import fs from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const bucketName = config.MEDIA_BUCKET;

if (!bucketName) {
  process.stderr.write("MEDIA_BUCKET is not configured in your environment.\n");
  process.exit(1);
}

const storage = new Storage({
  ...(config.GOOGLE_CLOUD_PROJECT ? { projectId: config.GOOGLE_CLOUD_PROJECT } : {}),
});

const uploadPrompt = async (fileName: string) => {
  const localPath = path.resolve("base_prompt", fileName);
  const destination = `prompts/${fileName}`;

  try {
    const exists = await fs.access(localPath).then(() => true).catch(() => false);
    if (!exists) {
      process.stdout.write(`Local prompt file not found: ${localPath}\n`);
      return;
    }

    process.stdout.write(`Uploading ${fileName} to gs://${bucketName}/${destination}...\n`);
    await storage.bucket(bucketName).upload(localPath, {
      destination,
      metadata: {
        contentType: "text/markdown",
        cacheControl: "no-cache", // avoid caching issues
      },
    });
    process.stdout.write(`Successfully uploaded ${fileName}\n`);
  } catch (error) {
    process.stderr.write(`Failed to upload ${fileName}: ${error instanceof Error ? error.message : error}\n`);
  }
};

await uploadPrompt("get_products.md");
await uploadPrompt("make_transcript.md");
process.stdout.write("Prompt synchronization complete!\n");
