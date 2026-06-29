import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const environmentSchema = z.object({
  GCP_PROJECT_ID: z.string().trim().min(1),
  GCP_ZONE: z.string().trim().default("us-central1-a"),
  GCE_INSTANCE_NAME: z.string().trim().default("telegram-codex-worker"),
  RESULTS_BUCKET: z.string().trim().min(3),
  CODEX_BIN: z.string().trim().default("codex"),
  CODEX_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(86400).default(1800),
  MAX_CODEX_OUTPUT_BYTES: z.coerce.number().int().min(4096).max(20 * 1024 * 1024).default(1024 * 1024),
  WORKER_POLL_SECONDS: z.coerce.number().int().min(1).max(60).default(5),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(7200).default(2100),
  WORKER_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  DRAIN_GRACE_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
  WORKER_MAX_BOOT_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  WORKDIR_CONFIG_PATH: z.string().trim().min(1),
  WORKER_DISABLE_SHUTDOWN: z.enum(["true", "false"]).default("false"),
  CODEX_RESET_CREDIT_DETAILS_MODE: z.enum(["disabled", "private_endpoint_details"]).default("private_endpoint_details"),
  CODEX_RESET_CREDITS_ENDPOINT: z.string().url().default("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"),
  CODEX_RESET_CREDITS_TIMEOUT_SECONDS: z.coerce.number().int().min(3).max(120).default(20),
});

const workdirSchema = z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), z.string().min(1));

export interface WorkerConfig {
  projectId: string;
  zone: string;
  instanceName: string;
  resultsBucket: string;
  codexBin: string;
  codexTimeoutMs: number;
  maxCodexOutputBytes: number;
  pollMs: number;
  leaseMs: number;
  heartbeatMs: number;
  drainGraceMs: number;
  maximumBootMs: number;
  workdirs: Readonly<Record<string, string>>;
  shutdownDisabled: boolean;
  resetCreditDetailsMode: "disabled" | "private_endpoint_details";
  resetCreditsEndpoint: string;
  resetCreditsTimeoutMs: number;
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const value = environmentSchema.parse(environment);
  const configPath = path.resolve(value.WORKDIR_CONFIG_PATH);
  const workdirs = workdirSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
  if (Object.keys(workdirs).length === 0) throw new Error("At least one working-directory mapping is required");
  if (value.WORKER_HEARTBEAT_SECONDS >= value.WORKER_LEASE_SECONDS) {
    throw new Error("WORKER_HEARTBEAT_SECONDS must be lower than WORKER_LEASE_SECONDS");
  }
  return {
    projectId: value.GCP_PROJECT_ID,
    zone: value.GCP_ZONE,
    instanceName: value.GCE_INSTANCE_NAME,
    resultsBucket: value.RESULTS_BUCKET,
    codexBin: value.CODEX_BIN,
    codexTimeoutMs: value.CODEX_TIMEOUT_SECONDS * 1000,
    maxCodexOutputBytes: value.MAX_CODEX_OUTPUT_BYTES,
    pollMs: value.WORKER_POLL_SECONDS * 1000,
    leaseMs: value.WORKER_LEASE_SECONDS * 1000,
    heartbeatMs: value.WORKER_HEARTBEAT_SECONDS * 1000,
    drainGraceMs: value.DRAIN_GRACE_SECONDS * 1000,
    maximumBootMs: value.WORKER_MAX_BOOT_SECONDS * 1000,
    workdirs,
    shutdownDisabled: value.WORKER_DISABLE_SHUTDOWN === "true",
    resetCreditDetailsMode: value.CODEX_RESET_CREDIT_DETAILS_MODE,
    resetCreditsEndpoint: value.CODEX_RESET_CREDITS_ENDPOINT,
    resetCreditsTimeoutMs: value.CODEX_RESET_CREDITS_TIMEOUT_SECONDS * 1000,
  };
}
