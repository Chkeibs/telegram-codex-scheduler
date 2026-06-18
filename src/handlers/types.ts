import type { Context, Telegraf } from "telegraf";
import type { AppConfig } from "../config.js";
import type { CodexRunner } from "../services/codexRunner.js";
import type { ConversationStateService } from "../services/conversationStateService.js";
import type { JobService } from "../services/jobService.js";
import type { PathPolicy } from "../services/pathPolicy.js";
import type { Scheduler } from "../services/scheduler.js";
import type { UserService } from "../services/userService.js";

export type Bot = Telegraf<Context>;

export interface AppServices {
  config: AppConfig;
  users: UserService;
  jobs: JobService;
  conversations: ConversationStateService;
  pathPolicy: PathPolicy;
  codexRunner: CodexRunner;
  scheduler: Scheduler;
}

export function telegramUserId(ctx: Context): string | null {
  return ctx.from ? String(ctx.from.id) : null;
}

export function requireTelegramUserId(ctx: Context): string {
  const id = telegramUserId(ctx);
  if (!id) throw new Error("Telegram update has no user identity");
  return id;
}
