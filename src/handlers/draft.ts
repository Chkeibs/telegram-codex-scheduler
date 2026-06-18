import type { Context } from "telegraf";
import type { ConversationState } from "../types/domain.js";
import { nextTwentyLabel } from "../services/dateParser.js";
import { sanitizeOutput } from "../services/outputService.js";
import { confirmationKeyboard, directoryKeyboard, mainMenuKeyboard, permissionKeyboard, timeKeyboard } from "../ui/keyboards.js";
import { confirmationMessage } from "../ui/messages.js";
import { DRAFT_EXPIRED, MAIN_MENU_TEXT } from "./shared.js";
import type { AppServices, Bot } from "./types.js";
import { requireTelegramUserId } from "./types.js";

async function currentState(ctx: Context, services: AppServices): Promise<ConversationState | null> {
  const state = services.conversations.get(requireTelegramUserId(ctx));
  if (!state) await ctx.reply(DRAFT_EXPIRED, mainMenuKeyboard());
  return state;
}

export async function askForDirectory(ctx: Context): Promise<void> {
  await ctx.reply("Where should I run Codex?", directoryKeyboard());
}

export async function askForPermission(ctx: Context): Promise<void> {
  await ctx.reply("What filesystem permission should Codex use?", permissionKeyboard());
}

export async function showConfirmation(ctx: Context, services: AppServices): Promise<void> {
  const userId = requireTelegramUserId(ctx);
  const state = services.conversations.transition(userId, "confirm");
  const user = services.users.getUser(userId);
  if (!state || !user) {
    await ctx.reply(DRAFT_EXPIRED, mainMenuKeyboard());
    return;
  }
  await ctx.reply(confirmationMessage(state, user), confirmationKeyboard(state.flow));
}

export async function handleCustomDirectoryText(ctx: Context, services: AppServices, input: string): Promise<void> {
  const userId = requireTelegramUserId(ctx);
  try {
    const directory = services.pathPolicy.resolveDirectory(input);
    const state = services.conversations.transition(userId, "select_permission", { workingDirectory: directory });
    if (!state) throw new Error(DRAFT_EXPIRED);
    await askForPermission(ctx);
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "That directory is not valid.");
  }
}

export function registerDraftHandlers(bot: Bot, services: AppServices): void {
  bot.action(/^draft:dir:(default|bot|custom)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const state = await currentState(ctx, services);
    if (!state || !["select_directory", "enter_custom_directory"].includes(state.step)) return;
    const choice = ctx.match[1];
    if (choice === "custom") {
      services.conversations.transition(state.telegramUserId, "enter_custom_directory");
      await ctx.reply("Type the absolute directory path. It must be inside an allowed working-directory root.");
      return;
    }
    const user = services.users.getUser(state.telegramUserId);
    if (!user) return;
    try {
      const directory = services.pathPolicy.resolveDirectory(choice === "default" ? user.defaultWorkdir : services.config.botWorkdir);
      services.conversations.transition(state.telegramUserId, "select_permission", { workingDirectory: directory });
      await askForPermission(ctx);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "The configured directory is not available.");
    }
  });

  bot.action(/^draft:permission:(read_only|workspace_write)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const state = await currentState(ctx, services);
    if (!state || state.step !== "select_permission") return;
    const permission = ctx.match[1] === "workspace_write" ? "workspace_write" : "read_only";
    services.conversations.transition(state.telegramUserId, "select_permission", { filesystemPermission: permission });
    if (permission === "workspace_write") {
      await ctx.reply("⚠️ Workspace write allows Codex to modify files in the selected directory. Use this only if you trust the prompt and directory.");
    }
    await showConfirmation(ctx, services);
  });

  bot.action("draft:edit:time", async (ctx) => {
    await ctx.answerCbQuery();
    const state = await currentState(ctx, services);
    if (!state || state.flow !== "schedule") return;
    const user = services.users.getUser(state.telegramUserId);
    services.conversations.transition(state.telegramUserId, "select_time");
    await ctx.reply("When should I send the message to Codex?", timeKeyboard(nextTwentyLabel(user?.timezone ?? services.config.defaultTimezone)));
  });
  bot.action("draft:edit:message", async (ctx) => {
    await ctx.answerCbQuery();
    const state = await currentState(ctx, services);
    if (!state) return;
    services.conversations.transition(state.telegramUserId, "enter_message");
    await ctx.reply("Type the message again.");
  });
  bot.action("draft:edit:directory", async (ctx) => {
    await ctx.answerCbQuery();
    const state = await currentState(ctx, services);
    if (!state) return;
    services.conversations.transition(state.telegramUserId, "select_directory");
    await askForDirectory(ctx);
  });
  bot.action("draft:edit:permission", async (ctx) => {
    await ctx.answerCbQuery();
    const state = await currentState(ctx, services);
    if (!state) return;
    services.conversations.transition(state.telegramUserId, "select_permission");
    await askForPermission(ctx);
  });

  bot.action("draft:confirm", async (ctx) => {
    await ctx.answerCbQuery();
    const state = await currentState(ctx, services);
    if (!state || state.step !== "confirm") return;
    const job = services.jobs.confirmConversation(state.telegramUserId, state.flow === "schedule" ? "scheduled" : "immediate");
    if (!job) {
      await ctx.reply(DRAFT_EXPIRED, mainMenuKeyboard());
      return;
    }
    if (job.kind === "scheduled") {
      await ctx.reply(`✅ Scheduled. I will send this message to Codex at ${new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium", timeStyle: "short", timeZone: job.timezone,
      }).format(new Date(job.scheduledAt))}.`, mainMenuKeyboard());
      return;
    }
    await ctx.reply("🚀 Codex execution queued.", mainMenuKeyboard());
    void services.scheduler.runJobNow(job.id).catch((error) => {
      const safeError = sanitizeOutput(error instanceof Error ? error.message : String(error), services.config.secretValues);
      console.error(`Immediate job ${job.id.slice(0, 8)} failed to start: ${safeError}`);
    });
  });

  bot.action("draft:cancel", async (ctx) => {
    await ctx.answerCbQuery();
    services.conversations.clear(requireTelegramUserId(ctx));
    await ctx.reply("Cancelled.", mainMenuKeyboard());
    await ctx.reply(MAIN_MENU_TEXT);
  });
}
