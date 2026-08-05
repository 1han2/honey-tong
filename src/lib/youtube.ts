import { AppError } from "./errors.js";

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

export const canonicalYouTubeUrl = (videoId: string): string => {
  if (!YOUTUBE_ID_PATTERN.test(videoId)) {
    throw new AppError("INVALID_VIDEO_ID", `Invalid YouTube video ID: ${videoId}`);
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
};

export const extractYouTubeVideoId = (url: string): string => {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const videoId = host === "youtu.be" ? parsed.pathname.slice(1).split("/")[0] : parsed.searchParams.get("v");
  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) {
    throw new AppError("INVALID_YOUTUBE_URL", `Could not extract video ID from URL: ${url}`);
  }
  return videoId;
};

/**
 * Fetches only the YouTube watch-page metadata needed to bound timestamps.
 * This never downloads video bytes; Gemini still receives the original
 * YouTube URL for multimodal analysis.
 */
export const fetchYouTubeDurationMs = async (
  videoUrl: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<number | null> => {
  const response = await fetchImpl(videoUrl, {
    headers: { "user-agent": "celebrity-affiliate-shorts/0.1" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return null;
  const html = await response.text();
  const lengthSeconds = /"lengthSeconds"\s*:\s*"(\d+)"/u.exec(html)?.[1];
  if (lengthSeconds) return Number(lengthSeconds) * 1_000;
  const approxDurationMs = /"approxDurationMs"\s*:\s*"(\d+)"/u.exec(html)?.[1];
  if (approxDurationMs) return Number(approxDurationMs);
  return null;
};

export const youtubeTimestampUrl = (videoId: string, startMs: number): string => {
  const seconds = Math.max(0, Math.floor(startMs / 1000));
  return `${canonicalYouTubeUrl(videoId)}&t=${seconds}s`;
};

export const formatTimestamp = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const minuteText = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const prefix = hours > 0 ? `${hours}:` : "";
  return `${prefix}${minuteText}:${String(remainingSeconds).padStart(2, "0")}`;
};
