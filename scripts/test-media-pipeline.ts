import fs from "node:fs/promises";
import path from "node:path";
import { renderShorts } from "../remotion/render.js";
import { runCommand } from "../src/lib/command.js";
import { extractSourceClip } from "../src/lib/media.js";

const outputDir = path.resolve("out", "media-pipeline");
const publicDir = path.join(outputDir, "public");
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(publicDir, { recursive: true });

const sourcePath = path.join(outputDir, "source.mp4");
await runCommand("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=1280x720:rate=30:duration=4",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=4",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  "-y",
  sourcePath,
]);

const clipName = "source-clip.mp4";
await extractSourceClip({
  sourceUrl: sourcePath,
  startMs: 1_000,
  endMs: 3_000,
  outputPath: path.join(publicDir, clipName),
});

const narrationName = "narration.wav";
await runCommand("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "anullsrc=channel_layout=mono:sample_rate=48000",
  "-t",
  "1",
  "-y",
  path.join(publicDir, narrationName),
]);

const outputPath = path.join(outputDir, "pipeline.mp4");
await renderShorts({
  publicDir,
  outputPath,
  concurrency: 1,
  props: {
    title: "미디어 파이프라인 통합 테스트",
    productName: "테스트 제품",
    segments: [
      {
        type: "source_clip",
        fileName: clipName,
        durationMs: 2_000,
        subtitle: "원본 컷 자막 테스트",
      },
      {
        type: "narration",
        fileName: narrationName,
        durationMs: 1_000,
        text: "나레이션 구간 테스트",
      },
    ],
  },
});

const { stdout } = await runCommand("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration:stream=codec_name,width,height,r_frame_rate",
  "-of",
  "json",
  outputPath,
]);
const probe = JSON.parse(stdout) as {
  format?: { duration?: string };
  streams?: Array<{ codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
};
const video = probe.streams?.find((stream) => stream.codec_name === "h264");
const audio = probe.streams?.find((stream) => stream.codec_name === "aac");
const duration = Number.parseFloat(probe.format?.duration ?? "0");
if (
  video?.width !== 1080 ||
  video.height !== 1920 ||
  video.r_frame_rate !== "30/1" ||
  !audio ||
  duration < 2.9 ||
  duration > 3.2
) {
  throw new Error(`Unexpected render metadata: ${stdout}`);
}

process.stdout.write(`${outputPath}\n${stdout}`);
