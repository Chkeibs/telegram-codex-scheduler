import "dotenv/config";
import path from "node:path";
import { DateTime } from "luxon";
import { z } from "zod";

const environmentSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ALLOWED_TELEGRAM_USER_IDS: z.string().trim().min(1, "ALLOWED_TELEGRAM_USER_IDS is required"),
  DEFAULT_TIMEZONE: z.string().trim().default("Europe/Paris"),
  DEFAULT_WORKDIR: z.string().trim().min(1, "DEFAULT_WORKDIR must be an existing absolute directory"),
  ALLOWED_WORKDIR_ROOTS: z.string().trim().optional(),
  DATABASE_PATH: z.string().trim().default("./data/bot.sqlite"),
  CODEX_BIN: z.string().trim().default("codex"),
  MAX_TELEGRAM_OUTPUT_CHARS: z.coerce.number().int().min(500).max(3900).default(3500),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  CONVERSATION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  CODEX_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(86400).default(1800),
  MAX_CODEX_OUTPUT_BYTES: z.coerce.number().int().min(4096).max(20 * 1024 * 1024).default(1024 * 1024),
});

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramUserIds: ReadonlySet<string>;
  defaultTimezone: string;
  defaultWorkdir: string;
  allowedWorkdirRoots: readonly string[];
  botWorkdir: string;
  databasePath: string;
  codexBin: string;
  maxTelegramOutputChars: number;
  schedulerIntervalSeconds: number;
  conversationTtlMinutes: number;
  codexTimeoutSeconds: number;
  maxCodexOutputBytes: number;
  secretValues: readonly string[];
}

function resolveFrom(base: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const parsed = environmentSchema.parse(environment);
  if (!DateTime.now().setZone(parsed.DEFAULT_TIMEZONE).isValid) {
    throw new Error(`DEFAULT_TIMEZONE is not a valid IANA timezone: ${parsed.DEFAULT_TIMEZONE}`);
  }

  const allowedIds = parsed.ALLOWED_TELEGRAM_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  if (allowedIds.length === 0 || allowedIds.some((id) => !/^\d+$/.test(id))) {
    throw new Error("ALLOWED_TELEGRAM_USER_IDS must be a comma-separated list of numeric Telegram user IDs");
  }

  const defaultWorkdir = resolveFrom(cwd, parsed.DEFAULT_WORKDIR);
  const configuredRoots = parsed.ALLOWED_WORKDIR_ROOTS?.split(",").map((root) => root.trim()).filter(Boolean) ?? [];
  const allowedRoots = configuredRoots.length > 0 ? configuredRoots.map((root) => resolveFrom(cwd, root)) : [defaultWorkdir, cwd];
  const secretValues = Object.entries(environment)
    .filter(([key, value]) => value && /(TOKEN|SECRET|PASSWORD|API_KEY|AUTH|COOKIE)/i.test(key))
    .map(([, value]) => value as string)
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);

  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedTelegramUserIds: new Set(allowedIds),
    defaultTimezone: parsed.DEFAULT_TIMEZONE,
    defaultWorkdir,
    allowedWorkdirRoots: [...new Set([...allowedRoots, cwd])],
    botWorkdir: cwd,
    databasePath: resolveFrom(cwd, parsed.DATABASE_PATH),
    codexBin: parsed.CODEX_BIN,
    maxTelegramOutputChars: parsed.MAX_TELEGRAM_OUTPUT_CHARS,
    schedulerIntervalSeconds: parsed.SCHEDULER_INTERVAL_SECONDS,
    conversationTtlMinutes: parsed.CONVERSATION_TTL_MINUTES,
    codexTimeoutSeconds: parsed.CODEX_TIMEOUT_SECONDS,
    maxCodexOutputBytes: parsed.MAX_CODEX_OUTPUT_BYTES,
    secretValues,
  };
}
