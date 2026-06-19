import { InstancesClient } from "@google-cloud/compute";

export type ComputeInstanceStatus =
  | "PROVISIONING"
  | "STAGING"
  | "RUNNING"
  | "STOPPING"
  | "SUSPENDING"
  | "SUSPENDED"
  | "REPAIRING"
  | "TERMINATED"
  | string;

export interface InstanceClientLike {
  get(request: { project: string; zone: string; instance: string }): Promise<readonly [{ status?: string | null }, ...unknown[]]>;
  start(request: { project: string; zone: string; instance: string }): Promise<readonly [unknown, ...unknown[]]>;
}

export type WakeDecision = "started" | "already_starting" | "already_running" | "retry_after_stop";

export class ComputeService {
  constructor(
    private readonly client: InstanceClientLike,
    private readonly project: string,
    private readonly zone: string,
    private readonly instance: string,
  ) {}

  async getStatus(): Promise<ComputeInstanceStatus> {
    const [vm] = await this.client.get({ project: this.project, zone: this.zone, instance: this.instance });
    if (!vm.status) throw new Error("Compute Engine returned an instance without a status");
    return vm.status;
  }

  async wake(): Promise<WakeDecision> {
    const status = await this.getStatus();
    if (status === "TERMINATED" || status === "SUSPENDED") {
      await this.client.start({ project: this.project, zone: this.zone, instance: this.instance });
      return "started";
    }
    if (status === "RUNNING") return "already_running";
    if (status === "PROVISIONING" || status === "STAGING" || status === "REPAIRING") return "already_starting";
    if (status === "STOPPING" || status === "SUSPENDING") return "retry_after_stop";
    throw new Error(`Unsupported Compute Engine instance status: ${status}`);
  }
}

export function createComputeService(project: string, zone: string, instance: string): ComputeService {
  return new ComputeService(new InstancesClient() as unknown as InstanceClientLike, project, zone, instance);
}
