import { loadConfig } from "../src/config.js";
import { CloudRunJobClient } from "../src/lib/cloud-run.js";
import { errorMessage } from "../src/lib/errors.js";
import { ShortsRepository } from "../src/lib/firestore.js";
import { sourceAssetSchema } from "../src/lib/schemas.js";

const valueOf = (name: string): string | undefined =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);

const candidateId = valueOf("candidate-id");
const videoId = valueOf("video-id");
const sourceUrl = valueOf("source-url");
if (!candidateId || !videoId || !sourceUrl) {
  throw new Error(
    "Usage: tsx scripts/register-source.ts --candidate-id=... --video-id=... --source-url=https://...",
  );
}

const config = loadConfig();
const repository = new ShortsRepository(config);
const candidate = await repository.getCandidate(candidateId);
if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
const sourceAsset = sourceAssetSchema.parse({
  videoId,
  sourceUrl,
  rightsStatus: "CONFIRMED",
});
const withoutSameVideo = candidate.sourceAssets.filter((asset) => asset.videoId !== videoId);
await repository.updateCandidate(candidateId, {
  sourceAssets: [...withoutSameVideo, sourceAsset],
  status: candidate.status === "SOURCE_REQUIRED" ? "APPROVED" : candidate.status,
  lastStep: "SOURCE_REGISTERED",
  lastError: null,
});

process.stdout.write(`Registered confirmed source for ${candidateId}\n`);

if (candidate.status === "SOURCE_REQUIRED" && !process.argv.includes("--no-start")) {
  try {
    await new CloudRunJobClient(config).startProduce(candidateId);
    process.stdout.write(`Started produce job for ${candidateId}\n`);
  } catch (error) {
    await repository.updateCandidate(candidateId, {
      status: "FAILED",
      lastStep: "JOB_START_AFTER_SOURCE",
      lastError: errorMessage(error).slice(0, 2_000),
    });
    throw error;
  }
}
