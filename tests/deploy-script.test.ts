import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("deployment script", () => {
  it("wires the minimal GCP resources and least-privilege job override role", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "shorts-deploy-test-"));
    const fakeGcloud = path.join(tempDir, "gcloud");
    const logPath = path.join(tempDir, "commands.log");
    await fs.writeFile(
      fakeGcloud,
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FAKE_GCLOUD_LOG"\nexit 0\n',
      { mode: 0o755 },
    );

    try {
      await execFileAsync("bash", ["scripts/deploy.sh"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ""}`,
          FAKE_GCLOUD_LOG: logPath,
          GOOGLE_CLOUD_PROJECT: "shorts-test-project",
          TELEGRAM_CHAT_ID: "1234",
          IMAGE_TAG: "test",
        },
      });
      const commands = await fs.readFile(logPath, "utf8");

      expect(commands).toContain("services enable artifactregistry.googleapis.com");
      expect(commands).toContain("--role=roles/run.jobsExecutorWithOverrides");
      expect(commands).toContain("storage buckets update gs://shorts-test-project-shorts-media --clear-soft-delete --no-versioning");
      expect(commands).toContain("run jobs deploy shorts-scan");
      expect(commands).toContain("--args=scan");
      expect(commands).toContain("run jobs deploy shorts-produce");
      expect(commands).toContain("--cpu=4 --memory=8Gi");
      expect(commands).toContain("--add-volume=name=render-tmp,type=in-memory,size-limit=3Gi");
      expect(commands).toContain("--add-volume-mount=volume=render-tmp,mount-path=/mnt/render-tmp");
      expect(commands).toContain("TMPDIR=/mnt/render-tmp");
      expect(commands).toContain("run deploy shorts-api");
      expect(commands).toContain("scheduler jobs update http shorts-scan");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
