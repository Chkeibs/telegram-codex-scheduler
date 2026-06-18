import type { Context } from "telegraf";
import { MAIN_MENU_TEXT } from "./shared.js";
import type { AppServices, Bot } from "./types.js";
import { requireTelegramUserId } from "./types.js";
import { mainMenuKeyboard, MENU } from "../ui/keyboards.js";
import { WELCOME_MESSAGE } from "../ui/messages.js";

export async function showMainMenu(ctx: Context, services: AppServices, clearState = true): Promise<void> {
  const userId = requireTelegramUserId(ctx);
  if (clearState) services.conversations.clear(userId);
  await ctx.reply(MAIN_MENU_TEXT, mainMenuKeyboard());
}

export function registerMenuHandlers(bot: Bot, services: AppServices): void {
  bot.start(async (ctx) => {
    services.conversations.clear(requireTelegramUserId(ctx));
    await ctx.reply(WELCOME_MESSAGE, mainMenuKeyboard());
  });
  bot.command("menu", (ctx) => showMainMenu(ctx, services));
  bot.action("menu:main", async (ctx) => {
    await ctx.answerCbQuery();
    await showMainMenu(ctx, services);
  });

  // Labels are registered in their feature handlers; exporting them here keeps the menu button-first.
  void MENU;
}
