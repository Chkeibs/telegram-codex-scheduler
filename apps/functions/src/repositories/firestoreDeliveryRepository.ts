import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { JobKind } from "@telegram-codex/shared";

export interface PendingDelivery {
  jobId: string;
  kind: JobKind;
  telegramChatId: string;
  status: "completed" | "failed";
  outputPreview: string | null;
  errorPreview: string | null;
  resultObjectName: string | null;
  outputMode: "preview" | "full";
  maxOutputChars: number;
  attempt: number;
}

export class FirestoreDeliveryRepository {
  constructor(private readonly firestore: Firestore, private readonly maximumAttempts = 3) {}

  async claim(jobId: string, now = new Date()): Promise<PendingDelivery | null> {
    const ref = this.firestore.collection("jobs").doc(jobId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const record = snapshot.data() as Record<string, unknown>;
      if (record.deliveryStatus !== "pending" || (record.status !== "completed" && record.status !== "failed")) return null;
      const attempt = Number(record.deliveryAttempt ?? 0) + 1;
      if (attempt > this.maximumAttempts) {
        transaction.update(ref, { deliveryStatus: "failed", updatedAt: Timestamp.fromDate(now) });
        return null;
      }
      const user = await transaction.get(this.firestore.collection("users").doc(String(record.telegramUserId)));
      const preferences = user.data() as Record<string, unknown> | undefined;
      transaction.update(ref, { deliveryStatus: "sending", deliveryAttempt: attempt, deliveryStartedAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) });
      return {
        jobId,
        kind: record.kind === "reset_credit_status" ? "reset_credit_status" : record.kind === "scheduled" ? "scheduled" : "immediate",
        telegramChatId: String(record.telegramChatId),
        status: record.status,
        outputPreview: typeof record.outputPreview === "string" ? record.outputPreview : null,
        errorPreview: typeof record.errorPreview === "string" ? record.errorPreview : null,
        resultObjectName: typeof record.resultObjectName === "string" ? record.resultObjectName : null,
        outputMode: preferences?.outputMode === "full" ? "full" : "preview",
        maxOutputChars: typeof preferences?.maxOutputChars === "number" ? Math.max(500, Math.min(3900, preferences.maxOutputChars)) : 3500,
        attempt,
      };
    });
  }

  async markSent(jobId: string, telegramMessageId: number, now = new Date()): Promise<void> {
    await this.firestore.collection("jobs").doc(jobId).update({
      deliveryStatus: "sent",
      telegramMessageId,
      deliveredAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    });
  }

  async releaseForRetry(jobId: string, error: string, now = new Date()): Promise<void> {
    await this.firestore.collection("jobs").doc(jobId).update({
      deliveryStatus: "pending",
      deliveryError: error.slice(0, 500),
      updatedAt: Timestamp.fromDate(now),
    });
  }
}
