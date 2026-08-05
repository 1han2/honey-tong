import { candidateSchema, type Candidate, type Channel, type Product, type Video } from "../src/lib/schemas.js";

export const channelFixture: Channel = {
  youtubeChannelId: "UCq_NshSNZ8pjuNsEr3PJtiw",
  celebrityName: "테스트 연예인",
  channelName: "테스트 채널",
  channelUrl: "https://www.youtube.com/@test/videos",
  enabled: true,
};

export const videoFixture: Video = {
  videoId: "abcDEF12345",
  channelId: channelFixture.youtubeChannelId,
  title: "테스트 제품 사용기",
  videoUrl: "https://www.youtube.com/watch?v=abcDEF12345",
  publishedAt: "2026-08-01T00:00:00.000Z",
  durationMs: 600_000,
  analyzedAt: null,
  analysisStatus: "DISCOVERED",
  analysisAttemptCount: 0,
  lastError: null,
};

export const productFixture: Product = {
  productName: "알레시 키친 타이머",
  productNameRaw: "알레시 타이머",
  brand: "Alessi",
  category: "생활용품",
  evidence: [
    {
      videoId: videoFixture.videoId,
      startMs: 192_000,
      endMs: 198_000,
      quote: "이거 진짜 좋아요.",
      kind: "quote",
    },
  ],
};

export const candidateFixture = (patch: Partial<Candidate> = {}): Candidate =>
  candidateSchema.parse({
    candidateId: "abcDEF12345_0123456789abcdefabcd",
    videoId: videoFixture.videoId,
    celebrityName: channelFixture.celebrityName,
    product: productFixture,
    status: "PENDING",
    promptVersion: "get-products.v1",
    modelVersion: "gemini-test",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...patch,
  });
