import { describe, expect, it } from "vitest";
import { parseDateInput, presetTime } from "../src/services/dateParser.js";

const now = new Date("2026-06-18T10:00:00.000Z");

describe("date parser", () => {
  it("parses both explicit formats in the user timezone", () => {
    expect(parseDateInput("2026-06-19 07:00", "Europe/Paris", now)).toEqual({
      ok: true,
      isoUtc: "2026-06-19T05:00:00.000Z",
    });
    expect(parseDateInput("19/06/2026 07:00", "Europe/Paris", now)).toEqual({
      ok: true,
      isoUtc: "2026-06-19T05:00:00.000Z",
    });
  });

  it("parses tomorrow and relative input", () => {
    expect(parseDateInput("tomorrow 7am", "Europe/Paris", now)).toMatchObject({ ok: true, isoUtc: "2026-06-19T05:00:00.000Z" });
    expect(parseDateInput("in 2 hours", "Europe/Paris", now)).toEqual({ ok: true, isoUtc: "2026-06-18T12:00:00.000Z" });
  });

  it("rejects invalid and past input", () => {
    expect(parseDateInput("nonsense", "Europe/Paris", now).ok).toBe(false);
    expect(parseDateInput("2026-01-01 07:00", "Europe/Paris", now).ok).toBe(false);
    expect(parseDateInput("2026-03-29 02:30", "Europe/Paris", new Date("2026-03-01T00:00:00.000Z")).ok).toBe(false);
  });

  it("moves the 20:00 preset to tomorrow after it has passed", () => {
    const late = new Date("2026-06-18T19:00:00.000Z"); // 21:00 in Paris
    expect(presetTime("next20", "Europe/Paris", late)).toBe("2026-06-19T18:00:00.000Z");
  });
});
