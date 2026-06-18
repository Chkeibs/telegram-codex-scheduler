import type { ConversationState, Job, User } from "../types/domain.js";
import { formatDate } from "../services/dateParser.js";
import { makePreview } from "../services/outputService.js";

export const WELCOME_MESSAGE = `Welcome. This is a private self-hosted Codex scheduler.

I can schedule messages and send them to Codex CLI at the time you choose.

Before using me, make sure:
1. Codex CLI is installed.
2. You ran codex login.
3. This machine or server stays on when scheduled tasks should run.`;

export function confirmationMessage(state: ConversationState, user: User): string {
  const permission = state.payload.filesystemPermission === "workspace_write" ? "Workspace write" : "Read-only";
  const lines = [state.flow === "schedule" ? "Please confirm this scheduled Codex message:" : "Send this to Codex now?"];
  if (state.flow === "schedule" && state.payload.scheduledAt) {
    lines.push("", `Time: ${formatDate(state.payload.scheduledAt, user.timezone)}`);
  }
  lines.push(
    `Message: ${makePreview(state.payload.message ?? "", 500)}`,
    `Working directory: ${state.payload.workingDirectory ?? "Not selected"}`,
    `Filesystem permission: ${permission}`,
  );
  return lines.join("\n");
}

export function formatPendingJob(job: Job, index: number): string {
  const permission = job.filesystemPermission === "workspace_write" ? "Workspace write" : "Read-only";
  return `${index}. Job ID: ${job.id.slice(0, 8)}\n   Time: ${formatDate(job.scheduledAt, job.timezone)}\n   Message: ${makePreview(job.message, 160)}\n   Directory: ${job.workingDirectory}\n   Permission: ${permission}\n   Status: ${job.status}`;
}
