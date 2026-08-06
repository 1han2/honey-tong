import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireConfig } from "../config.js";
import { AppError, errorMessage } from "./errors.js";
import { logger } from "./logger.js";
import { normalizeGeminiJsonSchema } from "./json-schema.js";
import { getProductsPrompt, makeTranscriptPrompt } from "./prompts.js";
import {
  productAnalysisSchema,
  scriptPlanSchema,
  type Candidate,
  type ProductAnalysis,
  type ScriptPlan,
} from "./schemas.js";
import { withRetry } from "./retry.js";
import { extractYouTubeVideoId } from "./youtube.js";

const isRetryableGeminiError = (error: unknown): boolean => {
  const message = errorMessage(error);
  if (/prepayment credits are depleted|billing/i.test(message)) return false;
  return /\b(408|409|429|500|502|503|504)\b/.test(message) || /timeout|temporar/i.test(message);
};

export type GeminiResult<T> = {
  value: T;
  modelVersion: string;
  usage: unknown;
};

type GenerateRequest = {
  model: string;
  contents: unknown[];
  config: {
    temperature: number;
    responseMimeType: string;
    responseJsonSchema?: Record<string, unknown>;
    responseSchema?: Record<string, unknown>;
    mediaResolution?: string;
    abortSignal?: AbortSignal;
  };
};

type GenerateResponse = {
  text: string | undefined;
  modelVersion: string | undefined;
  usageMetadata: unknown | undefined;
};

const textValue = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const joined = value.map(textValue).filter((item): item is string => Boolean(item)).join(" ").trim();
    return joined || undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of [
    "text",
    "content",
    "value",
    "transcript",
    "spokenText",
    "spoken_text",
    "narration",
    "script",
    "subtitle",
    "caption",
    "quote",
  ]) {
    const result = textValue(record[key]);
    if (result) return result;
  }
  return undefined;
};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return Math.round(numeric);
    const match = /^(?:(\d+):)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (match) {
      const minutes = Number(match[1] ?? 0);
      const seconds = Number(match[2]);
      const fraction = Number(`0.${match[3] ?? "0"}`);
      return Math.round((minutes * 60 + seconds + fraction) * 1_000);
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["milliseconds", "millisecond", "ms", "value"]) {
      const result = numberValue(record[key]);
      if (result !== undefined) return result;
    }
  }
  return undefined;
};

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const firstValue = (record: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
};

const normalizeSingleSourceVideoId = (value: unknown, expectedVideoId: string): string => {
  const raw = textValue(value);
  if (!raw) return expectedVideoId;
  if (/^(?:v|video|source|youtube)[ _-]*(?:id)?[ _-]*1$/iu.test(raw) || /^(?:video|source)[ _-]*id$/iu.test(raw)) {
    return expectedVideoId;
  }
  try {
    return extractYouTubeVideoId(raw) === expectedVideoId ? expectedVideoId : raw;
  } catch {
    return raw;
  }
};

const parseTimedScriptLines = (scriptText: string | undefined, fallbackVideoId: string | undefined) => {
  if (!scriptText || !fallbackVideoId) return [];
  const lines: Array<{ videoId: string; startMs: number; subtitle: string }> = [];
  for (const line of scriptText.split(/\r?\n/)) {
    const match = /\[(?:V|v)(\d+)\s+(\d{1,2}:\d{2}(?:\.\d+)?)\]\s*:\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const timeMs = numberValue(match[2]);
    const subtitle = match[3]?.trim();
    if (timeMs === undefined || !subtitle) continue;
    lines.push({ videoId: fallbackVideoId, startMs: timeMs, subtitle });
  }
  return lines;
};

export class GeminiVideoAnalyzer {
  private readonly provider: AppConfig["GEMINI_PROVIDER"];
  private readonly model: string;
  private readonly scriptModel: string;
  private readonly mediaResolution: AppConfig["GEMINI_MEDIA_RESOLUTION"];
  private readonly timeoutMs: number;
  private readonly generateContentImpl: (request: GenerateRequest) => Promise<GenerateResponse>;

