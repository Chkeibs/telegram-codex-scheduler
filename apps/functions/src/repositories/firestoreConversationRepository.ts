import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { FilesystemPermission } from "@telegram-codex/shared";

export type CloudFlow = "schedule" | "run_now" | "settings";
export type CloudStep = "select_time" | "enter_custom_time" | "enter_message" | "select_directory" | "select_permission" | "confirm_workspace_write" | "confirm" | "settings_timezone" | "settings_output_length";

export interface CloudDraft {
  telegramUserId: string;
  flow: CloudFlow;
  step: CloudStep;
  payload: {
    scheduledAt?: Date;
    prompt?: string;
    workdirKey?: string;
    filesystemPermission?: FilesystemPermission;
  };
  revision: number;
  expiresAt: Date;
}

interface StoredDraft extends Omit<CloudDraft, "payload" | "expiresAt"> {
  payload: Omit<CloudDraft["payload"], "scheduledAt"> & { scheduledAt?: Timestamp };
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

function decode(value: StoredDraft): CloudDraft {
  const { scheduledAt: storedScheduledAt, ...payload } = value.payload;
  const scheduledAt = storedScheduledAt?.toDate();
  return {
    telegramUserId: value.telegramUserId,
    flow: value.flow,
    step: value.step,
    payload: {
      ...payload,
      ...(scheduledAt ? { scheduledAt } : {}),
    },
    revision: value.revision,
    expiresAt: value.expiresAt.toDate(),
  };
}

export class FirestoreConversationRepository {
  constructor(private readonly firestore: Firestore, private readonly ttlMs: number) {}

  async start(userId: string, flow: CloudFlow, step: CloudStep, now = new Date()): Promise<CloudDraft> {
    const draft: StoredDraft = {
      telegramUserId: userId,
      flow,
      step,
      payload: {},
      revision: 1,
      expiresAt: Timestamp.fromMillis(now.getTime() + this.ttlMs),
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    };
    await this.firestore.collection("conversationStates").doc(userId).set(draft);
    return decode(draft);
  }

  async get(userId: string, now = new Date()): Promise<CloudDraft | null> {
    const ref = this.firestore.collection("conversationStates").doc(userId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const draft = decode(snapshot.data() as StoredDraft);
    if (draft.expiresAt.getTime() <= now.getTime()) {
      await ref.delete();
      return null;
    }
    return draft;
  }

  async transition(userId: string, step: CloudStep, patch: CloudDraft["payload"] = {}, now = new Date()): Promise<CloudDraft | null> {
    const ref = this.firestore.collection("conversationStates").doc(userId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const stored = snapshot.data() as StoredDraft;
      if (stored.expiresAt.toMillis() <= now.getTime()) { transaction.delete(ref); return null; }
      const { scheduledAt: patchScheduledAt, ...plainPatch } = patch;
      const encodedPatch = {
        ...plainPatch,
        ...(patchScheduledAt ? { scheduledAt: Timestamp.fromDate(patchScheduledAt) } : {}),
      };
      const updated: StoredDraft = {
        ...stored,
        step,
        payload: { ...stored.payload, ...encodedPatch },
        revision: stored.revision + 1,
        expiresAt: Timestamp.fromMillis(now.getTime() + this.ttlMs),
        updatedAt: Timestamp.fromDate(now),
      };
      transaction.set(ref, updated);
      return decode(updated);
    });
  }

  async clear(userId: string): Promise<void> {
    await this.firestore.collection("conversationStates").doc(userId).delete();
  }
}
