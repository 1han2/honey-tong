import { describe, expect, it } from "vitest";
import { evidenceSchema, scriptPlanSchema } from "../src/lib/schemas.js";

describe("media schemas", () => {
  it("rejects reversed evidence timestamps", () => {
    expect(
      evidenceSchema.safeParse({
        videoId: "abcDEF12345",
        startMs: 5_000,
        endMs: 4_000,
        quote: "테스트",
        kind: "quote",
      }).success,
    ).toBe(false);
  });

  it("accepts a mixed narration and source plan", () => {
    expect(
      scriptPlanSchema.safeParse({
        title: "테스트",
        scriptText: "전체 대본",
        segments: [
          { type: "narration", text: "관찰자 나레이션" },
          {
            type: "source_clip",
            videoId: "abcDEF12345",
            sourceStartMs: 1_000,
            sourceEndMs: 3_000,
            subtitle: "실제 발언",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("bounds evidence text before it can reach Telegram", () => {
    expect(
      evidenceSchema.safeParse({
        videoId: "abcDEF12345",
        startMs: 0,
        endMs: 1_000,
        quote: "x".repeat(501),
        kind: "quote",
      }).success,
    ).toBe(false);
  });
});
