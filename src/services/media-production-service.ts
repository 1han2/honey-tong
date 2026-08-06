import fs from "node:fs/promises";
import path from "node:path";
import type { ShortsRenderProps } from "../../remotion/types.js";
import type { Candidate, ScriptPlan, TtsAsset } from "../lib/schemas.js";
import { errorMessage } from "../lib/errors.js";
import { extractSourceClip } from "../lib/media.js";
import { logger } from "./../lib/logger.js";
import { TempWorkspace } from "../lib/temp-workspace.js";

export type MediaRepository = {
  updateCandidate(candidateId: string, patch: Partial<Candidate>): Promise<void>;
};

export type MediaProductionDependencies = {
  repository: MediaRepository;
  mediaStore: {
    uploadRemoteSource(input: {
      candidateId: string;
      videoId: string;
      sourceUrl: string;
    }): Promise<string>;
    uploadLocalFile(input: {
      localPath: string;
      objectName: string;
      contentType: string;
    }): Promise<string>;
    signedReadUrl(gcsUri: string, hours?: number): Promise<string>;
    deleteCandidateTemporaryObjects(candidateId: string): Promise<void>;
  };
  tts: { synthesizeToFile(text: string, outputPath: string): Promise<number> };
  clipTranscriber?: { transcribeClip(clipPath: string): Promise<string> };
  probeDuration?(sourceUrl: string): Promise<number>;
  renderer: (input: {
    publicDir: string;
    outputPath: string;
    props: ShortsRenderProps;
    concurrency?: number;
  }) => Promise<void>;
  notifier: {
    sendReview(input: { candidate: Candidate; signedUrl: string }): Promise<number>;
    sendFailure(input: { candidate: Candidate; message: string }): Promise<number>;
  };
  maxTempBytes: number;
};

export const validateSourceClipDurations = (
  scriptPlan: ScriptPlan,
  sourceDurations: ReadonlyMap<string, number>,
  toleranceMs = 250,
): void => {
  for (const segment of scriptPlan.segments) {
    if (segment.type !== "source_clip") continue;
    const durationMs = sourceDurations.get(segment.videoId);
    if (durationMs === undefined) continue;
    if (segment.sourceStartMs >= durationMs || segment.sourceEndMs > durationMs + toleranceMs) {
      throw new Error(
        `Source clip ${segment.videoId} (${segment.sourceStartMs}-${segment.sourceEndMs}ms) exceeds source duration ${durationMs}ms`,
      );
    }
  }
};

