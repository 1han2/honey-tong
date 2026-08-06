import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { handleTelegramUpdate, verifyWebhookSecret } from "../src/services/webhook-service.js";

const config = loadConfig({
  NODE_ENV: "test",
  TELEGRAM_CHAT_ID: "1234",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
});

describe("Telegram webhook", () => {
  it("approves once and starts the produce job", async () => {
    const repository = {
      approveCandidate: vi.fn().mockResolvedValue("APPROVED" as const),
      queueRerender: vi.fn(),
      completeCandidate: vi.fn(),
      updateCandidate: vi.fn(),
    };
    const jobClient = { startProduce: vi.fn().mockResolvedValue(undefined) };
    const telegram = {
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      clearInlineKeyboard: vi.fn().mockResolvedValue(undefined),
      sendStatus: vi.fn().mockResolvedValue(99),
    };


    await handleTelegramUpdate(
      {
        update_id: 1,
        callback_query: {
          id: "callback-1",
          data: "approve:candidate-1",
          message: { message_id: 9, chat: { id: 1234 } },
        },
      },
      { repository, jobClient, telegram, config },
    );

    expect(repository.approveCandidate).toHaveBeenCalledWith("candidate-1");
    expect(jobClient.startProduce).toHaveBeenCalledWith("candidate-1");
    expect(telegram.clearInlineKeyboard).toHaveBeenCalledWith(9);
  });

  it("uses constant-time compatible secret verification", () => {
    expect(verifyWebhookSecret(config, "test-secret")).toBe(true);
    expect(verifyWebhookSecret(config, "wrong")).toBe(false);
  });

  it("does not start another job for an already handled callback", async () => {
    const repository = {
      approveCandidate: vi.fn().mockResolvedValue("ALREADY_HANDLED" as const),
      queueRerender: vi.fn(),
      completeCandidate: vi.fn(),
      updateCandidate: vi.fn(),
    };
    const jobClient = { startProduce: vi.fn() };
    const telegram = {
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      clearInlineKeyboard: vi.fn(),
    };

    await handleTelegramUpdate(
      {
        update_id: 2,
        callback_query: {
          id: "callback-2",
          data: "approve:candidate-1",
          message: { message_id: 9, chat: { id: 1234 } },
        },
      },
      { repository, jobClient, telegram, config },
    );

    expect(jobClient.startProduce).not.toHaveBeenCalled();
    expect(telegram.clearInlineKeyboard).not.toHaveBeenCalled();
  });

  it("keeps the button and records FAILED when the job cannot start", async () => {
    const repository = {
      approveCandidate: vi.fn().mockResolvedValue("APPROVED" as const),
      queueRerender: vi.fn(),
      completeCandidate: vi.fn(),
      updateCandidate: vi.fn().mockResolvedValue(undefined),
    };
    const jobClient = { startProduce: vi.fn().mockRejectedValue(new Error("run unavailable")) };
    const telegram = {
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      clearInlineKeyboard: vi.fn(),
    };

    await handleTelegramUpdate(
      {
        update_id: 3,
        callback_query: {
          id: "callback-3",
          data: "approve:candidate-1",
          message: { message_id: 9, chat: { id: 1234 } },
        },
      },
      { repository, jobClient, telegram, config },
    );

    expect(repository.updateCandidate).toHaveBeenCalledWith(
      "candidate-1",
      expect.objectContaining({ status: "FAILED", lastStep: "JOB_START" }),
    );
    expect(telegram.clearInlineKeyboard).not.toHaveBeenCalled();
  });

  it("handles manual video creation from text messages with YouTube URL and product name", async () => {
    const repository = {
      approveCandidate: vi.fn(),
      queueRerender: vi.fn(),
      completeCandidate: vi.fn(),
      updateCandidate: vi.fn(),
      createManualCandidate: vi.fn().mockResolvedValue({ candidateId: "manual-c1" }),
    };
    const jobClient = { startProduce: vi.fn().mockResolvedValue(undefined) };
    const telegram = {
      answerCallbackQuery: vi.fn(),
      clearInlineKeyboard: vi.fn(),
      sendStatus: vi.fn().mockResolvedValue(100),
    };

    await handleTelegramUpdate(
      {
        update_id: 10,
        message: {
          message_id: 50,
          chat: { id: 1234 },
          text: "https://www.youtube.com/watch?v=abc12345\n나이키 운동화",
        },
      },
      { repository, jobClient, telegram, config },
    );

    expect(repository.createManualCandidate).toHaveBeenCalledWith({
      videoId: "abc12345",
      videoUrl: "https://www.youtube.com/watch?v=abc12345",
      productName: "나이키 운동화",
    });
    expect(jobClient.startProduce).toHaveBeenCalledWith("manual-c1");
    expect(telegram.sendStatus).toHaveBeenCalledWith(
      expect.stringContaining("수동 영상 제작 시작"),
    );
  });
});
