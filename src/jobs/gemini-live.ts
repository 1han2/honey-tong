import { loadConfig } from "../config.js";
import { GeminiVideoAnalyzer } from "../lib/gemini.js";
import { logger } from "../lib/logger.js";
import { fetchYouTubeDurationMs } from "../lib/youtube.js";

const videoArgument = process.argv.find((argument) => argument.startsWith("--video-url="));
const videoUrl = videoArgument?.slice("--video-url=".length);
if (!videoUrl) throw new Error("Missing required --video-url=<public YouTube URL> argument");

const durationMs = await fetchYouTubeDurationMs(videoUrl, fetch, AbortSignal.timeout(20_000));
const result = await new GeminiVideoAnalyzer(loadConfig()).analyzeProducts(videoUrl, durationMs);
logger.info(
  {
    videoUrl,
    modelVersion: result.modelVersion,
    productCount: result.value.products.length,
    products: result.value.products.map((product) => ({
      productName: product.productName,
      evidenceCount: product.evidence.length,
    })),
  },
  "live Gemini analysis completed",
);
