import fs from "node:fs/promises";
import textToSpeech from "@google-cloud/text-to-speech";
import type { AppConfig } from "../config.js";
import { runCommand } from "./command.js";
import { probeDurationMs } from "./media.js";
import { logger } from "./logger.js";

export interface TtsSynthesizer {
  synthesizeToFile(text: string, outputPath: string): Promise<number>;
}

export class SupertoneTtsClient implements TtsSynthesizer {
  constructor(private readonly config: AppConfig) {}

  async synthesizeToFile(text: string, outputPath: string): Promise<number> {
    const apiKey = this.config.SUPERTONE_API_KEY;
    const voiceId = this.config.SUPERTONE_VOICE_ID;
    if (!apiKey || !voiceId) {
      throw new Error("SUPERTONE_API_KEY and SUPERTONE_VOICE_ID must be set in environment");
    }

    const speakingRate = this.config.TTS_SPEAKING_RATE ?? 1.2;
    logger.info({ voiceId, textLength: text.length, speakingRate }, "synthesizing speech via Supertone AI API");
    const url = `https://supertoneapi.com/v1/text-to-speech/${voiceId}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-sup-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        language: "ko",
        voice_settings: {
          speed: speakingRate,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Supertone API error (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
    return probeDurationMs(outputPath);
  }
}

export class CloudTtsClient implements TtsSynthesizer {
  private readonly client = new textToSpeech.TextToSpeechClient();

  constructor(private readonly config: AppConfig) {}

  async synthesizeToFile(text: string, outputPath: string): Promise<number> {
    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: this.config.TTS_LANGUAGE_CODE,
        ...(this.config.TTS_VOICE_NAME ? { name: this.config.TTS_VOICE_NAME } : {}),
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: this.config.TTS_SPEAKING_RATE,
      },
    });
    if (!response.audioContent) throw new Error("Cloud TTS returned no audio content");
    const bytes =
      typeof response.audioContent === "string"
        ? Buffer.from(response.audioContent, "base64")
        : Buffer.from(response.audioContent);
    await fs.writeFile(outputPath, bytes);
    return probeDurationMs(outputPath);
  }
}

export class SmartTtsClient implements TtsSynthesizer {
  private readonly supertone?: SupertoneTtsClient;
  private readonly cloud: CloudTtsClient;

  constructor(private readonly config: AppConfig) {
    if (config.SUPERTONE_API_KEY && config.SUPERTONE_VOICE_ID) {
      this.supertone = new SupertoneTtsClient(config);
    }
    this.cloud = new CloudTtsClient(config);
  }

  async synthesizeToFile(text: string, outputPath: string): Promise<number> {
    if (this.supertone) {
      try {
        return await this.supertone.synthesizeToFile(text, outputPath);
      } catch (err) {
        logger.warn({ error: String(err) }, "Supertone TTS failed, falling back to Cloud TTS");
      }
    }
    return this.cloud.synthesizeToFile(text, outputPath);
  }
}
