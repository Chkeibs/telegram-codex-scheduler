import { preview, sanitizeOutput } from "./outputSanitizer.js";
import type { CodexRequest, CodexResult } from "./codexRunner.js";
import type { WorkerJob } from "./firestoreJobRepository.js";
import type { ResultArtifactStoreLike } from "./resultArtifactStore.js";
import type { CodexResetCreditsSnapshot } from "@telegram-codex/shared";
import { formatResetCreditsForTelegram } from "@telegram-codex/shared";

export interface WorkerJobsLike {
  setWorkerState(instanceName: string, state: string, bootId: string, currentJobId: string | null): Promise<void>;
  reconcileStaleRunning(): Promise<number>;
  promoteWakeableJobs(): Promise<number>;
  claimNextDue(workerId: string, bootId: string, leaseMs: number): Promise<WorkerJob | null>;
  hasClaimableWork(): Promise<boolean>;
  heartbeat(job: WorkerJob, leaseMs: number): Promise<boolean>;
  complete(job: WorkerJob, outputPreview: string, resultObjectName: string | null, exitCode: number | null, durationMs: number, workingDirectory: string): Promise<boolean>;
  fail(job: WorkerJob, errorCode: string, errorPreview: string, outputPreview: string | null, resultObjectName: string | null, exitCode: number | null, durationMs: number, workingDirectory: string | null): Promise<boolean>;
}

export interface CodexExecutorLike { run(request: CodexRequest): Promise<CodexResult> }
export interface ResetCreditsReaderLike { read(): Promise<CodexResetCreditsSnapshot> }
export interface ShutdownLike { drain(hasClaimableWork: () => Promise<boolean>): Promise<"continued" | "shutdown"> }

export interface WorkerLoopOptions {
  workerId: string;
  bootId: string;
  instanceName: string;
  leaseMs: number;
  heartbeatMs: number;
  maximumRuntimeMs: number;
  outputPreviewChars: number;
  secretValues?: readonly string[];
}

export class WorkerLoop {
  constructor(
    private readonly jobs: WorkerJobsLike,
    private readonly runner: CodexExecutorLike,
    private readonly artifacts: ResultArtifactStoreLike,
    private readonly shutdown: ShutdownLike,
    private readonly options: WorkerLoopOptions,
    private readonly resetCreditsReader?: ResetCreditsReaderLike,
  ) {}

  async run(): Promise<void> {
    const deadline = Date.now() + this.options.maximumRuntimeMs;
    await this.jobs.setWorkerState(this.options.instanceName, "booting", this.options.bootId, null);
    await this.jobs.reconcileStaleRunning();
    await this.jobs.promoteWakeableJobs();
    await this.jobs.setWorkerState(this.options.instanceName, "ready", this.options.bootId, null);

    while (Date.now() < deadline) {
      const job = await this.jobs.claimNextDue(this.options.workerId, this.options.bootId, this.options.leaseMs);
      if (!job) {
        await this.jobs.setWorkerState(this.options.instanceName, "draining", this.options.bootId, null);
        const result = await this.shutdown.drain(() => this.jobs.hasClaimableWork());
        if (result === "shutdown") return;
        await this.jobs.promoteWakeableJobs();
        await this.jobs.setWorkerState(this.options.instanceName, "ready", this.options.bootId, null);
        continue;
      }

      await this.jobs.setWorkerState(this.options.instanceName, "busy", this.options.bootId, job.id);
      let heartbeatInFlight = false;
      const heartbeat = setInterval(() => {
        if (heartbeatInFlight) return;
        heartbeatInFlight = true;
        void Promise.all([
          this.jobs.heartbeat(job, this.options.leaseMs),
          this.jobs.setWorkerState(this.options.instanceName, "busy", this.options.bootId, job.id),
        ]).finally(() => { heartbeatInFlight = false; });
      }, this.options.heartbeatMs);
      heartbeat.unref();
      try {
        if (job.kind === "reset_credit_status") {
          if (!this.resetCreditsReader) throw new Error("Reset-credit reader is not configured on this worker");
          const snapshot = await this.resetCreditsReader.read();
          const output = formatResetCreditsForTelegram(snapshot, job.timezoneSnapshot);
          const saved = await this.jobs.complete(job, output, null, 0, 0, "");
          if (!saved) throw new Error("Job lease was lost before reset-credit status could be recorded");
        } else {
          const result = await this.runner.run({ prompt: job.prompt, workdirKey: job.workdirKey, filesystemPermission: job.filesystemPermission });
          const stdout = sanitizeOutput(result.stdout, this.options.secretValues);
          const stderr = sanitizeOutput(result.stderr, this.options.secretValues);
          const resultObjectName = await this.artifacts.put(job.id, result.success ? stdout : [stdout, stderr].filter(Boolean).join("\n\n--- diagnostics ---\n"));
          if (result.success) {
            const saved = await this.jobs.complete(job, preview(stdout, this.options.outputPreviewChars), resultObjectName, result.exitCode, result.durationMs, result.workingDirectory);
            if (!saved) throw new Error("Job lease was lost before completion could be recorded");
          } else {
            const code = result.timedOut ? "CODEX_TIMEOUT" : result.exitCode === null ? "CODEX_SPAWN_FAILED" : "CODEX_EXIT_ERROR";
            const saved = await this.jobs.fail(job, code, preview(stderr, this.options.outputPreviewChars, true), stdout ? preview(stdout, this.options.outputPreviewChars) : null, resultObjectName, result.exitCode, result.durationMs, result.workingDirectory);
            if (!saved) throw new Error("Job lease was lost before failure could be recorded");
          }
        }
      } catch (error) {
        const message = sanitizeOutput(error instanceof Error ? error.message : String(error), this.options.secretValues);
        await this.jobs.fail(job, "WORKER_ERROR", preview(message, this.options.outputPreviewChars, true), null, null, null, 0, null);
      } finally {
        clearInterval(heartbeat);
      }
      await this.jobs.setWorkerState(this.options.instanceName, "ready", this.options.bootId, null);
    }

    await this.jobs.setWorkerState(this.options.instanceName, "stopping", this.options.bootId, null);
    await this.shutdown.drain(async () => false);
  }
}
