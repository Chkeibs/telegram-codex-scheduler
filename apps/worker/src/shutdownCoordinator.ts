import { writeFile } from "node:fs/promises";

export type ShutdownCommand = () => Promise<void>;

export function systemShutdown(): Promise<void> {
  return writeFile("/run/telegram-codex-worker/shutdown-request", new Date().toISOString(), { mode: 0o600 });
}

export class ShutdownCoordinator {
  constructor(private readonly graceMs: number, private readonly command: ShutdownCommand, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  async drain(hasClaimableWork: () => Promise<boolean>): Promise<"continued" | "shutdown"> {
    await this.sleep(this.graceMs);
    if (await hasClaimableWork()) return "continued";
    await this.command();
    return "shutdown";
  }
}
