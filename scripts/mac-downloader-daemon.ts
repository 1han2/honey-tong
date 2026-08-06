import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../src/lib/command.js";
import { logger } from "../src/lib/logger.js";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "honeytong";
const BUCKET_NAME = process.env.MEDIA_BUCKET || "honeytong-shorts-media";

function getAccessToken(): string {
  return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

interface CandidateDoc {
  candidateId: string;
  videoId: string;
  sourceUrl?: string;
  status: string;
}

async function fetchApprovedCandidates(): Promise<CandidateDoc[]> {
  const token = getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/candidates`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  const docs = data.documents || [];
  const results: CandidateDoc[] = [];

  for (const doc of docs) {
    const fields = doc.fields || {};
    const status = fields.status?.stringValue || "";
    if (status !== "APPROVED") continue;

    const candidateId = fields.candidateId?.stringValue || doc.name?.split("/").pop() || "";
    const videoId = fields.videoId?.stringValue || "";
    let sourceUrl = "";
    const sourceAssets = fields.sourceAssets?.arrayValue?.values || [];
    if (sourceAssets.length > 0) {
      sourceUrl = sourceAssets[0]?.mapValue?.fields?.sourceUrl?.stringValue || "";
    }
    if (!sourceUrl && videoId) {
      sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
    }

    if (candidateId && videoId) {
      results.push({ candidateId, videoId, sourceUrl, status });
    }
  }
  return results;
}

async function checkGcsFileExists(candidateId: string, videoId: string): Promise<boolean> {
  try {
    const gcsUri = `gs://${BUCKET_NAME}/source/${candidateId}/${videoId}.mp4`;
    const { stdout } = await runCommand("gcloud", ["storage", "ls", gcsUri]);
    return stdout.includes(gcsUri);
  } catch {
    return false;
  }
}

async function main() {
  logger.info({ PROJECT_ID, BUCKET_NAME }, "🚀 Mac Mini YouTube Downloader Daemon started!");
  logger.info("Polling Firestore for APPROVED candidates to download via Mac Mini home IP...");

  const processed = new Set<string>();

  while (true) {
    try {
      const candidates = await fetchApprovedCandidates();
      for (const candidate of candidates) {
        if (processed.has(candidate.candidateId)) continue;

        const exists = await checkGcsFileExists(candidate.candidateId, candidate.videoId);
        if (exists) {
          processed.add(candidate.candidateId);
          continue;
        }

        processed.add(candidate.candidateId);
        logger.info({ candidateId: candidate.candidateId, videoId: candidate.videoId }, "📥 Mac Mini downloading YouTube video via home IP...");

        const tempDir = path.join("/tmp", "mac_downloader");
        await fs.mkdir(tempDir, { recursive: true });
        const localPath = path.join(tempDir, `${candidate.candidateId}_${candidate.videoId}.mp4`);

        try {
          await runCommand("yt-dlp", [
            "--no-playlist",
            "--no-warnings",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", localPath,
            candidate.sourceUrl!,
          ]);

          const gcsDest = `gs://${BUCKET_NAME}/source/${candidate.candidateId}/${candidate.videoId}.mp4`;
          logger.info({ candidateId: candidate.candidateId, gcsDest }, "📤 Uploading downloaded video to GCS...");
          await runCommand("gcloud", ["storage", "cp", localPath, gcsDest]);
          logger.info({ candidateId: candidate.candidateId, gcsDest }, "✅ Uploaded source video to GCS successfully!");

          await fs.unlink(localPath).catch(() => {});

          logger.info({ candidateId: candidate.candidateId }, "🚀 Triggering Cloud Run produce job...");
          await runCommand("gcloud", [
            "run", "jobs", "execute", "shorts-produce",
            `--args=produce,--candidate-id=${candidate.candidateId}`,
            "--region=asia-northeast3",
          ]);
          logger.info({ candidateId: candidate.candidateId }, "🎉 Cloud Run produce job triggered!");
        } catch (err) {
          processed.delete(candidate.candidateId);
          logger.error({ candidateId: candidate.candidateId, error: String(err) }, "❌ Mac Mini download failed");
        }
      }
    } catch (err) {
      logger.error({ error: String(err) }, "Error in Mac Mini downloader loop");
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
}

main().catch((err) => {
  console.error("Fatal error in mac downloader daemon:", err);
  process.exit(1);
});
