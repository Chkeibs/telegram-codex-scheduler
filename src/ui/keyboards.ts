import { Markup } from "telegraf";
import type { ConversationFlow } from "../types/domain.js";

export const MENU = {
  schedule: "Send scheduled message",
  runNow: "Send message now",
  jobs: "My scheduled messages",
  cancel: "Cancel scheduled message",
  settings: "Settings",
  help: "Help",
} as const;

export function mainMenuKeyboard() {
  return Markup.keyboard([
    [MENU.schedule, MENU.runNow],
    [MENU.jobs, MENU.cancel],
    [MENU.settings, MENU.help],
  ]).resize();
}

export function timeKeyboard(nextTwentyLabel: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("In 10 minutes", "schedule:time:10m"), Markup.button.callback("In 30 minutes", "schedule:time:30m")],
    [Markup.button.callback("In 1 hour", "schedule:time:1h")],
    [Markup.button.callback("Tomorrow 7:00", "schedule:time:tomorrow7"), Markup.button.callback("Tomorrow 8:00", "schedule:time:tomorrow8")],
    [Markup.button.callback(nextTwentyLabel, "schedule:time:next20")],
    [Markup.button.callback("Custom time", "schedule:time:custom")],
    [Markup.button.callback("Cancel", "draft:cancel")],
  ]);
}

export function directoryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Default project", "draft:dir:default")],
    [Markup.button.callback("Bot directory", "draft:dir:bot")],
    [Markup.button.callback("Custom directory", "draft:dir:custom")],
    [Markup.button.callback("Cancel", "draft:cancel")],
  ]);
}

export function permissionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Read-only (recommended)", "draft:permission:read_only")],
    [Markup.button.callback("Workspace write", "draft:permission:workspace_write")],
    [Markup.button.callback("Cancel", "draft:cancel")],
  ]);
}

export function confirmationKeyboard(flow: ConversationFlow) {
  const rows = [
    [Markup.button.callback(flow === "schedule" ? "Confirm" : "Run now", "draft:confirm")],
    [Markup.button.callback("Edit message", "draft:edit:message"), Markup.button.callback("Edit directory", "draft:edit:directory")],
    [Markup.button.callback("Edit permission", "draft:edit:permission")],
  ];
  if (flow === "schedule") rows.splice(1, 0, [Markup.button.callback("Edit time", "draft:edit:time")]);
  rows.push([Markup.button.callback("Cancel", "draft:cancel")]);
  return Markup.inlineKeyboard(rows);
}

export function settingsKeyboard(outputMode: "preview" | "full") {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Change timezone", "settings:timezone")],
    [Markup.button.callback("Change default project", "settings:workdir")],
    [Markup.button.callback("Change output length", "settings:length")],
    [Markup.button.callback(`Output mode: ${outputMode}`, "settings:toggle_output")],
    [Markup.button.callback("Check Codex binary", "settings:codex_status")],
    [Markup.button.callback("Back to main menu", "menu:main")],
  ]);
}
