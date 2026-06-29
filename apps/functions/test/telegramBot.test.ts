import { afterEach, describe, expect, it, vi } from "vitest";
import { Telegram } from "telegraf";
import { createCloudTelegramBot, type CloudBotDependencies } from "../src/telegramBot.js";
import type { CloudDraft } from "../src/repositories/firestoreConversationRepository.js";

function messageUpdate(updateId: number, text: string, user = 1) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: user, type: "private" as const },
      from: { id: user, is_bot: false, first_name: "Test", username: "test" },
      text,
    },
  };
}

function callbackUpdate(updateId: number, data: string, user = 1) {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      chat_instance: "test",
      from: { id: user, is_bot: false, first_name: "Test", username: "test" },
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: user, type: "private" as const },
      },
    },
  };
}

function dependencies(): { value: CloudBotDependencies; calls: ReturnType<typeof vi.fn> } {
  let draft: CloudDraft | null = null;
  const calls = vi.fn(async () => ({ message_id: 100 }));
  const user = {
    telegramUserId: "1",
    telegramChatId: "1",
    username: "test",
    timezone: "Europe/Paris",
    defaultWorkdirKey: "default",
    maxOutputChars: 3500,
    outputMode: "preview" as const,
  };
  const conversations = {
    start: vi.fn(async (id: string, flow: CloudDraft["flow"], step: CloudDraft["step"]) => {
      draft = { telegramUserId: id, flow, step, payload: {}, revision: 1, expiresAt: new Date(Date.now() + 60000) };
      return draft;
    }),
    get: vi.fn(async () => draft),
    transition: vi.fn(async (_id: string, step: CloudDraft["step"], patch: CloudDraft["payload"] = {}) => {
      if (!draft) return null;
      draft = { ...draft, step, payload: { ...draft.payload, ...patch }, revision: draft.revision + 1 };
      return draft;
    }),
    clear: vi.fn(async () => { draft = null; }),
  };
  const value = {
    config: {
      projectId: "project",
      region: "us-central1",
      zone: "us-central1-a",
      instanceName: "worker",
      tasksLocation: "us-central1",
      tasksQueue: "wakeups",
      taskHandlerUrl: "https://example.test/task",
      taskInvokerServiceAccount: "tasks@example.iam.gserviceaccount.com",
      allowedTelegramUserIds: new Set(["1"]),
      telegramBotToken: "test-token",
      telegramWebhookSecret: "0123456789abcdef",
      defaultTimezone: "Europe/Paris",
      defaultWorkdirKey: "default",
      workdirKeys: ["default"],
      bootLeadSeconds: 90,
      conversationTtlMinutes: 30,
      maxTelegramOutputChars: 3500,
      wakeRetryDelaySeconds: 60,
    },
    users: {
      ensure: vi.fn(async () => user),
      get: vi.fn(async () => user),
      update: vi.fn(async () => undefined),
    },
    conversations,
    jobs: {
      createIdempotent: vi.fn(async (input: { id: string }) => ({
        created: true,
        job: { id: input.id, status: "pending_wake", scheduledAt: new Date(), telegramUserId: "1", telegramChatId: "1", cloudTaskName: null },
      })),
      setCloudTaskName: vi.fn(async () => undefined),
      markStarting: vi.fn(async () => null),
      markPending: vi.fn(async () => null),
      listForUser: vi.fn(async () => []),
      listPageForUser: vi.fn(async () => ({ jobs: [], nextCursor: null })),
      get: vi.fn(async () => null),
      cancel: vi.fn(async () => true),
    },
    tasks: {
      scheduleWake: vi.fn(async () => "task"),
      deleteWake: vi.fn(async () => undefined),
    },
  } as unknown as CloudBotDependencies;
  return { value, calls };
}

