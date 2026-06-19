#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

create_account() {
  local name="$1" display="$2"
  if ! gcloud_project iam service-accounts describe "$name@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud_project iam service-accounts create "$name" --display-name="$display"
  fi
}

create_account telegram-webhook "Telegram Codex webhook"
create_account wake-worker "Telegram Codex VM wake controller"
create_account cloud-tasks-invoker "Telegram Codex Cloud Tasks invoker"
create_account codex-worker "Telegram Codex VM worker"
create_account result-delivery "Telegram Codex result delivery"

gcloud_project projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:telegram-webhook@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user" >/dev/null
gcloud_project projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:telegram-webhook@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer" >/dev/null
gcloud_project projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:wake-worker@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user" >/dev/null
gcloud_project projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:wake-worker@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer" >/dev/null
gcloud_project projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:codex-worker@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user" >/dev/null
gcloud_project projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:result-delivery@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user" >/dev/null

ROLE_ID="codexWorkerWake"
if ! gcloud_project iam roles describe "$ROLE_ID" >/dev/null 2>&1; then
  gcloud_project iam roles create "$ROLE_ID" \
    --title="Start dedicated Codex worker" \
    --description="Read and start the dedicated worker VM; project is isolated to this bot" \
    --permissions="compute.instances.get,compute.instances.start,compute.zoneOperations.get" \
    --stage=GA
fi
gcloud_project projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:wake-worker@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="projects/$PROJECT_ID/roles/$ROLE_ID" >/dev/null

for caller in telegram-webhook wake-worker; do
  gcloud_project iam service-accounts add-iam-policy-binding \
    "cloud-tasks-invoker@$PROJECT_ID.iam.gserviceaccount.com" \
    --member="serviceAccount:$caller@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser" >/dev/null
done

echo "Service accounts created without downloadable keys."
