import { execFile as nodeExecFile } from "node:child_process";

export type ShutdownCommand = () => Promise<void>;

export function systemShutdown(): Promise<void> {
  return new Promise((resolve, reject) => {
    nodeExecFile("sudo", ["/sbin/shutdown", "-h", "now"], { shell: false }, (error) => error ? reject(error) : resolve());
  });
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
