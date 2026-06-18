import { Markup, type Context } from "telegraf";
import { MENU } from "../ui/keyboards.js";
import { formatDate } from "../services/dateParser.js";
import { makePreview } from "../services/outputService.js";
import type { AppServices, Bot } from "./types.js";
import { requireTelegramUserId } from "./types.js";

export async function showCancellationList(ctx: Context, services: AppServices): Promise<void> {
  const userId = requireTelegramUserId(ctx);
  services.conversations.clear(userId);
  const jobs = services.jobs.listPending(userId, 20, 0);
  if (jobs.length === 0) {
    await ctx.reply("You have no pending jobs to cancel.");
    return;
  }
  await ctx.reply("Choose a scheduled Codex message to cancel:", Markup.inlineKeyboard(
    jobs.map((job) => [Markup.button.callback(
      `${job.id.slice(0, 8)} · ${formatDate(job.scheduledAt, job.timezone)} · ${makePreview(job.message, 30)}`,
      `cancel:select:${job.id}`,
    )]),
  ));
}

export function registerCancelHandlers(bot: Bot, services: AppServices): void {
  bot.command("cancel", (ctx) => showCancellationList(ctx, services));
  bot.hears(MENU.cancel, (ctx) => showCancellationList(ctx, services));
  bot.action(/^cancel:select:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = requireTelegramUserId(ctx);
    const job = services.jobs.getForUser(ctx.match[1] as string, userId);
    if (!job || job.status !== "pending") {
      await ctx.reply("That job is no longer pending.");
      return;
    }
    await ctx.reply(`Cancel this scheduled Codex message?\n\n${makePreview(job.message, 300)}`, Markup.inlineKeyboard([
      [Markup.button.callback("Yes, cancel", `cancel:confirm:${job.id}`)],
      [Markup.button.callback("No, keep it", `cancel:keep:${job.id}`)],
    ]));
  });
  bot.action(/^cancel:confirm:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const cancelled = services.jobs.cancel(ctx.match[1] as string, requireTelegramUserId(ctx));
    await ctx.reply(cancelled ? "✅ Job cancelled." : "That job could not be cancelled because it is no longer pending.");
  });
  bot.action(/^cancel:keep:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("The job is still scheduled.");
  });
}
