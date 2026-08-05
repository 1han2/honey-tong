import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: null,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-telegram-bot-api-secret-token",
      "telegramBotToken",
      "geminiApiKey",
      "*.token",
      "*.apiKey",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
});
