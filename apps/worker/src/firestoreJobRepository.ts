import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { FilesystemPermission, JobKind } from "@telegram-codex/shared";

export interface WorkerJob {
  id: string;
  kind: JobKind;
  prompt: string;
  workdirKey: string;
  filesystemPermission: FilesystemPermission;
  telegramUserId: string;
  telegramChatId: string;
  scheduledAt: Date;
  timezoneSnapshot: string;
  leaseOwner: string;
}

interface WorkerJobRecord {
  id: string;
  kind: JobKind;
  status: string;
  prompt: string;
  workdirKey: string;
  filesystemPermission: FilesystemPermission;
  telegramUserId: string;
  telegramChatId: string;
  scheduledAt: Timestamp;
  timezoneSnapshot: string;
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: Timestamp | null;
}

export class WorkerJobRepository {
  constructor(private readonly firestore: Firestore) {}

  async reconcileStaleRunning(now = new Date()): Promise<number> {
    const snapshot = await this.firestore.collection("jobs")
      .where("status", "==", "running")
      .where("leaseExpiresAt", "<=", Timestamp.fromDate(now))
      .limit(100)
      .get();
    let reconciled = 0;
    for (const document of snapshot.docs) {
      const changed = await this.firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(document.ref);
        if (!current.exists) return false;
        const record = current.data() as WorkerJobRecord;
        if (record.status !== "running" || !record.leaseExpiresAt || record.leaseExpiresAt.toMillis() > now.getTime()) return false;
        transaction.update(document.ref, {
          status: "failed",
          errorCode: "STALE_RUNNING_JOB",
          errorPreview: "The worker stopped while this job was running. It was not retried automatically to prevent duplicate execution.",
          deliveryStatus: "pending",
          completedAt: Timestamp.fromDate(now),
          leaseExpiresAt: null,
          updatedAt: Timestamp.fromDate(now),
        });
        return true;
      });
      if (changed) reconciled += 1;
    }
    return reconciled;
  }

  async promoteWakeableJobs(now = new Date()): Promise<number> {
    const snapshot = await this.firestore.collection("jobs")
      .where("status", "in", ["pending_wake", "starting"])
      .limit(100)
      .get();
    if (snapshot.empty) return 0;
    const batch = this.firestore.batch();
    const timestamp = Timestamp.fromDate(now);
    for (const document of snapshot.docs) batch.update(document.ref, { status: "pending", updatedAt: timestamp });
    await batch.commit();
    return snapshot.size;
  }

  async claimNextDue(workerId: string, bootId: string, leaseMs: number, now = new Date()): Promise<WorkerJob | null> {
    const query = this.firestore.collection("jobs")
      .where("status", "==", "pending")
      .where("scheduledAt", "<=", Timestamp.fromDate(now))
      .orderBy("scheduledAt", "asc")
      .limit(1);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(query);
      const document = snapshot.docs[0];
      if (!document) return null;
      const record = document.data() as WorkerJobRecord;
      const leaseExpiresAt = Timestamp.fromMillis(now.getTime() + leaseMs);
      transaction.update(document.ref, {
        status: "running",
        leaseOwner: workerId,
        leaseExpiresAt,
        vmBootId: bootId,
        attempt: Number(record.attempt ?? 0) + 1,
        startedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      return {
        id: document.id,
        kind: record.kind,
        prompt: record.prompt,
        workdirKey: record.workdirKey,
        filesystemPermission: record.filesystemPermission,
        telegramUserId: record.telegramUserId,
        telegramChatId: record.telegramChatId,
        scheduledAt: record.scheduledAt.toDate(),
        timezoneSnapshot: record.timezoneSnapshot,
        leaseOwner: workerId,
      };
    });
  }

  async hasClaimableWork(now = new Date()): Promise<boolean> {
    const snapshot = await this.firestore.collection("jobs")
      .where("status", "==", "pending")
      .where("scheduledAt", "<=", Timestamp.fromDate(now))
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  async heartbeat(job: WorkerJob, leaseMs: number, now = new Date()): Promise<boolean> {
    const ref = this.firestore.collection("jobs").doc(job.id);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const record = snapshot.data() as WorkerJobRecord;
      if (record.status !== "running" || record.leaseOwner !== job.leaseOwner) return false;
      transaction.update(ref, {
        leaseExpiresAt: Timestamp.fromMillis(now.getTime() + leaseMs),
        heartbeatAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      return true;
    });
  }

  async complete(job: WorkerJob, outputPreview: string, resultObjectName: string | null, exitCode: number | null, durationMs: number, workingDirectory: string, now = new Date()): Promise<boolean> {
    return this.finish(job, {
      status: "completed",
      outputPreview,
      resultObjectName,
      errorCode: null,
      errorPreview: null,
      exitCode,
      durationMs,
      workingDirectorySnapshot: workingDirectory,
      deliveryStatus: "pending",
      completedAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      leaseExpiresAt: null,
    });
  }

  async fail(job: WorkerJob, errorCode: string, errorPreview: string, outputPreview: string | null, resultObjectName: string | null, exitCode: number | null, durationMs: number, workingDirectory: string | null, now = new Date()): Promise<boolean> {
    return this.finish(job, {
      status: "failed",
      outputPreview,
      resultObjectName,
      errorCode,
      errorPreview,
      exitCode,
      durationMs,
      workingDirectorySnapshot: workingDirectory,
      deliveryStatus: "pending",
      completedAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      leaseExpiresAt: null,
    });
  }

  async setWorkerState(instanceName: string, state: string, bootId: string, currentJobId: string | null, now = new Date()): Promise<void> {
    await this.firestore.collection("workerState").doc(instanceName).set({
      instanceName,
      state,
      bootId,
      currentJobId,
      heartbeatAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    }, { merge: true });
  }

  private async finish(job: WorkerJob, patch: Record<string, unknown>): Promise<boolean> {
    const ref = this.firestore.collection("jobs").doc(job.id);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const record = snapshot.data() as WorkerJobRecord;
      if (record.status !== "running" || record.leaseOwner !== job.leaseOwner) return false;
      transaction.update(ref, patch);
      return true;
    });
  }
}
