import type { AppConfig } from "../config.js";
import { requireConfig } from "../config.js";
import type { Candidate, Video } from "./schemas.js";
import { formatTimestamp, youtubeTimestampUrl } from "./youtube.js";

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramMessage = { message_id: number };

export const escapeTelegramHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export class TelegramClient {
  private readonly token: string;
  private readonly chatId: string;

  constructor(
    config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const required = requireConfig(config, "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID");
    this.token = required.TELEGRAM_BOT_TOKEN;
    this.chatId = required.TELEGRAM_CHAT_ID;
  }

  async sendCandidate(candidate: Candidate, video: Video): Promise<number> {
    const product = candidate.product;
    const evidenceLines = product.evidence.map((evidence) => {
      const label = formatTimestamp(evidence.startMs);
      const url = youtubeTimestampUrl(evidence.videoId, evidence.startMs);
      return `• <a href="${escapeTelegramHtml(url)}">${label} 바로 보기</a> — ${escapeTelegramHtml(evidence.quote)}`;
    });
    const text = [
      "🛍️ <b>쇼핑 클립 후보</b>",
      "",
      `<b>채널</b>: ${escapeTelegramHtml(candidate.celebrityName)}`,
      `<b>영상</b>: <a href="${video.videoUrl}">${escapeTelegramHtml(video.title)}</a>`,
      `<b>제품</b>: ${escapeTelegramHtml(product.productName)}`,
      `<b>브랜드/카테고리</b>: ${escapeTelegramHtml(product.brand ?? "미확인")} / ${escapeTelegramHtml(product.category)}`,
      "",
      "<b>등장 구간</b>",
      ...evidenceLines,
    ].join("\n");

    const response = await this.call<TelegramMessage>("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [{ text: "이 제품으로 제작 승인", callback_data: `approve:${candidate.candidateId}` }],
        ],
      },
    });
    return response.message_id;
  }

  async sendReview(input: {
    candidate: Candidate;
    signedUrl: string;
  }): Promise<number> {
    const text = [
      "🎬 <b>영상 제작 완료</b>",
      "",
      `<b>제품</b>: ${escapeTelegramHtml(input.candidate.product.productName)}`,
      "완성본 링크는 7일간 유효합니다.",
    ].join("\n");
    const response = await this.call<TelegramMessage>("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "영상 보기/다운로드", url: input.signedUrl }],
          [
            { text: "완료", callback_data: `complete:${input.candidate.candidateId}` },
            { text: "다시 렌더", callback_data: `rerender:${input.candidate.candidateId}` },
          ],
        ],
      },
    });
    return response.message_id;
  }

  async sendStatus(text: string): Promise<number> {
    const response = await this.call<TelegramMessage>("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return response.message_id;
  }


  async sendScanSummary(summary: {
    channels: number;
    claimedVideos: number;
    analyzedVideos: number;
    skippedVideos: number;
    candidates: number;
    failedVideos: number;
  }): Promise<number> {
    const text = [
      "📊 <b>유튜브 영상 스캔 완료 요약</b>",
      "",
      `• <b>대상 채널</b>: ${summary.channels}개`,
      `• <b>신규 스캔 영상</b>: ${summary.claimedVideos}개 (쇼츠/기타 스킵: ${summary.skippedVideos}개)`,
      `• <b>Gemini 분석 완료</b>: ${summary.analyzedVideos}개`,
      `• <b>생성된 후보</b>: <b>${summary.candidates}개</b>`,
      summary.failedVideos > 0 ? `• <b>분석 실패</b>: ${summary.failedVideos}개` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.call<TelegramMessage>("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return response.message_id;
  }


  async sendFailure(input: {
    candidate: Candidate;
    message: string;
  }): Promise<number> {
    const text = [
      "⚠️ <b>영상 제작 실패</b>",
      "",
      `<b>제품</b>: ${escapeTelegramHtml(input.candidate.product.productName)}`,
      `<b>원인</b>: ${escapeTelegramHtml(input.message.slice(0, 500))}`,
    ].join("\n");
    const response = await this.call<TelegramMessage>("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "다시 시도", callback_data: `rerender:${input.candidate.candidateId}` }],
        ],
      },
    });
    return response.message_id;
  }

  async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    });
  }

  async clearInlineKeyboard(messageId: number): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: this.chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  private async call<T = unknown>(method: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`);
    }
    return payload.result;
  }
}
