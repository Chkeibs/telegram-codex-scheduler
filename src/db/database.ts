import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") {
    const directory = path.dirname(databasePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  runMigrations(database);

  if (databasePath !== ":memory:") {
    try {
      chmodSync(databasePath, 0o600);
    } catch {
      // Some filesystems do not support POSIX permissions.
    }
  }

  return database;
}
