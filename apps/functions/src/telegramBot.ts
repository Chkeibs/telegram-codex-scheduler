import { randomUUID } from "node:crypto";
import { formatDate, isValidTimezone, nextTwentyLabel, parseDateInput, presetTime, type FilesystemPermission, type TimePreset } from "@telegram-codex/shared";
import { Markup, Telegraf, type Context } from "telegraf";
import type { FunctionsConfig } from "./config.js";
import type { FirestoreConversationRepository, CloudDraft } from "./repositories/firestoreConversationRepository.js";
import type { FirestoreJobRepository } from "./repositories/firestoreJobRepository.js";
import type { FirestoreUserRepository, CloudUserPreferences } from "./repositories/firestoreUserRepository.js";
import type { CloudTasksService } from "./services/cloudTasksService.js";

const MENU = {
  schedule: "Send scheduled message",
  runNow: "Send message now",
  jobs: "My scheduled messages",
  cancel: "Cancel scheduled message",
  settings: "Settings",
  help: "Help",
} as const;

export interface CloudBotDependencies {
  config: FunctionsConfig;
  users: FirestoreUserRepository;
  conversations: FirestoreConversationRepository;
  jobs: FirestoreJobRepository;
  tasks: CloudTasksService;
}

function mainKeyboard() {
  return Markup.keyboard([
    [MENU.schedule, MENU.runNow],
    [MENU.jobs, MENU.cancel],
    [MENU.settings, MENU.help],
  ]).resize();
}

function timeKeyboard(label: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("In 10 minutes", "schedule:time:10m"), Markup.button.callback("In 30 minutes", "schedule:time:30m")],
    [Markup.button.callback("In 1 hour", "schedule:time:1h")],
    [Markup.button.callback("Tomorrow 7:00", "schedule:time:tomorrow7"), Markup.button.callback("Tomorrow 8:00", "schedule:time:tomorrow8")],
    [Markup.button.callback(label, "schedule:time:next20")],
    [Markup.button.callback("Custom time", "schedule:time:custom")],
    [Markup.button.callback("Cancel", "draft:cancel")],
  ]);
}

function directoryKeyboard(keys: readonly string[], selected: string) {
  const rows = keys.map((key) => [Markup.button.callback(key === selected ? `Default project (${key})` : `Project: ${key}`, `draft:dir:${key}`)]);
  rows.push([Markup.button.callback("Cancel", "draft:cancel")]);
  return Markup.inlineKeyboard(rows);
}

function permissionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Read-only (recommended)", "draft:permission:read_only")],
    [Markup.button.callback("Workspace write", "draft:permission:workspace_write")],
    [Markup.button.callback("Cancel", "draft:cancel")],
  ]);
}

function settingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Change timezone", "settings:timezone")],
    [Markup.button.callback("Change default project", "settings:default_project")],
    [Markup.button.callback("Change output length", "settings:output_length")],
    [Markup.button.callback("Toggle output mode", "settings:toggle_output")],
    [Markup.button.callback("Back", "menu:main")],
  ]);
}

function confirmationKeyboard(flow: CloudDraft["flow"]) {
  const rows = [[Markup.button.callback(flow === "schedule" ? "Confirm" : "Run now", "draft:confirm")]];
  if (flow === "schedule") rows.push([Markup.button.callback("Edit time", "draft:edit:time")]);
  rows.push([Markup.button.callback("Edit message", "draft:edit:message")]);
  rows.push([Markup.button.callback("Edit directory", "draft:edit:directory")]);
  rows.push([Markup.button.callback("Edit permission", "draft:edit:permission")]);
  rows.push([Markup.button.callback("Cancel", "draft:cancel")]);
  return Markup.inlineKeyboard(rows);
}

function userId(ctx: Context): string {
  if (!ctx.from) throw new Error("Telegram update has no sender");
  return String(ctx.from.id);
}

async function ensureUser(ctx: Context, dependencies: CloudBotDependencies): Promise<CloudUserPreferences> {
  if (!ctx.from) throw new Error("Telegram update has no sender");
  return dependencies.users.ensure(String(ctx.from.id), String(ctx.chat?.id ?? ctx.from.id), ctx.from.username);
}

async function requireDraft(ctx: Context, dependencies: CloudBotDependencies): Promise<CloudDraft | null> {
  const draft = await dependencies.conversations.get(userId(ctx));
  if (!draft) await ctx.reply("That draft expired. Please start again.", mainKeyboard());
  return draft;
}

