import { DateTime } from "luxon";

export type ParseDateResult = { ok: true; date: Date } | { ok: false; reason: string };
const EXPLICIT_FORMATS = ["yyyy-MM-dd HH:mm", "dd/MM/yyyy HH:mm"] as const;

export function isValidTimezone(timezone: string): boolean {
  return DateTime.now().setZone(timezone).isValid;
}

export function parseDateInput(input: string, timezone: string, now = new Date()): ParseDateResult {
  const value = input.trim();
  if (!value) return { ok: false, reason: "Please enter a date and time." };
  if (!isValidTimezone(timezone)) return { ok: false, reason: "Your configured timezone is invalid." };
  let parsed: DateTime | null = null;
  for (const format of EXPLICIT_FORMATS) {
    const candidate = DateTime.fromFormat(value, format, { zone: timezone, setZone: true });
    if (candidate.isValid && candidate.toFormat(format) === value) { parsed = candidate; break; }
  }
  if (!parsed) {
    const match = /^tomorrow\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value);
    if (match) {
      let hour = Number(match[1]);
      const minute = Number(match[2] ?? "0");
      const meridiem = match[3]?.toLowerCase();
      if (meridiem && hour >= 1 && hour <= 12) {
        if (meridiem === "am" && hour === 12) hour = 0;
        if (meridiem === "pm" && hour !== 12) hour += 12;
      }
      if (hour <= 23 && minute <= 59 && (!meridiem || Number(match[1]) <= 12)) {
        const candidate = DateTime.fromJSDate(now).setZone(timezone).plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
        parsed = candidate.hour === hour && candidate.minute === minute ? candidate : DateTime.invalid("Nonexistent local time");
      }
    }
  }
  if (!parsed) {
    const match = /^in\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)$/i.exec(value);
    if (match) {
      const amount = Number(match[1]);
      const unit = (match[2] as string).toLowerCase();
      if (amount > 0) {
        const base = DateTime.fromJSDate(now, { zone: "utc" });
        parsed = unit.startsWith("m") ? base.plus({ minutes: amount }) : unit.startsWith("h") ? base.plus({ hours: amount }) : base.plus({ days: amount });
      }
    }
  }
  if (!parsed?.isValid) return { ok: false, reason: "I could not read that time. Try 2026-06-19 07:00, 19/06/2026 07:00, tomorrow 7am, or in 2 hours." };
  if (parsed.toMillis() <= now.getTime()) return { ok: false, reason: "Please choose a time in the future." };
  return { ok: true, date: parsed.toUTC().toJSDate() };
}

export type TimePreset = "10m" | "30m" | "1h" | "tomorrow7" | "tomorrow8" | "next20";

export function presetTime(preset: TimePreset, timezone: string, now = new Date()): Date {
  const local = DateTime.fromJSDate(now).setZone(timezone);
  if (preset === "10m") return local.plus({ minutes: 10 }).toJSDate();
  if (preset === "30m") return local.plus({ minutes: 30 }).toJSDate();
  if (preset === "1h") return local.plus({ hours: 1 }).toJSDate();
  if (preset === "tomorrow7" || preset === "tomorrow8") return local.plus({ days: 1 }).set({ hour: preset === "tomorrow7" ? 7 : 8, minute: 0, second: 0, millisecond: 0 }).toJSDate();
  let next = local.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });
  if (next.toMillis() <= local.toMillis()) next = next.plus({ days: 1 });
  return next.toJSDate();
}

export function nextTwentyLabel(timezone: string, now = new Date()): string {
  return DateTime.fromJSDate(now).setZone(timezone).hour < 20 ? "Tonight 20:00" : "Tomorrow 20:00";
}

export function formatDate(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone).toFormat("yyyy-MM-dd HH:mm ZZZZ");
}
