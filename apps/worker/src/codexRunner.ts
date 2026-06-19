import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import type { FilesystemPermission } from "@telegram-codex/shared";
import type { WorkdirPolicy } from "./pathPolicy.js";

export interface CodexRequest {
  prompt: string;
  workdirKey: string;
  filesystemPermission: FilesystemPermission;
}

export interface CodexResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  workingDirectory: string;
}

export type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;

function minimalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = [
    "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE",
    "CODEX_HOME", "CODEX_CA_CERTIFICATE", "SSL_CERT_FILE", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
  ];
  return Object.fromEntries(names.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]])) as NodeJS.ProcessEnv;
}

function appendHead(current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>, maximum: number): { value: Buffer<ArrayBufferLike>; truncated: boolean } {
  if (current.length >= maximum) return { value: current, truncated: chunk.length > 0 };
  const remaining = maximum - current.length;
  return { value: Buffer.concat([current, chunk.subarray(0, remaining)]), truncated: chunk.length > remaining };
}

function appendTail(current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>, maximum: number): { value: Buffer<ArrayBufferLike>; truncated: boolean } {
  const combined = Buffer.concat([current, chunk]);
  return combined.length <= maximum
    ? { value: combined, truncated: false }
    : { value: combined.subarray(combined.length - maximum), truncated: true };
}

export class CodexRunner {
  constructor(
    private readonly codexBin: string,
    private readonly paths: WorkdirPolicy,
    private readonly timeoutMs: number,
    private readonly maxOutputBytes: number,
    private readonly spawnProcess: SpawnProcess = nodeSpawn as SpawnProcess,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  run(request: CodexRequest): Promise<CodexResult> {
    const started = Date.now();
    const directory = this.paths.resolveKey(request.workdirKey);
    const sandbox = request.filesystemPermission === "workspace_write" ? "workspace-write" : "read-only";
    const args = ["--ask-for-approval", "never", "exec", "--ephemeral", "--sandbox", sandbox];
    if (!this.paths.isGitRepository(directory)) args.push("--skip-git-repo-check");
    args.push(request.prompt);

    return new Promise((resolve) => {
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      let settled = false;
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(this.codexBin, args, {
          cwd: directory,
          env: minimalEnvironment(this.environment),
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolve({ success: false, exitCode: null, stdout: "", stderr: error instanceof Error ? error.message : String(error), timedOut: false, truncated: false, durationMs: Date.now() - started, workingDirectory: directory });
        return;
      }

      child.stdout.on("data", (chunk: Buffer) => {
        const next = appendHead(stdout, chunk, this.maxOutputBytes);
        stdout = next.value;
        truncated ||= next.truncated;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const next = appendTail(stderr, chunk, this.maxOutputBytes);
        stderr = next.value;
        truncated ||= next.truncated;
      });

      const killTree = (signal: NodeJS.Signals) => {
        if (process.platform !== "win32" && child.pid) {
          try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
        } else child.kill(signal);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        killTree("SIGTERM");
        setTimeout(() => killTree("SIGKILL"), 2_000).unref();
      }, this.timeoutMs);

      const finish = (exitCode: number | null, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const diagnostic = error ? `${stderr.toString("utf8")}\n${error.message}` : stderr.toString("utf8");
        resolve({
          success: !timedOut && !error && exitCode === 0,
          exitCode,
          stdout: stdout.toString("utf8"),
          stderr: timedOut ? `${diagnostic}\nCodex execution timed out.` : diagnostic,
          timedOut,
          truncated,
          durationMs: Date.now() - started,
          workingDirectory: directory,
        });
      };
      child.once("error", (error) => finish(null, error));
      child.once("close", (code) => finish(code));
    });
  }
}
