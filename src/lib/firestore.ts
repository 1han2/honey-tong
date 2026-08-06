import { execSync } from "node:child_process";
import { Firestore } from "@google-cloud/firestore";
import type { AppConfig } from "../config.js";
import type {
  Candidate,
  CandidateStatus,
  Channel,
  Product,
  ScriptPlan,
  Video,
} from "./schemas.js";
import { candidateSchema, channelSchema, videoSchema } from "./schemas.js";
import { candidateIdFor } from "./id.js";
import { nowIso } from "./time.js";

type CandidatePatch = Partial<
  Omit<Candidate, "candidateId" | "videoId" | "createdAt" | "updatedAt">
>;

export class ShortsRepository {
  readonly firestore: Firestore;

  constructor(config: Pick<AppConfig, "GOOGLE_CLOUD_PROJECT" | "FIRESTORE_DATABASE_ID">) {
    let token: string | undefined;
    if (typeof process !== "undefined" && !process.env.K_SERVICE) {
      try {
        token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
      } catch {}
    }

    this.firestore = new Firestore({
      ...(config.GOOGLE_CLOUD_PROJECT ? { projectId: config.GOOGLE_CLOUD_PROJECT } : {}),
      databaseId: config.FIRESTORE_DATABASE_ID,
      ...(token ? { token } : {}),
      ignoreUndefinedProperties: true,
    });
  }

