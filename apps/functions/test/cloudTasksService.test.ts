import { describe, expect, it, vi } from "vitest";
import { CloudTasksService, type TasksClientLike } from "../src/services/cloudTasksService.js";

function fakeClient(): TasksClientLike {
  return {
    queuePath: (project, location, queue) => `${project}/${location}/${queue}`,
    taskPath: (project, location, queue, task) => `${project}/${location}/${queue}/${task}`,
    createTask: vi.fn(async () => [{}] as const),
    deleteTask: vi.fn(async () => [{}] as const),
  };
}

describe("CloudTasksService", () => {
  it("uses a deterministic task name", async () => {
    const client = fakeClient();
    const service = new CloudTasksService(client, {
      projectId: "project",
      location: "us-central1",
      queue: "wakeups",
      handlerUrl: "https://example.test/task",
      invokerServiceAccount: "tasks@example.iam.gserviceaccount.com",
    });
    const first = await service.scheduleWake("550e8400-e29b-41d4-a716-446655440000", new Date("2026-06-19T07:00:00Z"));
    const second = service.taskName("550e8400-e29b-41d4-a716-446655440000");
    expect(first).toBe(second);
    expect(client.createTask).toHaveBeenCalledOnce();
  });

  it("treats an existing task as success", async () => {
    const client = fakeClient();
    client.createTask = vi.fn(async () => { throw Object.assign(new Error("exists"), { code: 6 }); });
    const service = new CloudTasksService(client, {
      projectId: "project",
      location: "us-central1",
      queue: "wakeups",
      handlerUrl: "https://example.test/task",
      invokerServiceAccount: "tasks@example.iam.gserviceaccount.com",
    });
    await expect(service.scheduleWake("550e8400-e29b-41d4-a716-446655440000", new Date())).resolves.toContain("job-");
  });
});
