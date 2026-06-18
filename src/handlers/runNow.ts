import type { Context } from "telegraf";
import { directoryKeyboard, MENU } from "../ui/keyboards.js";
import type { AppServices, Bot } from "./types.js";
import { requireTelegramUserId } from "./types.js";

export async function beginRunNow(ctx: Context, services: AppServices): Promise<void> {
  services.conversations.set(requireTelegramUserId(ctx), "run_now", "enter_message");
  await ctx.reply("What message should I send to Codex now?");
}

export function registerRunNowHandlers(bot: Bot, services: AppServices): void {
  bot.command("run_now", (ctx) => beginRunNow(ctx, services));
  bot.hears(MENU.runNow, (ctx) => beginRunNow(ctx, services));
}

export async function handleRunNowText(ctx: Context, services: AppServices, input: string): Promise<boolean> {
  const userId = requireTelegramUserId(ctx);
  const state = services.conversations.get(userId);
  if (!state || state.flow !== "run_now" || state.step !== "enter_message") return false;
  const message = input.trim();
  if (!message) {
    await ctx.reply("Please enter a non-empty message.");
    return true;
  }
  services.conversations.transition(userId, "select_directory", { message });
  await ctx.reply("Where should I run Codex?", directoryKeyboard());
  return true;
}
