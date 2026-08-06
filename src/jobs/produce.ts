import { loadConfig } from "../config.js";
import { ShortsRepository } from "../lib/firestore.js";
import { GeminiVideoAnalyzer } from "../lib/gemini.js";
import { logger } from "../lib/logger.js";
import { probeRemoteDurationMs } from "../lib/media.js";
import { GcsMediaStore } from "../lib/storage.js";
import { TelegramClient } from "../lib/telegram.js";
import { SmartTtsClient } from "../lib/tts.js";
import { renderShorts } from "../../remotion/render.js";
import { renderCandidate } from "../services/media-production-service.js";
import { prepareProduction } from "../services/produce-service.js";

const candidateArgument = process.argv.find((argument) => argument.startsWith("--candidate-id="));
const candidateId = candidateArgument?.slice("--candidate-id=".length);
if (!candidateId) {
  throw new Error("Missing required --candidate-id=<id> argument");
}

const config = loadConfig();
const repository = new ShortsRepository(config);
const telegram = new TelegramClient(config);

const result = await prepareProduction(candidateId, {
  repository,
  scriptGenerator: new GeminiVideoAnalyzer(config),
  notifier: telegram,
});

if (result.status === "READY_FOR_MEDIA") {
  const output = await renderCandidate(
    { candidate: result.candidate, scriptPlan: result.scriptPlan },
    {
      repository,
      mediaStore: new GcsMediaStore(config),
      probeDuration: probeRemoteDurationMs,
      tts: new SmartTtsClient(config),
      renderer: renderShorts,
      notifier: telegram,
      maxTempBytes: config.MAX_TEMP_BYTES,
    },
  );
  logger.info({ candidateId, ...output }, "produce job completed");
} else {
  logger.info({ candidateId, status: result.status }, "produce job completed");
}
