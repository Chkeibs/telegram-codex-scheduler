import { Markup, type Context } from "telegraf";
import { MENU } from "../ui/keyboards.js";
import { formatPendingJob } from "../ui/messages.js";
import type { AppServices, Bot } from "./types.js";
import { requireTelegramUserId } from "./types.js";

const PAGE_SIZE = 5;

export async function showJobs(ctx: Context, services: AppServices, page = 0): Promise<void> {
  const userId = requireTelegramUserId(ctx);
  services.conversations.clear(userId);
  const count = services.jobs.countPending(userId);
  if (count === 0) {
    await ctx.reply("You have no pending scheduled Codex jobs.");
    return;
  }
  const maxPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  const jobs = services.jobs.listPending(userId, PAGE_SIZE, safePage * PAGE_SIZE);
  const text = `📋 Pending Codex jobs (${count}):\n\n${jobs.map((job, index) => formatPendingJob(job, safePage * PAGE_SIZE + index + 1)).join("\n\n")}`;
  const navigation = [];
  if (safePage > 0) navigation.push(Markup.button.callback("Previous", `jobs:page:${safePage - 1}`));
  if (safePage < maxPage) navigation.push(Markup.button.callback("Next", `jobs:page:${safePage + 1}`));
  await ctx.reply(text, navigation.length ? Markup.inlineKeyboard([navigation]) : undefined);
}

export function registerJobsHandlers(bot: Bot, services: AppServices): void {
  bot.command("jobs", (ctx) => showJobs(ctx, services));
  bot.hears(MENU.jobs, (ctx) => showJobs(ctx, services));
  bot.action(/^jobs:page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showJobs(ctx, services, Number(ctx.match[1]));
  });
}
