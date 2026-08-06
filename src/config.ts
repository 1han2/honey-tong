import "dotenv/config";
import { z } from "zod";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.string().default("info"),
  GOOGLE_CLOUD_PROJECT: optionalTrimmedString,
  GOOGLE_CLOUD_REGION: z.string().default("asia-northeast3"),
  FIRESTORE_DATABASE_ID: z.string().default("(default)"),
  MEDIA_BUCKET: optionalTrimmedString,
  GEMINI_PROVIDER: z.enum(["api", "vertex"]).default("api"),
  GEMINI_API_KEY: optionalTrimmedString,
  // GEMINI_MODEL is kept as the product-analysis model for backwards compatibility.
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_SCRIPT_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_LOCATION: z.string().default("global"),
  GEMINI_MEDIA_RESOLUTION: z
    .enum(["MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_MEDIUM", "MEDIA_RESOLUTION_HIGH"])
    .default("MEDIA_RESOLUTION_LOW"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(180_000),
  TELEGRAM_BOT_TOKEN: optionalTrimmedString,
  TELEGRAM_CHAT_ID: optionalTrimmedString,
  TELEGRAM_WEBHOOK_SECRET: optionalTrimmedString,
  PRODUCE_JOB_NAME: z.string().default("shorts-produce"),
  PUBLIC_API_URL: optionalTrimmedString,
  TTS_LANGUAGE_CODE: z.string().default("ko-KR"),
  TTS_VOICE_NAME: optionalTrimmedString,
  TTS_SPEAKING_RATE: z.coerce.number().min(0.25).max(4).default(1.05),
  SCAN_MAX_VIDEOS_PER_RUN: z.coerce.number().int().min(1).max(200).default(20),
  SCAN_VIDEO_ID: optionalTrimmedString,
  SCAN_LOOKBACK_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24),
  EXCLUDE_SHORTS: z
    .preprocess(
      (value) => (typeof value === "string" ? value.toLowerCase() !== "false" && value !== "0" : value),
      z.boolean(),
    )
    .default(true),
  MIN_LONG_FORM_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  VIDEO_TITLE_EXCLUDE_REGEX: optionalTrimmedString,

  YOUTUBE_PROXY: optionalTrimmedString,
  GITHUB_TOKEN: optionalTrimmedString,
  GITHUB_REPO: optionalTrimmedString,

  SIGNED_URL_HOURS: z.coerce.number().int().min(1).max(168).default(168),
  MAX_TEMP_BYTES: z.coerce.number().int().positive().default(3 * 1024 * 1024 * 1024),
});

export type AppConfig = z.infer<typeof envSchema>;
type RequiredConfig<K extends keyof AppConfig> = AppConfig & {
  [P in K]-?: Exclude<AppConfig[P], undefined>;
};

let cachedConfig: AppConfig | undefined;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  if (env === process.env && cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
  }

  if (env === process.env) {
    cachedConfig = parsed.data;
  }
  return parsed.data;
};

export const requireConfig = <K extends keyof AppConfig>(
  config: AppConfig,
  ...keys: K[]
): RequiredConfig<K> => {
  const missing = keys.filter((key) => config[key] === undefined || config[key] === "");
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
  return config as RequiredConfig<K>;
};

export const resetConfigForTests = (): void => {
  cachedConfig = undefined;
};
