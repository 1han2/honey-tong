import fs from "node:fs/promises";
import { loadConfig } from "../config.js";
import { runCommand } from "./command.js";
import { logger } from "./logger.js";

/**
 * Resolves a YouTube watch URL to a direct video stream URL using yt-dlp.
 * Returns the best single-file MP4 stream URL that FFmpeg can consume.
 *
 * yt-dlp must be installed in the runtime environment (Dockerfile.job).
 */
export const resolveDirectVideoUrl = async (
  watchUrl: string,
  signal?: AbortSignal,
): Promise<string> => {
  const config = loadConfig();

  // Check if cookies.txt is staged
  const cookiesExists = await fs.access("/tmp/cookies.txt").then(() => true).catch(() => false);
  const commonArgs = [
    "--no-download",
    "-g",                       // print URL only
    "--no-playlist",
    "--no-warnings",
  ];

  if (config.YOUTUBE_PROXY) {
    logger.info("Using YOUTUBE_PROXY for yt-dlp resolution");
    commonArgs.push("--proxy", config.YOUTUBE_PROXY);
  } else if (cookiesExists) {
    commonArgs.push("--cookies", "/tmp/cookies.txt");
  } else {
    // Standard bypass argument to impersonate android client
    commonArgs.push("--extractor-args", "youtube:player_client=android");
  }

  const { stdout } = await runCommand("yt-dlp", [
    ...commonArgs,
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    watchUrl,
  ]);

  const urls = stdout.trim().split("\n").filter(Boolean);
  if (urls.length === 0) {
    throw new Error(`yt-dlp returned no URLs for ${watchUrl}`);
  }

  // When video+audio are separate streams, yt-dlp prints two URLs.
  // We need a single URL for FFmpeg's -i. If there are two,
  // re-request with a single-stream format.
  if (urls.length > 1) {
    logger.info({ watchUrl, streamCount: urls.length }, "yt-dlp returned separate streams, requesting single stream");
    const { stdout: singleStdout } = await runCommand("yt-dlp", [
      ...commonArgs,
      "-f", "b[ext=mp4]/b",   // best single stream
      watchUrl,
    ]);

    const singleUrl = singleStdout.trim().split("\n").filter(Boolean)[0];
    if (singleUrl) return singleUrl;
  }

  return urls[0]!;
};

const YOUTUBE_HOST_PATTERN = /^(?:www\.)?(?:youtube\.com|youtu\.be)$/i;

/**
 * Returns true if the URL points to a YouTube watch page or short URL.
 */
export const isYouTubeWatchUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return YOUTUBE_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
};
