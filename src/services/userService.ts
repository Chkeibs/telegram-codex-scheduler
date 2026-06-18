import type { DatabaseSync } from "node:sqlite";
import type { OutputMode, User } from "../types/domain.js";

interface UserRow {
  telegram_user_id: string;
  telegram_chat_id: string;
  username: string | null;
  timezone: string;
  default_workdir: string;
  max_output_chars: number;
  output_mode: OutputMode;
  created_at: string;
  updated_at: string;
}

function mapUser(row: UserRow): User {
  return {
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    username: row.username,
    timezone: row.timezone,
    defaultWorkdir: row.default_workdir,
    maxOutputChars: row.max_output_chars,
    outputMode: row.output_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UserDefaults {
  timezone: string;
  defaultWorkdir: string;
  maxOutputChars: number;
}

export class UserService {
  constructor(private readonly database: DatabaseSync, private readonly defaults: UserDefaults) {}

  ensureUser(telegramUserId: string, telegramChatId: string, username?: string): User {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO users (
        telegram_user_id, telegram_chat_id, username, timezone, default_workdir,
        max_output_chars, output_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'preview', ?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        telegram_chat_id = excluded.telegram_chat_id,
        username = excluded.username,
        updated_at = excluded.updated_at
    `).run(
      telegramUserId,
      telegramChatId,
      username ?? null,
      this.defaults.timezone,
      this.defaults.defaultWorkdir,
      this.defaults.maxOutputChars,
      now,
      now,
    );
    return this.getUser(telegramUserId) as User;
  }

  getUser(telegramUserId: string): User | null {
    const row = this.database.prepare("SELECT * FROM users WHERE telegram_user_id = ?").get(telegramUserId) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  updateTimezone(telegramUserId: string, timezone: string): User | null {
    this.updateField(telegramUserId, "timezone", timezone);
    return this.getUser(telegramUserId);
  }

  updateDefaultWorkdir(telegramUserId: string, workingDirectory: string): User | null {
    this.updateField(telegramUserId, "default_workdir", workingDirectory);
    return this.getUser(telegramUserId);
  }

  updateMaxOutputChars(telegramUserId: string, maxOutputChars: number): User | null {
    this.updateField(telegramUserId, "max_output_chars", maxOutputChars);
    return this.getUser(telegramUserId);
  }

  updateOutputMode(telegramUserId: string, outputMode: OutputMode): User | null {
    this.updateField(telegramUserId, "output_mode", outputMode);
    return this.getUser(telegramUserId);
  }

  private updateField(telegramUserId: string, field: string, value: string | number): void {
    const allowedFields = new Set(["timezone", "default_workdir", "max_output_chars", "output_mode"]);
    if (!allowedFields.has(field)) {
      throw new Error(`Unsupported user setting: ${field}`);
    }
    this.database.prepare(`UPDATE users SET ${field} = ?, updated_at = ? WHERE telegram_user_id = ?`)
      .run(value, new Date().toISOString(), telegramUserId);
  }
}
