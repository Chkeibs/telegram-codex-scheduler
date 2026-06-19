import { z } from "zod";

export const filesystemPermissionSchema = z.enum(["read_only", "workspace_write"]);
export const jobKindSchema = z.enum(["scheduled", "immediate"]);
export const jobStatusSchema = z.enum([
  "scheduled",
  "pending_wake",
  "starting",
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const cloudTaskPayloadSchema = z.object({
  jobId: z.string().uuid(),
});

export function parseAllowedTelegramUserIds(value: string): ReadonlySet<string> {
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS must contain comma-separated numeric IDs");
  }
  return new Set(ids);
}
