import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexRateLimitsReader } from "../src/codexRateLimitsReader.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mock-codex-app-server.sh");

describe("CodexRateLimitsReader", () => {
  it("reads the normal usage windows through the local Codex App Server", async () => {
    const reader = new CodexRateLimitsReader({ codexBin: fixture, timeoutMs: 2_000 });
    await expect(reader.read()).resolves.toEqual({
      primary: { usedPercent: 43, windowDurationMins: 300, resetsAt: 1_788_241_059 },
      secondary: { usedPercent: 29, windowDurationMins: 10_080, resetsAt: 1_788_747_939 },
      earnedResets: {
        availableCount: 1,
        credits: [{ status: "available", expiresAt: 1_788_816_739, title: "Rate-limit reset" }],
      },
    });
  });
});
