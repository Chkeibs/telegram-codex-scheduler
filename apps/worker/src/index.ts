import { randomUUID } from "node:crypto";
import os from "node:os";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { CodexRunner } from "./codexRunner.js";
import { loadWorkerConfig } from "./config.js";
import { WorkerJobRepository } from "./firestoreJobRepository.js";
import { WorkdirPolicy } from "./pathPolicy.js";
import { ShutdownCoordinator, systemShutdown } from "./shutdownCoordinator.js";
import { WorkerLoop } from "./workerLoop.js";
import { CloudStorageResultArtifactStore } from "./resultArtifactStore.js";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  if (getApps().length === 0) initializeApp({ projectId: config.projectId });
  const jobs = new WorkerJobRepository(getFirestore());
  const paths = new WorkdirPolicy(config.workdirs);
  const runner = new CodexRunner(config.codexBin, paths, config.codexTimeoutMs, config.maxCodexOutputBytes);
  const shutdown = new ShutdownCoordinator(config.drainGraceMs, config.shutdownDisabled ? async () => undefined : systemShutdown);
  const bootId = randomUUID();
  const worker = new WorkerLoop(jobs, runner, new CloudStorageResultArtifactStore(config.resultsBucket), shutdown, {
    workerId: `${os.hostname()}:${process.pid}:${bootId}`,
    bootId,
    instanceName: config.instanceName,
    leaseMs: config.leaseMs,
    heartbeatMs: config.heartbeatMs,
    maximumRuntimeMs: config.maximumBootMs,
    outputPreviewChars: 3500,
  });
  await worker.run();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
