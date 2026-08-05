import { GoogleAuth } from "google-auth-library";
import type { AppConfig } from "../config.js";
import { requireConfig } from "../config.js";

export class CloudRunJobClient {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  private readonly projectId: string;
  private readonly region: string;
  private readonly jobName: string;
  private readonly requestImpl: (url: string, data: object) => Promise<void>;

  constructor(
    config: AppConfig,
    requestImpl?: (url: string, data: object) => Promise<void>,
  ) {
    const required = requireConfig(config, "GOOGLE_CLOUD_PROJECT");
    this.projectId = required.GOOGLE_CLOUD_PROJECT;
    this.region = config.GOOGLE_CLOUD_REGION;
    this.jobName = config.PRODUCE_JOB_NAME;
    this.requestImpl = requestImpl ?? (async (url, data) => {
      const client = await this.auth.getClient();
      await client.request({ url, method: "POST", data });
    });
  }

  async startProduce(candidateId: string): Promise<void> {
    const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(this.projectId)}/locations/${encodeURIComponent(this.region)}/jobs/${encodeURIComponent(this.jobName)}:run`;
    await this.requestImpl(url, {
      overrides: {
        containerOverrides: [
          {
            args: ["produce", `--candidate-id=${candidateId}`],
          },
        ],
        taskCount: 1,
      },
    });
  }
}
