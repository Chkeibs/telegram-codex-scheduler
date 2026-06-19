import { randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { JobStatus, NewCloudJob } from "@telegram-codex/shared";
import { assertJobTransition } from "@telegram-codex/shared";

export interface StoredJob {
  id: string;
  status: JobStatus;
  scheduledAt: Date;
  telegramUserId: string;
  telegramChatId: string;
  cloudTaskName: string | null;
  prompt?: string;
  workdirKey?: string;
  filesystemPermission?: "read_only" | "workspace_write";
  timezoneSnapshot?: string;
}

interface JobRecord {
  id: string;
  kind: "scheduled" | "immediate";
  status: JobStatus;
  telegramUserId: string;
  telegramChatId: string;
  prompt: string;
  scheduledAt: Timestamp;
  timezoneSnapshot: string;
  workdirKey: string;
  workingDirectorySnapshot: string | null;
  filesystemPermission: "read_only" | "workspace_write";
  codexMode: "exec";
  idempotencyKey: string;
  cloudTaskName: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Timestamp | null;
  attempt: number;
  vmBootId: string | null;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
  outputPreview: string | null;
  resultObjectName: string | null;
  errorCode: string | null;
  errorPreview: string | null;
  exitCode: number | null;
  durationMs: number | null;
  latenessSeconds: number | null;
  deliveryStatus: "none" | "pending" | "sending" | "sent" | "failed";
  deliveredAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

function summarize(record: JobRecord): StoredJob {
  return {
    id: record.id,
    status: record.status,
    scheduledAt: record.scheduledAt.toDate(),
    telegramUserId: record.telegramUserId,
    telegramChatId: record.telegramChatId,
    cloudTaskName: record.cloudTaskName,
    prompt: record.prompt,
    workdirKey: record.workdirKey,
    filesystemPermission: record.filesystemPermission,
    timezoneSnapshot: record.timezoneSnapshot,
  };
}

export class FirestoreJobRepository {
  constructor(private readonly firestore: Firestore) {}

  async createIdempotent(input: Omit<NewCloudJob, "id"> & { id?: string }, telegramUpdateId: number, now = new Date()): Promise<{ job: StoredJob; created: boolean }> {
    const id = input.id ?? randomUUID();
    const operationId = `telegram-${telegramUpdateId}`;
    const operationRef = this.firestore.collection("operations").doc(operationId);
    const jobRef = this.firestore.collection("jobs").doc(id);
    return this.firestore.runTransaction(async (transaction) => {
      const existingOperation = await transaction.get(operationRef);
      if (existingOperation.exists) {
        const previousJobId = existingOperation.get("resultingJobId") as string;
        const previous = await transaction.get(this.firestore.collection("jobs").doc(previousJobId));
        if (!previous.exists) throw new Error("Idempotency operation references a missing job");
        return { job: summarize(previous.data() as JobRecord), created: false };
      }

      const timestamp = Timestamp.fromDate(now);
      const status: JobStatus = input.kind === "scheduled" ? "scheduled" : "pending_wake";
      const record: JobRecord = {
        id,
        kind: input.kind,
        status,
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        prompt: input.prompt,
        scheduledAt: Timestamp.fromDate(input.scheduledAt),
        timezoneSnapshot: input.timezoneSnapshot,
        workdirKey: input.workdirKey,
        workingDirectorySnapshot: null,
        filesystemPermission: input.filesystemPermission,
        codexMode: "exec",
        idempotencyKey: input.idempotencyKey,
        cloudTaskName: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        attempt: 0,
        vmBootId: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        outputPreview: null,
        resultObjectName: null,
        errorCode: null,
        errorPreview: null,
        exitCode: null,
        durationMs: null,
        latenessSeconds: null,
        deliveryStatus: "none",
        deliveredAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      transaction.create(jobRef, record);
      transaction.create(operationRef, {
        idempotencyKey: operationId,
        telegramUpdateId,
        operationType: input.kind === "scheduled" ? "schedule_job" : "run_now",
        resultingJobId: id,
        createdAt: timestamp,
        expiresAt: Timestamp.fromMillis(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      return { job: summarize(record), created: true };
    });
  }

  async get(jobId: string): Promise<StoredJob | null> {
    const snapshot = await this.firestore.collection("jobs").doc(jobId).get();
    return snapshot.exists ? summarize(snapshot.data() as JobRecord) : null;
  }

  async setCloudTaskName(jobId: string, taskName: string, now = new Date()): Promise<void> {
    await this.firestore.collection("jobs").doc(jobId).update({ cloudTaskName: taskName, updatedAt: Timestamp.fromDate(now) });
  }

  async transition(jobId: string, expected: readonly JobStatus[], next: JobStatus, patch: Record<string, unknown> = {}, now = new Date()): Promise<StoredJob | null> {
    const ref = this.firestore.collection("jobs").doc(jobId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const record = snapshot.data() as JobRecord;
      if (!expected.includes(record.status)) return summarize(record);
      assertJobTransition(record.status, next);
      const nextRecord: JobRecord = { ...record, ...patch, status: next, updatedAt: Timestamp.fromDate(now) };
      transaction.update(ref, { ...patch, status: next, updatedAt: Timestamp.fromDate(now) });
      return summarize(nextRecord);
    });
  }

  async prepareWake(jobId: string, now = new Date()): Promise<StoredJob | null> {
    const current = await this.get(jobId);
    if (!current) return null;
    if (current.status === "scheduled") return this.transition(jobId, ["scheduled"], "pending_wake", {}, now);
    return current;
  }

  async markStarting(jobId: string, now = new Date()): Promise<StoredJob | null> {
    return this.transition(jobId, ["pending_wake"], "starting", {}, now);
  }

  async markPending(jobId: string, now = new Date()): Promise<StoredJob | null> {
    return this.transition(jobId, ["starting", "pending_wake"], "pending", {}, now);
  }

  async cancel(jobId: string, telegramUserId: string, now = new Date()): Promise<boolean> {
    const ref = this.firestore.collection("jobs").doc(jobId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const record = snapshot.data() as JobRecord;
      if (record.telegramUserId !== telegramUserId) return false;
      if (!(["scheduled", "pending_wake", "pending"] as JobStatus[]).includes(record.status)) return false;
      assertJobTransition(record.status, "cancelled");
      transaction.update(ref, { status: "cancelled", cancelledAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) });
      return true;
    });
  }

  async listForUser(telegramUserId: string, limit = 10): Promise<StoredJob[]> {
    return (await this.listPageForUser(telegramUserId, limit)).jobs;
  }

  async listPageForUser(telegramUserId: string, limit = 10, afterJobId?: string): Promise<{ jobs: StoredJob[]; nextCursor: string | null }> {
    let query = this.firestore.collection("jobs")
      .where("telegramUserId", "==", telegramUserId)
      .where("status", "in", ["scheduled", "pending_wake", "starting", "pending", "running"])
      .orderBy("scheduledAt", "asc")
      .limit(limit + 1);
    if (afterJobId) {
      const cursor = await this.firestore.collection("jobs").doc(afterJobId).get();
      if (!cursor.exists || cursor.get("telegramUserId") !== telegramUserId) return { jobs: [], nextCursor: null };
      query = query.startAfter(cursor);
    }
    const snapshot = await query.get();
    const visible = snapshot.docs.slice(0, limit);
    return {
      jobs: visible.map((document) => summarize(document.data() as JobRecord)),
      nextCursor: snapshot.size > limit ? visible.at(-1)?.id ?? null : null,
    };
  }
}
