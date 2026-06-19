import { CloudTasksClient } from "@google-cloud/tasks";

export interface TasksClientLike {
  queuePath(project: string, location: string, queue: string): string;
  taskPath(project: string, location: string, queue: string, task: string): string;
  createTask(request: unknown): Promise<readonly [unknown, ...unknown[]]>;
  deleteTask(request: { name: string }): Promise<readonly [unknown, ...unknown[]]>;
}

export interface CloudTasksConfig {
  projectId: string;
  location: string;
  queue: string;
  handlerUrl: string;
  invokerServiceAccount: string;
}

export class CloudTasksService {
  constructor(private readonly client: TasksClientLike, private readonly config: CloudTasksConfig) {}

  taskName(jobId: string, suffix?: string): string {
    const taskId = suffix ? `job-${jobId}-${suffix}` : `job-${jobId}`;
    return this.client.taskPath(this.config.projectId, this.config.location, this.config.queue, taskId);
  }

  async scheduleWake(jobId: string, scheduleAt: Date, suffix?: string): Promise<string> {
    const name = this.taskName(jobId, suffix);
    const body = Buffer.from(JSON.stringify({ jobId })).toString("base64");
    const seconds = Math.floor(scheduleAt.getTime() / 1000);
    try {
      await this.client.createTask({
        parent: this.client.queuePath(this.config.projectId, this.config.location, this.config.queue),
        task: {
          name,
          scheduleTime: { seconds },
          httpRequest: {
            httpMethod: "POST",
            url: this.config.handlerUrl,
            headers: { "Content-Type": "application/json" },
            body,
            oidcToken: { serviceAccountEmail: this.config.invokerServiceAccount },
          },
        },
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 6) throw error; // gRPC ALREADY_EXISTS
    }
    return name;
  }

  async deleteWake(jobId: string): Promise<void> {
    try {
      await this.client.deleteTask({ name: this.taskName(jobId) });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 5) throw error; // gRPC NOT_FOUND
    }
  }
}

export function createCloudTasksService(config: CloudTasksConfig): CloudTasksService {
  return new CloudTasksService(new CloudTasksClient() as unknown as TasksClientLike, config);
}
