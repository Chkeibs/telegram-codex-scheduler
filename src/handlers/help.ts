import type { Context } from "telegraf";
import { MENU } from "../ui/keyboards.js";
import type { AppServices, Bot } from "./types.js";

const HELP = `This private, self-hosted bot schedules prompts for Codex CLI on your own machine or server.

It runs the local codex command. Codex CLI must already be installed and authenticated by you with codex login. The bot never asks for or stores OpenAI passwords, cookies, API keys, session tokens, or Codex auth files.

Use the buttons to schedule a message, run one now, choose a safe working directory, and select read-only or workspace-write permission. Read-only is always the default.

The host must remain powered on, awake, and online. If it was offline, pending overdue jobs run after restart. A job interrupted while already running is not retried, to avoid duplicate execution.

Commands: /start, /menu, /schedule, /run_now, /jobs, /cancel, /settings, /help`;

export function registerHelpHandlers(bot: Bot, _services: AppServices): void {
  const showHelp = (ctx: Context) => {
    if (ctx.from) _services.conversations.clear(String(ctx.from.id));
    return ctx.reply(HELP);
  };
  bot.command("help", showHelp);
  bot.hears(MENU.help, showHelp);
}
