import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  constrainProductEvidenceToDuration,
  isShortsVideo,
  removeLikelyPersonProducts,
  runScan,
} from "../src/services/scan-service.js";
import { candidateFixture, channelFixture, productFixture, videoFixture } from "./fixtures.js";

describe("isShortsVideo", () => {
  it("detects Shorts from title hashtags or short duration", () => {
    expect(isShortsVideo("인기 맛집 탐방 #shorts")).toBe(true);
    expect(isShortsVideo("일상 브이로그 #쇼츠")).toBe(true);
    expect(isShortsVideo("일반 영상", 45_000, 60)).toBe(true);
    expect(isShortsVideo("롱폼 메이크업", 600_000, 60)).toBe(false);
  });
});

describe("runScan", () => {
  it("skips Shorts videos by title or duration when EXCLUDE_SHORTS is enabled", async () => {
    const repository = {
      listEnabledChannels: vi.fn().mockResolvedValue([channelFixture]),
      claimVideoForAnalysis: vi.fn().mockResolvedValue(true),
      updateVideoAnalysis: vi.fn().mockResolvedValue(undefined),
      createCandidate: vi.fn(),
      setTelegramMessageId: vi.fn(),
    };
    const analyzer = { analyzeProducts: vi.fn() };
    const summary = await runScan({
      repository,
      rssClient: {
        fetchLatest: vi.fn().mockResolvedValue([
          { ...videoFixture, videoId: "short1", title: "숏폼 테스트 #shorts", publishedAt: new Date().toISOString() },
          { ...videoFixture, videoId: "short2", title: "짧은 영상", durationMs: 30_000, publishedAt: new Date().toISOString() },
        ]),
      },
      analyzer,
      notifier: { sendCandidate: vi.fn() },
      config: loadConfig({ NODE_ENV: "test", EXCLUDE_SHORTS: "true" }),
    });

    expect(summary.skippedVideos).toBe(2);
    expect(summary.analyzedVideos).toBe(0);
    expect(analyzer.analyzeProducts).not.toHaveBeenCalled();
    expect(repository.updateVideoAnalysis).toHaveBeenCalledWith("short1", "SKIPPED");
    expect(repository.updateVideoAnalysis).toHaveBeenCalledWith("short2", "SKIPPED");
  });

  it("clamps evidence outside the YouTube duration to valid duration bounds without dropping products", () => {
    const bounded = constrainProductEvidenceToDuration(
      {
        products: [
          {
            ...productFixture,
            evidence: [
              productFixture.evidence[0]!,
              { ...productFixture.evidence[0]!, startMs: 700_000, endMs: 701_000 },
            ],
          },
          {
            ...productFixture,
            productName: "길이 밖 제품",
            productNameRaw: "길이 밖 제품",
            evidence: [{ ...productFixture.evidence[0]!, startMs: 700_000, endMs: 701_000 }],
          },
        ],
      },
      600_000,
    );

    expect(bounded.products).toHaveLength(2);
    expect(bounded.products[1]?.evidence[0]?.startMs).toBe(599_000);
  });

  it("drops obvious person names misclassified as generic products", () => {
    const result = removeLikelyPersonProducts(
      {
        products: [
          {
            ...productFixture,
            productName: "허경환",
            productNameRaw: "허경환",
            brand: null,
            category: "기타",
            evidence: [{ ...productFixture.evidence[0]!, quote: "허경환, 15년 만에 식사 데이트" }],
          },
          productFixture,
        ],
      },
      "이민정",
    );

    expect(result.products.map((product) => product.productName)).toEqual([productFixture.productName]);
  });

  it("analyzes a newly claimed video and notifies each candidate", async () => {
    const repository = {
      listEnabledChannels: vi.fn().mockResolvedValue([channelFixture]),
      claimVideoForAnalysis: vi.fn().mockResolvedValue(true),
      updateVideoAnalysis: vi.fn().mockResolvedValue(undefined),
      createCandidate: vi.fn().mockResolvedValue({ candidate: candidateFixture(), created: true }),
      setTelegramMessageId: vi.fn().mockResolvedValue(undefined),
    };
    const notifier = {
      sendCandidate: vi.fn().mockResolvedValue(77),
      sendScanSummary: vi.fn().mockResolvedValue(88),
    };
    const summary = await runScan({
      repository,
      rssClient: {
        fetchLatest: vi.fn().mockResolvedValue([
          { ...videoFixture, publishedAt: new Date().toISOString() },
        ]),
      },
      analyzer: {
        analyzeProducts: vi.fn().mockResolvedValue({
          value: { products: [productFixture] },
          modelVersion: "gemini-test",
          usage: null,
        }),
      },
      notifier,
      config: loadConfig({ NODE_ENV: "test", SCAN_MAX_VIDEOS_PER_RUN: "20" }),
    });

    expect(summary).toMatchObject({ analyzedVideos: 1, candidates: 1, failedVideos: 0 });
    expect(repository.createCandidate).toHaveBeenCalledOnce();
    expect(notifier.sendCandidate).toHaveBeenCalledOnce();
    expect(notifier.sendScanSummary).toHaveBeenCalledWith(expect.objectContaining({ analyzedVideos: 1, candidates: 1 }));
    expect(repository.setTelegramMessageId).toHaveBeenCalledWith(
      candidateFixture().candidateId,
      77,
    );
  });


  it("ignores historical RSS entries before creating Firestore work", async () => {
    const repository = {
      listEnabledChannels: vi.fn().mockResolvedValue([channelFixture]),
      claimVideoForAnalysis: vi.fn().mockResolvedValue(true),
      updateVideoAnalysis: vi.fn(),
      createCandidate: vi.fn(),
      setTelegramMessageId: vi.fn(),
    };
    const summary = await runScan({
      repository,
      rssClient: { fetchLatest: vi.fn().mockResolvedValue([videoFixture]) },
      analyzer: { analyzeProducts: vi.fn() },
      notifier: { sendCandidate: vi.fn() },
      config: loadConfig({ NODE_ENV: "test", SCAN_LOOKBACK_HOURS: "24" }),
    });

    expect(summary.ignoredOldVideos).toBe(1);
    expect(repository.claimVideoForAnalysis).not.toHaveBeenCalled();
  });
});
