import type { JobStatus } from "./domain.js";

const transitions: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  scheduled: new Set(["pending_wake", "cancelled"]),
  pending_wake: new Set(["starting", "pending", "cancelled", "failed"]),
  starting: new Set(["pending", "failed"]),
  pending: new Set(["running", "cancelled", "failed"]),
  running: new Set(["completed", "failed"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].has(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Invalid job transition: ${from} -> ${to}`);
  }
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
