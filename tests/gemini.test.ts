import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { GeminiVideoAnalyzer } from "../src/lib/gemini.js";
import { candidateFixture } from "./fixtures.js";

const config = loadConfig({
  NODE_ENV: "test",
  GEMINI_API_KEY: "test-key",
  GEMINI_MODEL: "gemini-test",
});

describe("GeminiVideoAnalyzer", () => {
  it("passes YouTube URLs as fileUri without a wildcard MIME type", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({ products: [] }),
      modelVersion: "gemini-test",
      usageMetadata: { promptTokenCount: 1 },
    });
    const analyzer = new GeminiVideoAnalyzer(config, generateContent);

    const result = await analyzer.analyzeProducts("https://www.youtube.com/watch?v=abcDEF12345");

    expect(result.value).toEqual({ products: [] });
    expect(generateContent).toHaveBeenCalledOnce();
    const request = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ fileData?: Record<string, unknown> }>;
      config: { responseJsonSchema?: Record<string, unknown>; responseSchema?: unknown; mediaResolution?: unknown };
    };
    expect(request.contents[0]?.fileData).toEqual({
      fileUri: "https://www.youtube.com/watch?v=abcDEF12345",
    });
    expect((generateContent.mock.calls[0]?.[0] as { model: string }).model).toBe("gemini-test");
  });

  it("uses the dedicated script model for final script generation", async () => {
    const scriptConfig = loadConfig({
      NODE_ENV: "test",
      GEMINI_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-product-test",
      GEMINI_SCRIPT_MODEL: "gemini-script-test",
    });
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: "테스트 제목",
        hookTitle: "첫 줄\n둘째 줄",
        scriptText: "대본",
        segments: [{ type: "narration", text: "대본" }],
      }),
      modelVersion: "gemini-script-test",
    });
    const analyzer = new GeminiVideoAnalyzer(scriptConfig, generateContent);

    await analyzer.generateScript({
      candidate: candidateFixture(),
      videoUrls: ["https://www.youtube.com/watch?v=abcDEF12345"],
    });

    expect((generateContent.mock.calls[0]?.[0] as { model: string }).model).toBe("gemini-script-test");
  });

  it("rejects evidence that references a different video", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        products: [
          {
            productName: "테스트",
            productNameRaw: "테스트",
            brand: null,
            category: "기타",
            evidence: [
              {
                videoId: "otherVideo1",
                startMs: 1_000,
                endMs: 2_000,
                quote: "테스트",
                kind: "quote",
              },
            ],
          },
        ],
      }),
      modelVersion: "gemini-test",
    });
    const analyzer = new GeminiVideoAnalyzer(config, generateContent);

    await expect(
      analyzer.analyzeProducts("https://www.youtube.com/watch?v=abcDEF12345"),
    ).rejects.toMatchObject({ code: "GEMINI_SOURCE_MISMATCH" });
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("adds the required MIME type for Vertex YouTube inputs", async () => {
    const vertexConfig = loadConfig({
      NODE_ENV: "test",
      GOOGLE_CLOUD_PROJECT: "test-project",
      GEMINI_PROVIDER: "vertex",
      GEMINI_MODEL: "gemini-2.5-flash-lite",
    });
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({ products: [] }),
      modelVersion: "gemini-2.5-flash-lite",
      usageMetadata: null,
    });
    const analyzer = new GeminiVideoAnalyzer(vertexConfig, generateContent);

    await analyzer.analyzeProducts("https://www.youtube.com/watch?v=abcDEF12345");

    const request = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ fileData?: Record<string, unknown> }>;
      config: { responseJsonSchema?: Record<string, unknown>; responseSchema?: unknown; mediaResolution?: unknown };
    };
    expect(request.contents[0]?.fileData).toEqual({
      fileUri: "https://www.youtube.com/watch?v=abcDEF12345",
      mimeType: "video/mp4",
    });
    expect(request.config.responseJsonSchema).toBeUndefined();
    expect(request.config.responseSchema).toBeUndefined();
    expect(request.config.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
  });

  it("normalizes a Vertex top-level product array", async () => {
    const vertexConfig = loadConfig({
      NODE_ENV: "test",
      GOOGLE_CLOUD_PROJECT: "test-project",
      GEMINI_PROVIDER: "vertex",
      GEMINI_MODEL: "gemini-2.5-flash-lite",
    });
    const generateContent = vi.fn().mockResolvedValue({
      text: "[]",
      modelVersion: "gemini-2.5-flash-lite",
      usageMetadata: null,
    });
    const analyzer = new GeminiVideoAnalyzer(vertexConfig, generateContent);

    await expect(
      analyzer.analyzeProducts("https://www.youtube.com/watch?v=abcDEF12345"),
    ).resolves.toMatchObject({ value: { products: [] } });
  });

  it("maps single-source Vertex labels such as V1 to the actual YouTube ID", async () => {
    const vertexConfig = loadConfig({
      NODE_ENV: "test",
      GOOGLE_CLOUD_PROJECT: "test-project",
      GEMINI_PROVIDER: "vertex",
      GEMINI_MODEL: "gemini-2.5-flash-lite",
    });
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        products: [
          {
            product_name: "테스트 제품",
            product_name_raw: "테스트 제품",
            brand: null,
            category: "기타",
            evidence: [
              { video_id: "V1", start_ms: 1_000, end_ms: 2_000, quote: "테스트", kind: "quote" },
            ],
          },
        ],
      }),
      modelVersion: "gemini-2.5-flash-lite",
      usageMetadata: null,
    });
    const analyzer = new GeminiVideoAnalyzer(vertexConfig, generateContent);

    const result = await analyzer.analyzeProducts("https://www.youtube.com/watch?v=abcDEF12345");

    expect(result.value.products[0]?.evidence[0]?.videoId).toBe("abcDEF12345");
  });

  it("normalizes Vertex script segment variants into the internal edit plan", async () => {
    const vertexConfig = loadConfig({
      NODE_ENV: "test",
      GOOGLE_CLOUD_PROJECT: "test-project",
      GEMINI_PROVIDER: "vertex",
      GEMINI_MODEL: "gemini-2.5-flash-lite",
    });
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: "테스트 제목",
        hook_title: "첫 줄\n둘째 줄",
        script_text: "나레이션과 원본을 조합합니다.",
        edit_plan: [
          { segment_type: "clip", video_id: "abcDEF12345", start_ms: 1_000, end_ms: 2_000, quote: "원본 자막" },
          { text: "나레이션 문장" },
        ],
      }),
      modelVersion: "gemini-2.5-flash-lite",
      usageMetadata: null,
    });
    const analyzer = new GeminiVideoAnalyzer(vertexConfig, generateContent);

    const result = await analyzer.generateScript({
      candidate: candidateFixture(),
      videoUrls: ["https://www.youtube.com/watch?v=abcDEF12345"],
    });

    expect(result.value).toMatchObject({
      title: "테스트 제목",
      hookTitle: "첫 줄\n둘째 줄",
      scriptText: "나레이션과 원본을 조합합니다.",
      segments: [
        {
          type: "source_clip",
          videoId: "abcDEF12345",
          sourceStartMs: 1_000,
          sourceEndMs: 2_000,
          subtitle: "원본 자막",
        },
        { type: "narration", text: "나레이션 문장" },
      ],
    });
  });

  it("normalizes Vertex transcript arrays with speaker utterances", async () => {
    const vertexConfig = loadConfig({
      NODE_ENV: "test",
      GOOGLE_CLOUD_PROJECT: "test-project",
      GEMINI_PROVIDER: "vertex",
      GEMINI_MODEL: "gemini-2.5-flash-lite",
    });
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify([
        {
          speaker: "테스트 출연자",
          utterances: [{ time_sec: 2, quote: "제품을 소개합니다." }],
        },
      ]),
      modelVersion: "gemini-2.5-flash-lite",
      usageMetadata: null,
    });
    const analyzer = new GeminiVideoAnalyzer(vertexConfig, generateContent);

    const result = await analyzer.generateScript({
      candidate: candidateFixture(),
      videoUrls: ["https://www.youtube.com/watch?v=abcDEF12345"],
    });

    expect(result.value.segments).toEqual([
      {
        type: "source_clip",
        videoId: "abcDEF12345",
        sourceStartMs: 2_000,
        sourceEndMs: 3_000,
        subtitle: "제품을 소개합니다.",
      },
    ]);
    expect(result.value.scriptText).toContain("제품을 소개합니다.");
  });

  it("recovers timestamped source clips from a Vertex scriptText fallback", async () => {
    const vertexConfig = loadConfig({
      NODE_ENV: "test",
      GOOGLE_CLOUD_PROJECT: "test-project",
      GEMINI_PROVIDER: "vertex",
      GEMINI_MODEL: "gemini-2.5-flash-lite",
    });
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: "테스트 제목",
        scriptText: "나레이션: 제품을 소개합니다.\n출연자 [V1 00:02]: 정말 좋아요.",
        segments: [
          { type: "narration", text: "나레이션: 제품을 소개합니다." },
          { type: "narration", text: "원본 영상 구간" },
        ],
      }),
      modelVersion: "gemini-2.5-flash-lite",
      usageMetadata: null,
    });
    const analyzer = new GeminiVideoAnalyzer(vertexConfig, generateContent);

    const result = await analyzer.generateScript({
      candidate: candidateFixture(),
      videoUrls: ["https://www.youtube.com/watch?v=abcDEF12345"],
    });

    expect(result.value.segments).toEqual([
      { type: "narration", text: "나레이션: 제품을 소개합니다." },
      {
        type: "source_clip",
        videoId: "abcDEF12345",
        sourceStartMs: 2_000,
        sourceEndMs: 3_000,
        subtitle: "정말 좋아요.",
      },
    ]);
  });
});
