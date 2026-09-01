import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { parseCodexRateLimitsResponse, type CodexRateLimitsSnapshot } from "@telegram-codex/shared";

type SpawnAppServer = (codexBin: string, args: readonly string[]) => ChildProcessWithoutNullStreams;

export interface CodexRateLimitsReaderOptions {
  codexBin: string;
  timeoutMs: number;
  spawnAppServer?: SpawnAppServer;
}

interface RpcMessage {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

export class CodexRateLimitsReader {
  private readonly spawnAppServer: SpawnAppServer;

  constructor(private readonly options: CodexRateLimitsReaderOptions) {
    this.spawnAppServer = options.spawnAppServer ?? ((codexBin, args) => spawn(codexBin, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
    }));
  }

  read(): Promise<CodexRateLimitsSnapshot> {
    return new Promise((resolve, reject) => {
      const child = this.spawnAppServer(this.options.codexBin, ["app-server", "--stdio"]);
      const lines = createInterface({ input: child.stdout });
      let settled = false;
      let initialized = false;

      const finish = (error?: Error, snapshot?: CodexRateLimitsSnapshot): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        lines.close();
        child.stdin.end();
        child.kill();
        if (error) reject(error);
        else resolve(snapshot as CodexRateLimitsSnapshot);
      };

      const timeout = setTimeout(() => finish(new Error("Codex App Server rate-limit request timed out")), this.options.timeoutMs);
      timeout.unref();

      child.once("error", (error) => finish(new Error(`Could not start Codex App Server: ${error.message}`)));
      child.once("exit", (code) => {
        if (!settled) finish(new Error(`Codex App Server exited before returning rate limits (code ${code ?? "unknown"})`));
      });
      child.stderr.resume();

      lines.on("line", (line) => {
        let message: RpcMessage;
        try {
          message = JSON.parse(line) as RpcMessage;
        } catch {
          return;
        }

        if (message.id === 1) {
          if (message.error) return finish(new Error(message.error.message ?? "Codex App Server initialization failed"));
          if (initialized) return;
          initialized = true;
          child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
          child.stdin.write(`${JSON.stringify({ method: "account/rateLimits/read", id: 2 })}\n`);
          return;
        }

        if (message.id === 2) {
          if (message.error) return finish(new Error(message.error.message ?? "Codex rate-limit request failed"));
          try {
            finish(undefined, parseCodexRateLimitsResponse(message.result));
          } catch {
            finish(new Error("Codex App Server returned an unexpected rate-limit response"));
          }
        }
      });

      child.stdin.write(`${JSON.stringify({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: { name: "telegram-codex-scheduler", title: "Telegram Codex Scheduler", version: "1.0.0" },
          capabilities: { experimentalApi: false, requestAttestation: false },
        },
      })}\n`);
    });
  }
}
