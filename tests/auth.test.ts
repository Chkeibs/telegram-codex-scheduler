import { describe, expect, it } from "vitest";
import { isAuthorized } from "../src/services/auth.js";
import { createTestServices } from "./helpers.js";

describe("Telegram allowlist", () => {
  it("accepts only explicitly allowed user IDs", () => {
    const allowed = new Set(["123", "456"]);
    expect(isAuthorized(allowed, "123")).toBe(true);
    expect(isAuthorized(allowed, "999")).toBe(false);
    expect(isAuthorized(allowed, null)).toBe(false);
  });

  it("cannot create a job for a user with no authorized user record", () => {
    const services = createTestServices();
    expect(() => services.jobs.create({
      kind: "scheduled",
      telegramUserId: "999",
      message: "unauthorized",
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      timezone: "Europe/Paris",
      workingDirectory: process.cwd(),
      filesystemPermission: "read_only",
    })).toThrow();
    services.database.close();
  });
});