  async upsertChannels(channels: Channel[]): Promise<void> {
    const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || "honeytong";

    for (const rawChannel of channels) {
      const channel = channelSchema.parse(rawChannel);
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/channels/${channel.youtubeChannelId}`;
      await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            youtubeChannelId: { stringValue: channel.youtubeChannelId },
            celebrityName: { stringValue: channel.celebrityName },
            channelName: { stringValue: channel.channelName },
            channelUrl: { stringValue: channel.channelUrl },
            enabled: { booleanValue: channel.enabled },
            sourceRow: { integerValue: String(channel.sourceRow) },
            updatedAt: { stringValue: nowIso() },
          },
        }),
      });
    }
  }

  async listEnabledChannels(): Promise<Channel[]> {
    const snapshot = await this.firestore
      .collection("channels")
      .where("enabled", "==", true)
      .get();
    return snapshot.docs.map((doc) => channelSchema.parse(doc.data()));
  }

  async claimVideoForAnalysis(video: Video): Promise<boolean> {
    const parsed = videoSchema.parse(video);
    const ref = this.firestore.collection("videos").doc(parsed.videoId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        transaction.create(ref, {
          ...parsed,
          analysisStatus: "ANALYZING",
          analysisAttemptCount: 1,
          lastError: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
        return true;
      }

      const current = videoSchema.parse(snapshot.data());
      if (current.analysisStatus !== "FAILED") {
        return false;
      }

      transaction.update(ref, {
        analysisStatus: "ANALYZING",
        analysisAttemptCount: current.analysisAttemptCount + 1,
        lastError: null,
        updatedAt: nowIso(),
      });
      return true;
    });
  }

  async updateVideoAnalysis(
    videoId: string,
    status: Video["analysisStatus"],
    lastError: string | null = null,
  ): Promise<void> {
    await this.firestore.collection("videos").doc(videoId).update({
      analysisStatus: status,
      analyzedAt: status === "ANALYZED" ? nowIso() : null,
      lastError,
      updatedAt: nowIso(),
    });
  }

  async updateVideoDuration(videoId: string, durationMs: number): Promise<void> {
    await this.firestore.collection("videos").doc(videoId).update({
      durationMs,
      updatedAt: nowIso(),
    });
  }

  async getVideo(videoId: string): Promise<Video | null> {
    const snapshot = await this.firestore.collection("videos").doc(videoId).get();
    return snapshot.exists ? videoSchema.parse(snapshot.data()) : null;
  }

  async createCandidate(input: {
    videoId: string;
    celebrityName: string;
    product: Product;
    promptVersion: string;
    modelVersion: string;
  }): Promise<{ candidate: Candidate; created: boolean }> {
    const candidateId = candidateIdFor(input.videoId, input.product.productName);
    const ref = this.firestore.collection("candidates").doc(candidateId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        return { candidate: candidateSchema.parse(snapshot.data()), created: false };
      }

      const timestamp = nowIso();
      const candidate = candidateSchema.parse({
        candidateId,
        videoId: input.videoId,
        celebrityName: input.celebrityName,
        product: input.product,
        status: "PENDING",
        promptVersion: input.promptVersion,
        modelVersion: input.modelVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.create(ref, candidate);
      return { candidate, created: true };
    });
  }

  async createManualCandidate(input: {
    videoId: string;
    videoUrl: string;
    productName: string;
    celebrityName?: string;
  }): Promise<Candidate> {
    const timestamp = nowIso();
    const candidateId = `${input.videoId}_manual_${Date.now().toString(36)}`;
    const ref = this.firestore.collection("candidates").doc(candidateId);

    const videoRef = this.firestore.collection("videos").doc(input.videoId);
    const videoSnapshot = await videoRef.get();
    let celebrityName = input.celebrityName || "출연자";
    if (!input.celebrityName && videoSnapshot.exists) {
      const videoData = videoSnapshot.data();
      if (videoData?.channelId) {
        const channelSnapshot = await this.firestore.collection("channels").doc(videoData.channelId).get();
        if (channelSnapshot.exists && channelSnapshot.data()?.celebrityName) {
          celebrityName = channelSnapshot.data()!.celebrityName;
        }
      }
    } else {
      await videoRef.set({
        videoId: input.videoId,
        channelId: "manual",
        title: input.productName,
        videoUrl: input.videoUrl,
        publishedAt: timestamp,
        durationMs: null,
        analyzedAt: timestamp,
        analysisStatus: "ANALYZED",
        analysisAttemptCount: 1,
        lastError: null,
      });
    }

    const candidate = candidateSchema.parse({
      candidateId,
      videoId: input.videoId,
      celebrityName,
      product: {
        productName: input.productName,
        productNameRaw: input.productName,
        brand: null,
        category: "기타",
        evidence: [
          {
            videoId: input.videoId,
            startMs: 0,
            quote: "[수동 등록]",
            kind: "scene",
          },
        ],
      },
      status: "APPROVED",
      sourceAssets: [
        {
          videoId: input.videoId,
          sourceUrl: input.videoUrl,
          rightsStatus: "CONFIRMED",
        },
      ],
      promptVersion: "manual",
      modelVersion: "manual",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ref.set(candidate);
    return candidate;
  }

  async getCandidate(candidateId: string): Promise<Candidate | null> {
    const snapshot = await this.firestore.collection("candidates").doc(candidateId).get();
    return snapshot.exists ? candidateSchema.parse(snapshot.data()) : null;
  }

  async setTelegramMessageId(candidateId: string, messageId: number): Promise<void> {
    await this.firestore.collection("candidates").doc(candidateId).update({
      telegramMessageId: messageId,
      updatedAt: nowIso(),
    });
  }

  async approveCandidate(candidateId: string): Promise<"APPROVED" | "ALREADY_HANDLED" | "NOT_FOUND"> {
    const ref = this.firestore.collection("candidates").doc(candidateId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return "NOT_FOUND";
      const candidate = candidateSchema.parse(snapshot.data());
      if (candidate.status !== "PENDING" && candidate.status !== "FAILED") {
        return "ALREADY_HANDLED";
      }
      transaction.update(ref, {
        status: "APPROVED",
        lastStep: "APPROVED",
        lastError: null,
        updatedAt: nowIso(),
      });
      return "APPROVED";
    });
  }

  async queueRerender(candidateId: string): Promise<"APPROVED" | "NOT_ALLOWED" | "NOT_FOUND"> {
    const ref = this.firestore.collection("candidates").doc(candidateId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return "NOT_FOUND";
      const candidate = candidateSchema.parse(snapshot.data());
      const allowed: CandidateStatus[] = ["REVIEW_READY", "FAILED", "SOURCE_REQUIRED", "COMPLETED"];
      if (!allowed.includes(candidate.status)) return "NOT_ALLOWED";
      transaction.update(ref, {
        status: "APPROVED",
        lastStep: "RERENDER_REQUESTED",
        lastError: null,
        updatedAt: nowIso(),
      });
      return "APPROVED";
    });
  }

  async completeCandidate(candidateId: string): Promise<"COMPLETED" | "NOT_ALLOWED" | "NOT_FOUND"> {
    const ref = this.firestore.collection("candidates").doc(candidateId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return "NOT_FOUND";
      const candidate = candidateSchema.parse(snapshot.data());
      if (candidate.status === "COMPLETED") return "COMPLETED";
      if (candidate.status !== "REVIEW_READY") return "NOT_ALLOWED";
      transaction.update(ref, {
        status: "COMPLETED",
        lastStep: "COMPLETED",
        lastError: null,
        updatedAt: nowIso(),
      });
      return "COMPLETED";
    });
  }

  async claimCandidateForProduction(candidateId: string): Promise<Candidate | null> {
    const ref = this.firestore.collection("candidates").doc(candidateId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const candidate = candidateSchema.parse(snapshot.data());
      const allowed: CandidateStatus[] = ["APPROVED", "SOURCE_REQUIRED", "FAILED"];
      if (!allowed.includes(candidate.status)) return null;

      const updated = candidateSchema.parse({
        ...candidate,
        status: "PRODUCING",
        attemptCount: candidate.attemptCount + 1,
        lastStep: "CLAIMED",
        lastError: null,
        updatedAt: nowIso(),
      });
      transaction.set(ref, updated);
      return updated;
    });
  }

  async updateCandidate(candidateId: string, patch: CandidatePatch): Promise<void> {
    await this.firestore.collection("candidates").doc(candidateId).update({
      ...patch,
      updatedAt: nowIso(),
    });
  }

  async saveScript(candidateId: string, scriptPlan: ScriptPlan): Promise<void> {
    const candidate = await this.getCandidate(candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
    await this.updateCandidate(candidateId, {
      scriptPlan,
      scriptText: scriptPlan.scriptText,
      scriptRevision: candidate.scriptRevision + 1,
      scriptGeneratedAt: nowIso(),
      lastStep: "SCRIPT_GENERATED",
      lastError: null,
    });
  }
}
