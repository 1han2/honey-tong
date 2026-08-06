import { Storage } from "@google-cloud/storage";
import type { AppConfig } from "../config.js";
import { requireConfig } from "../config.js";
import { logger } from "./logger.js";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 8 * 60 * 1_000; // 8 minutes (workflow timeout is 10 min)
const WORKFLOW_FILE = "download.yml";

/**
 * Triggers the GitHub Actions "download-video" repository_dispatch workflow and waits
 * for the downloaded video to appear in GCS.
 *
 * Flow:
 *  1. POST repository_dispatch event to GitHub API
 *  2. Poll GCS for the uploaded source file
 *  3. Return the GCS URI once the file lands
 */
export const downloadViaGitHub = async (input: {
  videoId: string;
  candidateId: string;
  config: AppConfig;
}): Promise<string> => {
  const { videoId, candidateId, config } = input;
  const required = requireConfig(config, "GITHUB_TOKEN", "GITHUB_REPO", "MEDIA_BUCKET");

  const [owner, repo] = required.GITHUB_REPO.split("/");
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPO must be in "owner/repo" format, got: ${required.GITHUB_REPO}`);
  }

  // 1. Trigger the workflow via repository_dispatch
  logger.info({ videoId, candidateId }, "triggering GitHub Actions download workflow via repository_dispatch");

  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const dispatchResponse = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: "download-video",
      client_payload: {
        video_id: videoId,
        candidate_id: candidateId,
        gcs_bucket: required.MEDIA_BUCKET,
      },
    }),
  });

  if (!dispatchResponse.ok) {
    const body = await dispatchResponse.text();
    throw new Error(`GitHub repository dispatch failed (${dispatchResponse.status}): ${body}`);
  }

  logger.info({ videoId }, "GitHub repository dispatch sent, polling GCS for result");

  // 2. Poll GCS for the uploaded file
  const objectName = `source/${candidateId}/${videoId}.mp4`;
  const gcsUri = `gs://${required.MEDIA_BUCKET}/${objectName}`;
  const storage = new Storage({
    ...(config.GOOGLE_CLOUD_PROJECT ? { projectId: config.GOOGLE_CLOUD_PROJECT } : {}),
  });
  const file = storage.bucket(required.MEDIA_BUCKET).file(objectName);

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const [exists] = await file.exists();
    if (exists) {
      // Verify the file has non-zero size (upload might still be in progress)
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (size > 0) {
        logger.info({ videoId, gcsUri, sizeBytes: size }, "GitHub Actions download complete");
        return gcsUri;
      }
    }
  }

  throw new Error(
    `GitHub Actions download timed out after ${MAX_WAIT_MS / 1_000}s — ` +
    `file not found at ${gcsUri}. Check the repository Actions tab at ` +
    `https://github.com/${owner}/${repo}/actions`,
  );
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
