import { z } from "zod";

export const candidateStatuses = [
  "PENDING",
  "APPROVED",
  "PRODUCING",
  "SOURCE_REQUIRED",
  "REVIEW_READY",
  "COMPLETED",
  "FAILED",
  "ARCHIVED",
] as const;

export const candidateStatusSchema = z.enum(candidateStatuses);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

export const channelSchema = z.object({
  youtubeChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  celebrityName: z.string().trim().min(1),
  channelName: z.string().trim().min(1),
  channelUrl: z.url(),
  enabled: z.boolean().default(true),
  sourceRow: z.number().int().positive().optional(),
});
export type Channel = z.infer<typeof channelSchema>;

export const videoSchema = z.object({
  videoId: z.string().trim().min(6),
  channelId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  videoUrl: z.url(),
  publishedAt: z.string().datetime(),
  durationMs: z.number().int().positive().nullable().default(null),
  analyzedAt: z.string().datetime().nullable().default(null),
  analysisStatus: z
    .enum(["DISCOVERED", "ANALYZING", "ANALYZED", "SKIPPED", "FAILED"])
    .default("DISCOVERED"),
  analysisAttemptCount: z.number().int().min(0).default(0),
  lastError: z.string().nullable().default(null),
});
export type Video = z.infer<typeof videoSchema>;

export const evidenceSchema = z
  .object({
    videoId: z.string().min(1),
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive().optional(),
    quote: z.string().trim().min(1).max(500),
    kind: z.enum(["quote", "scene"]).default("quote"),
  })
  .refine((value) => value.endMs === undefined || value.endMs > value.startMs, {
    message: "endMs must be greater than startMs when provided",
    path: ["endMs"],
  });

export type Evidence = z.infer<typeof evidenceSchema>;

export const productSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  productNameRaw: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(200).nullable(),
  category: z.enum(["건강", "뷰티", "식품", "생활용품", "패션", "기타"]),
  evidence: z.array(evidenceSchema).min(1).max(5),
});
export type Product = z.infer<typeof productSchema>;

export const productAnalysisSchema = z.object({
  products: z.array(productSchema).max(20),
});
export type ProductAnalysis = z.infer<typeof productAnalysisSchema>;

export const narrationSegmentSchema = z.object({
  type: z.literal("narration"),
  text: z.string().trim().min(1).max(2_000),
});

export const sourceClipSegmentSchema = z
  .object({
    type: z.literal("source_clip"),
    videoId: z.string().trim().min(1),
    sourceStartMs: z.number().int().min(0),
    sourceEndMs: z.number().int().positive(),
    subtitle: z.string().trim().min(1).max(500),
  })
  .refine((value) => value.sourceEndMs > value.sourceStartMs, {
    message: "sourceEndMs must be greater than sourceStartMs",
    path: ["sourceEndMs"],
  });

export const scriptSegmentSchema = z.discriminatedUnion("type", [
  narrationSegmentSchema,
  sourceClipSegmentSchema,
]);
export type ScriptSegment = z.infer<typeof scriptSegmentSchema>;

export const scriptPlanSchema = z.object({
  title: z.string().trim().min(1).max(200),
  // Optional for backwards compatibility with script plans already in Firestore.
  hookTitle: z.string().trim().min(1).max(120).optional(),
  scriptText: z.string().trim().min(1).max(20_000),
  segments: z.array(scriptSegmentSchema).min(1).max(40),
});
export type ScriptPlan = z.infer<typeof scriptPlanSchema>;

export const sourceAssetSchema = z.object({
  videoId: z.string().trim().min(1),
  sourceUrl: z.url().refine((value) => new URL(value).protocol === "https:", {
    message: "sourceUrl must use HTTPS",
  }),
  rightsStatus: z.enum(["CONFIRMED", "UNKNOWN", "REJECTED"]),
});
export type SourceAsset = z.infer<typeof sourceAssetSchema>;

export const ttsAssetSchema = z.object({
  segmentIndex: z.number().int().min(0),
  uri: z.string().min(1),
  durationMs: z.number().int().positive(),
});
export type TtsAsset = z.infer<typeof ttsAssetSchema>;

export const candidateSchema = z.object({
  candidateId: z.string().trim().min(8),
  videoId: z.string().trim().min(1),
  celebrityName: z.string().trim().min(1),
  product: productSchema,
  status: candidateStatusSchema,
  telegramMessageId: z.number().int().nullable().default(null),
  reviewMessageId: z.number().int().nullable().default(null),
  scriptText: z.string().nullable().default(null),
  scriptPlan: scriptPlanSchema.nullable().default(null),
  scriptRevision: z.number().int().min(0).default(0),
  scriptGeneratedAt: z.string().datetime().nullable().default(null),
  sourceAssets: z.array(sourceAssetSchema).default([]),
  sourceUris: z.array(z.string()).default([]),
  ttsAssets: z.array(ttsAssetSchema).default([]),
  outputUri: z.string().nullable().default(null),
  outputSizeBytes: z.number().int().min(0).nullable().default(null),
  outputDeleteAfter: z.string().datetime().nullable().default(null),
  attemptCount: z.number().int().min(0).default(0),
  lastStep: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  promptVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Candidate = z.infer<typeof candidateSchema>;
