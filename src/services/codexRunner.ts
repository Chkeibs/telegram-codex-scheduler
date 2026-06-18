import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import type { FilesystemPermission } from "../types/domain.js";
import type { PathPolicy } from "./pathPolicy.js";

export interface CodexRunRequest {
  message: string;
  workingDirectory: string;
  filesystemPermission: FilesystemPermission;
}

export interface CodexRunResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

function minimalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = [
    "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE",
    "CODEX_HOME", "CODEX_CA_CERTIFICATE", "SSL_CERT_FILE", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
    "SystemRoot", "ComSpec", "PATHEXT", "LOCALAPPDATA", "APPDATA",
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
  if (combined.length <= maximum) return { value: combined, truncated: false };
  return { value: combined.subarray(combined.length - maximum), truncated: true };
}

export class CodexRunner {
  constructor(
    private readonly codexBin: string,
    private readonly pathPolicy: PathPolicy,
    private readonly timeoutMs: number,
    private readonly maxOutputBytes: number,
    private readonly spawnProcess: SpawnProcess = nodeSpawn as SpawnProcess,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  run(request: CodexRunRequest): Promise<CodexRunResult> {
    const directory = this.pathPolicy.resolveDirectory(request.workingDirectory);
    const sandbox = request.filesystemPermission === "workspace_write" ? "workspace-write" : "read-only";
    // Approval is a root CLI option in Codex 0.140, so it must appear before `exec`.
    const args = ["--ask-for-approval", "never", "exec", "--ephemeral", "--sandbox", sandbox];
    if (!this.pathPolicy.isGitRepository(directory)) args.push("--skip-git-repo-check");
    args.push(request.message);

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
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolve({ success: false, exitCode: null, stdout: "", stderr: error instanceof Error ? error.message : String(error), timedOut: false, truncated: false });
        return;
      }

      child.stdout.on("data", (data: Buffer) => {
        const next = appendHead(stdout, data, this.maxOutputBytes);
        stdout = next.value;
        truncated ||= next.truncated;
      });
      child.stderr.on("data", (data: Buffer) => {
        const next = appendTail(stderr, data, this.maxOutputBytes);
        stderr = next.value;
        truncated ||= next.truncated;
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      }, this.timeoutMs);

      const finish = (exitCode: number | null, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const errorText = error ? `${stderr.toString("utf8")}\n${error.message}` : stderr.toString("utf8");
        resolve({
          success: !timedOut && !error && exitCode === 0,
          exitCode,
          stdout: stdout.toString("utf8"),
          stderr: timedOut ? `${errorText}\nCodex execution timed out.` : errorText,
          timedOut,
          truncated,
        });
      };
      child.once("error", (error) => finish(null, error));
      child.once("close", (code) => finish(code));
    });
  }

  checkAvailable(): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(this.codexBin, ["--version"], {
          env: minimalEnvironment(this.environment),
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolve({ ok: false, detail: error instanceof Error ? error.message : String(error) });
        return;
      }
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.once("error", (error) => { clearTimeout(timeout); resolve({ ok: false, detail: error.message }); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        resolve({ ok: code === 0, detail: output.trim() || `Exited with status ${String(code)}` });
      });
    });
  }
}
