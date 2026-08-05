import { describe, expect, it, vi } from "vitest";
import { prepareProduction } from "../src/services/produce-service.js";
import { candidateFixture, videoFixture } from "./fixtures.js";

describe("prepareProduction", () => {
  it("auto-registers YouTube URL and proceeds to READY_FOR_MEDIA", async () => {
    const candidate = candidateFixture({ status: "PRODUCING" });
    const plan = {
      title: "테스트",
      scriptText: "나레이션: 테스트",
      segments: [{ type: "narration" as const, text: "테스트" }],
    };
    const repository = {
      claimCandidateForProduction: vi.fn().mockResolvedValue(candidate),
      getVideo: vi.fn().mockResolvedValue(videoFixture),
      saveScript: vi.fn().mockResolvedValue(undefined),
      updateCandidate: vi.fn().mockResolvedValue(undefined),
    };
    const result = await prepareProduction(candidate.candidateId, {
      repository,
      scriptGenerator: {
        generateScript: vi.fn().mockResolvedValue({ value: plan, modelVersion: "gemini-test", usage: null }),
      },
      notifier: {
        sendStatus: vi.fn().mockResolvedValue(1),
        sendFailure: vi.fn().mockResolvedValue(2),
      },
    });

    expect(result.status).toBe("READY_FOR_MEDIA");
    expect(repository.saveScript).toHaveBeenCalledWith(candidate.candidateId, plan);
    // Auto source registration should have been called
    expect(repository.updateCandidate).toHaveBeenCalledWith(
      candidate.candidateId,
      expect.objectContaining({ sourceAssets: expect.any(Array), lastStep: "SOURCE_AUTO_REGISTERED" }),
    );
  });

  it("reuses a saved script without another Gemini call", async () => {
    const plan = {
      title: "저장된 대본",
      scriptText: "이미 생성된 나레이션",
      segments: [{ type: "narration" as const, text: "이미 생성된 나레이션" }],
    };
    const candidate = candidateFixture({ status: "PRODUCING", scriptPlan: plan, scriptText: plan.scriptText });
    const repository = {
      claimCandidateForProduction: vi.fn().mockResolvedValue(candidate),
      getVideo: vi.fn().mockResolvedValue(videoFixture),
      saveScript: vi.fn().mockResolvedValue(undefined),
      updateCandidate: vi.fn().mockResolvedValue(undefined),
    };
    const generateScript = vi.fn();

    const result = await prepareProduction(candidate.candidateId, {
      repository,
      scriptGenerator: { generateScript },
      notifier: {
        sendStatus: vi.fn().mockResolvedValue(1),
        sendFailure: vi.fn().mockResolvedValue(2),
      },
    });

    expect(result.status).toBe("READY_FOR_MEDIA");
    expect(generateScript).not.toHaveBeenCalled();
    expect(repository.saveScript).not.toHaveBeenCalled();
  });
});
