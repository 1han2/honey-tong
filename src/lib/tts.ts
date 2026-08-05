import fs from "node:fs/promises";
import textToSpeech from "@google-cloud/text-to-speech";
import type { AppConfig } from "../config.js";
import { probeDurationMs } from "./media.js";

export class CloudTtsClient {
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
