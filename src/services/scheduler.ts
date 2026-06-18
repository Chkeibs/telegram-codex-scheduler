import { Input, type Telegram } from "telegraf";
import type { Job } from "../types/domain.js";
import type { CodexRunner } from "./codexRunner.js";
import type { ConversationStateService } from "./conversationStateService.js";
import type { JobService } from "./jobService.js";
import { createTemporaryAttachment, makePreview, sanitizeOutput } from "./outputService.js";
import type { UserService } from "./userService.js";

export interface SchedulerOptions {
  intervalMs: number;
  staleAfterMs: number;
  secretValues: readonly string[];
  batchSize?: number;
}

export class Scheduler {
  private interval: NodeJS.Timeout | null = null;
  private ticking = false;
  private executionQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly jobs: JobService,
    private readonly users: UserService,
    private readonly conversations: ConversationStateService,
    private readonly runner: CodexRunner,
    private readonly telegram: Telegram,
    private readonly options: SchedulerOptions,
  ) {}

  start(): void {
    if (this.interval) return;
    void this.tick();
    this.interval = setInterval(() => void this.tick(), this.options.intervalMs);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.conversations.cleanupExpired(now);
      const cutoff = new Date(now.getTime() - this.options.staleAfterMs);
      for (const job of this.jobs.failStaleRunning(cutoff, now)) {
        const user = this.users.getUser(job.telegramUserId);
        if (user) await this.safeSend(user.telegramChatId, "❌ A Codex task was interrupted by a bot restart. It was not retried to avoid running it twice.");
      }

      const limit = this.options.batchSize ?? 20;
      for (let processed = 0; processed < limit; processed += 1) {
        const job = this.jobs.claimNextDue(new Date());
        if (!job) break;
        await this.enqueue(job);
      }
    } finally {
      this.ticking = false;
    }
  }

  async runJobNow(jobId: string): Promise<boolean> {
    const job = this.jobs.claimById(jobId);
    if (!job) return false;
    await this.enqueue(job);
    return true;
  }

  private enqueue(job: Job): Promise<void> {
    const task = this.executionQueue.then(() => this.executeClaimed(job));
    this.executionQueue = task.catch(() => undefined);
    return task;
  }

  private async executeClaimed(job: Job): Promise<void> {
    const user = this.users.getUser(job.telegramUserId);
    if (!user) {
      this.jobs.fail(job.id, "Telegram user record not found.");
      return;
    }

    const kind = job.kind === "scheduled" ? "scheduled " : "";
    await this.safeSend(user.telegramChatId, `🚀 Running ${kind}Codex task now.\n\nMessage:\n${makePreview(job.message, 500)}`);

    let result;
    try {
      result = await this.runner.run({
        message: job.message,
        workingDirectory: job.workingDirectory,
        filesystemPermission: job.filesystemPermission,
      });
    } catch (error) {
      const safeError = sanitizeOutput(error instanceof Error ? error.message : String(error), this.options.secretValues);
      this.jobs.fail(job.id, safeError || "Codex execution failed.");
      await this.safeSend(user.telegramChatId, `❌ Codex task failed.\n\nError:\n${makePreview(safeError, user.maxOutputChars, true)}\n\nCheck your server logs for details.`);
      return;
    }

    const safeStdout = sanitizeOutput(result.stdout, this.options.secretValues);
    const safeStderr = sanitizeOutput(result.stderr, this.options.secretValues);
    if (result.success) {
      const preview = makePreview(safeStdout, user.maxOutputChars);
      this.jobs.complete(job.id, preview);
      await this.safeSend(user.telegramChatId, `✅ Codex task completed.\n\nOutput:\n${preview}`);
      if (user.outputMode === "full" && (safeStdout.length > user.maxOutputChars || result.truncated)) {
        await this.safeSendAttachment(user.telegramChatId, safeStdout, job.id, result.truncated);
      }
      return;
    }

    const diagnostic = [safeStderr, safeStdout].filter(Boolean).join("\n\n") || `Codex exited with status ${String(result.exitCode)}.`;
    const preview = makePreview(diagnostic, user.maxOutputChars, true);
    this.jobs.fail(job.id, preview, safeStdout ? makePreview(safeStdout, user.maxOutputChars) : null);
    await this.safeSend(user.telegramChatId, `❌ Codex task failed.\n\nError:\n${preview}\n\nCheck your server logs for details.`);
    if (user.outputMode === "full" && diagnostic.length > user.maxOutputChars) {
      await this.safeSendAttachment(user.telegramChatId, diagnostic, job.id, result.truncated);
    }
  }

  private async safeSend(chatId: string, message: string): Promise<void> {
    try {
      await this.telegram.sendMessage(chatId, message);
    } catch (error) {
      const safe = sanitizeOutput(error instanceof Error ? error.message : String(error), this.options.secretValues);
      console.error(`Telegram delivery failed: ${safe}`);
    }
  }

  private async safeSendAttachment(chatId: string, content: string, jobId: string, truncated: boolean): Promise<void> {
    const attachment = createTemporaryAttachment(content, jobId);
    try {
      await this.telegram.sendDocument(chatId, Input.fromLocalFile(attachment.filePath), {
        caption: truncated ? "Sanitized Codex output (capture limit reached)." : "Complete sanitized Codex output.",
      });
    } catch (error) {
      const safe = sanitizeOutput(error instanceof Error ? error.message : String(error), this.options.secretValues);
      console.error(`Telegram attachment delivery failed: ${safe}`);
    } finally {
      attachment.cleanup();
    }
  }
}
