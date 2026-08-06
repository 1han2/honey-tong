import { Storage } from "@google-cloud/storage";
import { Firestore } from "@google-cloud/firestore";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { runCommand } from "../src/lib/command.js";
import { logger } from "../src/lib/logger.js";
import { CloudRunJobClient } from "../src/lib/cloud-run.js";

async function main() {
  const config = loadConfig();
  const storage = new Storage({
    ...(config.GOOGLE_CLOUD_PROJECT ? { projectId: config.GOOGLE_CLOUD_PROJECT } : {}),
  });
  const firestore = new Firestore({
    ...(config.GOOGLE_CLOUD_PROJECT ? { projectId: config.GOOGLE_CLOUD_PROJECT } : {}),
    databaseId: config.FIRESTORE_DATABASE_ID ?? "(default)",
  });
  const bucketName = config.MEDIA_BUCKET;
  if (!bucketName) throw new Error("MEDIA_BUCKET must be set");

  const jobClient = new CloudRunJobClient(config);

  logger.info("🚀 Mac Mini YouTube Downloader Daemon started!");
  logger.info({ bucketName }, "Listening for candidates with pending source downloads in GCS...");

  const processPendingCandidate = async (docData: any) => {
    const candidateId = docData.candidateId;
    const videoId = docData.videoId;
    const videoUrl = docData.sourceAssets?.[0]?.sourceUrl || `https://www.youtube.com/watch?v=${videoId}`;
    if (!candidateId || !videoId) return;

    const gcsPrefix = `source/${candidateId}/${videoId}.`;
    const [existing] = await storage.bucket(bucketName).getFiles({ prefix: gcsPrefix });
    if (existing.length > 0) return; // Already downloaded to GCS

    logger.info({ candidateId, videoId, videoUrl }, "📥 Mac Mini downloading source video from YouTube via home IP...");

    const tempDir = path.join("/tmp", "mac_downloader");
    await fs.mkdir(tempDir, { recursive: true });
    const localPath = path.join(tempDir, `${candidateId}_${videoId}.mp4`);

    try {
      await runCommand("yt-dlp", [
        "--no-playlist",
        "--no-warnings",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", localPath,
        videoUrl,
      ]);

      const objectName = `source/${candidateId}/${videoId}.mp4`;
      logger.info({ candidateId, objectName }, "📤 Uploading downloaded video to GCS...");
      await storage.bucket(bucketName).upload(localPath, { destination: objectName });
      logger.info({ candidateId, objectName }, "✅ Uploaded source video to GCS successfully!");

      await fs.unlink(localPath).catch(() => {});

      // Trigger Cloud Run produce job to render video
      logger.info({ candidateId }, "🚀 Triggering Cloud Run produce job...");
      await jobClient.startProduce(candidateId);
    } catch (err) {
      logger.error({ candidateId, error: String(err) }, "❌ Failed to download or upload source video on Mac Mini");
    }
  };

  while (true) {
    try {
      const snapshot = await firestore
        .collection("candidates")
        .where("status", "==", "APPROVED")
        .limit(20)
        .get();

      for (const doc of snapshot.docs) {
        await processPendingCandidate(doc.data());
      }
    } catch (err) {
      logger.error({ error: String(err) }, "Error in Mac Mini downloader daemon polling loop");
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
}

main().catch((err) => {
  console.error("Fatal error in mac downloader daemon:", err);
  process.exit(1);
});
