import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";
import type { AppConfig } from "../config.js";
import { requireConfig } from "../config.js";
import { isYouTubeWatchUrl, resolveDirectVideoUrl, downloadDirectVideo } from "./yt-dlp.js";
import { downloadViaGitHub } from "./github-downloader.js";
import { logger } from "./logger.js";

const contentTypeExtension = (contentType: string | null): string => {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    default:
      return "mp4";
  }
};

export class GcsMediaStore {
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly signedUrlHours: number;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    const required = requireConfig(config, "MEDIA_BUCKET");
    this.storage = new Storage({
      ...(config.GOOGLE_CLOUD_PROJECT ? { projectId: config.GOOGLE_CLOUD_PROJECT } : {}),
    });
    this.bucketName = required.MEDIA_BUCKET;
    this.signedUrlHours = config.SIGNED_URL_HOURS;
    this.config = config;
  }

  async uploadRemoteSource(input: {
    candidateId: string;
    videoId: string;
    sourceUrl: string;
  }): Promise<string> {
    if (isYouTubeWatchUrl(input.sourceUrl)) {
      // 1. If YOUTUBE_PROXY is set, download directly to disk via yt-dlp through proxy (avoids CDN IP 403)
      if (this.config.YOUTUBE_PROXY) {
        logger.info({ videoId: input.videoId }, "downloading YouTube video via yt-dlp with YOUTUBE_PROXY");
        const tempPath = `/tmp/youtube_${input.videoId}.mp4`;
        await downloadDirectVideo(input.sourceUrl, tempPath);
        const objectName = `source/${input.candidateId}/${input.videoId}.mp4`;
        const gcsUri = await this.uploadLocalFile({
          localPath: tempPath,
          objectName,
          contentType: "video/mp4",
        });
        await fs.promises.unlink(tempPath).catch(() => {});
        return gcsUri;
      }

      // 2. Otherwise if GitHub Actions integration is configured, delegate to GitHub Actions
      if (this.config.GITHUB_TOKEN && this.config.GITHUB_REPO) {
        logger.info({ videoId: input.videoId }, "delegating YouTube download to GitHub Actions");
        return downloadViaGitHub({
          videoId: input.videoId,
          candidateId: input.candidateId,
          config: this.config,
        });
      }

      // 3. Fallback to direct resolution & fetch
      logger.info({ videoId: input.videoId }, "resolving YouTube URL via yt-dlp fallback");
      const downloadUrl = await resolveDirectVideoUrl(input.sourceUrl);
      const response = await fetch(downloadUrl, {
        headers: { "user-agent": "celebrity-affiliate-shorts/0.1" },
        redirect: "follow",
        signal: AbortSignal.timeout(10 * 60 * 1_000),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Source download failed: ${response.status}`);
      }
      const contentType = response.headers.get("content-type") ?? "video/mp4";
      const extension = contentTypeExtension(contentType);
      const objectName = `source/${input.candidateId}/${input.videoId}.${extension}`;
      const file = this.storage.bucket(this.bucketName).file(objectName);
      const destination = file.createWriteStream({
        resumable: true,
        metadata: { contentType },
      });
      await pipeline(
        Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
        destination,
      );
      return `gs://${this.bucketName}/${objectName}`;
    }

    // Non-YouTube URLs → direct download as before
    const response = await fetch(input.sourceUrl, {
      headers: { "user-agent": "celebrity-affiliate-shorts/0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(10 * 60 * 1_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Source download failed: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "video/mp4";
    if (!contentType.startsWith("video/") && !contentType.startsWith("application/octet-stream")) {
      throw new Error(`Source URL did not return video content: ${contentType}`);
    }
    const extension = contentTypeExtension(contentType);
    const objectName = `source/${input.candidateId}/${input.videoId}.${extension}`;
    const file = this.storage.bucket(this.bucketName).file(objectName);
    const destination = file.createWriteStream({
      resumable: true,
      metadata: { contentType },
    });
    await pipeline(
      Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      destination,
    );
    return `gs://${this.bucketName}/${objectName}`;
  }


  async uploadLocalFile(input: {
    localPath: string;
    objectName: string;
    contentType: string;
  }): Promise<string> {
    await pipeline(
      fs.createReadStream(input.localPath),
      this.storage.bucket(this.bucketName).file(input.objectName).createWriteStream({
        resumable: false,
        metadata: { contentType: input.contentType },
      }),
    );
    return `gs://${this.bucketName}/${input.objectName}`;
  }

  async signedReadUrl(gcsUri: string, hours = this.signedUrlHours): Promise<string> {
    const { bucket, objectName } = this.parseUri(gcsUri);
    const [url] = await this.storage.bucket(bucket).file(objectName).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + hours * 60 * 60 * 1_000,
    });
    return url;
  }

  async deleteCandidateTemporaryObjects(candidateId: string): Promise<void> {
    const bucket = this.storage.bucket(this.bucketName);
    await Promise.all([
      bucket.deleteFiles({ prefix: `source/${candidateId}/`, force: true }),
      bucket.deleteFiles({ prefix: `tts/${candidateId}/`, force: true }),
    ]);
  }

  private parseUri(uri: string): { bucket: string; objectName: string } {
    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
    if (!match?.[1] || !match[2]) throw new Error(`Invalid GCS URI: ${uri}`);
    return { bucket: match[1], objectName: match[2] };
  }
}
