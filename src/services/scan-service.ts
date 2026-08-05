import type { AppConfig } from "../config.js";
import { errorMessage } from "../lib/errors.js";
import type { GeminiResult } from "../lib/gemini.js";
import { logger } from "../lib/logger.js";
import type { Candidate, Channel, ProductAnalysis, Product, Video } from "../lib/schemas.js";

export type ScanRepository = {
  listEnabledChannels(): Promise<Channel[]>;
  claimVideoForAnalysis(video: Video): Promise<boolean>;
  updateVideoAnalysis(
    videoId: string,
    status: Video["analysisStatus"],
    lastError?: string | null,
  ): Promise<void>;
  updateVideoDuration?(videoId: string, durationMs: number): Promise<void>;
  createCandidate(input: {
    videoId: string;
    celebrityName: string;
    product: ProductAnalysis["products"][number];
    promptVersion: string;
    modelVersion: string;
  }): Promise<{ candidate: Candidate; created: boolean }>;
  setTelegramMessageId(candidateId: string, messageId: number): Promise<void>;
};

export type ScanDependencies = {
  repository: ScanRepository;
  rssClient: {
    fetchLatest(channel: Channel, signal?: AbortSignal): Promise<Video[]>;
    fetchDurationMs?(videoUrl: string, signal?: AbortSignal): Promise<number | null>;
  };
  analyzer: {
    analyzeProducts(videoUrl: string, videoDurationMs?: number | null): Promise<GeminiResult<ProductAnalysis>>;
  };
  notifier: {
    sendCandidate(candidate: Candidate, video: Video): Promise<number>;
    sendScanSummary?(summary: ScanSummary): Promise<number>;
  };

  config: AppConfig;
};

export type ScanSummary = {
  channels: number;
  feedErrors: number;
  claimedVideos: number;
  analyzedVideos: number;
  skippedVideos: number;
  ignoredOldVideos: number;
  failedVideos: number;
  candidates: number;
};

const shouldSkipByTitle = (title: string, regexSource?: string): boolean => {
  if (!regexSource) return false;
  return new RegExp(regexSource, "iu").test(title);
};

