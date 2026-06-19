import { cloudTaskPayloadSchema } from "@telegram-codex/shared";
import type { StoredJob } from "./repositories/firestoreJobRepository.js";
import type { WakeDecision } from "./services/computeService.js";

export interface TaskJobsLike {
  prepareWake(jobId: string): Promise<StoredJob | null>;
  markStarting(jobId: string): Promise<StoredJob | null>;
  markPending(jobId: string): Promise<StoredJob | null>;
}

export interface TaskComputeLike { wake(): Promise<WakeDecision> }
export interface TaskQueueLike { scheduleWake(jobId: string, scheduleAt: Date, suffix?: string): Promise<string> }

export interface TaskHandlerDependencies {
  jobs: TaskJobsLike;
  compute: TaskComputeLike;
  tasks: TaskQueueLike;
  retryDelaySeconds: number;
}

export interface HttpRequestLike { body: unknown }
export interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): void;
  send(body?: unknown): void;
}

export function createTaskHandler(dependencies: TaskHandlerDependencies) {
  return async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    const parsed = cloudTaskPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_task_payload" });
      return;
    }
    const job = await dependencies.jobs.prepareWake(parsed.data.jobId);
    if (!job || job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
      response.status(204).send();
      return;
    }
    if (job.status !== "pending_wake" && job.status !== "starting" && job.status !== "pending") {
      response.status(409).json({ error: "job_not_wakeable", status: job.status });
      return;
    }

    if (job.status === "pending") {
      response.status(204).send();
      return;
    }

    const decision = await dependencies.compute.wake();
    if (decision === "retry_after_stop") {
      const retryAt = new Date(Date.now() + dependencies.retryDelaySeconds * 1000);
      await dependencies.tasks.scheduleWake(job.id, retryAt, `retry-${Math.floor(retryAt.getTime() / 1000)}`);
      response.status(202).json({ status: "retry_scheduled" });
      return;
    }
    if (decision === "already_running") await dependencies.jobs.markPending(job.id);
    else await dependencies.jobs.markStarting(job.id);
    response.status(202).json({ status: decision });
  };
}
