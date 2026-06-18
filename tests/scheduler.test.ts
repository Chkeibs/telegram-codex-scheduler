import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Telegram } from "telegraf";
import type { CodexRunner } from "../src/services/codexRunner.js";
import { Scheduler } from "../src/services/scheduler.js";
import { createTestServices } from "./helpers.js";

let database: DatabaseSync | undefined;
afterEach(() => database?.close());

function jobInput(scheduledAt: string) {
  return {
    kind: "scheduled" as const,
    telegramUserId: "123",
    message: "salut",
    scheduledAt,
    timezone: "Europe/Paris",
    workingDirectory: process.cwd(),
    filesystemPermission: "read_only" as const,
  };
}

describe("Scheduler", () => {
  it("executes an overdue job once and does not rerun after notification failure", async () => {
    const services = createTestServices();
    database = services.database;
    const job = services.jobs.create(jobInput("2026-06-18T09:00:00.000Z"));
    const run = vi.fn(async () => ({ success: true, exitCode: 0, stdout: "hello", stderr: "", timedOut: false, truncated: false }));
    const telegram = {
      sendMessage: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined),
      sendDocument: vi.fn(),
    } as unknown as Telegram;
    const scheduler = new Scheduler(services.jobs, services.users, services.conversations, { run } as unknown as CodexRunner, telegram, {
      intervalMs: 30_000,
      staleAfterMs: 60_000,
      secretValues: [],
    });
    await scheduler.tick(new Date("2026-06-18T10:00:00.000Z"));
    await scheduler.tick(new Date("2026-06-18T10:01:00.000Z"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(services.jobs.getById(job.id)?.status).toBe("completed");
  });

  it("marks stale running jobs failed without executing them again", async () => {
    const services = createTestServices();
    database = services.database;
    const job = services.jobs.create(jobInput("2026-06-18T08:00:00.000Z"));
    services.jobs.claimById(job.id, new Date("2026-06-18T09:00:00.000Z"));
    const run = vi.fn();
    const telegram = { sendMessage: vi.fn().mockResolvedValue(undefined), sendDocument: vi.fn() } as unknown as Telegram;
    const scheduler = new Scheduler(services.jobs, services.users, services.conversations, { run } as unknown as CodexRunner, telegram, {
      intervalMs: 30_000,
      staleAfterMs: 30 * 60_000,
      secretValues: [],
    });
    await scheduler.tick(new Date("2026-06-18T10:00:00.000Z"));
    expect(run).not.toHaveBeenCalled();
    expect(services.jobs.getById(job.id)?.status).toBe("failed");
  });

  it("serializes immediate executions through one queue", async () => {
    const services = createTestServices();
    database = services.database;
    const first = services.jobs.create({ ...jobInput(new Date().toISOString()), kind: "immediate" });
    const second = services.jobs.create({ ...jobInput(new Date().toISOString()), kind: "immediate" });
    let active = 0;
    let maximumActive = 0;
    const run = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { success: true, exitCode: 0, stdout: "ok", stderr: "", timedOut: false, truncated: false };
    });
    const telegram = { sendMessage: vi.fn().mockResolvedValue(undefined), sendDocument: vi.fn() } as unknown as Telegram;
    const scheduler = new Scheduler(services.jobs, services.users, services.conversations, { run } as unknown as CodexRunner, telegram, {
      intervalMs: 30_000,
      staleAfterMs: 60_000,
      secretValues: [],
    });
    await Promise.all([scheduler.runJobNow(first.id), scheduler.runJobNow(second.id)]);
    expect(maximumActive).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