export const isShortsVideo = (
  title: string,
  durationMs?: number | null,
  minLongFormSeconds: number = 60,
): boolean => {
  if (/(?:#|＃)(?:shorts|쇼츠)/iu.test(title)) return true;
  if (durationMs !== null && durationMs !== undefined && durationMs > 0 && durationMs <= minLongFormSeconds * 1_000) {
    return true;
  }
  return false;
};



export const constrainProductEvidenceToDuration = (
  analysis: ProductAnalysis,
  durationMs: number | null | undefined,
): ProductAnalysis => {
  if (!durationMs || durationMs <= 0) return analysis;
  const products: Product[] = [];
  for (const product of analysis.products) {
    const evidence = product.evidence.filter(
      (item) =>
        item.startMs >= 0 &&
        item.startMs <= durationMs &&
        (item.endMs === undefined || (item.endMs > item.startMs && item.endMs <= durationMs)),
    );
    if (evidence.length > 0) products.push({ ...product, evidence });
  }
  return { products };
};


const likelyPersonName = (product: Product, channelCelebrityName: string): boolean => {
  const name = product.productName.trim();
  const compactName = name.replaceAll(/\s+/gu, "");
  if (name === channelCelebrityName.trim()) return true;
  if (product.brand !== null || product.category !== "기타") return false;
  if (!/^[가-힣]{2,4}$/u.test(compactName)) return false;
  const evidenceText = product.evidence.map((item) => item.quote).join(" ");
  return product.evidence.some(
    (item) =>
      item.quote.trim() === name ||
      new RegExp(`${compactName}(?:씨|님|와|과|이|가|을|를|의|에게)`, "u").test(item.quote) ||
      /(?:팬|데이트|배우|출연|인터뷰|성덕)/u.test(evidenceText),
  );
};

export const removeLikelyPersonProducts = (
  analysis: ProductAnalysis,
  channelCelebrityName: string,
): ProductAnalysis => ({
  products: analysis.products.filter((product) => !likelyPersonName(product, channelCelebrityName)),
});

export const runScan = async (dependencies: ScanDependencies): Promise<ScanSummary> => {
  const { repository, rssClient, analyzer, notifier, config } = dependencies;
  const channels = await repository.listEnabledChannels();
  const summary: ScanSummary = {
    channels: channels.length,
    feedErrors: 0,
    claimedVideos: 0,
    analyzedVideos: 0,
    skippedVideos: 0,
    ignoredOldVideos: 0,
    failedVideos: 0,
    candidates: 0,
  };

  let limitReached = false;
  const publishedCutoffMs = Date.now() - config.SCAN_LOOKBACK_HOURS * 60 * 60 * 1_000;
  for (const channel of channels) {
    if (limitReached) break;
    let videos: Video[];
    try {
      videos = await rssClient.fetchLatest(channel, AbortSignal.timeout(20_000));
    } catch (error) {
      summary.feedErrors += 1;
      logger.warn(
        { channelId: channel.youtubeChannelId, error: errorMessage(error) },
        "channel feed failed",
      );
      continue;
    }

    const selectedVideos = config.SCAN_VIDEO_ID
      ? videos.filter((video) => video.videoId === config.SCAN_VIDEO_ID)
      : videos;
    for (const video of selectedVideos.toSorted((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
      if (Date.parse(video.publishedAt) < publishedCutoffMs) {
        summary.ignoredOldVideos += 1;
        continue;
      }
      if (summary.claimedVideos >= config.SCAN_MAX_VIDEOS_PER_RUN) {
        limitReached = true;
        break;
      }

      const claimed = await repository.claimVideoForAnalysis(video);
      if (!claimed) continue;
      summary.claimedVideos += 1;

      if (shouldSkipByTitle(video.title, config.VIDEO_TITLE_EXCLUDE_REGEX)) {
        await repository.updateVideoAnalysis(video.videoId, "SKIPPED");
        summary.skippedVideos += 1;
        continue;
      }

      if (config.EXCLUDE_SHORTS && isShortsVideo(video.title, video.durationMs, config.MIN_LONG_FORM_SECONDS)) {
        await repository.updateVideoAnalysis(video.videoId, "SKIPPED");
        summary.skippedVideos += 1;
        logger.info({ videoId: video.videoId, title: video.title }, "skipped Shorts video by title");
        continue;
      }

      try {
        let durationMs = video.durationMs;
        if (durationMs === null && rssClient.fetchDurationMs) {
          try {
            durationMs = await rssClient.fetchDurationMs(video.videoUrl, AbortSignal.timeout(20_000));
            if (durationMs && repository.updateVideoDuration) {
              await repository.updateVideoDuration(video.videoId, durationMs);
            }
          } catch (error) {
            logger.warn({ videoId: video.videoId, error: errorMessage(error) }, "YouTube duration lookup failed");
          }
        }

        if (config.EXCLUDE_SHORTS && isShortsVideo(video.title, durationMs, config.MIN_LONG_FORM_SECONDS)) {
          await repository.updateVideoAnalysis(video.videoId, "SKIPPED");
          summary.skippedVideos += 1;
          logger.info({ videoId: video.videoId, durationMs, title: video.title }, "skipped Shorts video by duration");
          continue;
        }

        const analysis = await analyzer.analyzeProducts(video.videoUrl, durationMs);

        const boundedAnalysis = constrainProductEvidenceToDuration(analysis.value, durationMs);
        const productAnalysis = removeLikelyPersonProducts(boundedAnalysis, channel.celebrityName);
        if (durationMs && boundedAnalysis.products.length !== analysis.value.products.length) {
          logger.warn(
            {
              videoId: video.videoId,
              durationMs,
              originalProducts: analysis.value.products.length,
              boundedProducts: boundedAnalysis.products.length,
            },
            "dropped products with out-of-range YouTube timestamps",
          );
        }
        if (productAnalysis.products.length !== boundedAnalysis.products.length) {
          logger.warn(
            {
              videoId: video.videoId,
              before: boundedAnalysis.products.length,
              after: productAnalysis.products.length,
            },
            "dropped likely person-name product candidates",
          );
        }
        for (const product of productAnalysis.products) {
          const { candidate } = await repository.createCandidate({
            videoId: video.videoId,
            celebrityName: channel.celebrityName,
            product,
            promptVersion: "get-products.v2",
            modelVersion: analysis.modelVersion,
          });
          if (candidate.telegramMessageId === null) {
            const messageId = await notifier.sendCandidate(candidate, video);
            await repository.setTelegramMessageId(candidate.candidateId, messageId);
          }
          summary.candidates += 1;
        }
        await repository.updateVideoAnalysis(video.videoId, "ANALYZED");
        summary.analyzedVideos += 1;
      } catch (error) {
        summary.failedVideos += 1;
        const message = errorMessage(error).slice(0, 2_000);
        await repository.updateVideoAnalysis(video.videoId, "FAILED", message);
        logger.error(
          { videoId: video.videoId, channelId: channel.youtubeChannelId, error: message },
          "video analysis failed",
        );
      }
    }
  }

  if (notifier.sendScanSummary) {
    try {
      await notifier.sendScanSummary(summary);
    } catch (error) {
      logger.warn({ error: errorMessage(error) }, "failed to send scan summary notification");
    }
  }

  return summary;
};

