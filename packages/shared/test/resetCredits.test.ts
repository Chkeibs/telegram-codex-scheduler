import { describe, expect, it } from "vitest";
import { formatResetCreditsForTelegram, parseResetCreditsResponse } from "../src/resetCredits.js";

describe("reset credit parsing and formatting", () => {
  it("formats only the available reset count and expiry dates", () => {
    const snapshot = parseResetCreditsResponse({
      available_count: 2,
      credits: [
        { id: "a", status: "available", expires_at: "2026-07-18T00:13:00.000Z", title: "Full reset" },
        { id: "b", status: "expired", expires_at: "2026-07-01T00:00:00.000Z", title: "Old reset" },
        { id: "c", status: "available", expires_at: "2026-07-27T23:45:00.000Z", title: "Full reset" },
      ],
    });

    expect(formatResetCreditsForTelegram(snapshot, "Asia/Beirut")).toBe([
      "Codex resets: 2",
      "",
      "1. Expires: 18 Jul 2026, 03:13",
      "2. Expires: 28 Jul 2026, 02:45",
    ].join("\n"));
  });

  it("returns a single count line when no reset is available", () => {
    const snapshot = parseResetCreditsResponse({ available_count: 0, credits: [] });
    expect(formatResetCreditsForTelegram(snapshot, "Asia/Beirut")).toBe("Codex resets: 0");
  });
});
