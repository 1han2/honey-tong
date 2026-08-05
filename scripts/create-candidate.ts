import { loadConfig } from "../src/config.js";
import { ShortsRepository } from "../src/lib/firestore.js";
import { GeminiVideoAnalyzer } from "../src/lib/gemini.js";
import { TelegramClient } from "../src/lib/telegram.js";
import { extractYouTubeVideoId, fetchYouTubeDurationMs } from "../src/lib/youtube.js";
import {
  constrainProductEvidenceToDuration,
  removeLikelyPersonProducts,
} from "../src/services/scan-service.js";
import { nowIso } from "../src/lib/time.js";

const getArgument = (name: string): string | undefined =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);

const videoUrl = getArgument("video-url");
const celebrityName = getArgument("celebrity-name");
const title = getArgument("title");
if (!videoUrl || !celebrityName || !title) {
  throw new Error(
    "Usage: tsx scripts/create-candidate.ts --video-url=<url> --celebrity-name=<name> --title=<title>",
  );
}

const config = loadConfig();
const videoId = extractYouTubeVideoId(videoUrl);
const repository = new ShortsRepository(config);
const durationMs = await fetchYouTubeDurationMs(videoUrl, fetch, AbortSignal.timeout(20_000));
const video = {
  videoId,
  channelId: "manual-import",
  title,
  videoUrl,
  publishedAt: nowIso(),
  durationMs,
  analysisStatus: "DISCOVERED" as const,
  analysisAttemptCount: 0,
  analyzedAt: null,
  lastError: null,
};

await repository.claimVideoForAnalysis(video);
const analysis = await new GeminiVideoAnalyzer(config).analyzeProducts(videoUrl, durationMs);
const boundedAnalysis = constrainProductEvidenceToDuration(analysis.value, durationMs);
const productAnalysis = removeLikelyPersonProducts(boundedAnalysis, celebrityName);
for (const product of productAnalysis.products) {
  const { candidate } = await repository.createCandidate({
    videoId,
    celebrityName,
    product,
    promptVersion: "get-products.v2",
    modelVersion: analysis.modelVersion,
  });
  if (candidate.telegramMessageId === null) {
    const messageId = await new TelegramClient(config).sendCandidate(candidate, video);
    await repository.setTelegramMessageId(candidate.candidateId, messageId);
  }
  console.log(JSON.stringify({ candidateId: candidate.candidateId, product: product.productName }));
}
await repository.updateVideoAnalysis(videoId, "ANALYZED");
