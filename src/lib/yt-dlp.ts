import fs from "node:fs/promises";
import { loadConfig } from "../config.js";
import { runCommand } from "./command.js";
import { logger } from "./logger.js";

/**
 * Parses raw proxy input (single or multiple, newline/comma separated, any format like ip:port:user:pass)
 * into a list of normalized proxy URLs (http://user:pass@ip:port).
 */
export const parseProxyList = (rawProxyStr?: string): string[] => {
  if (!rawProxyStr) return [];
  const lines = rawProxyStr.split(/[\r\n,]+/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    if (/^(https?|socks5|socks4):\/\//i.test(line)) return line;
    const parts = line.split(":");
    if (parts.length === 4) {
      if (parts[0]!.includes(".")) {
        // ip:port:user:pass
        const [ip, port, user, pwd] = parts;
        return `http://${user}:${pwd}@${ip}:${port}`;
      }
      // user:pass:ip:port
      const [user, pwd, ip, port] = parts;
      return `http://${user}:${pwd}@${ip}:${port}`;
    }
    return line;
  });
};

/**
 * Downloads a YouTube video directly to local disk using yt-dlp via proxy/cookies.
 * Downloading directly with yt-dlp ensures the CDN video chunks are requested through the same proxy IP.
 */
export const downloadDirectVideo = async (
  watchUrl: string,
  outputPath: string,
): Promise<void> => {
  const config = loadConfig();
  const proxies = parseProxyList(config.YOUTUBE_PROXY);
  const cookiesExists = await fs.access("/tmp/cookies.txt").then(() => true).catch(() => false);

  const attemptDownload = async (extraArgs: string[]): Promise<void> => {
    const commonArgs = [
      "--no-playlist",
      "--no-warnings",
      ...extraArgs,
    ];

    await runCommand("yt-dlp", [
      ...commonArgs,
      "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", outputPath,
      watchUrl,
    ]);
  };

  // 1. Try proxies in order (failover)
  if (proxies.length > 0) {
    let lastError: unknown;
    for (const [index, proxy] of proxies.entries()) {
      try {
        logger.info({ watchUrl, proxyIndex: index + 1, totalProxies: proxies.length }, "attempting yt-dlp direct video download via proxy");
        await attemptDownload(["--proxy", proxy]);
        return;
      } catch (err) {
        lastError = err;
        logger.warn({ watchUrl, proxyIndex: index + 1, error: String(err) }, "proxy video download failed, trying next proxy");
      }
    }
    throw new Error(`All ${proxies.length} proxies failed for ${watchUrl}: ${String(lastError)}`);
  }

  // 2. Fallback to cookies or android client
  if (cookiesExists) {
    return attemptDownload(["--cookies", "/tmp/cookies.txt"]);
  }

  return attemptDownload(["--extractor-args", "youtube:player_client=android"]);
};

/**
 * Resolves a YouTube watch URL to a direct video stream URL using yt-dlp.
 * Returns the best single-file MP4 stream URL that FFmpeg can consume.
 * Supports multi-proxy failover rotation.
 */
export const resolveDirectVideoUrl = async (
  watchUrl: string,
  signal?: AbortSignal,
): Promise<string> => {
  const config = loadConfig();
  const proxies = parseProxyList(config.YOUTUBE_PROXY);
  const cookiesExists = await fs.access("/tmp/cookies.txt").then(() => true).catch(() => false);

  const attemptResolution = async (extraArgs: string[]): Promise<string> => {
    const commonArgs = [
      "--no-download",
      "-g",
      "--no-playlist",
      "--no-warnings",
      ...extraArgs,
    ];

    const { stdout } = await runCommand("yt-dlp", [
      ...commonArgs,
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
      watchUrl,
    ]);

    const urls = stdout.trim().split("\n").filter(Boolean);
    if (urls.length === 0) {
      throw new Error(`yt-dlp returned no URLs for ${watchUrl}`);
    }

    if (urls.length > 1) {
      logger.info({ watchUrl, streamCount: urls.length }, "yt-dlp returned separate streams, requesting single stream");
      const { stdout: singleStdout } = await runCommand("yt-dlp", [
        ...commonArgs,
        "-f", "b[ext=mp4]/b",
        watchUrl,
      ]);

      const singleUrl = singleStdout.trim().split("\n").filter(Boolean)[0];
      if (singleUrl) return singleUrl;
    }

    return urls[0]!;
  };

  // 1. If proxies are configured, try proxies in order (failover)
  if (proxies.length > 0) {
    let lastError: unknown;
    for (const [index, proxy] of proxies.entries()) {
      try {
        logger.info({ watchUrl, proxyIndex: index + 1, totalProxies: proxies.length }, "attempting yt-dlp resolution via proxy");
        return await attemptResolution(["--proxy", proxy]);
      } catch (err) {
        lastError = err;
        logger.warn({ watchUrl, proxyIndex: index + 1, error: String(err) }, "proxy resolution failed, trying next proxy");
      }
    }
    throw new Error(`All ${proxies.length} proxies failed for ${watchUrl}: ${String(lastError)}`);
  }

  // 2. Fallback to cookies or android client if no proxies configured
  if (cookiesExists) {
    return attemptResolution(["--cookies", "/tmp/cookies.txt"]);
  }

  return attemptResolution(["--extractor-args", "youtube:player_client=android"]);
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
