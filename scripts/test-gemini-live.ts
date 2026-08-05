import { loadConfig } from "../src/config.js";
import { GeminiVideoAnalyzer } from "../src/lib/gemini.js";

const videoUrl =
  process.env.GEMINI_TEST_VIDEO_URL ?? "https://www.youtube.com/watch?v=9hE5-98ZeCg";
const result = await new GeminiVideoAnalyzer(loadConfig()).analyzeProducts(videoUrl);

process.stdout.write(
  JSON.stringify(
    {
      videoUrl,
      modelVersion: result.modelVersion,
      productCount: result.value.products.length,
      products: result.value.products.map((product) => ({
        productName: product.productName,
        evidenceCount: product.evidence.length,
      })),
    },
    null,
    2,
  ) + "\n",
);