  constructor(
    config: AppConfig,
    generateContentImpl?: (request: GenerateRequest) => Promise<GenerateResponse>,
  ) {
    this.provider = config.GEMINI_PROVIDER;
    const ai =
      config.GEMINI_PROVIDER === "vertex"
        ? new GoogleGenAI({
            vertexai: true,
            project: requireConfig(config, "GOOGLE_CLOUD_PROJECT").GOOGLE_CLOUD_PROJECT,
            location: config.GEMINI_LOCATION,
            // The Vertex YouTube-file endpoint is available on v1. The SDK
            // currently defaults Vertex requests to v1beta1, which returns a
            // generic INVALID_ARGUMENT for this input type.
            httpOptions: { apiVersion: "v1" },
          })
        : new GoogleGenAI({ apiKey: requireConfig(config, "GEMINI_API_KEY").GEMINI_API_KEY });
    this.model = config.GEMINI_MODEL;
    this.scriptModel = config.GEMINI_SCRIPT_MODEL;
    this.mediaResolution = config.GEMINI_MEDIA_RESOLUTION;
    this.timeoutMs = config.GEMINI_TIMEOUT_MS;
    this.generateContentImpl =
      generateContentImpl ??
      (async (request) => {
        const response = await ai.models.generateContent(
          request as Parameters<typeof ai.models.generateContent>[0],
        );
        return {
          text: response.text,
          modelVersion: response.modelVersion,
          usageMetadata: response.usageMetadata,
        };
      });
  }

  async analyzeProducts(
    videoUrl: string,
    videoDurationMs?: number | null,
  ): Promise<GeminiResult<ProductAnalysis>> {
    const expectedVideoId = extractYouTubeVideoId(videoUrl);
    const prompt = await getProductsPrompt(expectedVideoId, videoDurationMs);
    return this.generateStructured({
      videoUrls: [videoUrl],
      prompt,
      schema: productAnalysisSchema,
      operation: "analyze-products",
      validate: (analysis) => {
        if (analysis.products.some((product) => product.evidence.some((item) => item.videoId !== expectedVideoId))) {
          throw new AppError(
            "GEMINI_SOURCE_MISMATCH",
            `Gemini evidence referenced a video other than ${expectedVideoId}`,
            { retryable: true },
          );
        }
      },
    });
  }

  async generateScript(input: {
    candidate: Candidate;
    videoUrls: string[];
  }): Promise<GeminiResult<ScriptPlan>> {
    const basePrompt = await makeTranscriptPrompt();
    const context = [
      basePrompt,
      "",
      "[승인된 입력]",
      `연예인 이름: ${input.candidate.celebrityName}`,
      `제품/아이템: ${input.candidate.product.productName}`,
      `제품 근거 JSON: ${JSON.stringify(input.candidate.product.evidence)}`,
      ...input.videoUrls.map((url, index) => `V${index + 1}: ${url}`),
    ].join("\n");

    const allowedVideoIds = new Set(input.videoUrls.map(extractYouTubeVideoId));
    return this.generateStructured({
      videoUrls: input.videoUrls,
      prompt: context,
      schema: scriptPlanSchema,
      operation: "generate-script",
      validate: (plan) => {
        if (
          plan.segments.some(
            (segment) => segment.type === "source_clip" && !allowedVideoIds.has(segment.videoId),
          )
        ) {
          throw new AppError("GEMINI_SOURCE_MISMATCH", "Script referenced an unknown source video", {
            retryable: true,
          });
        }
      },
    });
  }

