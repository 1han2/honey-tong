import { errorMessage } from "../lib/errors.js";
import type { GeminiResult } from "../lib/gemini.js";
import { logger } from "../lib/logger.js";
import type { Candidate, ScriptPlan, Video } from "../lib/schemas.js";

export type ProduceRepository = {
  claimCandidateForProduction(candidateId: string): Promise<Candidate | null>;
  getVideo(videoId: string): Promise<Video | null>;
  saveScript(candidateId: string, scriptPlan: ScriptPlan): Promise<void>;
  updateCandidate(
    candidateId: string,
    patch: Partial<Pick<Candidate, "status" | "lastStep" | "lastError" | "modelVersion" | "sourceAssets">>,
  ): Promise<void>;

};

export type ProduceDependencies = {
  repository: ProduceRepository;
  scriptGenerator: {
    generateScript(input: {
      candidate: Candidate;
      videoUrls: string[];
    }): Promise<GeminiResult<ScriptPlan>>;
  };
  notifier: {
    sendStatus(text: string): Promise<number>;
    sendFailure(input: { candidate: Candidate; message: string }): Promise<number>;
  };
};

export type ProduceResult =
  | { status: "NOT_CLAIMED" }
  | { status: "SOURCE_REQUIRED"; candidateId: string }
  | { status: "READY_FOR_MEDIA"; candidate: Candidate; video: Video; scriptPlan: ScriptPlan };

export const prepareProduction = async (
  candidateId: string,
  dependencies: ProduceDependencies,
): Promise<ProduceResult> => {
  const candidate = await dependencies.repository.claimCandidateForProduction(candidateId);
  if (!candidate) return { status: "NOT_CLAIMED" };

  try {
    const video = await dependencies.repository.getVideo(candidate.videoId);
    if (!video) throw new Error(`Video not found: ${candidate.videoId}`);

    // A source-registration retry or Telegram re-render already has a validated
    // script plan. Reusing it avoids another paid Gemini request and keeps the
    // render deterministic. Only the first approval needs script generation.
    const generated = candidate.scriptPlan
      ? { value: candidate.scriptPlan, modelVersion: candidate.modelVersion }
      : await dependencies.scriptGenerator.generateScript({
          candidate,
          videoUrls: [video.videoUrl],
        });
    if (!candidate.scriptPlan) {
      await dependencies.repository.saveScript(candidateId, generated.value);
      await dependencies.repository.updateCandidate(candidateId, {
        modelVersion: generated.modelVersion,
      });
    }

    let confirmedSources = candidate.sourceAssets.filter(
      (source) => source.rightsStatus === "CONFIRMED",
    );

    let updatedSourceAssets = candidate.sourceAssets;

    // Auto-register YouTube URL as confirmed source for channels the user has vetted.
    if (confirmedSources.length === 0) {
      const autoSource = {
        videoId: candidate.videoId,
        sourceUrl: video.videoUrl,
        rightsStatus: "CONFIRMED" as const,
      };
      updatedSourceAssets = [...candidate.sourceAssets, autoSource];
      await dependencies.repository.updateCandidate(candidateId, {
        sourceAssets: updatedSourceAssets,
        lastStep: "SOURCE_AUTO_REGISTERED",
        lastError: null,
      });
      confirmedSources = [autoSource];
      logger.info({ candidateId, videoId: candidate.videoId }, "auto-registered YouTube URL as confirmed source");
    }

    const updatedCandidate = {
      ...candidate,
      sourceAssets: updatedSourceAssets,
    };

    return {
      status: "READY_FOR_MEDIA",
      candidate: { ...updatedCandidate, scriptPlan: generated.value, scriptText: generated.value.scriptText },
      video,
      scriptPlan: generated.value,
    };

  } catch (error) {
    const message = errorMessage(error).slice(0, 2_000);
    await dependencies.repository.updateCandidate(candidateId, {
      status: "FAILED",
      lastStep: "PREPARE_PRODUCTION",
      lastError: message,
    });
    try {
      await dependencies.notifier.sendFailure({ candidate, message });
    } catch (notificationError) {
      logger.error(
        { candidateId, error: errorMessage(notificationError) },
        "failed to send production failure notification",
      );
    }
    logger.error({ candidateId, error: message }, "production preparation failed");
    throw error;
  }
};