function prepareBot(dependencies: CloudBotDependencies, calls: ReturnType<typeof vi.fn>) {
  const bot = createCloudTelegramBot(dependencies);
  bot.botInfo = { id: 99, is_bot: true, first_name: "Bot", username: "test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
  vi.spyOn(Telegram.prototype, "callApi").mockImplementation(calls as never);
  return bot;
}

afterEach(() => vi.restoreAllMocks());

describe("cloud Telegram button flow", () => {
  it("rejects unauthorized users before writing state", async () => {
    const fixture = dependencies();
    const bot = prepareBot(fixture.value, fixture.calls);
    await bot.handleUpdate(messageUpdate(1, "Help", 2));
    expect(fixture.calls).toHaveBeenCalledWith(
      "sendMessage",
      expect.objectContaining({ text: expect.stringContaining("not authorized") }),
    );
    expect(fixture.value.conversations.start).not.toHaveBeenCalled();
  });

  it("runs preset time -> message -> directory -> permission -> confirmation", async () => {
    const fixture = dependencies();
    const bot = prepareBot(fixture.value, fixture.calls);
    await bot.handleUpdate(messageUpdate(1, "Send scheduled message"));
    await bot.handleUpdate(callbackUpdate(2, "schedule:time:10m"));
    await bot.handleUpdate(messageUpdate(3, "inspect the repository"));
    await bot.handleUpdate(callbackUpdate(4, "draft:dir:default"));
    await bot.handleUpdate(callbackUpdate(5, "draft:permission:read_only"));
    await bot.handleUpdate(callbackUpdate(6, "draft:confirm"));
    expect(fixture.value.jobs.createIdempotent).toHaveBeenCalledOnce();
    expect(fixture.value.tasks.scheduleWake).toHaveBeenCalledOnce();
  });

  it("queues an immediate job through the private wake task", async () => {
    const fixture = dependencies();
    const bot = prepareBot(fixture.value, fixture.calls);
    await bot.handleUpdate(messageUpdate(10, "Send message now"));
    await bot.handleUpdate(messageUpdate(11, "hello"));
    await bot.handleUpdate(callbackUpdate(12, "draft:dir:default"));
    await bot.handleUpdate(callbackUpdate(13, "draft:permission:read_only"));
    await bot.handleUpdate(callbackUpdate(14, "draft:confirm"));
    expect(fixture.value.tasks.scheduleWake).toHaveBeenCalledOnce();
    expect(fixture.value.jobs.markStarting).not.toHaveBeenCalled();
  });

  it("queues reset-credit status from one menu button without sending an intermediate reply", async () => {
    const fixture = dependencies();
    const bot = prepareBot(fixture.value, fixture.calls);
    await bot.handleUpdate(messageUpdate(15, "Codex reset credits"));
    expect(fixture.value.jobs.createIdempotent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reset_credit_status",
      prompt: "",
      filesystemPermission: "read_only",
      workdirKey: "default",
    }), 15);
    expect(fixture.value.tasks.scheduleWake).toHaveBeenCalledOnce();
    expect(fixture.calls).not.toHaveBeenCalledWith("sendMessage", expect.anything());
  });

  it("requires explicit acknowledgement before workspace-write confirmation", async () => {
    const fixture = dependencies();
    const bot = prepareBot(fixture.value, fixture.calls);
    await bot.handleUpdate(messageUpdate(20, "Send message now"));
    await bot.handleUpdate(messageUpdate(21, "edit files"));
    await bot.handleUpdate(callbackUpdate(22, "draft:dir:default"));
    await bot.handleUpdate(callbackUpdate(23, "draft:permission:workspace_write"));
    await bot.handleUpdate(callbackUpdate(24, "draft:confirm"));
    expect(fixture.value.jobs.createIdempotent).not.toHaveBeenCalled();
    await bot.handleUpdate(callbackUpdate(25, "draft:permission:ack_write"));
    await bot.handleUpdate(callbackUpdate(26, "draft:confirm"));
    expect(fixture.value.jobs.createIdempotent).toHaveBeenCalledOnce();
  });

  it("paginates pending jobs with an opaque job cursor", async () => {
    const fixture = dependencies();
    const cursor = "123e4567-e89b-12d3-a456-426614174000";
    const job = {
      id: "223e4567-e89b-12d3-a456-426614174000",
      status: "scheduled" as const,
      scheduledAt: new Date("2026-06-20T07:00:00.000Z"),
      telegramUserId: "1",
      telegramChatId: "1",
      cloudTaskName: "task",
      prompt: "inspect the repository",
      workdirKey: "default",
      filesystemPermission: "read_only" as const,
      timezoneSnapshot: "Europe/Paris",
    };
    vi.mocked(fixture.value.jobs.listPageForUser)
      .mockResolvedValueOnce({ jobs: [job], nextCursor: cursor })
      .mockResolvedValueOnce({ jobs: [], nextCursor: null });
    const bot = prepareBot(fixture.value, fixture.calls);
    await bot.handleUpdate(messageUpdate(30, "My scheduled messages"));
    expect(fixture.calls).toHaveBeenCalledWith(
      "sendMessage",
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [[expect.objectContaining({ callback_data: `jobs:page:${cursor}` })]],
        }),
      }),
    );
    await bot.handleUpdate(callbackUpdate(31, `jobs:page:${cursor}`));
    expect(fixture.value.jobs.listPageForUser).toHaveBeenLastCalledWith("1", 5, cursor);
  });
});
