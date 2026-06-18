import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestServices } from "./helpers.js";

let database: DatabaseSync | undefined;
afterEach(() => database?.close());

describe("JobService", () => {
  it("creates, finds, and cancels a scheduled job without deleting it", () => {
    const services = createTestServices();
    database = services.database;
    const job = services.jobs.create({
      kind: "scheduled",
      telegramUserId: "123",
      message: "salut",
      scheduledAt: "2026-06-19T05:00:00.000Z",
      timezone: "Europe/Paris",
      workingDirectory: process.cwd(),
      filesystemPermission: "read_only",
    });
    expect(services.jobs.countPending("123")).toBe(1);
    expect(services.jobs.cancel(job.id, "123")).toBe(true);
    expect(services.jobs.getById(job.id)?.status).toBe("cancelled");
  });

  it("finds and atomically claims due jobs only once", () => {
    const services = createTestServices();
    database = services.database;
    services.jobs.create({
      kind: "scheduled",
      telegramUserId: "123",
      message: "due",
      scheduledAt: "2026-06-18T09:00:00.000Z",
      timezone: "Europe/Paris",
      workingDirectory: process.cwd(),
      filesystemPermission: "read_only",
    });
    const claimed = services.jobs.claimNextDue(new Date("2026-06-18T10:00:00.000Z"));
    expect(claimed?.status).toBe("running");
    expect(services.jobs.claimNextDue(new Date("2026-06-18T10:00:00.000Z"))).toBeNull();
  });

  it("atomically consumes a confirmation draft and rejects duplicate callbacks", () => {
    const services = createTestServices();
    database = services.database;
    const now = new Date("2026-06-18T10:00:00.000Z");
    services.conversations.set("123", "schedule", "confirm", {
      scheduledAt: "2026-06-19T05:00:00.000Z",
      message: "salut",
      workingDirectory: process.cwd(),
      filesystemPermission: "read_only",
    }, now);
    expect(services.jobs.confirmConversation("123", "scheduled", now)).not.toBeNull();
    expect(services.jobs.confirmConversation("123", "scheduled", now)).toBeNull();
    expect(services.jobs.countPending("123")).toBe(1);
  });
});
