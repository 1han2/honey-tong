import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { SmartTtsClient, SupertoneTtsClient } from "../src/lib/tts.js";

const configFixture: AppConfig = {
  NODE_ENV: "test",
  PORT: 8080,
  LOG_LEVEL: "info",
  GOOGLE_CLOUD_REGION: "asia-northeast3",
  FIRESTORE_DATABASE_ID: "(default)",
  GEMINI_PROVIDER: "api",
  GEMINI_MODEL: "gemini-3.5-flash-lite",
  GEMINI_SCRIPT_MODEL: "gemini-3.5-flash",
  GEMINI_LOCATION: "global",
  GEMINI_MEDIA_RESOLUTION: "MEDIA_RESOLUTION_LOW",
  GEMINI_TIMEOUT_MS: 180000,
  PRODUCE_JOB_NAME: "shorts-produce",
  TTS_LANGUAGE_CODE: "ko-KR",
  TTS_SPEAKING_RATE: 1.05,
  SCAN_MAX_VIDEOS_PER_RUN: 20,
  SCAN_LOOKBACK_HOURS: 24,
  EXCLUDE_SHORTS: true,
  MIN_LONG_FORM_SECONDS: 60,
  SIGNED_URL_HOURS: 168,
  MAX_TEMP_BYTES: 3 * 1024 * 1024 * 1024,
  SUPERTONE_API_KEY: "test-supertone-key",
  SUPERTONE_VOICE_ID: "test-voice-id",
};

describe("SupertoneTtsClient", () => {
  it("calls Supertone API with correct headers and body", async () => {
    const client = new SupertoneTtsClient(configFixture);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    } as Response);

    // We pass output path to synthesizeToFile (note: probeDurationMs mocked or running)
    const probeSpy = vi.spyOn(await import("../src/lib/media.js"), "probeDurationMs").mockResolvedValueOnce(1500);

    const duration = await client.synthesizeToFile("안녕하세요", "/tmp/test_supertone.mp3");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://supertoneapi.com/v1/text-to-speech/test-voice-id",
      expect.objectContaining({
        method: "POST",
        headers: {
          "x-sup-api-key": "test-supertone-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "안녕하세요",
          language: "ko",
          voice_settings: { speed: 1.05 },
        }),
      }),
    );
    expect(duration).toBe(1500);
    fetchSpy.mockRestore();
    probeSpy.mockRestore();
  });

  it("throws error if API returns non-200", async () => {
    const client = new SupertoneTtsClient(configFixture);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    } as Response);

    await expect(client.synthesizeToFile("테스트", "/tmp/err.mp3")).rejects.toThrow(
      "Supertone API error (400): Bad Request",
    );
    fetchSpy.mockRestore();
  });
});

describe("SmartTtsClient", () => {
  it("uses SupertoneTtsClient when keys are provided", async () => {
    const client = new SmartTtsClient(configFixture);
    const probeSpy = vi.spyOn(await import("../src/lib/media.js"), "probeDurationMs").mockResolvedValueOnce(2000);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    } as Response);

    const duration = await client.synthesizeToFile("테스트", "/tmp/smart_test.mp3");
    expect(duration).toBe(2000);

    fetchSpy.mockRestore();
    probeSpy.mockRestore();
  });
});
