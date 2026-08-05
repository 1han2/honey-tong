import { XMLParser } from "fast-xml-parser";
import type { Channel, Video } from "./schemas.js";
import { canonicalYouTubeUrl, fetchYouTubeDurationMs } from "./youtube.js";

type FeedEntry = {
  "yt:videoId"?: string;
  title?: string;
  published?: string;
};

type BrowseVideo = {
  videoId: string;
  title: string;
  publishedAt: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const relativePublishedAt = (label: string | undefined, nowMs = Date.now()): string => {
  if (!label) return new Date(nowMs).toISOString();
  const normalized = label.trim().toLowerCase();
  if (/^(방금 전|just now)$/iu.test(normalized)) return new Date(nowMs - 60_000).toISOString();
  if (/^(오늘|today)$/iu.test(normalized)) return new Date(nowMs - 60 * 60_000).toISOString();
  if (/^(어제|yesterday)$/iu.test(normalized)) return new Date(nowMs - 24 * 60 * 60_000).toISOString();

  const match = /^(\d+)\s*(분|시간|일|주|개월|년)\s*전$/u.exec(normalized) ??
    /^(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago$/iu.exec(normalized);
  if (!match) return new Date(nowMs).toISOString();
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const milliseconds = unit.startsWith("분") || unit.startsWith("minute")
    ? amount * 60_000
    : unit.startsWith("시간") || unit.startsWith("hour")
      ? amount * 60 * 60_000
      : unit.startsWith("일") || unit.startsWith("day")
        ? amount * 24 * 60 * 60_000
        : unit.startsWith("주") || unit.startsWith("week")
          ? amount * 7 * 24 * 60 * 60_000
          : unit.startsWith("개월") || unit.startsWith("month")
            ? amount * 30 * 24 * 60 * 60_000
            : amount * 365 * 24 * 60 * 60_000;
  return new Date(nowMs - milliseconds).toISOString();
};

const browseVideos = (payload: unknown): BrowseVideo[] => {
  const videos: BrowseVideo[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const lockup = record.lockupViewModel;
    if (lockup && typeof lockup === "object" && !Array.isArray(lockup)) {
      const view = lockup as Record<string, unknown>;
      const videoId = typeof view.contentId === "string" ? view.contentId.trim() : "";
      const contentType = typeof view.contentType === "string" ? view.contentType : "";
      const metadata =
        view.metadata && typeof view.metadata === "object" && !Array.isArray(view.metadata)
          ? (view.metadata as Record<string, unknown>).lockupMetadataViewModel
          : view.lockupMetadataViewModel;
      const title =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? ((metadata as Record<string, unknown>).title as Record<string, unknown> | undefined)?.content
          : undefined;
      const titleText = typeof title === "string" ? title.trim() : "";
      let publishedLabel: string | undefined;
      const rows =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? ((metadata as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
              ?.contentMetadataViewModel
          : undefined;
      const metadataRows =
        rows && typeof rows === "object" && !Array.isArray(rows)
          ? (rows as Record<string, unknown>).metadataRows
          : undefined;
      for (const row of Array.isArray(metadataRows) ? metadataRows : []) {
        if (!row || typeof row !== "object") continue;
        const parts = (row as Record<string, unknown>).metadataParts;
        for (const part of Array.isArray(parts) ? parts : []) {
          if (!part || typeof part !== "object") continue;
          const partRecord = part as Record<string, unknown>;
          const label = typeof partRecord.accessibilityLabel === "string" ? partRecord.accessibilityLabel : undefined;
          const content =
            partRecord.text && typeof partRecord.text === "object"
              ? (partRecord.text as Record<string, unknown>).content
              : undefined;
          const candidate = label ?? (typeof content === "string" ? content : undefined);
          if (candidate && /(?:전|ago|today|오늘|어제|yesterday|방금|just now)/iu.test(candidate)) {
            publishedLabel = candidate;
            break;
          }
        }
        if (publishedLabel) break;
      }
      if (
        contentType === "LOCKUP_CONTENT_TYPE_VIDEO" &&
        /^[A-Za-z0-9_-]{11}$/u.test(videoId) &&
        titleText &&
        !seen.has(videoId)
      ) {
        seen.add(videoId);
        videos.push({ videoId, title: titleText, publishedAt: relativePublishedAt(publishedLabel) });
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
  return videos;
};

export class YouTubeRssClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchLatest(channel: Channel, signal?: AbortSignal): Promise<Video[]> {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.youtubeChannelId)}`;
    const response = await this.fetchImpl(url, {
      headers: { "user-agent": "celebrity-affiliate-shorts/0.1" },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      // YouTube's public Atom endpoint intermittently returns 404. The
      // channel browse endpoint is also public and does not require a Data
      // API key, so use it as a lightweight fallback before failing the
      // channel. This avoids adding a paid/quota-bound dependency to the MVP.
      if (response.status === 404 || response.status >= 500) {
        return this.fetchBrowseLatest(channel, signal);
      }
      throw new Error(`YouTube RSS ${response.status} for ${channel.youtubeChannelId}`);
    }

    const parsed = parser.parse(await response.text()) as { feed?: { entry?: FeedEntry | FeedEntry[] } };
    return asArray(parsed.feed?.entry).flatMap((entry) => {
      const videoId = entry["yt:videoId"]?.trim();
      const title = entry.title?.trim();
      const publishedAt = entry.published ? new Date(entry.published).toISOString() : undefined;
      if (!videoId || !title || !publishedAt) return [];
      return [
        {
          videoId,
          channelId: channel.youtubeChannelId,
          title,
          videoUrl: canonicalYouTubeUrl(videoId),
          publishedAt,
          durationMs: null,
          analyzedAt: null,
          analysisStatus: "DISCOVERED" as const,
          analysisAttemptCount: 0,
          lastError: null,
        },
      ];
    });
  }

  private async fetchBrowseLatest(channel: Channel, signal?: AbortSignal): Promise<Video[]> {
    const response = await this.fetchImpl("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "celebrity-affiliate-shorts/0.1",
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20260804.01.00" } },
        browseId: channel.youtubeChannelId,
        params: "EgZ2aWRlb3PyBgQKAjoA",
      }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`YouTube RSS ${response.status}; browse fallback ${response.status} for ${channel.youtubeChannelId}`);
    }
    return browseVideos(await response.json()).map((video) => ({
      videoId: video.videoId,
      channelId: channel.youtubeChannelId,
      title: video.title,
      videoUrl: canonicalYouTubeUrl(video.videoId),
      publishedAt: video.publishedAt,
      durationMs: null,
      analyzedAt: null,
      analysisStatus: "DISCOVERED" as const,
      analysisAttemptCount: 0,
      lastError: null,
    }));
  }

  async fetchDurationMs(videoUrl: string, signal?: AbortSignal): Promise<number | null> {
    return fetchYouTubeDurationMs(videoUrl, this.fetchImpl, signal);
  }
}
