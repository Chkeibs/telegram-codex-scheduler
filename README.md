# Telegram Codex Scheduler — Google Cloud wake-to-run

> Private, self-hosted Telegram scheduler for the locally authenticated Codex CLI.
> The cloud implementation lives on `codex/google-cloud-wake-worker`; `main` and the
> `local-sqlite-v1` tag retain the earlier always-on SQLite edition as a rollback.
> Never put a Telegram token, Codex credential, Google refresh token, or service-account
> key in this repository.

## 0. Implementation status

The wake-to-run architecture described here is implemented. The repository contains
the Firebase Functions control plane, Firestore repositories and rules, Cloud Tasks
scheduling, the Compute Engine worker, systemd shutdown/watchdog units, guarded
provisioning scripts, rollback/teardown scripts, and automated tests.

The reference deployment was validated on 19 June 2026 with this cold-boot path:

```text
Telegram button flow -> Cloud Task -> TERMINATED VM starts -> systemd worker
-> codex exec --ephemeral --sandbox read-only -> Firestore result
-> Telegram notification -> drain grace -> VM returns to TERMINATED
```

The immediate and scheduled real smoke outputs were `CLOUD_E2E_OK` and
`CLOUD_SCHEDULED_E2E_OK`. Each was executed exactly once, delivered to Telegram, and
followed by an automatic VM shutdown. No deployment-specific project ID,
account number, bot token, webhook secret, or Codex auth file is committed.

Verified local gates on Node.js 24:

- strict TypeScript typecheck;
- production build of the local app, shared package, Functions, and worker;
- 58 unit/integration tests;
- 5 Firestore Emulator transaction tests;
- real subprocess success, failure, output-bound, injection, and timeout tests;
- cold-VM real Codex execution and result delivery;
- cost-resource inventory with the idle VM in `TERMINATED`.

`npm audit` currently reports moderate advisories in transitive Google/Firebase
packages and no high/critical advisory. npm's proposed forced remedy downgrades a
Google Cloud package across a breaking major version, so it is not applied blindly.
Recheck on every release and upgrade when the upstream dependency graph contains a
compatible fix.

This is still self-hosted infrastructure, not a hosted service. Every operator must
create a new dedicated Firebase/Google Cloud project, create their own BotFather bot,
authenticate Codex locally on their own VM, review current prices, and monitor billing.

## 1. Executive summary

The target product is a private Telegram application that can accept an immediate
or scheduled Codex request while its Compute Engine worker is powered off.

The always-available control plane will run on Firebase/Google Cloud serverless
services. It will receive Telegram webhooks, persist state in Firestore, schedule
future wake-ups with Cloud Tasks, and start a stopped Compute Engine VM. The VM
will run the locally authenticated Codex CLI, publish the sanitized result, and
stop itself as soon as the queue is empty.

```text
Telegram
   |
   | HTTPS webhook
   v
Firebase Function: telegramWebhook
   |
   +--> Firestore: users, drafts, jobs, job events
   |
   +--> Cloud Tasks: scheduled wake-up
   |
   +--> private Firebase Function: taskHandler
                              |
                              | Compute Engine API: instances.start
                              v
                    stopped Compute Engine VM
                              |
                              | systemd startup
                              v
                         Codex worker
                              |
                              | codex exec
                              v
                      Firestore job result
                              |
                              v
                  Firebase Function: deliverResult
                              |
                              v
                          Telegram user
                              |
                              v
                     worker shuts VM down
```

The target monthly infrastructure cost is close to zero for light personal use,
but it is not an absolute zero-cost guarantee. A billing account and Firebase
Blaze plan are required. Cost is controlled by free quotas, an ephemeral VM,
automatic shutdown, a maximum-runtime watchdog, narrow resource choices, and
budget alerts.

## 2. Product definition

### 2.1 What the finished system must do

- Provide the existing button-first Telegram experience.
- Support immediate and scheduled Codex jobs.
- Accept Telegram interactions while the worker VM is stopped.
- Start the worker VM only when executable work exists.
- Persist jobs independently of the VM lifecycle.
- Execute Codex in a validated project directory.
- Default to a read-only Codex sandbox.
- Allow workspace write only after explicit confirmation.
- Send progress and final output to the authorized Telegram user.
- Shut the VM down automatically after all claimable work is finished.
- Recover pending jobs after function, task, or VM restarts.
- Avoid executing the same job twice.
- Keep OpenAI/Codex authentication outside Firebase and outside Firestore.
- Remain deployable by other people as a public self-hosted project.

### 2.2 What the system must not do

- It must not expose a public Codex App Server listener.
- It must not ask for OpenAI email, password, cookies, session tokens, or auth files.
- It must not store Codex credentials in Firestore, Firebase configuration, GitHub,
  Telegram messages, or application logs.
- It must not implement OpenAI account linking.
- It must not run arbitrary shell strings supplied through Telegram.
- It must not keep a paid VM running indefinitely after a worker failure.
- It must not rely on SQLite as the cross-service source of truth.
- It must not depend on a static external IPv4 address, Cloud NAT, Cloud SQL,
  a load balancer, or Kubernetes for the MVP.
- It must not expose `danger-full-access` as a Telegram option.

### 2.3 Explicit assumptions

- English remains the initial application language.
- One Firebase/Google Cloud project represents one private installation.
- Multiple explicitly allowlisted Telegram users may use that installation.
- Jobs execute sequentially on one Compute Engine VM for the MVP.
- The VM uses a persistent boot disk so its repository, Codex configuration, and
  locally cached Codex authentication survive stop/start cycles.
- The VM has outbound internet access while running.
- The serverless control plane stays within normal Firebase free quotas for a
  personal bot.
- The operator accepts a cold-start delay of roughly one to several minutes.
- The operator enables billing but also configures cost controls before production.

## 3. Feasibility and key technical decisions

### 3.1 The design is feasible

