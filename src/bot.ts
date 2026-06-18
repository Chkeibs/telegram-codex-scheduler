import type { DatabaseSync } from "node:sqlite";
import { Telegraf } from "telegraf";
import type { AppConfig } from "./config.js";
import { registerCancelHandlers } from "./handlers/cancel.js";
import { registerDraftHandlers, handleCustomDirectoryText } from "./handlers/draft.js";
import { registerHelpHandlers } from "./handlers/help.js";
import { registerJobsHandlers } from "./handlers/jobs.js";
import { registerMenuHandlers, showMainMenu } from "./handlers/menu.js";
import { registerRunNowHandlers, handleRunNowText } from "./handlers/runNow.js";
import { registerScheduleHandlers, handleScheduleText } from "./handlers/schedule.js";
import { registerSettingsHandlers, handleSettingsText } from "./handlers/settings.js";
import type { AppServices } from "./handlers/types.js";
import { requireTelegramUserId } from "./handlers/types.js";
import { CodexRunner } from "./services/codexRunner.js";
import { isAuthorized } from "./services/auth.js";
import { ConversationStateService } from "./services/conversationStateService.js";
import { JobService } from "./services/jobService.js";
import { PathPolicy } from "./services/pathPolicy.js";
import { sanitizeOutput } from "./services/outputService.js";
import { Scheduler } from "./services/scheduler.js";
import { UserService } from "./services/userService.js";

export interface Application {
  bot: Telegraf;
  scheduler: Scheduler;
  services: AppServices;
}

export function createApplication(config: AppConfig, database: DatabaseSync): Application {
  const bot = new Telegraf(config.telegramBotToken);
  const users = new UserService(database, {
    timezone: config.defaultTimezone,
    defaultWorkdir: config.defaultWorkdir,
    maxOutputChars: config.maxTelegramOutputChars,
  });
  const jobs = new JobService(database);
  const conversations = new ConversationStateService(database, config.conversationTtlMinutes);
  const pathPolicy = new PathPolicy(config.allowedWorkdirRoots);
  // Fail fast if the default path is not usable under the configured roots.
  pathPolicy.resolveDirectory(config.defaultWorkdir);
  pathPolicy.resolveDirectory(config.botWorkdir);
  const codexRunner = new CodexRunner(
    config.codexBin,
    pathPolicy,
    config.codexTimeoutSeconds * 1_000,
    config.maxCodexOutputBytes,
  );
  const scheduler = new Scheduler(jobs, users, conversations, codexRunner, bot.telegram, {
    intervalMs: config.schedulerIntervalSeconds * 1_000,
    staleAfterMs: config.codexTimeoutSeconds * 1_000 + 5 * 60_000,
    secretValues: config.secretValues,
  });
  const services: AppServices = { config, users, jobs, conversations, pathPolicy, codexRunner, scheduler };

  bot.use(async (ctx, next) => {
    const userId = ctx.from ? String(ctx.from.id) : null;
    if (!isAuthorized(config.allowedTelegramUserIds, userId)) {
      if (ctx.chat) await ctx.reply("This is a private self-hosted bot. You are not authorized.");
      return;
    }
    users.ensureUser(userId, String(ctx.chat?.id ?? ctx.from?.id), ctx.from?.username);
    await next();
  });

  registerMenuHandlers(bot, services);
  registerScheduleHandlers(bot, services);
  registerRunNowHandlers(bot, services);
  registerJobsHandlers(bot, services);
  registerCancelHandlers(bot, services);
  registerSettingsHandlers(bot, services);
  registerHelpHandlers(bot, services);
  registerDraftHandlers(bot, services);

  bot.on("text", async (ctx) => {
    const input = ctx.message.text;
    if (await handleSettingsText(ctx, services, input)) return;
    const state = conversations.get(requireTelegramUserId(ctx));
    if (state?.step === "enter_custom_directory") {
      await handleCustomDirectoryText(ctx, services, input);
      return;
    }
    if (await handleScheduleText(ctx, services, input)) return;
    if (await handleRunNowText(ctx, services, input)) return;
    if (state) {
      await ctx.reply("Please use the buttons for the current step, or return to /menu.");
      return;
    }
    await showMainMenu(ctx, services, false);
  });

  bot.catch((error, ctx) => {
    const safeError = sanitizeOutput(error instanceof Error ? error.message : String(error), config.secretValues);
    console.error(`Telegram handler failed for update ${ctx.update.update_id}: ${safeError}`);
    void ctx.reply("Something went wrong. Please try again or return to /menu.").catch(() => undefined);
  });

  return { bot, scheduler, services };
}
