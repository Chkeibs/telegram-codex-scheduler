import { describe, expect, it } from "vitest";
import { formatBankedResetsForTelegram, formatCodexRateLimitsForTelegram, parseCodexRateLimitsResponse } from "../src/rateLimits.js";

describe("Codex rate-limit parsing and formatting", () => {
  it("formats the 5-hour and weekly windows returned by App Server", () => {
    const snapshot = parseCodexRateLimitsResponse({
      rateLimits: {
        primary: { usedPercent: 43, windowDurationMins: 300, resetsAt: 1_788_241_059 },
        secondary: { usedPercent: 29, windowDurationMins: 10_080, resetsAt: 1_788_747_939 },
      },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [{ status: "available", expiresAt: 1_788_816_739, title: "Rate-limit reset" }],
      },
    });

    expect(formatCodexRateLimitsForTelegram(snapshot, "America/New_York")).toBe([
      "Codex usage limits",
      "",
      "5-hour limit: 43% used (57% left)",
      "Resets: 01 Sep 2026, 01:37 (America/New_York)",
      "",
      "Weekly limit: 29% used (71% left)",
      "Resets: 06 Sep 2026, 22:25 (America/New_York)",
    ].join("\n"));
  });

  it("prefers the Codex bucket from the multi-limit response", () => {
    const snapshot = parseCodexRateLimitsResponse({
      rateLimits: { primary: null, secondary: null },
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_788_241_059 }, secondary: null },
      },
    });
    expect(snapshot.primary?.usedPercent).toBe(10);
    expect(snapshot.earnedResets).toBeNull();
  });

  it("formats only banked resets and their expiry dates", () => {
    const snapshot = parseCodexRateLimitsResponse({
      rateLimits: { primary: null, secondary: null },
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [{ status: "available", expiresAt: 1_789_866_600, title: "Rate-limit reset" }],
      },
    });
    expect(formatBankedResetsForTelegram(snapshot, "Europe/Paris")).toBe([
      "Codex banked resets",
      "",
      "Available: 1",
      "",
      "1. Expires: 20 Sep 2026, 03:10 (Europe/Paris)",
    ].join("\n"));
  });
});