Google Compute Engine exposes an API to start a VM in the `TERMINATED` state.
Stopped VMs do not incur CPU or memory usage charges, although attached resources
such as persistent disks and static IP addresses can still be billed. See the
[Compute Engine stop/start documentation](https://docs.cloud.google.com/compute/docs/instances/stop-start-instance).

Firebase Functions can receive Telegram webhooks without an always-running bot
process. Cloud Tasks can preserve a future execution time while the VM is off.
Firestore provides the shared durable state that both the functions and worker
need. These services have free usage quotas suitable for a low-volume private bot.

### 3.2 `codex exec` is the MVP execution interface

The worker will initially use `codex exec`, not a remotely exposed Codex App
Server. This is deliberate:

- `codex exec` is designed for scripts, scheduled jobs, and CI-style automation.
- It produces a clear process exit status and bounded stdout/stderr streams.
- The existing project already has a tested spawn-based runner.
- App Server is intended for richer interactive clients and streaming protocols.
- App Server WebSocket transport is experimental and must not be exposed publicly.

Reference:

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/)
- [Codex App Server](https://developers.openai.com/codex/app-server/)

App Server may be added later as a local `stdio` child process if persistent
multi-turn Codex threads become a product requirement. That optional phase is
defined near the end of this README.

### 3.3 Telegram must use webhooks

Long polling cannot work while the VM is stopped because no process is available
to call Telegram's `getUpdates`. The target control plane therefore uses a
Telegram webhook directed at an HTTPS Firebase Function.

The webhook function must acknowledge valid Telegram requests quickly. It must
never wait for the VM to boot or for Codex to finish. Long operations are handed
off through Firestore and Cloud Tasks.

### 3.4 Firestore replaces SQLite as the authoritative database

SQLite remains useful for the current local version, but its file lives on the VM
and cannot be read by Firebase while the VM is stopped. In the target architecture:

- Firestore is the source of truth for users, drafts, jobs, leases, and delivery.
- The worker uses transactional claims to prevent duplicate execution.
- SQLite is removed from the cloud runtime after migration.
- A local development adapter may remain temporarily for unit tests or backwards
  compatibility, but it must not be used in production cloud mode.

### 3.5 Cloud Tasks owns scheduled wake-ups

Cloud Tasks is preferred over a function that polls Firestore every minute:

- each job has an explicit scheduled delivery time;
- no always-running scheduler is required;
- task names can be deterministic for idempotency;
- retries and authentication are controlled centrally;
- the first one million operations per month are currently free.

Reference: [Cloud Tasks pricing](https://cloud.google.com/tasks/pricing).

## 4. Implemented cloud state and retained rollback

| Concern | Retained local release | Implemented cloud release |
| --- | --- | --- |
| Telegram transport | Telegraf long polling | Telegraf webhook in a Gen 2 Function |
| Runtime | One always-running Node process | Serverless control plane + normally stopped VM |
| Database | Local SQLite | Firestore Native mode |
| Scheduling | SQLite poll every 30 seconds | Deterministic authenticated Cloud Tasks |
| Codex execution | Local process | Dedicated VM worker using `spawn`, never a shell |
| Result delivery | Polling bot process | Firestore Eventarc trigger |
| Conversation state | SQLite with TTL | Firestore document with TTL semantics |
| Authentication | Local Codex login | VM-local Codex login on persistent disk |
| Power management | Host stays on | Private task handler starts VM; systemd stops it |
| Secrets | Local `.env` | Telegram secrets in Secret Manager; Codex auth only on VM |

The legacy local implementation remains in `src/` and is tagged
`local-sqlite-v1`. It is not the authoritative database for cloud mode.

## 5. Implemented repository structure

The repository is an npm-workspaces monorepo. Generated `dist/`, Function `lib/`,
local project environment files, emulator logs, and credentials are ignored.

```text
.
├── apps/
│   ├── functions/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config.ts
│   │   │   ├── telegramBot.ts
│   │   │   ├── deliverResult.ts
│   │   │   ├── taskHandler.ts
│   │   │   ├── repositories/
│   │   │   └── services/
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── worker/
│       ├── src/
│       │   ├── index.ts
│       │   ├── config.ts
│       │   ├── workerLoop.ts
│       │   ├── codexRunner.ts
│       │   ├── firestoreJobRepository.ts
│       │   ├── shutdownCoordinator.ts
│       │   ├── pathPolicy.ts
│       │   ├── outputSanitizer.ts
│       │   └── resultArtifactStore.ts
│       ├── test/
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── domain.ts
│       │   ├── jobStateMachine.ts
│       │   ├── dateParser.ts
│       │   └── validation.ts
│       ├── test/
│       └── package.json
├── infra/
│   ├── firestore.indexes.json
│   ├── firestore.rules
│   ├── firebase.json
│   ├── gcloud/
│   │   ├── create-dedicated-project.sh
│   │   ├── enable-apis.sh
│   │   ├── create-{firestore,service-accounts,task-queue,results-bucket,vm}.sh
│   │   ├── deploy-functions.sh
│   │   ├── register-webhook.sh
│   │   ├── verify-deployment.sh
│   │   ├── rollback-to-local.sh
│   │   └── teardown-dedicated-project.sh
│   ├── vm/
│   │   └── install-worker.sh
│   └── systemd/
│       ├── telegram-codex-worker.service
│       ├── telegram-codex-watchdog.service
│       ├── telegram-codex-shutdown.path
│       └── telegram-codex-shutdown.service
├── src/                         # retained local SQLite release
├── tests/                       # retained local test suite
├── .github/workflows/ci.yml     # Node 24 + Java 21 validation
├── .env.example
├── .gitignore
├── firebase.json
├── package.json
├── README.md
└── LICENSE
```

The control plane, shared domain package, worker, and retained local release are
independently typechecked and tested.

## 6. Detailed runtime flows

### 6.1 Immediate job

1. Telegram sends an update to `telegramWebhook`.
2. The function validates the Telegram webhook secret.
3. The function extracts `from.id` and rejects non-allowlisted users.
4. Telegraf routes the update through the existing button flow.
5. The final confirmation transaction creates a Firestore job with:
   - `kind = immediate`;
   - `status = pending_wake`;
   - UTC `scheduledAt = now`;
   - a configuration snapshot;
   - an idempotency key derived from the Telegram update and draft.
6. The transaction removes or closes the conversation draft.
7. The function invokes the internal wake service.
8. The wake service reads the current Compute Engine instance state.
9. If the VM is `TERMINATED`, it calls `instances.start`.
10. If the VM is `PROVISIONING`, `STAGING`, `RUNNING`, or `STOPPING`, it does not
    issue a conflicting start request.
11. Telegram receives an immediate acknowledgement such as:
    `Job queued. Waking the Codex worker.`
12. On boot, systemd launches the worker.
13. The worker transactionally claims the oldest eligible job.
14. The worker validates the real path and permission policy.
15. The worker runs Codex with `spawn`, `shell: false`, bounded output, and timeout.
16. The worker transactionally records `completed` or `failed`.
17. `deliverResult` sends the sanitized notification to Telegram.
18. The worker waits through a short drain period for newly queued jobs.
19. If no job remains, it shuts the VM down.

### 6.2 Scheduled job

1. The Telegram flow parses the selected local time in the user's IANA timezone.
2. The function converts the time to UTC and rejects invalid or past times.
3. A transaction creates the job with `status = scheduled`.
4. A deterministic Cloud Task name is generated from the job ID.
5. The task is configured to call `taskHandler` at `scheduledAt - bootLeadTime`.
6. The default `bootLeadTime` is initially 90 seconds and is configurable.
7. The task uses OIDC authentication from a dedicated service account.
8. At delivery time, `taskHandler` verifies the OIDC caller and job state.
9. It transitions the job to `pending_wake` only if it is still scheduled.
10. It starts the VM through the same idempotent wake service.
11. The worker claims the job when `scheduledAt <= now`.
12. If the VM boots early, the worker waits until the exact due time or polls with
    a bounded interval instead of running the job early.
13. If the VM boots late, the job runs immediately and records `latenessSeconds`.
14. The rest of the flow matches an immediate job.

### 6.3 Cancellation

1. The user selects a pending or scheduled job.
2. The function re-reads the job before presenting confirmation.
3. Confirmation runs a Firestore transaction.
4. `scheduled` and `pending_wake` jobs become `cancelled`.
5. A deterministic Cloud Task is deleted when it exists.
6. If task deletion reports not found, cancellation still succeeds because job
   state is authoritative.
7. A `running` job cannot be silently cancelled in the MVP. Telegram explains
   that execution already started.
8. Future work may add process interruption through a worker control channel.

### 6.4 Duplicate Telegram updates

Telegram may retry webhook delivery. Every state-changing update must use a
deduplication document keyed by `update_id`, or a deterministic operation key.
The transaction creates the operation record and job together. Replayed updates
return the previously generated response without creating another job.

### 6.5 Result delivery

1. The worker writes only sanitized, bounded output to the job document.
2. A completion event creates a delivery record with `status = pending`.
3. `deliverResult` claims the delivery record transactionally.
4. Telegram delivery success stores `telegramMessageId` and `deliveredAt`.
5. Retryable Telegram errors use bounded retries with exponential backoff.
6. Permanent errors mark delivery failed without rerunning Codex.
7. Full output mode uses a temporary file in function memory only when the output
   remains within Telegram's attachment limit.
8. Temporary files are deleted in a `finally` block.

### 6.6 VM shutdown race

The dangerous race is a new job arriving after the worker sees an empty queue but
before the VM reaches `TERMINATED`.

The implemented shutdown protocol is:

1. Worker writes `workerState = draining` with a lease expiry.
2. Worker waits `DRAIN_GRACE_SECONDS`, initially 60 seconds.
3. Worker rechecks claimable jobs transactionally.
4. If work exists, it clears draining and continues.
5. If no work exists, it writes `workerState = stopping` and creates a private
   `/run/telegram-codex-worker/shutdown-request` marker.
6. A root-owned systemd path unit observes only that marker and calls
   `shutdown -h now`; the worker retains `NoNewPrivileges=true` and no sudo rule.
7. The task handler treats `STOPPING` as a delayed-start condition and creates a
   short Cloud Task retry rather than issuing an immediate conflicting start.
8. The retry checks the state again and starts the VM once it is `TERMINATED`.

## 7. Firestore data model

Firestore security rules deny all client-side access. Only trusted server
service accounts use the Admin SDK. The project has no public Firebase web client.

### 7.1 `users/{telegramUserId}`

```ts
interface UserDocument {
  telegramUserId: string;
  telegramChatId: string;
  username: string | null;
  timezone: string;                 // IANA timezone
  defaultWorkdirKey: string;        // logical key, not arbitrary cloud path
  maxOutputChars: number;
  outputMode: "preview" | "full";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Custom directories require special handling in the cloud design. The recommended
MVP exposes an operator-configured map of logical project keys to absolute VM paths:

```text
default -> /srv/codex/projects/default
scheduler -> /srv/codex/projects/telegram-codex-scheduler
```

Telegram stores the logical key. The worker resolves it locally. Raw arbitrary
paths should not cross the serverless boundary unless the operator explicitly
enables advanced custom-path mode.

### 7.2 `conversationStates/{telegramUserId}`

```ts
interface ConversationStateDocument {
  flow: "schedule" | "run_now" | "settings";
  step: string;
  payload: {
    scheduledAt?: Timestamp;
    message?: string;
    workdirKey?: string;
    filesystemPermission?: "read_only" | "workspace_write";
  };
  revision: number;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Expired drafts are treated as missing during reads. A scheduled cleanup function
may delete them later; correctness must not depend on cleanup timing.

### 7.3 `jobs/{jobId}`

```ts
type JobStatus =
  | "scheduled"
  | "pending_wake"
  | "starting"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface JobDocument {
  id: string;
  kind: "scheduled" | "immediate";
  status: JobStatus;
  telegramUserId: string;
  telegramChatId: string;
  prompt: string;
  scheduledAt: Timestamp;
  timezoneSnapshot: string;
  workdirKey: string;
  workingDirectorySnapshot: string | null;
  filesystemPermission: "read_only" | "workspace_write";
  codexMode: "exec";
  idempotencyKey: string;
  cloudTaskName: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Timestamp | null;
  attempt: number;
  vmBootId: string | null;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
  outputPreview: string | null;
  errorCode: string | null;
  errorPreview: string | null;
  exitCode: number | null;
  durationMs: number | null;
  latenessSeconds: number | null;
  deliveryStatus: "none" | "pending" | "sending" | "sent" | "failed";
  deliveredAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Full raw Codex output is not persisted in Firestore for the MVP. Only a bounded,
sanitized preview is stored.

### 7.4 `operations/{idempotencyKey}`

Stores Telegram update deduplication and confirmation idempotency:

```ts
interface OperationDocument {
  idempotencyKey: string;
  telegramUpdateId: number;
  operationType: string;
  resultingJobId: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}
```

### 7.5 `workerState/{instanceName}`

```ts
interface WorkerStateDocument {
  instanceName: string;
  state: "offline" | "booting" | "ready" | "busy" | "draining" | "stopping";
  bootId: string | null;
  currentJobId: string | null;
  heartbeatAt: Timestamp | null;
  leaseExpiresAt: Timestamp | null;
  startedAt: Timestamp | null;
  updatedAt: Timestamp;
}
```

This document is operational telemetry, not the authoritative Compute Engine
instance state. The wake service still checks the Compute API.

### 7.6 Required indexes

- `jobs(status ASC, scheduledAt ASC)` for claimable work.
- `jobs(telegramUserId ASC, status ASC, scheduledAt ASC)` for Telegram listings.
- `jobs(deliveryStatus ASC, completedAt ASC)` if delivery is polled.
- `conversationStates(expiresAt ASC)` for cleanup.
- `operations(expiresAt ASC)` for cleanup.

Index definitions must be committed in `infra/firestore.indexes.json` and tested
with the Firestore Emulator before deployment.

## 8. Job state machine

Allowed transitions are centralized in the shared package.

```text
scheduled -----> pending_wake -----> pending -----> running -----> completed
    |                 |                  |              |              |
    v                 v                  v              v              v
cancelled         cancelled          cancelled       failed       delivery

pending_wake --VM boot--> starting --worker ready--> pending
```

Rules:

- Only serverless control-plane code creates `scheduled` or `pending_wake` jobs.
- Only `taskHandler` transitions a due scheduled job to `pending_wake`.
- Only the wake workflow may use `starting`.
- Only the worker transitions `pending` to `running`.
- A claim transaction requires `status = pending` and no unexpired lease.
- `running` jobs are never automatically requeued after ambiguous worker death.
- Stale `running` jobs become `failed` after timeout plus grace.
- Completion and failure are terminal for execution.
- Delivery retries never change execution status.
- Cancellation never deletes job history.

## 9. Security model

### 9.1 Telegram boundary

- Configure Telegram's `secret_token` when registering the webhook.
- Validate `X-Telegram-Bot-Api-Secret-Token` before parsing updates.
- Apply the numeric Telegram user-ID allowlist before every command, message,
  callback, or state mutation.
- Reject unauthorized callers with the private-bot message and no infrastructure
  details.
- Treat Telegram prompts as untrusted input.
- Never use usernames as authorization identifiers.

### 9.2 Google Cloud IAM

Create separate service accounts:

| Service account | Purpose | Minimum permissions |
| --- | --- | --- |
| `telegram-webhook-sa` | Telegram ingress and Firestore state | Firestore read/write, Cloud Tasks enqueue, Telegram secret access |
| `wake-worker-sa` | Internal VM start handler | `compute.instances.get`, `compute.instances.start`, task enqueue for retry |
| `cloud-tasks-invoker-sa` | Signs scheduled task requests | Invoke only the internal task function |
| `codex-worker` | VM identity | Read/claim/update jobs and worker state only |
| `result-delivery-sa` | Telegram result sender | Read delivery data, update delivery state, Telegram secret access |

Implementation requirements:

- Do not create downloadable service-account key files.
- Use attached runtime identities and Application Default Credentials.
- Place the VM in a dedicated project when practical, or isolate the project so
  the wake account cannot start unrelated production VMs.
- Prefer custom roles containing only required actions.
- Protect internal HTTP functions with IAM/OIDC rather than shared URL secrets.
- Deny all Firestore client rules.
- Review IAM bindings in CI or a scripted audit.

### 9.3 Secret Manager

Store these values in Secret Manager:

- Telegram bot token.
- Telegram webhook secret.
- Optional output-redaction secrets controlled by the operator.

Do not store:

- Codex `auth.json`.
- ChatGPT cookies or session tokens.
- OpenAI passwords.
- Arbitrary project `.env` files.

Codex authentication remains on the VM under the dedicated worker user's home
directory. The VM boot disk uses Google-managed encryption by default; the OS
permissions must still restrict access to the worker user.

### 9.4 Worker filesystem policy

- Run as an unprivileged Linux user such as `codexworker`.
- Resolve a logical `workdirKey` through a local immutable configuration map.
- Resolve every configured path using its real path before execution.
- Reject missing directories and symlink escapes.
- Keep allowed projects under `/srv/codex/projects`.
- Keep secrets outside allowed project roots.
- Default to `read-only`.
- Allow `workspace-write` only for an explicitly confirmed job.
- Never pass prompt text through a shell.
- Spawn `codex` with a fixed argument array and `shell: false`.

### 9.5 Codex child environment

The worker constructs an allowlisted child environment containing only required
runtime variables such as `HOME`, `PATH`, locale, and proxy/CA settings explicitly
approved by the operator. It must not forward Firebase secrets, service account
tokens, Telegram tokens, or unrelated project environment variables.

### 9.6 Network exposure

- Firebase Functions are the only public application endpoint.
- The VM does not accept public application traffic.
- SSH should use OS Login/IAP where possible.
- If an ephemeral external IPv4 is used, firewall ingress remains closed except
  for a deliberately configured administrative path.
- Do not expose App Server WebSocket on `0.0.0.0`.
- Do not add a load balancer or Cloud NAT for the MVP.

## 10. Configuration contract

### 10.1 Serverless environment

Non-secret configuration:

```dotenv
GCP_PROJECT_ID=replace_me
GCP_REGION=us-central1
GCP_ZONE=us-central1-a
GCE_INSTANCE_NAME=telegram-codex-worker
CLOUD_TASKS_LOCATION=us-central1
CLOUD_TASKS_QUEUE=codex-wakeups
TELEGRAM_ALLOWED_USER_IDS=123456789
DEFAULT_TIMEZONE=Europe/Paris
BOOT_LEAD_SECONDS=90
CONVERSATION_TTL_MINUTES=30
MAX_TELEGRAM_OUTPUT_CHARS=3500
WAKE_RETRY_DELAY_SECONDS=60
```

Secrets are bound from Secret Manager and never committed:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
```

### 10.2 Worker environment

```dotenv
GCP_PROJECT_ID=replace_me
GCP_ZONE=us-central1-a
GCE_INSTANCE_NAME=telegram-codex-worker
CODEX_BIN=/usr/local/bin/codex
CODEX_TIMEOUT_SECONDS=1800
MAX_CODEX_OUTPUT_BYTES=1048576
WORKER_POLL_SECONDS=5
WORKER_LEASE_SECONDS=2100
WORKER_HEARTBEAT_SECONDS=30
DRAIN_GRACE_SECONDS=60
WORKER_MAX_BOOT_SECONDS=3600
WORKDIR_CONFIG_PATH=/etc/telegram-codex-scheduler/workdirs.json
WORKER_DISABLE_SHUTDOWN=false
```

`workdirs.json` example:

```json
{
  "default": "/srv/codex/projects/default",
  "scheduler": "/srv/codex/projects/telegram-codex-scheduler"
}
```

The worker configuration file must be owned by root and readable by the worker.
Telegram must never be able to modify it.

## 11. Detailed implementation roadmap

These phases were used to implement the cloud release and are retained as a
reproducible engineering/audit plan. Every phase ends with a measurable exit
criterion; when repeating the deployment, do not advance while an earlier required
criterion is red.

### Phase 0 — Freeze the baseline and record decisions

#### Objective

Preserve the working local scheduler while creating a safe migration path.

#### Micro-steps

1. Tag the current working local implementation, for example `local-sqlite-v1`.
2. Run and record:
   - `npm run typecheck`;
   - `npm test`;
   - `npm run build`.
3. Export the current Telegram button flows and callback identifiers.
4. Inventory all SQLite tables, fields, indexes, and migration versions.
5. Inventory all environment variables and classify them as:
   - shared non-secret configuration;
   - Firebase-only configuration;
   - worker-only configuration;
   - Secret Manager value;
   - obsolete after migration.
6. Add an architecture decision record documenting:
   - webhook instead of long polling;
   - Firestore instead of SQLite;
   - Cloud Tasks instead of scheduler polling;
   - `codex exec` before App Server;
   - one sequential worker VM;
   - ephemeral external IPv4 if required.
7. Open a migration branch using the repository's normal `codex/` prefix.

#### Artifacts

- Git tag for the local version.
- `docs/migration-notes.md`.
- Initial architecture decision records.
- Green baseline test report.

#### Exit criteria

- Local version can be restored from its tag.
- All current tests pass without cloud credentials.
- No secret is present in tracked files or Git history of the new repository.

### Phase 1 — Google Cloud and Firebase preflight

#### Objective

Create a cost-controlled project foundation before deploying code.

#### Micro-steps

1. Decide whether to reuse an existing Firebase project or create a dedicated one.
2. Record the immutable Firestore location before enabling Firestore.
3. Prefer `us-central1` for the low-cost design unless an existing Firestore
   location makes another choice operationally necessary.
4. Link a Cloud Billing account and move Firebase to Blaze.
5. Create budget alerts at low thresholds such as 1 USD, 5 USD, and 10 USD.
6. Document clearly that budget alerts do not enforce a hard spending cap.
7. Enable APIs:
   - Cloud Functions;
   - Cloud Run;
   - Cloud Build;
   - Artifact Registry;
   - Firestore;
   - Cloud Tasks;
   - Compute Engine;
   - Secret Manager;
   - IAM Service Account Credentials;
   - Cloud Logging and Monitoring.
8. Create the default Firestore database in Native mode.
9. Create the Cloud Tasks queue in the chosen function region.
10. Configure a retry policy suitable for idempotent wake requests.
11. Create the dedicated service accounts.
12. Create custom roles or minimal bindings.
13. Add the Telegram token and webhook secret to Secret Manager.
14. Verify that no service-account JSON key exists locally or in the project.
15. Export the final project/region/zone values into an operator-only setup record.

#### Validation

- A test identity can read project metadata but cannot start arbitrary unrelated VMs.
- The Cloud Tasks invoker can invoke only its intended internal function.
- Firestore client access is denied without server credentials.
- Secret values are readable only by the functions that require them.
- Billing alerts are visible and active.

#### Exit criteria

- Project foundation exists with least-privilege IAM.
- No compute VM has been created yet.
- Estimated idle cost is documented before the first paid resource is created.

### Phase 2 — Convert the repository to workspaces

#### Objective

Separate serverless and worker runtimes without duplicating domain logic.

#### Micro-steps

1. Add npm workspaces for `apps/*` and `packages/*`.
2. Create `packages/shared` and move pure domain types first.
3. Move date parsing and timezone formatting into the shared package.
4. Move Telegram callback constants into the shared package.
5. Define the job state transition function as a pure shared module.
6. Create `apps/functions` with no Codex CLI dependency.
7. Create `apps/worker` with no Telegram bot token dependency.
8. Add strict TypeScript project references or separate `tsconfig` files.
9. Add workspace-level scripts:
   - `build`;
   - `typecheck`;
   - `test`;
   - `test:emulators`;
   - `lint` if linting is introduced.
10. Ensure package builds are deterministic from a clean clone.
11. Keep the legacy local app temporarily runnable behind a clearly named script.

#### Tests

- Shared package unit tests.
- Workspace build from an empty `node_modules` directory.
- No circular dependency from shared code to Firebase or worker code.

#### Exit criteria

- Functions and worker compile independently.
- Shared package has no runtime cloud credentials.
- Existing date parser and authorization tests still pass.

### Phase 3 — Implement the Firestore repository layer

#### Objective

Replace direct SQLite assumptions with transactional Firestore repositories.

#### Micro-steps

1. Create converters for every Firestore document type.
2. Reject malformed documents at repository boundaries with Zod.
3. Implement `UserRepository`.
4. Implement `ConversationStateRepository` with revision checks and expiry.
5. Implement `JobRepository.createScheduled`.
6. Implement `JobRepository.createImmediate`.
7. Implement atomic job confirmation and operation deduplication.
8. Implement transactional cancellation.
9. Implement due-job transition from `scheduled` to `pending_wake`.
10. Implement worker claim with lease owner and lease expiry.
11. Implement completion and failure transitions.
12. Implement stale-running reconciliation without automatic rerun.
13. Implement paginated pending-job listings.
14. Implement delivery claim and delivery completion.
15. Commit required composite indexes.
16. Deny all Firestore client rules.
17. Add an emulator test harness with isolated project IDs.

#### Mandatory tests

- Duplicate confirmation creates one job.
- Duplicate Telegram update creates one operation.
- Two concurrent workers cannot claim the same job.
- Cancellation races safely with task delivery.
- Cancellation cannot overwrite `running`.
- Completion cannot overwrite `cancelled`.
- Lease expiry is handled according to the no-duplicate policy.
- User settings remain isolated.
- Draft expiry works without relying on cleanup.
- All timestamps are Firestore timestamps stored in UTC.

#### Exit criteria

- Firestore Emulator tests cover every allowed state transition.
- Repository code has no Telegram or Compute Engine calls.
- The job state machine rejects every unspecified transition.

### Phase 4 — Port Telegram UX to an HTTPS webhook function

#### Objective

Preserve the existing button experience while removing long polling.

#### Micro-steps

1. Instantiate Telegraf without calling `bot.launch()`.
2. Adapt Telegraf to the Firebase HTTPS request/response lifecycle.
3. Add webhook secret validation before Telegraf middleware.
4. Add allowlist middleware before every handler.
5. Port `/start`, `/menu`, `/schedule`, `/run_now`, `/jobs`, `/cancel`,
   `/settings`, and `/help`.
6. Port the reply keyboard and inline callback keyboards.
7. Replace in-process/SQLite draft access with Firestore repositories.
8. Add deterministic callback payload parsing and length validation.
9. Ensure every valid update is acknowledged before the function timeout.
10. Create a webhook registration script.
11. Create a webhook removal script for rollback to local long polling.
12. Configure Telegram's allowed updates explicitly.
13. Record webhook status during deployment verification.

#### Mandatory tests

- Unauthorized user is rejected before a Firestore write.
- Invalid webhook secret receives a generic non-success response.
- Preset scheduling flow matches the existing UX.
- Custom time flow matches the existing UX.
- Editing time, prompt, directory, and permission works.
- Expired buttons return an expiry message.
- Duplicate updates remain idempotent.
- Function returns promptly without waiting for Compute Engine.

#### Exit criteria

- Telegram staging bot works entirely through the Function webhook.
- No long-polling process is required to navigate menus or create a job.
- The production bot token has not yet been switched unless rollback is tested.

### Phase 5 — Implement Cloud Tasks scheduling

#### Objective

Wake the VM at the correct time without a polling scheduler.

#### Micro-steps

1. Create a deterministic task name from `jobId`.
2. Calculate `taskScheduleTime = scheduledAt - bootLeadSeconds`.
3. Clamp task time to `now` for immediate or overdue work.
4. Sign task requests with the dedicated OIDC service account.
5. Require authenticated invocation on `taskHandler`.
6. Include only `jobId` in the task body; re-read authoritative data from Firestore.
7. Treat `ALREADY_EXISTS` as success for duplicate task creation.
8. Delete the task during cancellation when possible.
9. Treat missing task deletion as success.
10. Configure bounded retries and a dead-letter operational path.
11. Record task name and wake timestamps on the job.
12. Add clock-skew and late-delivery metrics.

#### Mandatory tests

- Correct UTC schedule from each supported date format.
- Deterministic duplicate task creation.
- Cancelled job task delivery does not wake the VM.
- Completed job task replay is a no-op.
- Overdue job wakes immediately.
- OIDC validation rejects direct anonymous calls.

#### Exit criteria

- A task in the emulator/mock environment produces one state transition.
- A staging Cloud Task invokes the authenticated handler successfully.
- No scheduler interval loop remains in the serverless code.

### Phase 6 — Implement the Compute Engine wake service

#### Objective

Start exactly one known VM safely and idempotently.

#### Micro-steps

1. Wrap the official Compute Engine client in `ComputeService`.
2. Hardcode configuration to one project, zone, and instance name.
3. Read the instance status before deciding an action.
4. Define behavior for every state:
   - `TERMINATED`: start;
   - `PROVISIONING` or `STAGING`: wait/no-op;
   - `RUNNING`: no-op;
   - `STOPPING`: enqueue delayed recheck;
   - unknown state: fail visibly and do not loop aggressively.
5. Make concurrent wake calls safe.
6. Record wake request ID and Compute operation name.
7. Do not wait synchronously for the whole VM boot in the Telegram function.
8. Add structured metrics for start requests, no-ops, errors, and latency.
9. Use sanitized errors in Telegram and detailed errors only in protected logs.
10. Add a manual operator-only smoke-test script.

#### Mandatory tests

- Multiple simultaneous immediate jobs issue at most one useful start operation.
- `RUNNING` does not trigger restart.
- `STOPPING` produces one delayed recheck.
- Wrong configured instance fails closed.
- Permission denied produces a clear operator error without leaking metadata.

#### Exit criteria

- A mocked service passes all state tests.
- The staging service account starts the designated test VM and cannot modify
  unrelated resources.

### Phase 7 — Provision the Compute Engine worker VM

#### Objective

Create a persistent but normally stopped worker with controlled recurring cost.

#### Recommended initial configuration

- Region: `us-central1`.
- Zone: a capacity-available `us-central1-*` zone.
- Machine type for production trial: `e2-medium` with 4 GiB RAM.
- Cost-minimum test alternative: `e2-micro` with swap, accepting lower reliability.
- Operating system: current Ubuntu LTS.
- Boot disk: 30 GiB standard Persistent Disk where compatible with free allowance.
- External address: ephemeral only if needed for outbound connectivity.
- No static IP.
- No GPU, Local SSD, load balancer, Cloud NAT, or extra data disk.
- Attached identity: `codex-worker`.
- Deletion protection during setup, reviewed after backups exist.

#### Micro-steps

1. Create the VM using a reviewed script, not undocumented console clicks.
2. Verify the console cost estimate before confirmation.
3. Configure OS Login/IAP or the chosen restricted administration path.
4. Apply operating-system updates.
5. Install Node.js 24 LTS, npm, Git, build tools, and `bubblewrap` if supported.
6. Create the `codexworker` system user and home directory.
7. Create `/opt/telegram-codex-scheduler` for built application code.
8. Create `/srv/codex/projects` for allowed repositories.
9. Create `/etc/telegram-codex-scheduler` for root-owned configuration.
10. Clone or deploy the repository without any `.env` secret.
11. Install production dependencies and build the worker.
12. Configure a swap file if using `e2-micro` or `e2-small`.
13. Set strict file ownership and modes.
14. Install systemd worker and watchdog units.
15. Disable automatic worker restart loops that could prevent shutdown.
16. Verify journal retention and avoid prompt/output logging.
17. Stop the VM and confirm it reaches `TERMINATED`.
18. Start it through the Compute API and confirm systemd starts automatically.

#### Exit criteria

- Cold boot reaches worker-ready state without SSH intervention.
- Stop/start preserves repositories and Codex configuration.
- VM has no unexpected paid attached resources.
- Worker cannot read Secret Manager Telegram secrets.

### Phase 8 — Install and authenticate Codex on the VM

#### Objective

Authenticate Codex locally without involving Firebase.

#### Micro-steps

1. Install Codex CLI from the current official source.
2. Run all authentication as `codexworker`, the same user as systemd.
3. Use:

   ```bash
   sudo -iu codexworker codex login --device-auth
   ```

4. Complete device authentication manually in the operator's browser.
5. Verify credential storage ownership and mode.
6. Never copy the credential file into the repository or Firebase.
7. Run a manual read-only test in the default project.
8. Run a controlled workspace-write test in a disposable repository.
9. Verify `codex --version` and record it in deployment diagnostics.
10. Define the operator procedure for expired/revoked authentication.

#### Exit criteria

- `codex exec` succeeds as the systemd user after a full VM stop/start.
- No OpenAI credential appears in Firestore, Secret Manager, Telegram, Git, or logs.

### Phase 9 — Implement the worker and Codex runner

#### Objective

Execute queued jobs safely, sequentially, and observably.

#### Micro-steps

1. Generate a unique `bootId` at worker startup.
2. Publish `workerState = booting` then `ready`.
3. Reconcile stale jobs according to the no-retry policy.
4. Query the oldest eligible pending job.
5. Claim it transactionally with lease owner, expiry, and attempt count.
6. Resolve `workdirKey` through the local path map.
7. Validate directory existence, real path, and allowed roots.
8. Detect whether the directory is a Git repository.
9. Build a fixed Codex argument array.
10. Use `spawn` with `shell: false`.
11. Use read-only sandbox by default.
12. Add `--skip-git-repo-check` only for a validated non-Git directory.
13. Bound stdout and stderr independently.
14. Redact configured secret values and common credential patterns.
15. Enforce the process timeout.
16. Terminate the child process group on timeout.
17. Store a sanitized stdout preview on success.
18. Store a sanitized diagnostic tail on failure.
19. Never persist full raw output by default.
20. Update heartbeat while a job runs.
21. Mark terminal job state transactionally.
22. Continue with the next pending job before considering shutdown.

#### Mandatory tests

- Prompt is one argument and cannot inject shell syntax.
- Missing Codex binary returns a helpful error.
- Missing working directory fails before spawning.
- Symlink escape is rejected.
- Read-only and workspace-write flags are correct.
- Timeout kills descendants and marks failure.
- Output capture is bounded.
- Secret redaction covers stdout and stderr.
- Non-zero exit records diagnostic tail.
- Firestore completion failure does not falsely report success.
- Worker restart does not rerun an ambiguous `running` job.

#### Exit criteria

- Mock Codex job completes end to end from Firestore.
- Real Codex smoke job completes in a disposable repository.
- Two queued jobs execute sequentially.

### Phase 10 — Implement result delivery

#### Objective

Notify Telegram reliably without giving the VM the Telegram token.

#### Micro-steps

1. Trigger delivery from terminal job state or create an explicit delivery queue.
2. Claim a pending delivery transactionally.
3. Read the Telegram token only in the delivery function.
4. Format completion, failure, cancellation, and timeout messages.
5. Escape Telegram markup safely or use plain text.
6. Enforce Telegram message length limits.
7. Implement preview mode.
8. Implement temporary sanitized attachment mode.
9. Delete temporary files in all outcomes.
10. Classify retryable and permanent Telegram API errors.
11. Never transition execution back to pending because delivery failed.
12. Expose failed delivery in `/jobs` or an operator diagnostic command.

#### Exit criteria

- Telegram receives success and failure results from staging.
- A simulated Telegram outage does not rerun Codex.
- Worker environment contains no Telegram token.

### Phase 11 — Implement automatic shutdown and watchdogs

#### Objective

Make indefinite VM runtime structurally difficult.

#### Micro-steps

1. Implement the drain protocol defined earlier.
2. Add a systemd maximum runtime watchdog independent of application logic.
3. Default maximum boot duration to 60 minutes.
4. Emit warnings at 80% of maximum runtime.
5. Stop after timeout even if Firestore is unreachable.
6. Preserve a final local diagnostic marker before shutdown.
7. Ensure a crashed worker does not cause systemd to restart forever.
8. Limit restart attempts and hand control to the watchdog.
9. Test `shutdown -h now` transitions the VM to `TERMINATED`.
10. Test a job arriving during `STOPPING` wakes the VM after termination.
11. Add a manual emergency stop command for the operator.

#### Exit criteria

- Every tested path ends with the VM stopped or an explicit actionable alert.
- A deliberately hung worker cannot keep the VM running beyond the configured cap.

### Phase 12 — Observability and cost controls

#### Objective

Make failures and unexpected cost visible without logging sensitive prompts.

#### Micro-steps

1. Use structured logs with job IDs, statuses, durations, and error codes.
2. Do not log full prompts or full Codex output.
3. Add metrics for:
   - webhook authorization failures;
   - jobs created;
   - wake attempts;
   - VM boot latency;
   - job lateness;
   - Codex duration;
   - failures by error code;
   - Telegram delivery failures;
   - VM runtime per boot.
4. Create alerts for:
   - VM running longer than the maximum expected duration;
   - repeated worker crashes;
   - repeated wake failures;
   - task dead-letter/retry exhaustion;
   - Codex authentication failure;
   - monthly cost thresholds.
5. Configure Artifact Registry cleanup for old function images.
6. Set log retention intentionally.
7. Review disk, IP, snapshot, and function resources monthly.
8. Add a cost-estimation script using configured runtime assumptions.

#### Exit criteria

- An operator can diagnose each documented failure without reading secret data.
- A test overlong VM runtime produces an alert and forced stop.
- Billing dashboard shows only expected services.

### Phase 13 — Migration and cleanup

#### Objective

Switch production safely and remove obsolete infrastructure only after validation.

#### Micro-steps

1. Deploy functions using a separate staging Telegram bot.
2. Complete all end-to-end tests against staging.
3. Export the existing SQLite database for archival backup.
4. Decide whether pending SQLite jobs are migrated or cancelled with notice.
5. Write a one-time migration tool only if existing jobs must be preserved.
6. Freeze new jobs briefly during production webhook cutover.
7. Stop the local long-polling bot before registering the production webhook.
8. Register the production Telegram webhook.
9. Run production smoke tests with read-only Codex.
10. Run one scheduled production job.
11. Verify VM automatic shutdown.
12. Observe at least one complete cold-start cycle.
13. Keep webhook deletion and local rollback instructions ready.
14. Remove Oracle-specific deployment scripts and README sections only after the
    Google deployment is accepted.
15. Remove SQLite production dependencies after rollback window closes.
16. Update `.env.example` for local development and cloud configuration.
17. Tag the first cloud release.

#### Exit criteria

- Production Telegram bot uses webhook only.
- No production scheduler depends on the old local process.
- Google VM remains stopped when there is no work.
- Rollback procedure has been tested, not merely documented.

### Phase 14 — Public self-hosting documentation

#### Objective

Make the repository reproducible for another operator without exposing credentials.

#### Required documentation

1. Project overview and non-goals.
2. Cost model and billing warning.
3. Firebase project creation.
4. Blaze plan requirement.
5. Required API enablement.
6. Firestore location decision warning.
7. Service-account and IAM setup.
8. Secret Manager setup.
9. Telegram BotFather and webhook setup.
10. Cloud Tasks queue creation.
11. VM creation with reviewed resource choices.
12. Worker OS hardening.
13. Codex installation and `codex login --device-auth`.
14. systemd installation.
15. Deployment commands.
16. Test commands.
17. Backup and restore.
18. Cost monitoring.
19. Incident runbooks.
20. Complete teardown instructions to stop all charges.

#### Exit criteria

- A clean test project can be deployed from documentation alone.
- No step requires copying a Codex credential into Firebase.
- Teardown removes billable resources without deleting unrelated projects.

## 12. Testing strategy

### 12.1 Unit tests

- Date parsing and timezone conversion.
- State transition validation.
- Telegram callback parsing.
- Allowlist middleware.
- Secret redaction.
- Path policy.
- Codex argument construction.
- Output bounds.
- Cost-estimation calculations.

### 12.2 Firestore Emulator integration tests

- Job creation and cancellation.
- Concurrent claims.
- Duplicate webhook updates.
- Duplicate confirmations.
- Lease behavior.
- Stale running reconciliation.
- User isolation.
- Draft expiry.
- Delivery claims.
- Index-backed queries.

### 12.3 Mocked cloud-service tests

- Compute state behavior.
- Cloud Tasks creation/deletion and idempotency.
- OIDC authorization failures.
- Secret Manager access boundaries.
- Telegram retry classification.

### 12.4 VM integration tests

- systemd starts after cold boot.
- worker publishes heartbeat.
- mock Codex binary success.
- mock Codex binary failure.
- timeout and descendant termination.
- two sequential jobs.
- queue drain.
- forced watchdog shutdown.
- persistence across stop/start.

### 12.5 End-to-end staging tests

1. Unauthorized Telegram user.
2. Immediate read-only job from a stopped VM.
3. Immediate workspace-write job with warning.
4. Scheduled job from a stopped VM.
5. Cancelled scheduled job.
6. Duplicate confirmation callback.
7. Two jobs submitted while the VM is booting.
8. Job submitted while another job is running.
9. Job submitted while VM is stopping.
10. Codex binary missing.
11. Codex authentication expired.
12. Invalid workdir mapping.
13. Firestore transient failure.
14. Telegram delivery failure.
15. Worker crash after claim.
16. Worker timeout.
17. VM forced stop and later recovery.
18. Final automatic VM shutdown.

### 12.6 Required CI gates

Every merge must pass:

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run test:emulators
npm audit --omit=dev --audit-level=high
```

CI uses mocks/emulators and never requires real Telegram, OpenAI, or Google Cloud
production credentials for ordinary pull requests. Moderate advisories remain visible;
the gate fails on high or critical production advisories.

## 13. Cost model

### 13.1 Expected free or near-free services

- Cloud Functions for Firebase includes no-cost quotas for invocations, compute,
  and outbound transfer on Blaze. See [Firebase pricing](https://firebase.google.com/pricing).
- Firestore currently includes one free database with 1 GiB stored data,
  50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, and 10 GiB/month
  outbound transfer. See [Firestore pricing](https://cloud.google.com/firestore/pricing).
- Cloud Tasks currently includes the first one million operations/month free.
- Secret Manager currently has a small free allowance suitable for a few secrets.
- Compute Engine's Free Tier includes eligible `e2-micro` usage and up to 30 GB
  standard persistent disk in specified US regions. See
  [Google Cloud Free Tier](https://docs.cloud.google.com/free/docs/free-cloud-features).

Free quotas and prices can change. The deployment documentation must require a
fresh review of the official calculator before creating resources.

### 13.2 Approximate VM rates used for planning

Approximate US on-demand inputs rechecked on 19 June 2026:

| Machine | RAM | VM rate | External IPv4 while running | Approx. combined |
| --- | ---: | ---: | ---: | ---: |
| `e2-micro` | 1 GiB | Covered when eligible for Free Tier | $0.005/hour | ~$0.005/hour |
| `e2-small` | 2 GiB | ~$0.01675/hour | $0.005/hour | ~$0.02175/hour |
| `e2-medium` | 4 GiB | ~$0.03351/hour | $0.005/hour | ~$0.03851/hour |

External IPv4 pricing reference:
[VPC network pricing](https://cloud.google.com/vpc/network-pricing).

`e2-medium` compute is **not** an Always Free VM. It is billed only while running;
the ephemeral IPv4 is released and no longer billed while the VM is stopped. The
30 GiB standard disk can be covered by the Compute Engine Free Tier only when the
billing account, region, and aggregate usage remain eligible. Never infer eligibility
solely from this README—check the current Billing report and
[Google Cloud Free Tier limits](https://docs.cloud.google.com/free/docs/free-cloud-features).

### 13.3 Example monthly costs

Assuming a free-eligible 30 GB standard disk and serverless usage inside free
quotas:

| Powered-on worker time | `e2-small` estimate | `e2-medium` estimate |
| ---: | ---: | ---: |
| 5 hours/month | ~$0.11 | ~$0.19 |
| 10 hours/month | ~$0.22 | ~$0.39 |
| 30 hours/month | ~$0.65 | ~$1.16 |
| 100 hours/month | ~$2.18 | ~$3.85 |

These estimates exclude taxes, currency conversion, Codex/ChatGPT subscription
or API charges, unexpected network transfer, non-free disk choices, snapshots,
and resources created outside the blueprint.

For the deployed default, `estimate-monthly-cost.sh` reports approximately **$0.39
per month** for 10 powered-on hours, plus **$0 to $1.20** for the persistent disk
depending on Free Tier eligibility. This is a planning range, not a price guarantee.

### 13.4 Fixed-cost traps to avoid

- Static external IPv4 retained while stopped.
- Persistent disk larger than the free allowance.
- SSD or balanced disk chosen unintentionally.
- Cloud NAT running continuously.
- Load balancer.
- Cloud SQL.
- Snapshots retained indefinitely.
- Artifact Registry images without cleanup.
- Logging volume caused by prompts or streamed Codex output.
- VM watchdog failure.
- Resources created in non-eligible regions.

### 13.5 Cost-control checklist

- Budget alerts configured before VM creation.
- Ephemeral, not static, external IPv4.
- Standard 30 GB boot disk where eligible.
- Maximum VM runtime watchdog.
- Application drain shutdown.
- No automatic restart loop after terminal failure.
- Artifact cleanup policy.
- Log retention and exclusion rules.
- Monthly resource inventory.
- Teardown script tested in a disposable project.

## 14. Failure modes and required behavior

| Failure | Required behavior |
| --- | --- |
| Telegram retries update | Deduplicate; do not create a second job |
| Cloud Task retries | Re-read state; transition once |
| VM already running | Do not restart; worker picks up new job |
| VM stopping | Schedule delayed state recheck |
| VM start permission denied | Mark infrastructure error; notify operator |
| VM capacity unavailable | Keep job pending; bounded retry with visible status |
| Worker cannot reach Firestore | Retry briefly, then watchdog stops VM |
| Worker crashes before claim | Job remains pending and can be claimed later |
| Worker crashes after claim | Job becomes failed after lease/timeout; no automatic rerun |
| Codex auth expired | Fail job with operator-safe diagnostic |
| Codex timeout | Kill process tree; mark failed; continue shutdown flow |
| Telegram result delivery fails | Retry delivery only; never rerun Codex |
| New job during drain | Cancel shutdown and process it |
| New job during stopping | Delayed Cloud Task wakes after termination |
| Firestore index missing | Deployment fails acceptance; do not improvise production query |
| Secret unavailable | Fail closed; do not log secret identifier contents |
| Billing alert fires | Operator checks VM, disk, IP, logs, tasks, functions, and artifacts |

## 15. Operational runbooks

Before production acceptance, the following runbooks must exist and be exercised:

### 15.1 VM does not start

- Check job and Cloud Task state.
- Check wake function logs and IAM denial.
- Check Compute API quota and zone capacity.
- Check VM status and pending operations.
- Do not repeatedly create replacement VMs automatically.
- Move zone only through an operator-reviewed migration.

### 15.2 Worker is running but no job is claimed

- Check worker heartbeat and boot ID.
- Check Firestore query/index availability.
- Check worker service-account permissions.
- Check scheduled time and job state.
- Check lease owner and expiry.
- Stop the VM if diagnosis exceeds the runtime cap.

### 15.3 Codex authentication expired

- Stop automatic job submission if repeated failures occur.
- Start VM manually.
- Run `codex login --device-auth` as `codexworker`.
- Run a read-only smoke test.
- Stop VM and retry one failed job manually only after explicit operator action.

### 15.4 VM will not stop

- Check active child processes.
- Check systemd watchdog.
- Issue Compute Engine stop from the console or CLI.
- Mark ambiguous running jobs failed rather than requeueing.
- Investigate before enabling new wake requests.

### 15.5 Telegram bot is unresponsive

- Check webhook info with Telegram.
- Check webhook secret and Function logs.
- Check Firebase Function deployment and region.
- Check Secret Manager access.
- Use webhook deletion only as part of the documented rollback.

### 15.6 Unexpected cost

- Stop the VM immediately if running unexpectedly.
- List disks, static IPs, snapshots, NAT gateways, load balancers, function
  revisions, Artifact Registry images, and log ingestion.
- Compare billing SKUs to the blueprint.
- Remove only confirmed unwanted resources.
- Record the root cause and add a preventive test or policy.

### 15.7 Function starts then crashes for memory

- Confirm all three Gen 2 Functions have 512 MiB; the bundled Firebase/Google clients
  can exceed a 256 MiB cold-start limit.
- Keep `minInstances=0` and bound `maxInstances`; do not solve this by leaving warm
  instances permanently enabled.
- Inspect Cloud Run revision logs without printing request bodies or secrets.

### 15.8 Job completes but Telegram delivery remains pending

- Confirm the Firestore Eventarc trigger identity is `result-delivery@PROJECT_ID`.
- Confirm that identity has `roles/eventarc.eventReceiver` and `roles/run.invoker` on
  only the `deliverresult` Cloud Run service.
- Confirm it can access `TELEGRAM_BOT_TOKEN` but not the webhook secret.
- Fix IAM and allow Eventarc retry; never rerun Codex merely because notification
  delivery failed.

### 15.9 Webhook returns 403 after deployment

- Confirm Telegram's `secret_token` and Secret Manager's latest webhook-secret version
  match byte-for-byte.
- A generated secret must not contain a trailing newline. The supplied script strips
  it before upload.
- Requests without the `X-Telegram-Bot-Api-Secret-Token` header must continue to get
  `403`; do not make the function accept anonymous unsigned updates.

### 15.10 Worker finishes but VM remains running

- Inspect `telegram-codex-worker`, `telegram-codex-shutdown.path`, and
  `telegram-codex-shutdown.service` with `systemctl status`.
- Confirm `/run/telegram-codex-worker` is created by `RuntimeDirectory=` and owned by
  `codexworker`.
- Do not give Codex or the worker blanket sudo. The root path unit is the privilege
  boundary for poweroff.
- Stop the VM from Compute Engine while diagnosing so costs stay bounded.

## 16. Deployment sequence

The scripts are deliberately guarded. Every mutating script requires an explicit
new project ID and `CONFIRM_NEW_DEDICATED_PROJECT=yes`; project creation refuses an
ID that already exists. Firebase CLI calls also require an explicit account. Do not
set a global default project as a shortcut.

### 16.1 Prerequisites on the operator machine

Install:

- Git;
- Node.js 24 LTS and npm;
- Google Cloud CLI (`gcloud`);
- Firebase CLI (the project uses `npx firebase`, so a global install is optional);
- Java 21 only for Firestore Emulator tests;
- `curl`, OpenSSL, and a POSIX shell.

Then authenticate interactively with the account that will own the new project:

```bash
gcloud auth login
npx firebase login:add
gcloud auth list
npx firebase login:list
```

Authentication codes belong only in the Google/Firebase browser prompt. Never paste
them into `.env`, Telegram, GitHub, an issue, or a commit.

Clone and select the cloud branch:

```bash
git clone https://github.com/OWNER/telegram-codex-scheduler.git
cd telegram-codex-scheduler
git switch codex/google-cloud-wake-worker
npm ci
npm run typecheck
npm run build
npm test
npm run test:emulators
```

### 16.2 Create local deployment configuration

Create an ignored `.env.deployment.local` in the repository root. Choose a globally
unique project ID that has never existed, and verify the billing account yourself:

```dotenv
PROJECT_ID=replace-with-a-new-dedicated-project-id
PROJECT_NAME=Telegram Codex Scheduler
FIREBASE_ACCOUNT=you@example.com
BILLING_ACCOUNT_ID=000000-000000-000000
REGION=us-central1
FIRESTORE_LOCATION=us-central1
ZONE=us-central1-a
INSTANCE_NAME=telegram-codex-worker
CONFIRM_NEW_DEDICATED_PROJECT=yes
TELEGRAM_ALLOWED_USER_IDS=123456789
RESULTS_BUCKET=replace-with-a-new-dedicated-project-id-codex-results
```

Get your numeric Telegram ID from a trusted method and allowlist only intended users.
The file is covered by `.gitignore`; confirm with `git check-ignore` before continuing:

```bash
git check-ignore .env.deployment.local
set -a
source .env.deployment.local
set +a
```

### 16.3 Create only the dedicated project and cost guardrails

Run in this exact order:

```bash
./infra/gcloud/create-dedicated-project.sh
./infra/gcloud/enable-apis.sh
BUDGET_AMOUNT=10 ./infra/gcloud/create-budget.sh
./infra/gcloud/create-firestore.sh
./infra/gcloud/create-service-accounts.sh
./infra/gcloud/create-task-queue.sh
./infra/gcloud/create-results-bucket.sh
```

The budget amount is in the billing account's currency. A budget sends alerts; it is
not a hard spending cap. Confirm recipients and thresholds in Billing. Firestore
location cannot be casually changed later, so choose it before running the database
creation command.

The service accounts use attached identities only. Do not create or download JSON
keys. The result bucket blocks public access and deletes `result-artifacts/` objects
after one day.

### 16.4 Create the normally stopped worker VM

Review current Compute Engine and external IPv4 prices before creation. The tested
default is an `e2-medium`, Ubuntu 24.04, 30 GiB `pd-standard`, in `us-central1`:

```bash
MACHINE_TYPE=e2-medium ./infra/gcloud/create-vm.sh
```

The script creates a dedicated VPC/subnet, permits SSH only from Google's IAP range,
uses an ephemeral external IPv4, attaches the `codex-worker` identity, and enables
deletion protection. It creates no static IP, NAT gateway, load balancer, Cloud SQL,
GPU, Local SSD, or extra data disk.

### 16.5 Install the worker

SSH through IAP:

```bash
gcloud compute ssh "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --tunnel-through-iap
```

On the VM, clone a disposable bootstrap copy, then run the installer as root with
your repository and release branch:

```bash
git clone --branch codex/google-cloud-wake-worker --depth 1 \
  https://github.com/OWNER/telegram-codex-scheduler.git \
  /tmp/telegram-codex-bootstrap
sudo env \
  REPOSITORY_URL=https://github.com/OWNER/telegram-codex-scheduler.git \
  BRANCH=codex/google-cloud-wake-worker \
  bash /tmp/telegram-codex-bootstrap/infra/vm/install-worker.sh
rm -rf /tmp/telegram-codex-bootstrap
```

Copy `infra/vm/worker.env.example` to
`/etc/telegram-codex-scheduler/worker.env`, replace placeholders, then enforce:

```bash
sudo chown root:codexworker /etc/telegram-codex-scheduler/worker.env
sudo chmod 0640 /etc/telegram-codex-scheduler/worker.env
sudo chown root:codexworker /etc/telegram-codex-scheduler/workdirs.json
sudo chmod 0640 /etc/telegram-codex-scheduler/workdirs.json
```

`workdirs.json` is the only Telegram-to-filesystem mapping. Paths must be absolute,
real directories under `/srv/codex/projects`; Telegram users choose keys, never raw
server paths.

### 16.6 Authenticate Codex locally on the VM

Run authentication as the exact systemd user:

```bash
sudo -iu codexworker codex login --device-auth
sudo -iu codexworker codex login status
sudo -iu codexworker bash -lc \
  'cd /srv/codex/projects/default && codex exec --ephemeral --sandbox read-only --ask-for-approval never --skip-git-repo-check "Reply with VM_CODEX_OK only"'
```

Complete the browser step yourself. The bot never receives this code or the resulting
Codex authentication. Verify `/home/codexworker/.codex` is mode `0700` and its auth
file is `0600`. Do not upload that directory to Secret Manager, Firebase, GitHub, or
Telegram.

Enable the three boot services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable telegram-codex-worker.service
sudo systemctl enable telegram-codex-watchdog.service
sudo systemctl enable telegram-codex-shutdown.path
sudo systemctl start telegram-codex-shutdown.path
```

The worker retains `NoNewPrivileges=true`. It writes a request inside its private
`/run` directory; the root-owned shutdown path/service performs poweroff. The worker
has no sudo rule. The watchdog independently schedules a hard stop after 65 minutes.

### 16.7 Create secrets and deploy the serverless control plane

Back on the operator machine, with the deployment environment loaded:

```bash
./infra/gcloud/set-function-secrets.sh
./infra/gcloud/deploy-functions.sh
./infra/gcloud/register-webhook.sh
./infra/gcloud/verify-deployment.sh
```

`set-function-secrets.sh` asks for the BotFather token interactively and generates the
webhook secret locally without a trailing newline. The deployment uses Node.js 24,
512 MiB, min instances `0`, max instances `3`, deny-all Firestore client rules, and
least-privilege execution identities. The private task handler can be invoked only by
`cloud-tasks-invoker`; Eventarc uses `result-delivery` to invoke the result function.

Check Telegram's webhook without printing the token:

```bash
./infra/gcloud/register-webhook.sh
# Then open the bot in Telegram and run /start.
```

### 16.8 Cold-boot acceptance test

First stop the VM and wait for the terminal state:

```bash
gcloud compute instances stop "$INSTANCE_NAME" \
  --project="$PROJECT_ID" --zone="$ZONE" --quiet
gcloud compute instances describe "$INSTANCE_NAME" \
  --project="$PROJECT_ID" --zone="$ZONE" --format='value(status)'
```

The output must be `TERMINATED`. In Telegram:

1. choose **Send message now**;
2. enter `CLOUD_E2E_OK`;
3. choose the default project;
4. choose **Read-only**;
5. confirm;
6. observe the queue notification, then the exact Codex result;
7. wait through the drain grace and verify the VM returns to `TERMINATED`;
8. schedule another read-only job several minutes ahead and verify the same full cycle;
9. create then cancel a future job and verify the VM never starts for it.

Do not press confirmation twice to “help” a slow boot. Confirmation is idempotent,
but cold boot plus Codex can legitimately take several minutes.

### 16.9 Final audit and cost estimate

```bash
./infra/gcloud/verify-deployment.sh
POWERED_ON_HOURS_PER_MONTH=10 ./infra/gcloud/estimate-monthly-cost.sh
git status --short
```

Expected idle audit: VM `TERMINATED`; no reserved address; no NAT gateway; no
forwarding rule/load balancer; no Cloud SQL; 30 GiB standard disk; one-day result
lifecycle; public access prevention enabled. Re-run this audit monthly and whenever a
billing alert fires.

## 17. Rollback plan

Rollback remains possible until the local runtime is deliberately retired.

Load the dedicated deployment environment, then require the project ID a second
time so a typo cannot silently target another installation:

```bash
set -a
source .env.deployment.local
set +a
export CONFIRM_ROLLBACK_PROJECT_ID="$PROJECT_ID"
./infra/gcloud/rollback-to-local.sh
```

1. Prevent new cloud job creation.
2. Stop the worker VM.
3. Delete the Telegram webhook.
4. Restore the previous local `.env` from the operator's protected copy.
5. Start the tagged local long-polling release.
6. Reconcile jobs created in Firestore during the cloud window.
7. Never import ambiguous `running` jobs as pending.
8. Notify the operator of jobs requiring manual resubmission.
9. Leave cloud resources intact for diagnosis unless they are causing cost.
10. After diagnosis, either resume the cloud rollout or execute the teardown plan.

To resume cloud intake after reconciliation, run `register-webhook.sh` again. Never
run the local long-polling bot while the cloud webhook is still active.

## 18. Teardown plan

The project is not complete until a safe no-surprise teardown is documented.

The guarded fast path deletes the entire *dedicated* project. It intentionally
refuses to run unless the confirmation exactly matches `PROJECT_ID`:

```bash
set -a
source .env.deployment.local
set +a
export CONFIRM_DELETE_PROJECT_ID="$PROJECT_ID"
./infra/gcloud/teardown-dedicated-project.sh
```

Before entering that confirmation, export any records you are legally or
operationally required to retain. Project deletion is destructive and must never be
used if unrelated resources were placed in the project.

1. Delete Telegram webhook or redirect it to the retained deployment.
2. Stop and delete the worker VM.
3. Decide whether to retain or delete the boot disk.
4. Delete static IPs if any were accidentally created.
5. Delete Cloud Tasks queues after pending jobs are resolved.
6. Delete deployed Functions/Cloud Run revisions.
7. Apply Artifact Registry cleanup or delete the repository.
8. Delete unneeded secrets and versions.
9. Export then delete Firestore data if required.
10. Remove IAM bindings and service accounts.
11. Disable unused APIs where appropriate.
12. Verify the Billing report for several days.
13. Delete the dedicated Google Cloud project only after confirming no unrelated
    resources live in it.

## 19. Acceptance checklist

### Functional

- [x] `/start` and all menus work while VM is stopped.
- [x] Immediate job wakes a stopped VM.
- [x] Scheduled job wakes the VM at the expected time.
- [x] Custom timezone displays correctly.
- [x] Cancellation prevents execution.
- [x] Job listing is paginated.
- [x] Read-only is default.
- [x] Workspace-write requires warning and confirmation.
- [x] Result reaches Telegram.
- [x] VM stops after queue drain.

### Reliability

- [x] Duplicate updates cannot duplicate jobs.
- [x] Duplicate wake requests are harmless.
- [x] Concurrent workers cannot duplicate claims.
- [x] Stale running jobs are not rerun automatically.
- [x] Telegram delivery failure does not rerun Codex.
- [x] Job arriving during shutdown creates an idempotent delayed wake.
- [x] VM watchdog installs an independent maximum-runtime poweroff timer.

### Security

- [x] Webhook secret is validated; unsigned calls return `403`.
- [x] Telegram user allowlist is enforced first.
- [x] Firestore client rules deny all access.
- [x] No user-managed service-account keys exist.
- [x] Telegram token in the cloud runtime is a Secret Manager binding.
- [x] Codex credentials exist only on the VM under the worker user.
- [x] VM never receives Telegram token.
- [x] Function never receives Codex auth files.
- [x] Worker has no shell interpolation.
- [x] Working-directory mapping is operator-controlled.
- [x] Secret redaction and output bounds are tested.

### Cost

- [x] Blaze billing is enabled intentionally.
- [x] Budget alerts are configured.
- [x] VM machine type and region are reviewed.
- [x] Boot disk type and size are reviewed.
- [x] No static IPv4 exists.
- [x] No Cloud NAT, load balancer, Cloud SQL, GPU, or Local SSD exists.
- [x] Artifact and result cleanup policies are configured.
- [x] Idle VM state is `TERMINATED`.
- [x] Monthly cost estimate script reads the deployed VM/disk configuration.

### Documentation

- [x] Clean deployment sequence was exercised in a brand-new dedicated project.
- [x] Rollback removed the webhook/stopped intake and webhook restoration succeeded.
- [x] Teardown and rollback refuse mismatched project confirmations.
- [x] Authentication-expiry runbook includes local reauthentication and smoke checks.
- [x] Unexpected-cost inventory script was exercised against the deployment.
- [x] Public README contains no private project IDs or credentials.

The destructive final project-deletion command is intentionally not executed against
the live reference installation. Its exact-ID refusal path is tested; operators should
exercise full deletion only in a disposable project or when they truly intend teardown.

## 20. Definition of done

The migration is complete only when all of the following are true:

1. The Telegram control plane works with the worker VM fully stopped.
2. One immediate and one scheduled real Codex job pass from a cold VM.
3. Both jobs produce Telegram results.
4. The VM returns to `TERMINATED` automatically.
5. Duplicate-delivery and shutdown-race tests pass.
6. Authentication and secret boundaries are verified.
7. All unit, emulator, integration, and build checks pass.
8. Billing shows only expected resources.
9. Rollback and teardown have been exercised in staging.
10. The public documentation can reproduce the deployment in a clean project.

## 21. Optional future phase — local Codex App Server

This phase is explicitly deferred until the wake-to-run MVP is stable.

Use App Server only if the product needs persistent Codex threads, streamed item
events, steering, or richer approval UX. The safe architecture would be:

```text
worker process
   -> spawn codex app-server over stdio
   -> initialize JSON-RPC connection
   -> start/resume thread
   -> start turn
   -> consume local event stream
   -> terminate App Server before VM shutdown
```

Constraints:

- Use local `stdio`; do not expose an unauthenticated network listener.
- Pin Codex CLI version and generate matching TypeScript schemas.
- Persist only required thread identifiers and non-secret metadata.
- Define thread behavior across VM shutdowns.
- Add protocol compatibility tests before each Codex upgrade.
- Keep `codex exec` as the fallback execution mode.

## 22. Release and maintenance workflow

For each release:

1. update dependencies intentionally and review advisories;
2. run typecheck, build, 58+ unit tests, and Firestore Emulator tests on Node 24;
3. deploy Functions to the explicit dedicated project/account;
4. update the VM checkout and rebuild before the next wake;
5. run one mocked worker smoke test;
6. run one real read-only cold-boot job;
7. verify Telegram delivery and automatic `TERMINATED` state;
8. run the cost-resource audit;
9. inspect the diff for secrets and deployment-specific identifiers;
10. tag the release only after every gate is green.

Codex CLI, Firebase, Google Cloud prices, free quotas, and IAM behavior can change.
Pin and test upgrades; never assume a previous price estimate or authentication flow
is permanent.

## 23. License

[MIT](LICENSE)
