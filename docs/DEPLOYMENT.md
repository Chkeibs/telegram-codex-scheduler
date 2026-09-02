# Deployment and operations

[Back to the project overview](../README.md)

This guide retains the detailed setup and operating procedures for the self-hosted
Google Cloud deployment. Run commands in the indicated environment and replace
placeholders with your own dedicated project configuration. Run operator-side
commands from the repository root.

- [Deployment sequence](#deployment-sequence)
- [Rollback plan](#rollback-plan)
- [Teardown plan](#teardown-plan)
- [Operational runbooks](#operational-runbooks)

## Deployment sequence

The scripts are deliberately guarded. Every mutating script requires an explicit
new project ID and `CONFIRM_NEW_DEDICATED_PROJECT=yes`; project creation refuses an
ID that already exists. Firebase CLI calls also require an explicit account. Do not
set a global default project as a shortcut.

### Prerequisites on the operator machine

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

Clone the production `main` branch and validate it locally:

```bash
git clone https://github.com/Chkeibs/telegram-codex-scheduler.git
cd telegram-codex-scheduler
npm ci
npm run typecheck
npm run build
npm test
npm run test:emulators
```

### Create local deployment configuration

Create an ignored `.env.deployment.local` in the repository root. Choose a globally
unique project ID that has never existed, and verify the billing account yourself:

```dotenv
PROJECT_ID=replace-with-a-new-dedicated-project-id
PROJECT_NAME="Telegram Codex Scheduler"
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

### Create only the dedicated project and cost guardrails

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

### Create the normally stopped worker VM

Review current Compute Engine and external IPv4 prices before creation. The tested
default is an `e2-medium`, Ubuntu 24.04, 30 GiB `pd-standard`, in `us-central1`:

```bash
MACHINE_TYPE=e2-medium ./infra/gcloud/create-vm.sh
```

The script creates a dedicated VPC/subnet, permits SSH only from Google's IAP range,
uses an ephemeral external IPv4, attaches the `codex-worker` identity, and enables
deletion protection. It creates no static IP, NAT gateway, load balancer, Cloud SQL,
GPU, Local SSD, or extra data disk.

### Install the worker

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
git clone --branch main --depth 1 \
  https://github.com/Chkeibs/telegram-codex-scheduler.git \
  /tmp/telegram-codex-bootstrap
sudo env \
  REPOSITORY_URL=https://github.com/Chkeibs/telegram-codex-scheduler.git \
  BRANCH=main \
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

### Authenticate Codex locally on the VM

Run authentication as the exact systemd user:

```bash
sudo -iu codexworker codex login --device-auth
sudo -iu codexworker codex login status
sudo -iu codexworker bash -lc \
  'cd /srv/codex/projects/default && codex --ask-for-approval never exec --ephemeral --sandbox read-only --skip-git-repo-check "Reply with VM_CODEX_OK only"'
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

### Create secrets and deploy the serverless control plane

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

### Cold-boot acceptance test

First stop the VM and wait for the terminal state:

```bash
gcloud compute instances stop "$INSTANCE_NAME" \
  --project="$PROJECT_ID" --zone="$ZONE" --quiet
gcloud compute instances describe "$INSTANCE_NAME" \
  --project="$PROJECT_ID" --zone="$ZONE" --format='value(status)'
```

The output must be `TERMINATED`. In Telegram:

1. choose **Send say "hi" now**;
2. choose the default project;
3. choose **Read-only**;
4. confirm;
5. observe the queue notification, then the exact Codex result;
6. wait through the drain grace and verify the VM returns to `TERMINATED`;
7. click **Codex banked resets** and verify Telegram sends exactly one result
   with the available banked-reset count and expiry dates;
8. click **Codex usage limits** and verify the 5-hour and weekly percentages plus
   their reset times, without banked-reset details;
9. use **Schedule say "hi"** several minutes ahead and verify the same full cycle;
10. create then cancel a future job and verify the VM never starts for it.

Do not press confirmation twice to “help” a slow boot. Confirmation is idempotent,
but cold boot plus Codex can legitimately take several minutes.

### Final audit and cost estimate

```bash
./infra/gcloud/verify-deployment.sh
POWERED_ON_HOURS_PER_MONTH=10 ./infra/gcloud/estimate-monthly-cost.sh
git status --short
```

Expected idle audit: VM `TERMINATED`; no reserved address; no NAT gateway; no
forwarding rule/load balancer; no Cloud SQL; 30 GiB standard disk; one-day result
lifecycle; public access prevention enabled. Re-run this audit monthly and whenever a
billing alert fires.

## Rollback plan

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

## Teardown plan

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

## Operational runbooks

Before production acceptance, the following runbooks must exist and be exercised:

### VM does not start

- Check job and Cloud Task state.
- Check wake function logs and IAM denial.
- Check Compute API quota and zone capacity.
- Check VM status and pending operations.
- Do not repeatedly create replacement VMs automatically.
- Move zone only through an operator-reviewed migration.

### Worker is running but no job is claimed

- Check worker heartbeat and boot ID.
- Check Firestore query/index availability.
- Check worker service-account permissions.
- Check scheduled time and job state.
- Check lease owner and expiry.
- Stop the VM if diagnosis exceeds the runtime cap.

### Codex authentication expired

- Stop automatic job submission if repeated failures occur.
- Start VM manually.
- Run `codex login --device-auth` as `codexworker`.
- Run a read-only smoke test.
- Stop VM and retry one failed job manually only after explicit operator action.

### VM will not stop

- Check active child processes.
- Check systemd watchdog.
- Issue Compute Engine stop from the console or CLI.
- Mark ambiguous running jobs failed rather than requeueing.
- Investigate before enabling new wake requests.

### Telegram bot is unresponsive

- Check webhook info with Telegram.
- Check webhook secret and Function logs.
- Check Firebase Function deployment and region.
- Check Secret Manager access.
- Use webhook deletion only as part of the documented rollback.

### Unexpected cost

- Stop the VM immediately if running unexpectedly.
- List disks, static IPs, snapshots, NAT gateways, load balancers, function
  revisions, Artifact Registry images, and log ingestion.
- Compare billing SKUs to the blueprint.
- Remove only confirmed unwanted resources.
- Record the root cause and add a preventive test or policy.

### Function starts then crashes for memory

- Confirm all three Gen 2 Functions have 512 MiB; the bundled Firebase/Google clients
  can exceed a 256 MiB cold-start limit.
- Keep `minInstances=0` and bound `maxInstances`; do not solve this by leaving warm
  instances permanently enabled.
- Inspect Cloud Run revision logs without printing request bodies or secrets.

### Job completes but Telegram delivery remains pending

- Confirm the Firestore Eventarc trigger identity is `result-delivery@PROJECT_ID`.
- Confirm that identity has `roles/eventarc.eventReceiver` and `roles/run.invoker` on
  only the `deliverresult` Cloud Run service.
- Confirm it can access `TELEGRAM_BOT_TOKEN` but not the webhook secret.
- Fix IAM and allow Eventarc retry; never rerun Codex merely because notification
  delivery failed.

### Webhook returns 403 after deployment

- Confirm Telegram's `secret_token` and Secret Manager's latest webhook-secret version
  match byte-for-byte.
- A generated secret must not contain a trailing newline. The supplied script strips
  it before upload.
- Requests without the `X-Telegram-Bot-Api-Secret-Token` header must continue to get
  `403`; do not make the function accept anonymous unsigned updates.

If a banked-reset job remains in `pending_wake` while the VM stays stopped, inspect
the `taskHandler` logs for an authenticated-invocation `403`. Reapply
`infra/gcloud/configure-function-access.sh` after any manual Firebase Functions
deployment; it grants the dedicated Cloud Tasks identity `roles/run.invoker` only
on the private task-handler service. The normal `deploy-functions.sh` workflow does
this automatically.

### Worker finishes but VM remains running

- Inspect `telegram-codex-worker`, `telegram-codex-shutdown.path`, and
  `telegram-codex-shutdown.service` with `systemctl status`.
- Confirm `/run/telegram-codex-worker` is created by `RuntimeDirectory=` and owned by
  `codexworker`.
- Do not give Codex or the worker blanket sudo. The root path unit is the privilege
  boundary for poweroff.
- Stop the VM from Compute Engine while diagnosing so costs stay bounded.
