import { describe, expect, it, vi } from "vitest";
import { ComputeService, type InstanceClientLike } from "../src/services/computeService.js";

function clientWith(status: string): InstanceClientLike {
  return {
    get: vi.fn(async () => [{ status }] as const),
    start: vi.fn(async () => [{}] as const),
  };
}

describe("ComputeService", () => {
  it("starts a terminated instance", async () => {
    const client = clientWith("TERMINATED");
    const service = new ComputeService(client, "project", "zone", "worker");
    await expect(service.wake()).resolves.toBe("started");
    expect(client.start).toHaveBeenCalledOnce();
  });

  it("does not restart a running instance", async () => {
    const client = clientWith("RUNNING");
    const service = new ComputeService(client, "project", "zone", "worker");
    await expect(service.wake()).resolves.toBe("already_running");
    expect(client.start).not.toHaveBeenCalled();
  });

  it("defers when the instance is stopping", async () => {
    const service = new ComputeService(clientWith("STOPPING"), "project", "zone", "worker");
    await expect(service.wake()).resolves.toBe("retry_after_stop");
  });
});