async function showConfirmation(ctx: Context, dependencies: CloudBotDependencies): Promise<void> {
  const id = userId(ctx);
  const draft = await dependencies.conversations.transition(id, "confirm");
  const user = await dependencies.users.get(id);
  if (!draft || !user) { await ctx.reply("That draft expired. Please start again.", mainKeyboard()); return; }
  const lines = [draft.flow === "schedule" ? "Please confirm this scheduled Codex message:" : "Send this to Codex now?"];
  if (draft.flow === "schedule" && draft.payload.scheduledAt) lines.push("", `Time: ${formatDate(draft.payload.scheduledAt, user.timezone)}`);
  lines.push(
    `Message: ${(draft.payload.prompt ?? "").slice(0, 500)}`,
    `Project: ${draft.payload.workdirKey ?? "Not selected"}`,
    `Filesystem permission: ${draft.payload.filesystemPermission === "workspace_write" ? "Workspace write" : "Read-only"}`,
  );
  await ctx.reply(lines.join("\n"), confirmationKeyboard(draft.flow));
}

async function beginSchedule(ctx: Context, dependencies: CloudBotDependencies): Promise<void> {
  const user = await ensureUser(ctx, dependencies);
  await dependencies.conversations.start(user.telegramUserId, "schedule", "select_time");
  await ctx.reply("When should I send the message to Codex?", timeKeyboard(nextTwentyLabel(user.timezone)));
}

async function beginRunNow(ctx: Context, dependencies: CloudBotDependencies): Promise<void> {
  const user = await ensureUser(ctx, dependencies);
  await dependencies.conversations.start(user.telegramUserId, "run_now", "enter_message");
  await ctx.reply("What message should I send to Codex now?");
}

async function showJobs(ctx: Context, dependencies: CloudBotDependencies, cancellation = false, cursor?: string): Promise<void> {
  const id = userId(ctx);
  const page = await dependencies.jobs.listPageForUser(id, 5, cursor);
  const jobs = page.jobs;
  if (jobs.length === 0) { await ctx.reply("There are no pending Codex jobs.", mainKeyboard()); return; }
  const lines = jobs.map((job, index) => `${index + 1}. ${job.id.slice(0, 8)} — ${formatDate(job.scheduledAt, job.timezoneSnapshot ?? dependencies.config.defaultTimezone)}\n${(job.prompt ?? "").slice(0, 120)}\nProject: ${job.workdirKey ?? "unknown"}\nStatus: ${job.status}`);
  if (!cancellation) {
    const buttons = page.nextCursor ? [[Markup.button.callback("Next page", `jobs:page:${page.nextCursor}`)]] : [];
    await ctx.reply(`Pending Codex jobs:\n\n${lines.join("\n\n")}`, buttons.length ? Markup.inlineKeyboard(buttons) : undefined);
    return;
  }
  const buttons = jobs.map((job) => [Markup.button.callback(`${job.id.slice(0, 8)} — ${job.status}`, `cancel:ask:${job.id}`)]);
  if (page.nextCursor) buttons.push([Markup.button.callback("Next page", `cancel:page:${page.nextCursor}`)]);
  await ctx.reply("Choose a job to cancel:", Markup.inlineKeyboard(buttons));
}

