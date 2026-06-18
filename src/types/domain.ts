export type OutputMode = "preview" | "full";
export type FilesystemPermission = "read_only" | "workspace_write";
export type JobKind = "scheduled" | "immediate";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface User {
  telegramUserId: string;
  telegramChatId: string;
  username: string | null;
  timezone: string;
  defaultWorkdir: string;
  maxOutputChars: number;
  outputMode: OutputMode;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  telegramUserId: string;
  message: string;
  scheduledAt: string;
  timezone: string;
  workingDirectory: string;
  filesystemPermission: FilesystemPermission;
  status: JobStatus;
  outputPreview: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type ConversationFlow = "schedule" | "run_now" | "settings";
export type ConversationStep =
  | "select_time"
  | "enter_custom_time"
  | "enter_message"
  | "select_directory"
  | "enter_custom_directory"
  | "select_permission"
  | "confirm"
  | "settings_timezone"
  | "settings_workdir"
  | "settings_output_length";

export interface ConversationPayload {
  scheduledAt?: string;
  message?: string;
  workingDirectory?: string;
  filesystemPermission?: FilesystemPermission;
}

export interface ConversationState {
  telegramUserId: string;
  flow: ConversationFlow;
  step: ConversationStep;
  payload: ConversationPayload;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewJobInput {
  kind: JobKind;
  telegramUserId: string;
  message: string;
  scheduledAt: string;
  timezone: string;
  workingDirectory: string;
  filesystemPermission: FilesystemPermission;
}
