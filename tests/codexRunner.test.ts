import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { CodexRunner, type SpawnProcess } from "../src/services/codexRunner.js";
import { PathPolicy } from "../src/services/pathPolicy.js";
import { makePreview, sanitizeOutput } from "../src/services/outputService.js";

function fakeChild(stdoutText: string, stderrText: string, exitCode: number): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout,
    stderr,
    kill: vi.fn(() => true),
  });
  queueMicrotask(() => {
    stdout.end(stdoutText);
    stderr.end(stderrText);
    child.emit("close", exitCode, null);
  });
  return child;
}

describe("CodexRunner", () => {
  it("passes the prompt as one argument without a shell", async () => {
    let captured: { command: string; args: readonly string[]; shell: unknown; env: NodeJS.ProcessEnv | undefined } | undefined;
    const spawn: SpawnProcess = (command, args, options) => {
      captured = { command, args, shell: options.shell, env: options.env };
      return fakeChild("done", "progress", 0);
    };
    const runner = new CodexRunner("codex", new PathPolicy([process.cwd()]), 1_000, 1024, spawn, {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TELEGRAM_BOT_TOKEN: "must-not-pass",
    });
    const prompt = "hello; rm -rf /";
    const result = await runner.run({ message: prompt, workingDirectory: process.cwd(), filesystemPermission: "read_only" });
    expect(result.success).toBe(true);
    expect(captured?.shell).toBe(false);
    expect(captured?.args.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);
    expect(captured?.args.at(-1)).toBe(prompt);
    expect(captured?.args).toContain("read-only");
    expect(captured?.env?.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("returns a helpful failure and bounds output", async () => {
    const spawn: SpawnProcess = () => fakeChild("x".repeat(100), "Codex not logged in", 1);
    const runner = new CodexRunner("missing-codex", new PathPolicy([process.cwd()]), 1_000, 20, spawn);
    const result = await runner.run({ message: "hello", workingDirectory: process.cwd(), filesystemPermission: "workspace_write" });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("Codex not logged in");
    expect(result.stdout.length).toBe(20);
    expect(result.truncated).toBe(true);
  });

  it("reports a missing Codex binary without throwing", async () => {
    const runner = new CodexRunner("definitely-missing-codex-binary", new PathPolicy([process.cwd()]), 1_000, 1024);
    const result = await runner.run({ message: "hello", workingDirectory: process.cwd(), filesystemPermission: "read_only" });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("ENOENT");
  });

  it("redacts known secrets and creates bounded previews", () => {
    expect(sanitizeOutput("token=secret-value", ["secret-value"])).toBe("token=[REDACTED]");
    expect(makePreview("x".repeat(100), 50)).toHaveLength(50);
  });
});
