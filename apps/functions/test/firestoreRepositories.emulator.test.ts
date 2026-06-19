import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FirestoreJobRepository } from "../src/repositories/firestoreJobRepository.js";
import { WorkerJobRepository } from "../../worker/src/firestoreJobRepository.js";

const app = initializeApp({ projectId: `demo-telegram-codex-${randomUUID()}` }, `test-${randomUUID()}`);
const firestore = getFirestore(app);

beforeEach(async () => {
  await firestore.recursiveDelete(firestore.collection("jobs"));
  await firestore.recursiveDelete(firestore.collection("operations"));
});

afterAll(async () => {
  await deleteApp(app);
});

describe("Firestore repositories", () => {
  it("deduplicates a Telegram confirmation transactionally", async () => {
    const repository = new FirestoreJobRepository(firestore);
    const input = {
      kind: "immediate" as const,
      telegramUserId: "1",
      telegramChatId: "1",
      prompt: "hello",
      scheduledAt: new Date(),
      timezoneSnapshot: "Europe/Paris",
      workdirKey: "default",
      filesystemPermission: "read_only" as const,
      idempotencyKey: "confirm-100",
    };
    const first = await repository.createIdempotent(input, 100);
    const second = await repository.createIdempotent(input, 100);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect((await firestore.collection("jobs").get()).size).toBe(1);
  });

  it("allows only one concurrent worker claim", async () => {
    const id = randomUUID();
    await firestore.collection("jobs").doc(id).set({
      id,
      status: "pending",
      prompt: "hello",
      workdirKey: "default",
      filesystemPermission: "read_only",
      telegramUserId: "1",
      telegramChatId: "1",
      scheduledAt: Timestamp.fromMillis(Date.now() - 1000),
      attempt: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    const repository = new WorkerJobRepository(firestore);
    const [first, second] = await Promise.all([
      repository.claimNextDue("worker-a", "boot-a", 60_000),
      repository.claimNextDue("worker-b", "boot-b", 60_000),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("cancels pending work but not running work", async () => {
    const repository = new FirestoreJobRepository(firestore);
    const created = await repository.createIdempotent({
      kind: "immediate",
      telegramUserId: "1",
      telegramChatId: "1",
      prompt: "hello",
      scheduledAt: new Date(),
      timezoneSnapshot: "Europe/Paris",
      workdirKey: "default",
      filesystemPermission: "read_only",
      idempotencyKey: "cancel-1",
    }, 101);
    expect(await repository.cancel(created.job.id, "1")).toBe(true);
    expect((await repository.get(created.job.id))?.status).toBe("cancelled");
  });

  it("extends an owned lease and reconciles an abandoned running job without retry", async () => {
    const id = randomUUID();
    const oldLease = Timestamp.fromMillis(Date.now() - 60_000);
    await firestore.collection("jobs").doc(id).set({
      id,
      status: "running",
      prompt: "hello",
      workdirKey: "default",
      filesystemPermission: "read_only",
      telegramUserId: "1",
      telegramChatId: "1",
      scheduledAt: oldLease,
      attempt: 1,
      leaseOwner: "dead-worker",
      leaseExpiresAt: oldLease,
    });
    const repository = new WorkerJobRepository(firestore);
    const reconciled = await repository.reconcileStaleRunning();
    const failed = await firestore.collection("jobs").doc(id).get();
    expect(reconciled).toBe(1);
    expect(failed.get("status")).toBe("failed");
    expect(failed.get("errorCode")).toBe("STALE_RUNNING_JOB");
    expect(failed.get("deliveryStatus")).toBe("pending");
  });

  it("heartbeats only the worker that owns the running lease", async () => {
    const id = randomUUID();
    const now = new Date();
    await firestore.collection("jobs").doc(id).set({
      id,
      status: "running",
      prompt: "hello",
      workdirKey: "default",
      filesystemPermission: "read_only",
      telegramUserId: "1",
      telegramChatId: "1",
      scheduledAt: Timestamp.fromDate(now),
      attempt: 1,
      leaseOwner: "worker-a",
      leaseExpiresAt: Timestamp.fromDate(now),
    });
    const repository = new WorkerJobRepository(firestore);
    const job = {
      id,
      prompt: "hello",
      workdirKey: "default",
      filesystemPermission: "read_only" as const,
      telegramUserId: "1",
      telegramChatId: "1",
      scheduledAt: now,
      leaseOwner: "worker-a",
    };
    expect(await repository.heartbeat(job, 60_000, now)).toBe(true);
    expect(await repository.heartbeat({ ...job, leaseOwner: "worker-b" }, 60_000, now)).toBe(false);
  });
});
