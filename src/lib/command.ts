import { spawn } from "node:child_process";

export const runCommand = async (
  command: string,
  args: string[],
  options: { cwd?: string; maxOutputChars?: number } = {},
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const maxChars = options.maxOutputChars ?? 20_000;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-maxChars);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-maxChars);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${command} exited with code ${String(code)} signal ${String(signal)}: ${stderr || stdout}`,
          ),
        );
      }
    });
  });
