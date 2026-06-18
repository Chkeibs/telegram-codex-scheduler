import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestServices } from "./helpers.js";

let database: DatabaseSync | undefined;
afterEach(() => database?.close());

describe("persistent conversation flow", () => {
  it("supports preset time, message, directory, permission, and edits", () => {
    const services = createTestServices();
    database = services.database;
    const now = new Date("2026-06-18T10:00:00.000Z");
    services.conversations.set("123", "schedule", "select_time", {}, now);
    services.conversations.transition("123", "enter_message", { scheduledAt: "2026-06-19T05:00:00.000Z" }, now);
    services.conversations.transition("123", "select_directory", { message: "first" }, now);
    services.conversations.transition("123", "select_permission", { workingDirectory: process.cwd() }, now);
    services.conversations.transition("123", "confirm", { filesystemPermission: "read_only" }, now);
    expect(services.conversations.get("123", now)?.payload.message).toBe("first");
    services.conversations.transition("123", "enter_message", {}, now);
    services.conversations.transition("123", "select_directory", { message: "edited" }, now);
    services.conversations.transition("123", "select_permission", { workingDirectory: process.cwd() }, now);
    services.conversations.transition("123", "confirm", { filesystemPermission: "workspace_write" }, now);
    expect(services.conversations.get("123", now)?.payload).toMatchObject({
      message: "edited",
      workingDirectory: process.cwd(),
      filesystemPermission: "workspace_write",
    });
  });

  it("supports the custom-time branch and expires abandoned state", () => {
    const services = createTestServices();
    database = services.database;
    const start = new Date("2026-06-18T10:00:00.000Z");
    services.conversations.set("123", "schedule", "enter_custom_time", {}, start);
    expect(services.conversations.get("123", new Date("2026-06-18T10:29:00.000Z"))).not.toBeNull();
    expect(services.conversations.get("123", new Date("2026-06-18T10:31:00.000Z"))).toBeNull();
  });

  it("keeps preferences isolated between allowed users", () => {
    const services = createTestServices();
    database = services.database;
    services.users.ensureUser("456", "456", "other");
    services.users.updateTimezone("123", "America/New_York");
    expect(services.users.getUser("123")?.timezone).toBe("America/New_York");
    expect(services.users.getUser("456")?.timezone).toBe("Europe/Paris");
  });
});