  /**
   * Transcribe the actual spoken dialogue from a short video clip.
   * Used to correct AI-generated subtitles that may not match the real audio.
   */
  async transcribeClip(clipPath: string): Promise<string> {
    const fs = await import("node:fs/promises");
    const clipBytes = await fs.readFile(clipPath);
    const base64 = clipBytes.toString("base64");

    const response = await this.generateContentImpl({
      model: this.scriptModel,
      contents: [
        {
          inlineData: {
            mimeType: "video/mp4",
            data: base64,
          },
        },
        {
          text: [
            "이 영상 클립에서 사람이 실제로 말하는 대사를 정확히 받아적어라.",
            "규칙:",
            "- 실제 들리는 말만 적는다. 추측하거나 요약하지 않는다.",
            "- 아무 말도 안 들리면 빈 문자열을 반환한다.",
            "- 문장 끝에 마침표(.)를 붙이지 않는다.",
            "- JSON이 아니라 순수 텍스트만 반환한다.",
          ].join("\n"),
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "text/plain",
        abortSignal: AbortSignal.timeout(30_000),
      },
    });

    const text = response.text?.trim() ?? "";
    logger.info({ clipPath, transcribedLength: text.length }, "transcribed clip subtitle from actual audio");
    return text.replace(/\.+$/, "").trim();
  }

  private async generateStructured<T>(input: {
    videoUrls: string[];
    prompt: string;
    schema: z.ZodType<T>;
    operation: string;
    validate?: (value: T) => void;
  }): Promise<GeminiResult<T>> {
    return withRetry(
      async () => {
        const responseJsonSchema = normalizeGeminiJsonSchema(
          z.toJSONSchema(input.schema) as Record<string, unknown>,
        );
        const response = await this.generateContentImpl({
          model: input.operation === "generate-script" ? this.scriptModel : this.model,
          contents: [
            ...input.videoUrls.map((url) => ({
              // Direct Gemini accepts a YouTube fileUri without MIME metadata.
              // Vertex AI requires an explicit MIME type for the same input.
              fileData:
                this.provider === "vertex"
                  ? { fileUri: url, mimeType: "video/mp4" }
                  : { fileUri: url },
            })),
            { text: input.prompt },
          ],
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            abortSignal: AbortSignal.timeout(this.timeoutMs),
            // Vertex's v1 endpoint accepts JSON MIME output but rejects the
            // full Zod-derived schema dialect (notably nullable/type-array
            // fields) with a generic INVALID_ARGUMENT. Keep strict Zod
            // validation locally and let the model produce JSON. AI Studio
            // retains structured responseJsonSchema support.
            ...(this.provider === "vertex"
              ? { mediaResolution: this.mediaResolution }
              : { responseJsonSchema, mediaResolution: this.mediaResolution }),
          },
        });

        if (!response.text) {
          throw new AppError("GEMINI_EMPTY_RESPONSE", "Gemini returned no text", {
            retryable: true,
          });
        }

        let json: unknown;
        try {
          json = JSON.parse(response.text);
        } catch (error) {
          throw new AppError("GEMINI_INVALID_JSON", "Gemini returned invalid JSON", {
            retryable: true,
            cause: error,
          });
        }

        // Vertex JSON MIME responses occasionally omit the wrapper object
        // when the prompt asks for a list. Preserve the same internal
        // contract as the structured AI Studio path without weakening the
        // Zod validation of each product.
        let normalizedJson = json;
        if (this.provider === "vertex" && input.operation === "analyze-products") {
          const expectedVideoId = extractYouTubeVideoId(input.videoUrls[0]!);
          const products = Array.isArray(json)
            ? json
            : json && typeof json === "object" && Array.isArray((json as { products?: unknown }).products)
              ? (json as { products: unknown[] }).products
              : null;
          if (products) {
            normalizedJson = {
              products: products.map((product) => {
                if (!product || typeof product !== "object") return product;
                const value = product as Record<string, unknown>;
                const evidence = Array.isArray(value.evidence) ? value.evidence : [];
                return {
                  ...value,
                  productName: value.productName ?? value.product_name,
                  productNameRaw: value.productNameRaw ?? value.product_name_raw,
                  evidence: evidence.map((item) => {
                    if (!item || typeof item !== "object") return item;
                    const entry = item as Record<string, unknown>;
                    return {
                      ...entry,
                      // Vertex may omit the ID when only one source was sent.
                      // Fill that safe single-source default; mismatched IDs
                      // remain subject to semantic validation below.
                      videoId: normalizeSingleSourceVideoId(
                        entry.videoId ?? entry.video_id,
                        expectedVideoId,
                      ),
                      startMs: entry.startMs ?? entry.start_ms,
                      endMs: entry.endMs ?? entry.end_ms,
                    };
                  }),
                };
              }),
            };
          }
        }
        if (this.provider === "vertex" && input.operation === "generate-script" && normalizedJson) {
          const topLevelArray = Array.isArray(normalizedJson) ? normalizedJson : undefined;
          const value = recordValue(normalizedJson) ?? {};
          const segmentContainer = firstValue(value, ["segments", "editPlan", "edit_plan"]);
          let rawSegments = Array.isArray(segmentContainer)
            ? segmentContainer
            : Array.isArray(recordValue(segmentContainer)?.segments)
              ? (recordValue(segmentContainer)?.segments as unknown[])
              : Array.isArray(recordValue(segmentContainer)?.items)
                ? (recordValue(segmentContainer)?.items as unknown[])
                : [];
          const expectedVideoId = input.videoUrls.length === 1 ? extractYouTubeVideoId(input.videoUrls[0]!) : undefined;
          if (topLevelArray) {
            rawSegments = topLevelArray.flatMap((block) => {
              const speakerBlock = recordValue(block);
              const speaker = textValue(firstValue(speakerBlock ?? {}, ["speaker", "name"]));
              const utterances = Array.isArray(speakerBlock?.utterances) ? speakerBlock.utterances : [];
              return utterances.map((utterance) => {
                const item = recordValue(utterance) ?? {};
                const timeSec = numberValue(firstValue(item, ["timeSec", "time_sec", "seconds"]));
                const endSec = numberValue(firstValue(item, ["endSec", "end_sec", "endSeconds"]));
                return {
                  type: "source_clip",
                  videoId: expectedVideoId,
                  sourceStartMs:
                    timeSec !== undefined
                      ? timeSec * 1_000
                      : firstValue(item, ["startMs", "start_ms", "timeStampMs", "time_stamp_ms", "timeStamp", "time_stamp"]),
                  sourceEndMs:
                    endSec !== undefined
                      ? endSec * 1_000
                      : firstValue(item, ["endMs", "end_ms", "timeEndMs", "time_end_ms"]),
                  subtitle: textValue(firstValue(item, ["text", "content", "transcript", "quote"])) ?? speaker ?? "원본 영상 구간",
                };
              });
            });
          }
          let normalizedSegments = rawSegments.map((segment) => {
            const item = recordValue(segment) ?? {};
            const rawType = String(textValue(firstValue(item, ["type", "segmentType", "segment_type", "kind"])) ?? "")
              .trim()
              .toLowerCase()
              .replaceAll("-", "_");
            const explicitVideoId = textValue(
              firstValue(item, ["videoId", "video_id", "sourceVideoId", "source_video_id"]),
            );
            const videoId = explicitVideoId ?? expectedVideoId;
            const timeSec = numberValue(firstValue(item, ["timeSec", "time_sec", "seconds"]));
            const endSec = numberValue(firstValue(item, ["endSec", "end_sec", "endSeconds"]));
            const sourceStartMs = numberValue(
              firstValue(item, [
                "sourceStartMs",
                "source_start_ms",
                "startMs",
                "start_ms",
                "startTimeMs",
                "start_time_ms",
                "start",
                "timeStampMs",
                "time_stamp_ms",
                "timeStamp",
                "time_stamp",
              ]),
            );
            const sourceEndMs = numberValue(
              firstValue(item, [
                "sourceEndMs",
                "source_end_ms",
                "endMs",
                "end_ms",
                "endTimeMs",
                "end_time_ms",
                "end",
                "timeEndMs",
                "time_end_ms",
              ]),
            );
            const startMs = timeSec !== undefined ? timeSec * 1_000 : sourceStartMs;
            const endMs = endSec !== undefined ? endSec * 1_000 : sourceEndMs;
            const hasSourceTiming =
              startMs !== undefined || endMs !== undefined || Boolean(explicitVideoId);
            if (
              rawType.includes("source") ||
              rawType.includes("clip") ||
              rawType.includes("video") ||
              hasSourceTiming
            ) {
              const start = startMs ?? 0;
              const end = Math.max(endMs ?? start + 1_000, start + 1);
              return {
                type: "source_clip" as const,
                videoId,
                sourceStartMs: start,
                sourceEndMs: end,
                subtitle:
                  textValue(firstValue(item, ["subtitle", "text", "quote", "caption", "transcript", "content"])) ??
                  "원본 영상 구간",
              };
            }
            return {
              type: "narration" as const,
              text:
                textValue(firstValue(item, ["text", "narration", "script", "transcript", "content", "spokenText"])) ??
                "원본 영상 구간",
            };
          });
          // Vertex JSON-MIME responses sometimes keep the timestamped source
          // lines only in scriptText while returning placeholder narration
          // segments. Recover those source clips so Remotion still receives
          // real cut timings instead of rendering a black/placeholder block.
          const rawScriptText = textValue(firstValue(value, ["scriptText", "script_text", "script", "transcript"]));
          const timedLines = parseTimedScriptLines(rawScriptText, expectedVideoId);
          if (
            timedLines.length > 0 &&
            !normalizedSegments.some((segment) => segment.type === "source_clip")
          ) {
            let timedIndex = 0;
            normalizedSegments = normalizedSegments.map((segment) => {
              if (segment.type !== "narration" || segment.text !== "원본 영상 구간") return segment;
              const timed = timedLines[timedIndex++];
              if (!timed) return segment;
              return {
                type: "source_clip" as const,
                videoId: timed.videoId,
                sourceStartMs: timed.startMs,
                sourceEndMs: timed.startMs + 1_000,
                subtitle: timed.subtitle,
              };
            });
            while (timedIndex < timedLines.length) {
              const timed = timedLines[timedIndex++];
              if (!timed) break;
              normalizedSegments.push({
                type: "source_clip" as const,
                videoId: timed.videoId,
                sourceStartMs: timed.startMs,
                sourceEndMs: timed.startMs + 1_000,
                subtitle: timed.subtitle,
              });
            }
          }
          normalizedJson = {
            ...value,
            title: textValue(firstValue(value, ["title", "videoTitle", "video_title"])) ?? "제품 추천 쇼츠",
            hookTitle:
              textValue(firstValue(value, ["hookTitle", "hook_title", "hook"])) ??
              "연예인이 직접 추천한\n이 제품의 정체",
            scriptText:
              textValue(firstValue(value, ["scriptText", "script_text", "script", "transcript"])) ??
              normalizedSegments
                .map((segment) => (segment.type === "narration" ? segment.text : segment.subtitle))
                .join("\n"),
            segments: normalizedSegments,
          };
        }
        const parsed = input.schema.safeParse(normalizedJson);
        if (!parsed.success) {
          throw new AppError("GEMINI_SCHEMA_MISMATCH", z.prettifyError(parsed.error), {
            retryable: true,
          });
        }

        input.validate?.(parsed.data);

        logger.info(
          {
            operation: input.operation,
            modelVersion:
              response.modelVersion ?? (input.operation === "generate-script" ? this.scriptModel : this.model),
            usage: response.usageMetadata ?? null,
          },
          "Gemini request completed",
        );

        return {
          value: parsed.data,
          modelVersion:
            response.modelVersion ?? (input.operation === "generate-script" ? this.scriptModel : this.model),
          usage: response.usageMetadata ?? null,
        };
      },
      {
        attempts: 3,
        baseDelayMs: 1_000,
        shouldRetry: (error) =>
          error instanceof AppError ? error.retryable : isRetryableGeminiError(error),
        onRetry: (error, attempt, delayMs) => {
          logger.warn(
            { operation: input.operation, attempt, delayMs, error: errorMessage(error) },
            "retrying Gemini request",
          );
        },
      },
    );
  }
}
