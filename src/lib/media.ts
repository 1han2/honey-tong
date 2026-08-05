import { runCommand } from "./command.js";

const seconds = (milliseconds: number): string => (milliseconds / 1_000).toFixed(3);

export const extractSourceClip = async (input: {
  sourceUrl: string;
  startMs: number;
  endMs: number;
  outputPath: string;
}): Promise<void> => {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-ss",
    seconds(input.startMs),
    "-i",
    input.sourceUrl,
    "-t",
    seconds(input.endMs - input.startMs),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-y",
    input.outputPath,
  ]);
};

export const probeDurationMs = async (filePath: string): Promise<number> => {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const durationMs = Math.round(Number.parseFloat(stdout.trim()) * 1_000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(`Could not determine media duration: ${filePath}`);
  }
  return durationMs;
};

export const probeRemoteDurationMs = async (sourceUrl: string): Promise<number> => {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    sourceUrl,
  ]);
  const durationMs = Math.round(Number.parseFloat(stdout.trim()) * 1_000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Could not determine remote media duration");
  }
  return durationMs;
};
