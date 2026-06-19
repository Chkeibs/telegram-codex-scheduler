import { parseAllowedTelegramUserIds } from "@telegram-codex/shared";
import { z } from "zod";

const schema = z.object({
  GCP_PROJECT_ID: z.string().trim().min(1),
  GCP_REGION: z.string().trim().default("us-central1"),
  GCP_ZONE: z.string().trim().default("us-central1-a"),
  GCE_INSTANCE_NAME: z.string().trim().default("telegram-codex-worker"),
  CLOUD_TASKS_LOCATION: z.string().trim().default("us-central1"),
  CLOUD_TASKS_QUEUE: z.string().trim().default("codex-wakeups"),
  CLOUD_TASKS_HANDLER_URL: z.string().url(),
  CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT: z.string().email(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().trim().min(1),
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().trim().min(16),
  DEFAULT_TIMEZONE: z.string().trim().default("Europe/Paris"),
  DEFAULT_WORKDIR_KEY: z.string().trim().default("default"),
  WORKDIR_KEYS: z.string().trim().default("default"),
  BOOT_LEAD_SECONDS: z.coerce.number().int().min(0).max(900).default(90),
  CONVERSATION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  MAX_TELEGRAM_OUTPUT_CHARS: z.coerce.number().int().min(500).max(3900).default(3500),
  WAKE_RETRY_DELAY_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
});

export interface FunctionsConfig {
  projectId: string;
  region: string;
  zone: string;
  instanceName: string;
  tasksLocation: string;
  tasksQueue: string;
  taskHandlerUrl: string;
  taskInvokerServiceAccount: string;
  allowedTelegramUserIds: ReadonlySet<string>;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  defaultTimezone: string;
  defaultWorkdirKey: string;
  workdirKeys: readonly string[];
  bootLeadSeconds: number;
  conversationTtlMinutes: number;
  maxTelegramOutputChars: number;
  wakeRetryDelaySeconds: number;
}

export function loadFunctionsConfig(environment: NodeJS.ProcessEnv = process.env): FunctionsConfig {
  const value = schema.parse(environment);
  const workdirKeys = value.WORKDIR_KEYS.split(",").map((key) => key.trim()).filter(Boolean);
  if (workdirKeys.length === 0 || workdirKeys.some((key) => !/^[a-zA-Z0-9_-]+$/.test(key))) {
    throw new Error("WORKDIR_KEYS must contain comma-separated logical keys");
  }
  if (!workdirKeys.includes(value.DEFAULT_WORKDIR_KEY)) throw new Error("DEFAULT_WORKDIR_KEY must be included in WORKDIR_KEYS");
  return {
    projectId: value.GCP_PROJECT_ID,
    region: value.GCP_REGION,
    zone: value.GCP_ZONE,
    instanceName: value.GCE_INSTANCE_NAME,
    tasksLocation: value.CLOUD_TASKS_LOCATION,
    tasksQueue: value.CLOUD_TASKS_QUEUE,
    taskHandlerUrl: value.CLOUD_TASKS_HANDLER_URL,
    taskInvokerServiceAccount: value.CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT,
    allowedTelegramUserIds: parseAllowedTelegramUserIds(value.TELEGRAM_ALLOWED_USER_IDS),
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: value.TELEGRAM_WEBHOOK_SECRET,
    defaultTimezone: value.DEFAULT_TIMEZONE,
    defaultWorkdirKey: value.DEFAULT_WORKDIR_KEY,
    workdirKeys,
    bootLeadSeconds: value.BOOT_LEAD_SECONDS,
    conversationTtlMinutes: value.CONVERSATION_TTL_MINUTES,
    maxTelegramOutputChars: value.MAX_TELEGRAM_OUTPUT_CHARS,
    wakeRetryDelaySeconds: value.WAKE_RETRY_DELAY_SECONDS,
  };
}
