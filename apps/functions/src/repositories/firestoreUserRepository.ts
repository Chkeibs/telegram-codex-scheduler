import { Timestamp, type Firestore } from "firebase-admin/firestore";

export interface CloudUserPreferences {
  telegramUserId: string;
  telegramChatId: string;
  username: string | null;
  timezone: string;
  defaultWorkdirKey: string;
  maxOutputChars: number;
  outputMode: "preview" | "full";
}

export interface UserDefaults {
  timezone: string;
  defaultWorkdirKey: string;
  maxOutputChars: number;
}

export class FirestoreUserRepository {
  constructor(private readonly firestore: Firestore, private readonly defaults: UserDefaults) {}

  async ensure(userId: string, chatId: string, username: string | undefined, now = new Date()): Promise<CloudUserPreferences> {
    const ref = this.firestore.collection("users").doc(userId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const timestamp = Timestamp.fromDate(now);
      if (!snapshot.exists) {
        const user: CloudUserPreferences = {
          telegramUserId: userId,
          telegramChatId: chatId,
          username: username ?? null,
          timezone: this.defaults.timezone,
          defaultWorkdirKey: this.defaults.defaultWorkdirKey,
          maxOutputChars: this.defaults.maxOutputChars,
          outputMode: "preview",
        };
        transaction.create(ref, { ...user, createdAt: timestamp, updatedAt: timestamp });
        return user;
      }
      const data = snapshot.data() as CloudUserPreferences;
      transaction.update(ref, { telegramChatId: chatId, username: username ?? null, updatedAt: timestamp });
      return { ...data, telegramChatId: chatId, username: username ?? null };
    });
  }

  async get(userId: string): Promise<CloudUserPreferences | null> {
    const snapshot = await this.firestore.collection("users").doc(userId).get();
    return snapshot.exists ? snapshot.data() as CloudUserPreferences : null;
  }

  async update(userId: string, patch: Partial<Pick<CloudUserPreferences, "timezone" | "defaultWorkdirKey" | "maxOutputChars" | "outputMode">>, now = new Date()): Promise<void> {
    await this.firestore.collection("users").doc(userId).update({ ...patch, updatedAt: Timestamp.fromDate(now) });
  }
}
