import type { Context } from "telegraf";
import { isValidTimezone } from "../services/dateParser.js";
import { MENU, settingsKeyboard } from "../ui/keyboards.js";
import type { AppServices, Bot } from "./types.js";
import { requireTelegramUserId } from "./types.js";

export async function showSettings(ctx: Context, services: AppServices): Promise<void> {
  const userId = requireTelegramUserId(ctx);
  services.conversations.clear(userId);
  const user = services.users.getUser(userId);
  if (!user) return;
  await ctx.reply(`Settings\n\nTimezone: ${user.timezone}\nDefault project: ${user.defaultWorkdir}\nOutput preview length: ${user.maxOutputChars}\nOutput mode: ${user.outputMode}\nCodex binary: ${services.config.codexBin} (managed in .env)`, settingsKeyboard(user.outputMode));
}

export function registerSettingsHandlers(bot: Bot, services: AppServices): void {
  bot.command("settings", (ctx) => showSettings(ctx, services));
  bot.hears(MENU.settings, (ctx) => showSettings(ctx, services));
  bot.action("settings:timezone", async (ctx) => {
    await ctx.answerCbQuery();
    services.conversations.set(requireTelegramUserId(ctx), "settings", "settings_timezone");
    await ctx.reply("Type an IANA timezone such as Europe/Paris or America/New_York.");
  });
  bot.action("settings:workdir", async (ctx) => {
    await ctx.answerCbQuery();
    services.conversations.set(requireTelegramUserId(ctx), "settings", "settings_workdir");
    await ctx.reply("Type the new default project directory. It must exist inside an allowed root.");
  });
  bot.action("settings:length", async (ctx) => {
    await ctx.answerCbQuery();
    services.conversations.set(requireTelegramUserId(ctx), "settings", "settings_output_length");
    await ctx.reply("Type the maximum preview length from 500 to 3900 characters.");
  });
  bot.action("settings:toggle_output", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = requireTelegramUserId(ctx);
    const user = services.users.getUser(userId);
    if (!user) return;
    services.users.updateOutputMode(userId, user.outputMode === "preview" ? "full" : "preview");
    await showSettings(ctx, services);
  });
  bot.action("settings:codex_status", async (ctx) => {
    await ctx.answerCbQuery("Checking Codex…");
    const status = await services.codexRunner.checkAvailable();
    await ctx.reply(status.ok ? `✅ Codex is available: ${status.detail}` : `❌ Codex is not available: ${status.detail}\n\nCheck CODEX_BIN and install/login instructions in the README.`);
  });
}

export async function handleSettingsText(ctx: Context, services: AppServices, input: string): Promise<boolean> {
  const userId = requireTelegramUserId(ctx);
  const state = services.conversations.get(userId);
  if (!state || state.flow !== "settings") return false;
  if (state.step === "settings_timezone") {
    const timezone = input.trim();
    if (!isValidTimezone(timezone)) {
      await ctx.reply("That is not a valid IANA timezone. Try Europe/Paris or America/New_York.");
      return true;
    }
    services.users.updateTimezone(userId, timezone);
    services.conversations.clear(userId);
    await ctx.reply("✅ Timezone updated.");
    await showSettings(ctx, services);
    return true;
  }
  if (state.step === "settings_workdir") {
    try {
      const directory = services.pathPolicy.resolveDirectory(input);
      services.users.updateDefaultWorkdir(userId, directory);
      services.conversations.clear(userId);
      await ctx.reply("✅ Default project updated.");
      await showSettings(ctx, services);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "That directory is not valid.");
    }
    return true;
  }
  if (state.step === "settings_output_length") {
    const amount = Number(input.trim());
    if (!Number.isInteger(amount) || amount < 500 || amount > 3900) {
      await ctx.reply("Enter a whole number from 500 to 3900.");
      return true;
    }
    services.users.updateMaxOutputChars(userId, amount);
    services.conversations.clear(userId);
    await ctx.reply("✅ Output preview length updated.");
    await showSettings(ctx, services);
    return true;
  }
  return false;
}
