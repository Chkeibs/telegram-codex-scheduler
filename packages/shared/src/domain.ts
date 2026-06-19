export type FilesystemPermission = "read_only" | "workspace_write";
export type JobKind = "scheduled" | "immediate";
export type JobStatus =
  | "scheduled"
  | "pending_wake"
  | "starting"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type DeliveryStatus = "none" | "pending" | "sending" | "sent" | "failed";
export type WorkerStatus = "offline" | "booting" | "ready" | "busy" | "draining" | "stopping";

export interface CloudUser {
  telegramUserId: string;
  telegramChatId: string;
  username: string | null;
  timezone: string;
  defaultWorkdirKey: string;
  maxOutputChars: number;
  outputMode: "preview" | "full";
  createdAt: Date;
  updatedAt: Date;
}

export interface CloudJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  telegramUserId: string;
  telegramChatId: string;
  prompt: string;
  scheduledAt: Date;
  timezoneSnapshot: string;
  workdirKey: string;
  workingDirectorySnapshot: string | null;
  filesystemPermission: FilesystemPermission;
  codexMode: "exec";
  idempotencyKey: string;
  cloudTaskName: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attempt: number;
  vmBootId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  outputPreview: string | null;
  resultObjectName: string | null;
  errorCode: string | null;
  errorPreview: string | null;
  exitCode: number | null;
  durationMs: number | null;
  latenessSeconds: number | null;
  deliveryStatus: DeliveryStatus;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCloudJob {
  id: string;
  kind: JobKind;
  telegramUserId: string;
  telegramChatId: string;
  prompt: string;
  scheduledAt: Date;
  timezoneSnapshot: string;
  workdirKey: string;
  filesystemPermission: FilesystemPermission;
  idempotencyKey: string;
}

export interface WorkerState {
  instanceName: string;
  state: WorkerStatus;
  bootId: string | null;
  currentJobId: string | null;
  heartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  startedAt: Date | null;
  updatedAt: Date;
}
