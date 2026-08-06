import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { renderCandidate, validateSourceClipDurations } from "../src/services/media-production-service.js";
import { candidateFixture, videoFixture } from "./fixtures.js";

describe("renderCandidate", () => {
  it("rejects source clips outside the confirmed source duration", () => {
    expect(() =>
      validateSourceClipDurations(
        {
          title: "테스트",
          scriptText: "클립",
          segments: [
            {
              type: "source_clip",
              videoId: videoFixture.videoId,
              sourceStartMs: 9_000,
              sourceEndMs: 11_000,
              subtitle: "원본",
            },
          ],
        },
        new Map([[videoFixture.videoId, 10_000]]),
      ),
    ).toThrow(/exceeds source duration/);
  });

  it("uploads output, notifies review, and cleans temporary GCS objects", async () => {
    const candidate = candidateFixture({
      status: "PRODUCING",
      sourceAssets: [
        {
          videoId: videoFixture.videoId,
          sourceUrl: "https://media.example.com/source.mp4",
          rightsStatus: "CONFIRMED",
        },
      ],
    });
    const repository = { updateCandidate: vi.fn().mockResolvedValue(undefined) };
    const deleteTemporary = vi.fn().mockResolvedValue(undefined);
    const result = await renderCandidate(
      {
        candidate,
        scriptPlan: {
          title: "테스트",
          scriptText: "나레이션",
          segments: [{ type: "narration", text: "나레이션" }],
        },
      },
      {
        repository,
        mediaStore: {
          uploadRemoteSource: vi.fn().mockResolvedValue("gs://bucket/source/candidate/source.mp4"),
          uploadLocalFile: vi.fn().mockImplementation(async ({ objectName }) => `gs://bucket/${objectName}`),
          signedReadUrl: vi.fn().mockResolvedValue("https://storage.example.com/signed"),
          deleteCandidateTemporaryObjects: deleteTemporary,
        },
        tts: {
          synthesizeToFile: vi.fn().mockImplementation(async (_text, outputPath) => {
            await fs.writeFile(outputPath, Buffer.from("fake-mp3"));
            return 1_200;
          }),
        },
        renderer: vi.fn().mockImplementation(async ({ outputPath }) => {
          await fs.writeFile(outputPath, Buffer.from("fake-mp4-output"));
        }),
        notifier: {
          sendReview: vi.fn().mockResolvedValue(88),
          sendFailure: vi.fn().mockResolvedValue(89),
        },
        maxTempBytes: 1024 * 1024,
      },
    );

    expect(result.reviewMessageId).toBe(88);
    expect(result.outputUri).toContain(`/output/${candidate.candidateId}/output.mp4`);
    expect(deleteTemporary).toHaveBeenCalledWith(candidate.candidateId);
    expect(repository.updateCandidate).toHaveBeenCalledWith(
      candidate.candidateId,
      expect.objectContaining({ status: "COMPLETED" }),
    );
  });
});
