import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";
import type { AppConfig } from "../config.js";
import { requireConfig } from "../config.js";
import { isYouTubeWatchUrl, resolveDirectVideoUrl, downloadDirectVideo } from "./yt-dlp.js";
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
    // 0. Check if source asset already exists in GCS bucket to avoid redundant downloads
    const existingPrefix = `source/${input.candidateId}/${input.videoId}.`;
    for (let check = 0; check < 5; check++) {
      const [existingFiles] = await this.storage.bucket(this.bucketName).getFiles({ prefix: existingPrefix });
      if (existingFiles.length > 0 && existingFiles[0]) {
        logger.info({ candidateId: input.candidateId, videoId: input.videoId }, "source asset already staged in GCS, reusing existing file");
        return `gs://${this.bucketName}/${existingFiles[0].name}`;
      }
      if (check < 4) {
        await new Promise((res) => setTimeout(res, 3000));
      }
    }

    if (isYouTubeWatchUrl(input.sourceUrl)) {
      // 1. If YOUTUBE_PROXY is set, try downloading directly to disk via yt-dlp through proxy
      if (this.config.YOUTUBE_PROXY) {
        try {
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
        } catch (proxyError) {
          logger.warn({ videoId: input.videoId, error: String(proxyError) }, "YOUTUBE_PROXY download failed, attempting direct resolution fallback");
        }
      }

      // 2. Fallback to direct resolution & fetch
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

    // Non-YouTube URLs → direct download
    const response = await fetch(input.sourceUrl, {
      signal: AbortSignal.timeout(10 * 60 * 1_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Source download failed: ${response.status}`);
    }
    const contentType = response.headers.get("content-type");
    const extension = contentTypeExtension(contentType);
    const objectName = `source/${input.candidateId}/${input.videoId}.${extension}`;
    const file = this.storage.bucket(this.bucketName).file(objectName);
    const destination = file.createWriteStream({
      resumable: true,
      metadata: contentType ? { contentType } : {},
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
    contentType?: string;
  }): Promise<string> {
    const file = this.storage.bucket(this.bucketName).file(input.objectName);
    await file.save(await fs.promises.readFile(input.localPath), {
      metadata: input.contentType ? { contentType: input.contentType } : {},
      resumable: false,
    });
    return `gs://${this.bucketName}/${input.objectName}`;
  }

  async signedReadUrl(gcsUri: string): Promise<string> {
    const { bucket, objectName } = parseGcsUri(gcsUri);
    const [url] = await this.storage
      .bucket(bucket)
      .file(objectName)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + this.signedUrlHours * 60 * 60 * 1_000,
      });
    return url;
  }

  async isSourceAssetUploaded(candidateId: string, videoId: string): Promise<boolean> {
    const prefix = `source/${candidateId}/${videoId}.`;
    const [files] = await this.storage.bucket(this.bucketName).getFiles({ prefix });
    return files.length > 0;
  }

  async deleteCandidateTemporaryObjects(candidateId: string): Promise<void> {
    // Preserve staged source assets in GCS to support instant re-renders without yt-dlp re-downloads
  }
}

export function parseGcsUri(gcsUri: string): { bucket: string; objectName: string } {
  if (!gcsUri.startsWith("gs://")) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }
  const slice = gcsUri.slice("gs://".length);
  const slashIndex = slice.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }
  return {
    bucket: slice.slice(0, slashIndex),
    objectName: slice.slice(slashIndex + 1),
  };
}
