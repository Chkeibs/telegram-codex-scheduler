import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationFlow,
  ConversationPayload,
  ConversationState,
  ConversationStep,
} from "../types/domain.js";

interface ConversationRow {
  telegram_user_id: string;
  flow: ConversationFlow;
  step: ConversationStep;
  payload_json: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

function mapState(row: ConversationRow): ConversationState {
  return {
    telegramUserId: row.telegram_user_id,
    flow: row.flow,
    step: row.step,
    payload: JSON.parse(row.payload_json) as ConversationPayload,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationStateService {
  constructor(private readonly database: DatabaseSync, private readonly ttlMinutes: number) {}

  set(
    telegramUserId: string,
    flow: ConversationFlow,
    step: ConversationStep,
    payload: ConversationPayload = {},
    now = new Date(),
  ): ConversationState {
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60_000).toISOString();
    this.database.prepare(`
      INSERT INTO conversation_states (
        telegram_user_id, flow, step, payload_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        flow = excluded.flow,
        step = excluded.step,
        payload_json = excluded.payload_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(telegramUserId, flow, step, JSON.stringify(payload), expiresAt, nowIso, nowIso);
    return this.get(telegramUserId, now) as ConversationState;
  }

  get(telegramUserId: string, now = new Date()): ConversationState | null {
    const row = this.database.prepare("SELECT * FROM conversation_states WHERE telegram_user_id = ?")
      .get(telegramUserId) as ConversationRow | undefined;
    if (!row) return null;
    if (row.expires_at <= now.toISOString()) {
      this.clear(telegramUserId);
      return null;
    }
    return mapState(row);
  }

  transition(
    telegramUserId: string,
    step: ConversationStep,
    payloadPatch: ConversationPayload = {},
    now = new Date(),
  ): ConversationState | null {
    const current = this.get(telegramUserId, now);
    if (!current) return null;
    return this.set(telegramUserId, current.flow, step, { ...current.payload, ...payloadPatch }, now);
  }

  clear(telegramUserId: string): void {
    this.database.prepare("DELETE FROM conversation_states WHERE telegram_user_id = ?").run(telegramUserId);
  }

  cleanupExpired(now = new Date()): number {
    return Number(this.database.prepare("DELETE FROM conversation_states WHERE expires_at <= ?").run(now.toISOString()).changes);
  }
}
