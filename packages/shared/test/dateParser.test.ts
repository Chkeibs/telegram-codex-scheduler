import { describe, expect, it } from "vitest";
import { parseDateInput, presetTime } from "../src/index.js";

describe("shared date parser", () => {
  const now = new Date("2026-06-18T10:00:00Z");

  it("parses explicit local time into UTC", () => {
    const result = parseDateInput("2026-06-19 07:00", "Europe/Paris", now);
    expect(result.ok && result.date.toISOString()).toBe("2026-06-19T05:00:00.000Z");
  });

  it("rejects past input", () => {
    expect(parseDateInput("2026-06-17 07:00", "Europe/Paris", now).ok).toBe(false);
  });

  it("creates relative presets", () => {
    expect(presetTime("10m", "Europe/Paris", now).toISOString()).toBe("2026-06-18T10:10:00.000Z");
  });
});