export function createCloudTelegramBot(dependencies: CloudBotDependencies): Telegraf {
  const bot = new Telegraf(dependencies.config.telegramBotToken);

  bot.use(async (ctx, next) => {
    const id = ctx.from ? String(ctx.from.id) : null;
    if (!id || !dependencies.config.allowedTelegramUserIds.has(id)) {
      if (ctx.chat) await ctx.reply("This is a private self-hosted bot. You are not authorized.");
      return;
    }
    await ensureUser(ctx, dependencies);
    await next();
  });

  const menu = async (ctx: Context) => ctx.reply("Choose an action:", mainKeyboard());
  bot.start(async (ctx) => {
    await ctx.reply("Welcome. This private bot queues Codex work and wakes its Google Cloud worker only when needed.", mainKeyboard());
  });
  bot.command("menu", menu);
  bot.action("menu:main", async (ctx) => { await ctx.answerCbQuery(); await menu(ctx); });
  bot.command("schedule", (ctx) => beginSchedule(ctx, dependencies));
  bot.hears(MENU.schedule, (ctx) => beginSchedule(ctx, dependencies));
  bot.command("run_now", (ctx) => beginRunNow(ctx, dependencies));
  bot.hears(MENU.runNow, (ctx) => beginRunNow(ctx, dependencies));
  bot.command("jobs", (ctx) => showJobs(ctx, dependencies));
  bot.hears(MENU.jobs, (ctx) => showJobs(ctx, dependencies));
  bot.action(/^jobs:page:([0-9a-f-]{36})$/, async (ctx) => { await ctx.answerCbQuery(); await showJobs(ctx, dependencies, false, ctx.match[1]); });
  bot.command("cancel", (ctx) => showJobs(ctx, dependencies, true));
  bot.hears(MENU.cancel, (ctx) => showJobs(ctx, dependencies, true));
  bot.action(/^cancel:page:([0-9a-f-]{36})$/, async (ctx) => { await ctx.answerCbQuery(); await showJobs(ctx, dependencies, true, ctx.match[1]); });
  bot.command("help", async (ctx) => ctx.reply("This is a private self-hosted Telegram controller. It stores jobs in Firestore, wakes a dedicated Compute Engine VM, runs the locally authenticated Codex CLI, returns a sanitized result, and powers the VM off. It never asks for OpenAI credentials."));
  bot.hears(MENU.help, async (ctx) => ctx.reply("This is a private self-hosted Telegram controller. Use the buttons to schedule or run Codex. The worker may need a few minutes to wake."));

  bot.command("settings", async (ctx) => {
    const user = await ensureUser(ctx, dependencies);
    await ctx.reply(`Timezone: ${user.timezone}\nDefault project: ${user.defaultWorkdirKey}\nOutput length: ${user.maxOutputChars}\nOutput mode: ${user.outputMode}`, settingsKeyboard());
  });
  bot.hears(MENU.settings, async (ctx) => {
    const user = await ensureUser(ctx, dependencies);
    await ctx.reply(`Timezone: ${user.timezone}\nDefault project: ${user.defaultWorkdirKey}\nOutput length: ${user.maxOutputChars}\nOutput mode: ${user.outputMode}`, settingsKeyboard());
  });

  bot.action(/^schedule:time:(10m|30m|1h|tomorrow7|tomorrow8|next20|custom)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const draft = await requireDraft(ctx, dependencies);
    if (!draft || draft.flow !== "schedule") return;
    const choice = ctx.match[1] as TimePreset | "custom";
    if (choice === "custom") {
      await dependencies.conversations.transition(draft.telegramUserId, "enter_custom_time");
      await ctx.reply("Type a time such as 2026-06-19 07:00, 19/06/2026 07:00, tomorrow 7am, or in 2 hours.");
      return;
    }
    const user = await dependencies.users.get(draft.telegramUserId);
    const scheduledAt = presetTime(choice, user?.timezone ?? dependencies.config.defaultTimezone);
    await dependencies.conversations.transition(draft.telegramUserId, "enter_message", { scheduledAt });
    await ctx.reply("What message should I send to Codex?");
  });

  bot.action(/^draft:dir:([a-zA-Z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const draft = await requireDraft(ctx, dependencies);
    if (!draft || draft.step !== "select_directory") return;
    const key = ctx.match[1] as string;
    if (!dependencies.config.workdirKeys.includes(key)) { await ctx.reply("That project is not configured on the worker."); return; }
    await dependencies.conversations.transition(draft.telegramUserId, "select_permission", { workdirKey: key });
    await ctx.reply("What filesystem permission should Codex use?", permissionKeyboard());
  });

  bot.action(/^draft:permission:(read_only|workspace_write)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const draft = await requireDraft(ctx, dependencies);
    if (!draft || draft.step !== "select_permission") return;
    const filesystemPermission = ctx.match[1] as FilesystemPermission;
    await dependencies.conversations.transition(draft.telegramUserId, filesystemPermission === "workspace_write" ? "confirm_workspace_write" : "select_permission", { filesystemPermission });
    if (filesystemPermission === "workspace_write") {
      await ctx.reply("⚠️ Workspace write allows Codex to modify files in the selected project. Continue only if you accept those changes.", Markup.inlineKeyboard([
        [Markup.button.callback("I understand, continue", "draft:permission:ack_write")],
        [Markup.button.callback("Back to read-only", "draft:permission:read_only")],
      ]));
      return;
    }
    await showConfirmation(ctx, dependencies);
  });
  bot.action("draft:permission:ack_write", async (ctx) => {
    await ctx.answerCbQuery();
    const draft = await requireDraft(ctx, dependencies);
    if (!draft || draft.step !== "confirm_workspace_write" || draft.payload.filesystemPermission !== "workspace_write") return;
    await showConfirmation(ctx, dependencies);
  });

  bot.action("draft:edit:time", async (ctx) => {
    await ctx.answerCbQuery();
    const draft = await requireDraft(ctx, dependencies);
    if (!draft || draft.flow !== "schedule") return;
    const user = await dependencies.users.get(draft.telegramUserId);
    await dependencies.conversations.transition(draft.telegramUserId, "select_time");
    await ctx.reply("When should I send the message to Codex?", timeKeyboard(nextTwentyLabel(user?.timezone ?? dependencies.config.defaultTimezone)));
  });
  bot.action("draft:edit:message", async (ctx) => { await ctx.answerCbQuery(); const draft = await requireDraft(ctx, dependencies); if (draft) { await dependencies.conversations.transition(draft.telegramUserId, "enter_message"); await ctx.reply("Type the message again."); } });
  bot.action("draft:edit:directory", async (ctx) => { await ctx.answerCbQuery(); const draft = await requireDraft(ctx, dependencies); if (draft) { const user = await dependencies.users.get(draft.telegramUserId); await dependencies.conversations.transition(draft.telegramUserId, "select_directory"); await ctx.reply("Where should I run Codex?", directoryKeyboard(dependencies.config.workdirKeys, user?.defaultWorkdirKey ?? dependencies.config.defaultWorkdirKey)); } });
  bot.action("draft:edit:permission", async (ctx) => { await ctx.answerCbQuery(); const draft = await requireDraft(ctx, dependencies); if (draft) { await dependencies.conversations.transition(draft.telegramUserId, "select_permission"); await ctx.reply("Choose the permission again.", permissionKeyboard()); } });
  bot.action("draft:cancel", async (ctx) => { await ctx.answerCbQuery(); await dependencies.conversations.clear(userId(ctx)); await ctx.reply("Cancelled.", mainKeyboard()); });

  bot.action("draft:confirm", async (ctx) => {
    await ctx.answerCbQuery();
    const draft = await requireDraft(ctx, dependencies);
    const user = await dependencies.users.get(userId(ctx));
    if (!draft || !user || draft.step !== "confirm" || !draft.payload.prompt || !draft.payload.workdirKey || !draft.payload.filesystemPermission) return;
    const scheduledAt = draft.flow === "schedule" ? draft.payload.scheduledAt : new Date();
    if (!scheduledAt) { await ctx.reply("The scheduled time is missing. Please edit the time."); return; }
    const id = randomUUID();
    const result = await dependencies.jobs.createIdempotent({
      id,
      kind: draft.flow === "schedule" ? "scheduled" : "immediate",
      telegramUserId: user.telegramUserId,
      telegramChatId: user.telegramChatId,
      prompt: draft.payload.prompt,
      scheduledAt,
      timezoneSnapshot: user.timezone,
      workdirKey: draft.payload.workdirKey,
      filesystemPermission: draft.payload.filesystemPermission,
      idempotencyKey: `telegram-confirm-${ctx.update.update_id}`,
    }, ctx.update.update_id);
    await dependencies.conversations.clear(user.telegramUserId);
    if (!result.created) { await ctx.reply(`Job ${result.job.id.slice(0, 8)} was already queued.`, mainKeyboard()); return; }

    if (draft.flow === "schedule") {
      const taskAt = new Date(Math.max(Date.now(), scheduledAt.getTime() - dependencies.config.bootLeadSeconds * 1000));
      const taskName = await dependencies.tasks.scheduleWake(result.job.id, taskAt);
      await dependencies.jobs.setCloudTaskName(result.job.id, taskName);
      await ctx.reply(`✅ Scheduled for ${formatDate(scheduledAt, user.timezone)}.`, mainKeyboard());
      return;
    }

    await dependencies.tasks.scheduleWake(result.job.id, new Date());
    await ctx.reply("🚀 Job queued. Waking the Codex worker.", mainKeyboard());
  });

  bot.action(/^cancel:ask:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1] as string;
    await ctx.reply("Cancel this scheduled Codex message?", Markup.inlineKeyboard([[Markup.button.callback("Yes, cancel", `cancel:confirm:${id}`)], [Markup.button.callback("No, keep it", "menu:main")]]));
  });
  bot.action(/^cancel:confirm:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1] as string;
    const existing = await dependencies.jobs.get(id);
    const cancelled = await dependencies.jobs.cancel(id, userId(ctx));
    if (cancelled) {
      if (existing?.cloudTaskName) await dependencies.tasks.deleteWake(id);
      await ctx.reply("✅ Job cancelled.", mainKeyboard());
    } else await ctx.reply("That job can no longer be cancelled.", mainKeyboard());
  });

  bot.action("settings:timezone", async (ctx) => { await ctx.answerCbQuery(); await dependencies.conversations.start(userId(ctx), "settings", "settings_timezone"); await ctx.reply("Type an IANA timezone, for example Europe/Paris."); });
  bot.action("settings:default_project", async (ctx) => {
    await ctx.answerCbQuery();
    const user = await dependencies.users.get(userId(ctx));
    await ctx.reply("Choose the default project used for new jobs.", Markup.inlineKeyboard(dependencies.config.workdirKeys.map((key) => [Markup.button.callback(key === user?.defaultWorkdirKey ? `✓ ${key}` : key, `settings:project:${key}`)])));
  });
  bot.action(/^settings:project:([a-zA-Z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const key = ctx.match[1] as string;
    if (!dependencies.config.workdirKeys.includes(key)) { await ctx.reply("That project is not configured on the worker."); return; }
    await dependencies.users.update(userId(ctx), { defaultWorkdirKey: key });
    await ctx.reply(`Default project changed to ${key}.`, mainKeyboard());
  });
  bot.action("settings:output_length", async (ctx) => { await ctx.answerCbQuery(); await dependencies.conversations.start(userId(ctx), "settings", "settings_output_length"); await ctx.reply("Type a Telegram output limit between 500 and 3900 characters."); });
  bot.action("settings:toggle_output", async (ctx) => { await ctx.answerCbQuery(); const user = await dependencies.users.get(userId(ctx)); if (user) { const outputMode = user.outputMode === "preview" ? "full" : "preview"; await dependencies.users.update(user.telegramUserId, { outputMode }); await ctx.reply(`Output mode changed to ${outputMode}.`); } });

  bot.on("text", async (ctx) => {
    const draft = await dependencies.conversations.get(userId(ctx));
    const input = ctx.message.text.trim();
    if (!draft) { await menu(ctx); return; }
    if (draft.step === "settings_timezone") {
      if (!isValidTimezone(input)) { await ctx.reply("That is not a valid IANA timezone."); return; }
      await dependencies.users.update(draft.telegramUserId, { timezone: input });
      await dependencies.conversations.clear(draft.telegramUserId);
      await ctx.reply(`Timezone changed to ${input}.`, mainKeyboard());
      return;
    }
    if (draft.step === "settings_output_length") {
      const length = Number(input);
      if (!Number.isInteger(length) || length < 500 || length > 3900) { await ctx.reply("Enter a whole number between 500 and 3900."); return; }
      await dependencies.users.update(draft.telegramUserId, { maxOutputChars: length });
      await dependencies.conversations.clear(draft.telegramUserId);
      await ctx.reply(`Output length changed to ${length} characters.`, mainKeyboard());
      return;
    }
    if (draft.step === "enter_custom_time") {
      const user = await dependencies.users.get(draft.telegramUserId);
      const parsed = parseDateInput(input, user?.timezone ?? dependencies.config.defaultTimezone);
      if (!parsed.ok) { await ctx.reply(parsed.reason); return; }
      await dependencies.conversations.transition(draft.telegramUserId, "enter_message", { scheduledAt: parsed.date });
      await ctx.reply("What message should I send to Codex?");
      return;
    }
    if (draft.step === "enter_message") {
      if (!input) { await ctx.reply("Please enter a non-empty message."); return; }
      await dependencies.conversations.transition(draft.telegramUserId, "select_directory", { prompt: input });
      const user = await dependencies.users.get(draft.telegramUserId);
      await ctx.reply("Where should I run Codex?", directoryKeyboard(dependencies.config.workdirKeys, user?.defaultWorkdirKey ?? dependencies.config.defaultWorkdirKey));
      return;
    }
    await ctx.reply("Please use the buttons for the current step, or return to /menu.");
  });

  bot.catch((error, ctx) => {
    console.error(JSON.stringify({ severity: "ERROR", event: "telegram_handler_failed", updateId: ctx.update.update_id, message: error instanceof Error ? error.message : String(error) }));
    void ctx.reply("Something went wrong. Please try again or return to /menu.").catch(() => undefined);
  });

  return bot;
}
