import type { Context } from "telegraf";
import { nextTwentyLabel, parseDateInput, presetTime } from "../services/dateParser.js";
import { directoryKeyboard, MENU, timeKeyboard } from "../ui/keyboards.js";
import type { AppServices, Bot } from "./types.js";
import { requireTelegramUserId } from "./types.js";

export async function beginSchedule(ctx: Context, services: AppServices): Promise<void> {
  const userId = requireTelegramUserId(ctx);
  const user = services.users.getUser(userId);
  const timezone = user?.timezone ?? services.config.defaultTimezone;
  services.conversations.set(userId, "schedule", "select_time");
  await ctx.reply("When should I send the message to Codex?", timeKeyboard(nextTwentyLabel(timezone)));
}

export function registerScheduleHandlers(bot: Bot, services: AppServices): void {
  bot.command("schedule", (ctx) => beginSchedule(ctx, services));
  bot.hears(MENU.schedule, (ctx) => beginSchedule(ctx, services));
  bot.action(/^schedule:time:(10m|30m|1h|tomorrow7|tomorrow8|next20|custom)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = requireTelegramUserId(ctx);
    const state = services.conversations.get(userId);
    if (!state || state.flow !== "schedule" || !["select_time", "enter_custom_time", "confirm"].includes(state.step)) {
      await ctx.reply("That scheduling draft expired. Please start again.");
      return;
    }
    const choice = ctx.match[1];
    if (choice === "custom") {
      services.conversations.transition(userId, "enter_custom_time");
      await ctx.reply("Type the date and time, for example: 2026-06-19 07:00, 19/06/2026 07:00, tomorrow 7am, or in 2 hours.");
      return;
    }
    const user = services.users.getUser(userId);
    const timezone = user?.timezone ?? services.config.defaultTimezone;
    const scheduledAt = presetTime(choice as "10m" | "30m" | "1h" | "tomorrow7" | "tomorrow8" | "next20", timezone);
    services.conversations.transition(userId, "enter_message", { scheduledAt });
    await ctx.reply("What message should I send to Codex?");
  });
}

export async function handleScheduleText(ctx: Context, services: AppServices, input: string): Promise<boolean> {
  const userId = requireTelegramUserId(ctx);
  const state = services.conversations.get(userId);
  if (!state || state.flow !== "schedule") return false;
  if (state.step === "enter_custom_time") {
    const user = services.users.getUser(userId);
    const result = parseDateInput(input, user?.timezone ?? services.config.defaultTimezone);
    if (!result.ok) {
      await ctx.reply(result.reason);
      return true;
    }
    services.conversations.transition(userId, "enter_message", { scheduledAt: result.isoUtc });
    await ctx.reply("What message should I send to Codex?");
    return true;
  }
  if (state.step === "enter_message") {
    const message = input.trim();
    if (!message) {
      await ctx.reply("Please enter a non-empty message.");
      return true;
    }
    services.conversations.transition(userId, "select_directory", { message });
    await ctx.reply("Where should I run Codex?", directoryKeyboard());
    return true;
  }
  return false;
}
