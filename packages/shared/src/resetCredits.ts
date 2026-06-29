import { DateTime } from "luxon";
import { z } from "zod";

export const resetCreditSchema = z.object({
  id: z.string().optional(),
  status: z.string(),
  expires_at: z.string().nullable().optional(),
}).passthrough();

export const resetCreditsResponseSchema = z.object({
  credits: z.array(resetCreditSchema).default([]),
  available_count: z.number().int().nonnegative().optional(),
}).passthrough();

export interface CodexResetCredit {
  status: string;
  expiresAt: string | null;
}

export interface CodexResetCreditsSnapshot {
  availableCount: number;
  availableCredits: CodexResetCredit[];
}

export function parseResetCreditsResponse(value: unknown): CodexResetCreditsSnapshot {
  const parsed = resetCreditsResponseSchema.parse(value);
  const availableCredits = parsed.credits
    .filter((credit) => credit.status === "available")
    .map((credit) => ({
      status: credit.status,
      expiresAt: credit.expires_at ?? null,
    }));
  return {
    availableCount: parsed.available_count ?? availableCredits.length,
    availableCredits,
  };
}

export function formatResetCreditsForTelegram(snapshot: CodexResetCreditsSnapshot, timezone: string): string {
  const lines = [`Codex resets: ${snapshot.availableCount}`];
  const datedCredits = snapshot.availableCredits.slice(0, snapshot.availableCount);
  if (datedCredits.length > 0) {
    lines.push("");
    datedCredits.forEach((credit, index) => {
      lines.push(`${index + 1}. Expires: ${formatExpiry(credit.expiresAt, timezone)}`);
    });
  }
  return lines.join("\n");
}

function formatExpiry(value: string | null, timezone: string): string {
  if (!value) return "unknown";
  const date = DateTime.fromISO(value, { zone: "utc" }).setZone(timezone);
  if (!date.isValid) return "unknown";
  return date.toFormat("dd LLL yyyy, HH:mm");
}
