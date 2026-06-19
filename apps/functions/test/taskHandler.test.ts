import { describe, expect, it, vi } from "vitest";
import { createTaskHandler, type HttpResponseLike, type TaskHandlerDependencies } from "../src/taskHandler.js";
import type { StoredJob } from "../src/repositories/firestoreJobRepository.js";

function responseRecorder() {
  const result = { code: 0, body: undefined as unknown };
  const response: HttpResponseLike = {
    status(code) { result.code = code; return response; },
    json(body) { result.body = body; },
    send(body) { result.body = body; },
  };
  return { response, result };
}

function job(status: StoredJob["status"]): StoredJob {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    status,
    scheduledAt: new Date(),
    telegramUserId: "1",
    telegramChatId: "1",
    cloudTaskName: null,
  };
}

function dependencies(status: StoredJob["status"], wake: TaskHandlerDependencies["compute"]["wake"]): TaskHandlerDependencies {
  return {
    jobs: {
      prepareWake: vi.fn(async () => job(status)),
      markStarting: vi.fn(async () => job("starting")),
      markPending: vi.fn(async () => job("pending")),
    },
    compute: { wake },
    tasks: { scheduleWake: vi.fn(async () => "task") },
    retryDelaySeconds: 60,
  };
}

describe("task handler", () => {
  it("does not wake a cancelled job", async () => {
    const deps = dependencies("cancelled", vi.fn(async () => "started"));
    const { response, result } = responseRecorder();
    await createTaskHandler(deps)({ body: { jobId: job("cancelled").id } }, response);
    expect(result.code).toBe(204);
    expect(deps.compute.wake).not.toHaveBeenCalled();
  });

  it("marks a job pending when the worker is already running", async () => {
    const deps = dependencies("pending_wake", vi.fn(async () => "already_running"));
    const { response, result } = responseRecorder();
    await createTaskHandler(deps)({ body: { jobId: job("pending_wake").id } }, response);
    expect(result.code).toBe(202);
    expect(deps.jobs.markPending).toHaveBeenCalledOnce();
  });

  it("schedules a distinct retry while the VM is stopping", async () => {
    const deps = dependencies("pending_wake", vi.fn(async () => "retry_after_stop"));
    const { response, result } = responseRecorder();
    await createTaskHandler(deps)({ body: { jobId: job("pending_wake").id } }, response);
    expect(result.code).toBe(202);
    expect(deps.tasks.scheduleWake).toHaveBeenCalledWith(job("pending_wake").id, expect.any(Date), expect.stringContaining("retry-"));
  });
});
