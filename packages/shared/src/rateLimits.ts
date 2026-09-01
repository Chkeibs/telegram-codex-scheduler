import { DateTime } from "luxon";
import { z } from "zod";

const rateLimitWindowSchema = z.object({
  usedPercent: z.number().min(0),
  windowDurationMins: z.number().int().positive().nullable(),
  resetsAt: z.number().int().positive().nullable(),
});

const rateLimitSnapshotSchema = z.object({
  primary: rateLimitWindowSchema.nullable(),
  secondary: rateLimitWindowSchema.nullable(),
});

const earnedResetSchema = z.object({
  status: z.string(),
  expiresAt: z.number().int().positive().nullable(),
  title: z.string().nullable().optional(),
});

const earnedResetsSchema = z.object({
  availableCount: z.number().int().nonnegative(),
  credits: z.array(earnedResetSchema).nullable().optional(),
});

const accountRateLimitsResponseSchema = z.object({
  rateLimits: rateLimitSnapshotSchema,
  rateLimitsByLimitId: z.record(z.string(), rateLimitSnapshotSchema).nullable().optional(),
  rateLimitResetCredits: earnedResetsSchema.nullable().optional(),
});

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimitsSnapshot {
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  earnedResets: {
    availableCount: number;
    credits: Array<{ status: string; expiresAt: number | null; title: string | null }>;
  } | null;
}

export function parseCodexRateLimitsResponse(value: unknown): CodexRateLimitsSnapshot {
  const parsed = accountRateLimitsResponseSchema.parse(value);
  const limits = parsed.rateLimitsByLimitId?.codex ?? parsed.rateLimits;
  return {
    primary: limits.primary,
    secondary: limits.secondary,
    earnedResets: parsed.rateLimitResetCredits ? {
      availableCount: parsed.rateLimitResetCredits.availableCount,
      credits: (parsed.rateLimitResetCredits.credits ?? []).map((credit) => ({
        status: credit.status,
        expiresAt: credit.expiresAt,
        title: credit.title ?? null,
      })),
    } : null,
  };
}

export function formatCodexRateLimitsForTelegram(snapshot: CodexRateLimitsSnapshot, timezone: string): string {
  const windows = [snapshot.primary, snapshot.secondary].filter((window): window is CodexRateLimitWindow => window !== null);
  const lines = [
    "Codex usage limits",
    ...windows.flatMap((window) => [
      "",
      `${windowLabel(window.windowDurationMins)}: ${formatPercent(window.usedPercent)} used (${formatPercent(Math.max(0, 100 - window.usedPercent))} left)`,
      `Resets: ${formatResetTime(window.resetsAt, timezone)}`,
    ]),
  ];
  if (windows.length === 0) lines.push("", "No usage windows were returned by Codex.");
  return lines.join("\n");
}

export function formatBankedResetsForTelegram(snapshot: CodexRateLimitsSnapshot, timezone: string): string {
  const banked = snapshot.earnedResets;
  if (!banked) return "Codex banked resets\n\nAvailable: unknown\n\nCodex did not return banked-reset data.";

  const lines = ["Codex banked resets", "", `Available: ${banked.availableCount}`];
  const availableCredits = banked.credits.filter((credit) => credit.status === "available");
  if (availableCredits.length > 0) {
    availableCredits.forEach((credit, index) => {
      lines.push("", `${index + 1}. Expires: ${formatResetTime(credit.expiresAt, timezone)}`);
    });
  } else if (banked.availableCount > 0) {
    lines.push("", "Expiry details were not returned by this Codex version.");
  }
  return lines.join("\n");
}

function windowLabel(durationMins: number | null): string {
  if (durationMins === 300) return "5-hour limit";
  if (durationMins === 10_080) return "Weekly limit";
  if (durationMins === null) return "Usage limit";
  if (durationMins % 1_440 === 0) return `${durationMins / 1_440}-day limit`;
  if (durationMins % 60 === 0) return `${durationMins / 60}-hour limit`;
  return `${durationMins}-minute limit`;
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
}

function formatResetTime(epochSeconds: number | null, timezone: string): string {
  if (epochSeconds === null) return "unknown";
  const date = DateTime.fromSeconds(epochSeconds, { zone: "utc" }).setZone(timezone);
  if (!date.isValid) return "unknown";
  return `${date.toFormat("dd LLL yyyy, HH:mm")} (${timezone})`;
}
