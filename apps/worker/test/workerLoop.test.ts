import { describe, expect, it, vi } from "vitest";
import { WorkerLoop, type WorkerJobsLike } from "../src/workerLoop.js";
import type { WorkerJob } from "../src/firestoreJobRepository.js";

const queuedJob: WorkerJob = {
  id: "job-1",
  prompt: "hello",
  workdirKey: "default",
  filesystemPermission: "read_only",
  telegramUserId: "1",
  telegramChatId: "1",
  scheduledAt: new Date(),
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
});
