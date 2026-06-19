import { describe, expect, it, vi } from "vitest";
import { ShutdownCoordinator } from "../src/shutdownCoordinator.js";

describe("ShutdownCoordinator", () => {
  it("continues when new work arrives during drain", async () => {
    const command = vi.fn(async () => undefined);
    const coordinator = new ShutdownCoordinator(1, command, async () => undefined);
    await expect(coordinator.drain(async () => true)).resolves.toBe("continued");
    expect(command).not.toHaveBeenCalled();
  });

  it("shuts down after an empty drain period", async () => {
    const command = vi.fn(async () => undefined);
    const coordinator = new ShutdownCoordinator(1, command, async () => undefined);
    await expect(coordinator.drain(async () => false)).resolves.toBe("shutdown");
    expect(command).toHaveBeenCalledOnce();
  });
});
