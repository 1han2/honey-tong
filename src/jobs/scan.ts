import { loadConfig } from "../config.js";
import { ShortsRepository } from "../lib/firestore.js";
import { GeminiVideoAnalyzer } from "../lib/gemini.js";
import { logger } from "../lib/logger.js";
import { YouTubeRssClient } from "../lib/rss.js";
import { TelegramClient } from "../lib/telegram.js";
import { runScan } from "../services/scan-service.js";

const config = loadConfig();
const summary = await runScan({
  repository: new ShortsRepository(config),
  rssClient: new YouTubeRssClient(),
  analyzer: new GeminiVideoAnalyzer(config),
  notifier: new TelegramClient(config),
  config,
});

logger.info(summary, "scan job completed");
