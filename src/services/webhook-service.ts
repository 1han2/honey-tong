import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireConfig } from "../config.js";
import { errorMessage } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const callbackQuerySchema = z.object({
  id: z.string().min(1),
  data: z.string().min(1).max(64),
  message: z
    .object({
      message_id: z.number().int(),
      chat: z.object({ id: z.union([z.number(), z.string()]) }),
    })
    .optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  callback_query: callbackQuerySchema.optional(),
});
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export type WebhookRepository = {
  approveCandidate(candidateId: string): Promise<"APPROVED" | "ALREADY_HANDLED" | "NOT_FOUND">;
  queueRerender(candidateId: string): Promise<"APPROVED" | "NOT_ALLOWED" | "NOT_FOUND">;
  completeCandidate(candidateId: string): Promise<"COMPLETED" | "NOT_ALLOWED" | "NOT_FOUND">;
  updateCandidate(candidateId: string, patch: { status?: "FAILED"; lastStep?: string; lastError?: string }): Promise<void>;
  getCandidate?(candidateId: string): Promise<any | null>;
  getVideo?(videoId: string): Promise<any | null>;
};


export type WebhookDependencies = {
  repository: WebhookRepository;
  jobClient: { startProduce(candidateId: string): Promise<void> };
  telegram: {
    answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
    clearInlineKeyboard(messageId: number): Promise<void>;
    sendStatus?(text: string): Promise<number>;
  };
  config: AppConfig;
};


const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyWebhookSecret = (config: AppConfig, value: string | undefined): boolean => {
  const required = requireConfig(config, "TELEGRAM_WEBHOOK_SECRET");
  return value !== undefined && safeEqual(value, required.TELEGRAM_WEBHOOK_SECRET);
};

const callbackText = (result: string): string => {
  switch (result) {
    case "APPROVED":
      return "제작을 시작했습니다.";
    case "COMPLETED":
      return "완료 처리했습니다.";
    case "ALREADY_HANDLED":
      return "이미 처리된 항목입니다.";
    case "NOT_ALLOWED":
      return "현재 상태에서는 처리할 수 없습니다.";
    default:
      return "후보를 찾을 수 없습니다.";
  }
};

export const handleTelegramUpdate = async (
  update: TelegramUpdate,
  dependencies: WebhookDependencies,
): Promise<void> => {
  const callback = update.callback_query;
  if (!callback) return;

  const configuredChatId = requireConfig(dependencies.config, "TELEGRAM_CHAT_ID").TELEGRAM_CHAT_ID;
  const callbackChatId = callback.message ? String(callback.message.chat.id) : "";
  if (callbackChatId !== configuredChatId) {
    logger.warn({ callbackChatId }, "ignored callback from unauthorized chat");
    await dependencies.telegram.answerCallbackQuery(callback.id, "허용되지 않은 채팅입니다.");
    return;
  }

  const separatorIndex = callback.data.indexOf(":");
  const action = separatorIndex >= 0 ? callback.data.slice(0, separatorIndex) : callback.data;
  const candidateId = separatorIndex >= 0 ? callback.data.slice(separatorIndex + 1) : "";
  if (!candidateId) {
    await dependencies.telegram.answerCallbackQuery(callback.id, "잘못된 요청입니다.");
    return;
  }

  if (action === "complete") {
    const result = await dependencies.repository.completeCandidate(candidateId);
    await dependencies.telegram.answerCallbackQuery(callback.id, callbackText(result));
    if (result === "COMPLETED" && callback.message) {
      await dependencies.telegram.clearInlineKeyboard(callback.message.message_id);
    }
    return;
  }

  const result =
    action === "approve"
      ? await dependencies.repository.approveCandidate(candidateId)
      : action === "rerender"
        ? await dependencies.repository.queueRerender(candidateId)
        : "NOT_ALLOWED";

  if (result === "APPROVED") {
    try {
      let videoTitle = "";
      let productName = "";
      if (dependencies.repository.getCandidate && dependencies.repository.getVideo) {
        try {
          const candidate = await dependencies.repository.getCandidate(candidateId);
          if (candidate) {
            productName = candidate.product.productName;
            const video = await dependencies.repository.getVideo(candidate.videoId);
            if (video) {
              videoTitle = video.title;
            }
          }
        } catch (e) {
          logger.warn({ candidateId, error: errorMessage(e) }, "Failed to fetch info for start message");
        }
      }

      await dependencies.jobClient.startProduce(candidateId);

      if (dependencies.telegram.sendStatus) {
        let details = "";
        if (productName) details += `\n• <b>제품</b>: ${escapeHtml(productName)}`;
        if (videoTitle) details += `\n• <b>영상</b>: ${escapeHtml(videoTitle)}`;
        await dependencies.telegram.sendStatus(
          `🚀 <b>영상 제작 시작</b>${details}\n\nShorts 대본 생성, TTS 및 Remotion 렌더링 작업을 시작했습니다.`,
        );
      }
    } catch (error) {


      const message = errorMessage(error).slice(0, 2_000);
      await dependencies.repository.updateCandidate(candidateId, {
        status: "FAILED",
        lastStep: "JOB_START",
        lastError: message,
      });
      logger.error({ candidateId, error: message }, "failed to start produce job");
      await dependencies.telegram.answerCallbackQuery(callback.id, "Job 시작에 실패했습니다. 다시 시도해 주세요.");
      return;
    }
  }

  await dependencies.telegram.answerCallbackQuery(callback.id, callbackText(result));
  if (result === "APPROVED" && callback.message) {
    await dependencies.telegram.clearInlineKeyboard(callback.message.message_id);
  }
};
