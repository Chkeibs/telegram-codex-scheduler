import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { PathPolicy } from "../src/services/pathPolicy.js";

describe("local persistence setup", () => {
  it("creates and migrates the SQLite database file when missing", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "scheduler-db-"));
    const file = path.join(directory, "nested", "bot.sqlite");
    const database = openDatabase(file);
    expect(existsSync(file)).toBe(true);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toContain("jobs");
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("gives a helpful error for a missing default workdir", () => {
    expect(() => new PathPolicy([path.join(os.tmpdir(), "definitely-missing-codex-workdir")])).toThrow(/does not exist/);
  });
});
