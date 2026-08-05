import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { TelegramClient } from "../src/lib/telegram.js";
import { candidateFixture, videoFixture } from "./fixtures.js";

const config = loadConfig({
  NODE_ENV: "test",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_CHAT_ID: "1234",
});

const successfulFetch = () =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

describe("Telegram messages", () => {
  it("sends the original URL, timestamp deep link, and only an approve button", async () => {
    const fetchMock = successfulFetch();
    const client = new TelegramClient(config, fetchMock);
    await expect(client.sendCandidate(candidateFixture(), videoFixture)).resolves.toBe(77);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      text: string;
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(body.text).toContain(videoFixture.videoUrl);
    expect(body.text).toContain("https://www.youtube.com/watch?v=abcDEF12345&amp;t=192s");
    expect(body.reply_markup.inline_keyboard.flat()).toEqual([
      {
        text: "이 제품으로 제작 승인",
        callback_data: `approve:${candidateFixture().candidateId}`,
      },
    ]);
  });

  it("puts a rerender callback on failure notifications", async () => {
    const fetchMock = successfulFetch();
    const client = new TelegramClient(config, fetchMock);
    await client.sendFailure({ candidate: candidateFixture(), message: "render failed" });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> };
    };
    expect(body.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe(
      `rerender:${candidateFixture().candidateId}`,
    );
  });

  it("formats and sends a scan summary notification", async () => {
    const fetchMock = successfulFetch();
    const client = new TelegramClient(config, fetchMock);
    const messageId = await client.sendScanSummary({
      channels: 161,
      claimedVideos: 5,
      analyzedVideos: 3,
      skippedVideos: 2,
      candidates: 1,
      failedVideos: 0,
    });

    expect(messageId).toBe(77);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as { text: string };
    expect(body.text).toContain("유튜브 영상 스캔 완료 요약");
    expect(body.text).toContain("161개");
    expect(body.text).toContain("5개");
    expect(body.text).toContain("1개");
  });
});

