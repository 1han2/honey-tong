import fs from "node:fs/promises";
import path from "node:path";
import { renderShorts } from "../remotion/render.js";

const outputDir = path.resolve("out");
const publicDir = path.join(outputDir, "fixture-public");
await fs.mkdir(publicDir, { recursive: true });

const sampleRate = 48_000;
const durationSeconds = 10;
const sampleCount = Math.round(sampleRate * durationSeconds);
const pcmBytes = sampleCount * 2;
const wav = Buffer.alloc(44 + pcmBytes);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + pcmBytes, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(pcmBytes, 40);
await fs.writeFile(path.join(publicDir, "fixture.wav"), wav);

const outputPath = path.join(outputDir, "fixture.mp4");
await renderShorts({
  publicDir,
  outputPath,
  concurrency: 1,
  props: {
    title: "Fixture",
    hookTitle: "50대 연예인이\n매일 하는 루틴",
    productName: "테스트 제품",
    segments: [
      {
        type: "narration",
        fileName: "fixture.wav",
        durationMs: Math.round(durationSeconds * 1_000),
        text: "Remotion 렌더 테스트",
      },
    ],
  },
});

process.stdout.write(`${outputPath}\n`);
