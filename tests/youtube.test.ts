import { describe, expect, it } from "vitest";
import { candidateIdFor } from "../src/lib/id.js";
import {
  canonicalYouTubeUrl,
  extractYouTubeVideoId,
  fetchYouTubeDurationMs,
  formatTimestamp,
  youtubeTimestampUrl,
} from "../src/lib/youtube.js";

describe("YouTube helpers", () => {
  it("creates canonical timestamp deep links", () => {
    expect(youtubeTimestampUrl("abcDEF12345", 192_999)).toBe(
      "https://www.youtube.com/watch?v=abcDEF12345&t=192s",
    );
    expect(canonicalYouTubeUrl("abcDEF12345")).toBe(
      "https://www.youtube.com/watch?v=abcDEF12345",
    );
    expect(extractYouTubeVideoId("https://youtu.be/abcDEF12345?t=10")).toBe("abcDEF12345");
  });

  it("formats minute and hour timestamps", () => {
    expect(formatTimestamp(192_000)).toBe("3:12");
    expect(formatTimestamp(3_723_000)).toBe("1:02:03");
  });

  it("reads duration metadata without downloading video bytes", async () => {
    const fetchImpl = async () =>
      new Response('<script>"lengthSeconds":"947"</script>', { status: 200 });
    await expect(
      fetchYouTubeDurationMs("https://www.youtube.com/watch?v=abcDEF12345", fetchImpl),
    ).resolves.toBe(947_000);
  });
});

describe("candidate IDs", () => {
  it("is deterministic across harmless product name differences", () => {
    expect(candidateIdFor("abcDEF12345", "알레시   타이머")).toBe(
      candidateIdFor("abcDEF12345", "알레시 타이머"),
    );
    expect(candidateIdFor("abcDEF12345", "알레시 타이머")).not.toBe(
      candidateIdFor("abcDEF12345", "다른 제품"),
    );
  });
});