export const renderCandidate = async (
  input: { candidate: Candidate; scriptPlan: ScriptPlan },
  dependencies: MediaProductionDependencies,
): Promise<{ outputUri: string; outputSizeBytes: number; reviewMessageId: number }> => {
  const { candidate, scriptPlan } = input;
  const workspace = await TempWorkspace.create(dependencies.maxTempBytes);
  const fontsSrc = path.resolve("remotion/public/fonts");
  const fontsDst = path.join(workspace.publicDir, "fonts");
  await fs.cp(fontsSrc, fontsDst, { recursive: true }).catch(() => {});

  try {
    const confirmedSources = candidate.sourceAssets.filter(
      (source) => source.rightsStatus === "CONFIRMED",
    );
    const requiredVideoIds = new Set(
      scriptPlan.segments
        .filter((segment): segment is Extract<ScriptPlan["segments"][number], { type: "source_clip" }> => segment.type === "source_clip")
        .map((segment) => segment.videoId),
    );
    const sourceUris: string[] = [];
    const signedSourceUrls = new Map<string, string>();
    const sourceDurations = new Map<string, number>();

    for (const videoId of requiredVideoIds) {
      const source = confirmedSources.find((item) => item.videoId === videoId);
      if (!source) throw new Error(`No confirmed source asset for video ${videoId}`);
      const uri = await dependencies.mediaStore.uploadRemoteSource({
        candidateId: candidate.candidateId,
        videoId: source.videoId,
        sourceUrl: source.sourceUrl,
      });
      sourceUris.push(uri);
      const signedUrl = await dependencies.mediaStore.signedReadUrl(uri, 1);
      signedSourceUrls.set(source.videoId, signedUrl);
      if (dependencies.probeDuration) {
        sourceDurations.set(source.videoId, await dependencies.probeDuration(signedUrl));
      }
    }
    validateSourceClipDurations(scriptPlan, sourceDurations);
    await dependencies.repository.updateCandidate(candidate.candidateId, {
      sourceUris,
      lastStep: "SOURCES_STAGED",
      lastError: null,
    });

    const ttsAssets: TtsAsset[] = [];
    const renderSegments: ShortsRenderProps["segments"] = [];

    for (const [index, segment] of scriptPlan.segments.entries()) {
      if (segment.type === "narration") {
        const fileName = `narration-${String(index).padStart(2, "0")}.mp3`;
        const localPath = workspace.assetPath(fileName);
        const durationMs = await dependencies.tts.synthesizeToFile(segment.text, localPath);
        const uri = await dependencies.mediaStore.uploadLocalFile({
          localPath,
          objectName: `tts/${candidate.candidateId}/${fileName}`,
          contentType: "audio/mpeg",
        });
        ttsAssets.push({ segmentIndex: index, uri, durationMs });

        // Extract continuous background video clip for narration segment
        let anchorVideoId = candidate.videoId;
        let anchorStartMs = candidate.product.evidence[0]?.startMs ?? 0;

        const nextSegment = scriptPlan.segments[index + 1];
        const prevSegment = scriptPlan.segments[index - 1];
        if (nextSegment?.type === "source_clip") {
          anchorVideoId = nextSegment.videoId;
          anchorStartMs = Math.max(0, nextSegment.sourceStartMs - durationMs);
        } else if (prevSegment?.type === "source_clip") {
          anchorVideoId = prevSegment.videoId;
          anchorStartMs = prevSegment.sourceEndMs;
        }

        const bgFileName = `narration-bg-${String(index).padStart(2, "0")}.mp4`;
        const bgSourceUrl = signedSourceUrls.get(anchorVideoId);
        if (bgSourceUrl) {
          await extractSourceClip({
            sourceUrl: bgSourceUrl,
            startMs: anchorStartMs,
            endMs: anchorStartMs + durationMs,
            outputPath: workspace.assetPath(bgFileName),
          });
        }

        renderSegments.push({
          type: "narration",
          fileName,
          videoFileName: bgSourceUrl ? bgFileName : undefined,
          durationMs,
          text: segment.text,
        });
      } else {
        const sourceUrl = signedSourceUrls.get(segment.videoId);
        if (!sourceUrl) {
          throw new Error(`No confirmed source asset for video ${segment.videoId}`);
        }
        const fileName = `source-${String(index).padStart(2, "0")}.mp4`;
        const clipPath = workspace.assetPath(fileName);
        await extractSourceClip({
          sourceUrl,
          startMs: segment.sourceStartMs,
          endMs: segment.sourceEndMs,
          outputPath: clipPath,
        });
        const durationMs = segment.sourceEndMs - segment.sourceStartMs;

        // Transcribe the actual audio from the cut clip to fix subtitle sync
        let subtitle = segment.subtitle;
        if (dependencies.clipTranscriber) {
          try {
            const transcribed = await dependencies.clipTranscriber.transcribeClip(clipPath);
            if (transcribed.length > 0) {
              logger.info(
                { index, original: segment.subtitle, transcribed },
                "corrected subtitle from actual clip audio",
              );
              subtitle = transcribed;
            }
          } catch (err) {
            logger.warn({ index, error: String(err) }, "clip transcription failed, using original subtitle");
          }
        }

        renderSegments.push({
          type: "source_clip",
          fileName,
          durationMs,
          subtitle,
        });
      }
      await workspace.assertWithinLimit();
    }

    await dependencies.repository.updateCandidate(candidate.candidateId, {
      ttsAssets,
      lastStep: "MEDIA_PREPARED",
      lastError: null,
    });

    const outputPath = workspace.outputPath();
    await dependencies.renderer({
      publicDir: workspace.publicDir,
      outputPath,
      props: {
        title: scriptPlan.title,
        hookTitle: scriptPlan.hookTitle ?? scriptPlan.title,
        productName: candidate.product.productName,
        segments: renderSegments,
      },
      concurrency: 2,
    });
    await workspace.assertWithinLimit();

    const outputSizeBytes = (await fs.stat(outputPath)).size;
    const outputUri = await dependencies.mediaStore.uploadLocalFile({
      localPath: outputPath,
      objectName: `output/${candidate.candidateId}/output.mp4`,
      contentType: "video/mp4",
    });
    const outputDeleteAfter = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString();
    await dependencies.repository.updateCandidate(candidate.candidateId, {
      status: "COMPLETED",
      outputUri,
      outputSizeBytes,
      outputDeleteAfter,
      lastStep: "OUTPUT_UPLOADED",
      lastError: null,
    });

    const signedUrl = await dependencies.mediaStore.signedReadUrl(outputUri);
    const reviewMessageId = await dependencies.notifier.sendReview({ candidate, signedUrl });
    await dependencies.repository.updateCandidate(candidate.candidateId, {
      reviewMessageId,
      lastStep: "REVIEW_NOTIFIED",
      lastError: null,
    });

    await dependencies.mediaStore.deleteCandidateTemporaryObjects(candidate.candidateId);
    await dependencies.repository.updateCandidate(candidate.candidateId, {
      sourceUris: [],
      ttsAssets: [],
    });

    return { outputUri, outputSizeBytes, reviewMessageId };
  } catch (error) {
    const message = errorMessage(error).slice(0, 2_000);
    await dependencies.repository.updateCandidate(candidate.candidateId, {
      status: "FAILED",
      lastStep: "MEDIA_PRODUCTION",
      lastError: message,
    });
    try {
      await dependencies.notifier.sendFailure({ candidate, message });
    } catch (notificationError) {
      logger.error(
        { candidateId: candidate.candidateId, error: errorMessage(notificationError) },
        "failed to send media failure notification",
      );
    }
    logger.error({ candidateId: candidate.candidateId, error: message }, "media production failed");
    throw error;
  } finally {
    await workspace.cleanup();
  }
};
