import { describe, expect, it, vi } from "vitest";
import { WorkerLoop, type WorkerJobsLike } from "../src/workerLoop.js";
import type { WorkerJob } from "../src/firestoreJobRepository.js";

const queuedJob: WorkerJob = {
  id: "job-1",
  kind: "immediate",
  prompt: "hello",
  workdirKey: "default",
  filesystemPermission: "read_only",
  telegramUserId: "1",
  telegramChatId: "1",
  scheduledAt: new Date(),
  timezoneSnapshot: "Asia/Beirut",
  leaseOwner: "worker",
};

function jobsWithOne(job: WorkerJob): WorkerJobsLike {
  let claimed = false;
  return {
    setWorkerState: vi.fn(async () => undefined),
    reconcileStaleRunning: vi.fn(async () => 0),
    promoteWakeableJobs: vi.fn(async () => 1),
    claimNextDue: vi.fn(async () => claimed ? null : (claimed = true, job)),
    hasClaimableWork: vi.fn(async () => false),
    heartbeat: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
}

const artifacts = { put: vi.fn(async () => "result-artifacts/job-1.txt") };

describe("WorkerLoop", () => {
  it("completes one job and then drains", async () => {
    const jobs = jobsWithOne(queuedJob);
    const runner = { run: vi.fn(async () => ({ success: true, exitCode: 0, stdout: "done", stderr: "", timedOut: false, truncated: false, durationMs: 10, workingDirectory: "/tmp/project" })) };
    const shutdown = { drain: vi.fn(async () => "shutdown" as const) };
    const loop = new WorkerLoop(jobs, runner, artifacts, shutdown, {
      workerId: "worker",
      bootId: "boot",
      instanceName: "vm",
      leaseMs: 1000,
      heartbeatMs: 100,
      maximumRuntimeMs: 10000,
      outputPreviewChars: 3500,
    });
    await loop.run();
    expect(jobs.complete).toHaveBeenCalledOnce();
    expect(jobs.fail).not.toHaveBeenCalled();
    expect(shutdown.drain).toHaveBeenCalledOnce();
  });

  it("records Codex failure without rerunning the job", async () => {
    const jobs = jobsWithOne(queuedJob);
    const runner = { run: vi.fn(async () => ({ success: false, exitCode: 1, stdout: "", stderr: "failed", timedOut: false, truncated: false, durationMs: 10, workingDirectory: "/tmp/project" })) };
    const loop = new WorkerLoop(jobs, runner, artifacts, { drain: vi.fn(async () => "shutdown" as const) }, {
      workerId: "worker",
      bootId: "boot",
      instanceName: "vm",
      leaseMs: 1000,
      heartbeatMs: 100,
      maximumRuntimeMs: 10000,
      outputPreviewChars: 3500,
    });
    await loop.run();
    expect(jobs.fail).toHaveBeenCalledWith(queuedJob, "CODEX_EXIT_ERROR", expect.stringContaining("failed"), null, "result-artifacts/job-1.txt", 1, 10, "/tmp/project");
    expect(runner.run).toHaveBeenCalledOnce();
  });

  it("answers reset-credit jobs without running Codex or writing an artifact", async () => {
    const resetJob: WorkerJob = { ...queuedJob, kind: "reset_credit_status", prompt: "" };
    const jobs = jobsWithOne(resetJob);
    const runner = { run: vi.fn() };
    const resetCredits = {
      read: vi.fn(async () => ({
        availableCount: 1,
        availableCredits: [{ status: "available", expiresAt: "2026-07-18T00:13:00.000Z" }],
      })),
    };
    const artifactsForReset = { put: vi.fn(async () => "result-artifacts/job-1.txt") };
    const loop = new WorkerLoop(jobs, runner, artifactsForReset, { drain: vi.fn(async () => "shutdown" as const) }, {
      workerId: "worker",
      bootId: "boot",
      instanceName: "vm",
      leaseMs: 1000,
      heartbeatMs: 100,
      maximumRuntimeMs: 10000,
      outputPreviewChars: 3500,
    }, resetCredits);
    await loop.run();
    expect(resetCredits.read).toHaveBeenCalledOnce();
    expect(runner.run).not.toHaveBeenCalled();
    expect(artifactsForReset.put).not.toHaveBeenCalled();
    expect(jobs.complete).toHaveBeenCalledWith(resetJob, "Codex resets: 1\n\n1. Expires: 18 Jul 2026, 03:13", null, 0, 0, "");
  });
});
