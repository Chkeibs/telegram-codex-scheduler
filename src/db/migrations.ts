import type { DatabaseSync } from "node:sqlite";

const MIGRATIONS: readonly string[] = [
  `
    CREATE TABLE users (
      telegram_user_id TEXT PRIMARY KEY,
      telegram_chat_id TEXT NOT NULL,
      username TEXT,
      timezone TEXT NOT NULL,
      default_workdir TEXT NOT NULL,
      max_output_chars INTEGER NOT NULL CHECK (max_output_chars BETWEEN 500 AND 3900),
      output_mode TEXT NOT NULL CHECK (output_mode IN ('preview', 'full')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'immediate')),
      telegram_user_id TEXT NOT NULL REFERENCES users(telegram_user_id),
      message TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      filesystem_permission TEXT NOT NULL CHECK (filesystem_permission IN ('read_only', 'workspace_write')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      output_preview TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    ) STRICT;

    CREATE TABLE conversation_states (
      telegram_user_id TEXT PRIMARY KEY REFERENCES users(telegram_user_id) ON DELETE CASCADE,
      flow TEXT NOT NULL CHECK (flow IN ('schedule', 'run_now', 'settings')),
      step TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX jobs_due_idx ON jobs(status, scheduled_at);
    CREATE INDEX jobs_user_status_idx ON jobs(telegram_user_id, status, scheduled_at);
    CREATE INDEX conversation_expiry_idx ON conversation_states(expires_at);
  `,
];

export function runMigrations(database: DatabaseSync): void {
  const current = Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let index = current; index < MIGRATIONS.length; index += 1) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(MIGRATIONS[index] as string);
      database.exec(`PRAGMA user_version = ${index + 1}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
