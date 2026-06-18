import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationPayload,
  FilesystemPermission,
  Job,
  JobKind,
  JobStatus,
  NewJobInput,
} from "../types/domain.js";

interface JobRow {
  id: string;
  kind: JobKind;
  telegram_user_id: string;
  message: string;
  scheduled_at: string;
  timezone: string;
  working_directory: string;
  filesystem_permission: FilesystemPermission;
  status: JobStatus;
  output_preview: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    telegramUserId: row.telegram_user_id,
    message: row.message,
    scheduledAt: row.scheduled_at,
    timezone: row.timezone,
    workingDirectory: row.working_directory,
    filesystemPermission: row.filesystem_permission,
    status: row.status,
    outputPreview: row.output_preview,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export class JobService {
  constructor(private readonly database: DatabaseSync) {}

  create(input: NewJobInput, now = new Date()): Job {
    const id = randomUUID();
    const timestamp = now.toISOString();
    this.database.prepare(`
      INSERT INTO jobs (
        id, kind, telegram_user_id, message, scheduled_at, timezone,
        working_directory, filesystem_permission, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      input.kind,
      input.telegramUserId,
      input.message,
      input.scheduledAt,
      input.timezone,
      input.workingDirectory,
      input.filesystemPermission,
      timestamp,
      timestamp,
    );
    return this.getById(id) as Job;
  }

  confirmConversation(telegramUserId: string, expectedKind: JobKind, now = new Date()): Job | null {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const state = this.database.prepare(`
        SELECT flow, step, payload_json, expires_at
        FROM conversation_states WHERE telegram_user_id = ?
      `).get(telegramUserId) as { flow: string; step: string; payload_json: string; expires_at: string } | undefined;
      const expectedFlow = expectedKind === "scheduled" ? "schedule" : "run_now";
      if (!state || state.flow !== expectedFlow || state.step !== "confirm" || state.expires_at <= now.toISOString()) {
        this.database.exec("ROLLBACK");
        return null;
      }

      const user = this.database.prepare("SELECT timezone FROM users WHERE telegram_user_id = ?")
        .get(telegramUserId) as { timezone: string } | undefined;
      const payload = JSON.parse(state.payload_json) as ConversationPayload;
      if (!user || !payload.message || !payload.workingDirectory || !payload.filesystemPermission) {
        throw new Error("Conversation draft is incomplete");
      }
      if (expectedKind === "scheduled" && !payload.scheduledAt) {
        throw new Error("Scheduled conversation has no time");
      }

      const job = this.insertInTransaction({
        kind: expectedKind,
        telegramUserId,
        message: payload.message,
        scheduledAt: expectedKind === "scheduled" ? payload.scheduledAt as string : now.toISOString(),
        timezone: user.timezone,
        workingDirectory: payload.workingDirectory,
        filesystemPermission: payload.filesystemPermission,
      }, now);
      this.database.prepare("DELETE FROM conversation_states WHERE telegram_user_id = ?").run(telegramUserId);
      this.database.exec("COMMIT");
      return job;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  getById(id: string): Job | null {
    const row = this.database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  getForUser(id: string, telegramUserId: string): Job | null {
    const row = this.database.prepare("SELECT * FROM jobs WHERE id = ? AND telegram_user_id = ?")
      .get(id, telegramUserId) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  listPending(telegramUserId: string, limit = 5, offset = 0): Job[] {
    const rows = this.database.prepare(`
      SELECT * FROM jobs
      WHERE telegram_user_id = ? AND status = 'pending'
      ORDER BY scheduled_at ASC LIMIT ? OFFSET ?
    `).all(telegramUserId, limit, offset) as unknown as JobRow[];
    return rows.map(mapJob);
  }

  countPending(telegramUserId: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM jobs WHERE telegram_user_id = ? AND status = 'pending'
    `).get(telegramUserId) as { count: number };
    return Number(row.count);
  }

  cancel(id: string, telegramUserId: string, now = new Date()): boolean {
    const result = this.database.prepare(`
      UPDATE jobs SET status = 'cancelled', updated_at = ?, completed_at = ?
      WHERE id = ? AND telegram_user_id = ? AND status = 'pending'
    `).run(now.toISOString(), now.toISOString(), id, telegramUserId);
    return Number(result.changes) === 1;
  }

  claimNextDue(now = new Date()): Job | null {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare(`
        SELECT * FROM jobs WHERE status = 'pending' AND scheduled_at <= ?
        ORDER BY scheduled_at ASC LIMIT 1
      `).get(now.toISOString()) as JobRow | undefined;
      const claimed = row ? this.claimRow(row, now) : null;
      this.database.exec("COMMIT");
      return claimed;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  claimById(id: string, now = new Date()): Job | null {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'pending'").get(id) as JobRow | undefined;
      const claimed = row ? this.claimRow(row, now) : null;
      this.database.exec("COMMIT");
      return claimed;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  complete(id: string, outputPreview: string, now = new Date()): void {
    this.database.prepare(`
      UPDATE jobs SET status = 'completed', output_preview = ?, error_message = NULL,
        updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'
    `).run(outputPreview, now.toISOString(), now.toISOString(), id);
  }

  fail(id: string, errorMessage: string, outputPreview: string | null = null, now = new Date()): void {
    this.database.prepare(`
      UPDATE jobs SET status = 'failed', output_preview = ?, error_message = ?,
        updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'
    `).run(outputPreview, errorMessage, now.toISOString(), now.toISOString(), id);
  }

  failStaleRunning(cutoff: Date, now = new Date()): Job[] {
    const rows = this.database.prepare(`
      SELECT * FROM jobs WHERE status = 'running' AND started_at < ? ORDER BY started_at ASC
    `).all(cutoff.toISOString()) as unknown as JobRow[];
    const message = "Execution was interrupted by a bot restart and was not retried to avoid duplicate execution.";
    for (const row of rows) {
      this.fail(row.id, message, null, now);
    }
    return rows.map((row) => ({ ...mapJob(row), status: "failed", errorMessage: message, completedAt: now.toISOString() }));
  }

  private insertInTransaction(input: NewJobInput, now: Date): Job {
    const id = randomUUID();
    const timestamp = now.toISOString();
    this.database.prepare(`
      INSERT INTO jobs (
        id, kind, telegram_user_id, message, scheduled_at, timezone,
        working_directory, filesystem_permission, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, input.kind, input.telegramUserId, input.message, input.scheduledAt, input.timezone,
      input.workingDirectory, input.filesystemPermission, timestamp, timestamp);
    const row = this.database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow;
    return mapJob(row);
  }

  private claimRow(row: JobRow, now: Date): Job | null {
    const nowIso = now.toISOString();
    const result = this.database.prepare(`
      UPDATE jobs SET status = 'running', started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(nowIso, nowIso, row.id);
    if (Number(result.changes) !== 1) return null;
    return { ...mapJob(row), status: "running", startedAt: nowIso, updatedAt: nowIso };
  }
}
