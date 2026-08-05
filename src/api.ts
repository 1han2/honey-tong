import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { CloudRunJobClient } from "./lib/cloud-run.js";
import { ShortsRepository } from "./lib/firestore.js";
import { logger } from "./lib/logger.js";
import { TelegramClient } from "./lib/telegram.js";
import {
  handleTelegramUpdate,
  telegramUpdateSchema,
  verifyWebhookSecret,
} from "./services/webhook-service.js";

const config = loadConfig();
const repository = new ShortsRepository(config);
const telegram = new TelegramClient(config);
const jobClient = new CloudRunJobClient(config);
const app = Fastify({ loggerInstance: logger });

app.get("/healthz", async () => ({ ok: true }));
// Cloud Run's external frontend reserves the exact /healthz path. Keep the
// conventional route for internal callers and expose /health for probes.
app.get("/health", async () => ({ ok: true }));

app.post("/telegram/webhook", async (request, reply) => {
  const secretHeader = request.headers["x-telegram-bot-api-secret-token"];
  const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
  if (!verifyWebhookSecret(config, secret)) {
    return reply.code(401).send({ ok: false });
  }

  const parsed = telegramUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    request.log.warn({ issues: parsed.error.issues }, "ignored invalid Telegram update");
    return reply.code(200).send({ ok: true });
  }

  await handleTelegramUpdate(parsed.data, { repository, telegram, jobClient, config });
  return reply.code(200).send({ ok: true });
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "request failed");
  void reply.code(500).send({ ok: false });
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
