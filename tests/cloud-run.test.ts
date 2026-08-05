import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { CloudRunJobClient } from "../src/lib/cloud-run.js";

describe("Cloud Run Job client", () => {
  it("starts one produce task with a candidate argument override", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const client = new CloudRunJobClient(
      loadConfig({
        NODE_ENV: "test",
        GOOGLE_CLOUD_PROJECT: "shorts-project",
        GOOGLE_CLOUD_REGION: "asia-northeast3",
        PRODUCE_JOB_NAME: "shorts-produce",
      }),
      request,
    );

    await client.startProduce("video_candidate");

    expect(request).toHaveBeenCalledWith(
      "https://run.googleapis.com/v2/projects/shorts-project/locations/asia-northeast3/jobs/shorts-produce:run",
      {
        overrides: {
          containerOverrides: [{ args: ["produce", "--candidate-id=video_candidate"] }],
          taskCount: 1,
        },
      },
    );
  });
});
