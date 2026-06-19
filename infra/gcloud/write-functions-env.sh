#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/common.sh"

: "${TELEGRAM_ALLOWED_USER_IDS:?Set TELEGRAM_ALLOWED_USER_IDS to the private allowlist}"
QUEUE="${QUEUE:-codex-wakeups}"
WORKDIR_KEYS="${WORKDIR_KEYS:-default}"
DEFAULT_WORKDIR_KEY="${DEFAULT_WORKDIR_KEY:-default}"
RESULTS_BUCKET="${RESULTS_BUCKET:-$PROJECT_ID-codex-results}"
HANDLER_URL="${CLOUD_TASKS_HANDLER_URL:-https://$REGION-$PROJECT_ID.cloudfunctions.net/taskHandler}"
TARGET="$REPO_ROOT/apps/functions/.env.$PROJECT_ID"

umask 077
{
  printf 'GCP_PROJECT_ID=%s\n' "$PROJECT_ID"
  printf 'GCP_REGION=%s\n' "$REGION"
  printf 'GCP_ZONE=%s\n' "$ZONE"
  printf 'GCE_INSTANCE_NAME=%s\n' "$INSTANCE_NAME"
  printf 'RESULTS_BUCKET=%s\n' "$RESULTS_BUCKET"
  printf 'CLOUD_TASKS_LOCATION=%s\n' "$REGION"
  printf 'CLOUD_TASKS_QUEUE=%s\n' "$QUEUE"
  printf 'CLOUD_TASKS_HANDLER_URL=%s\n' "$HANDLER_URL"
  printf 'CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT=cloud-tasks-invoker@%s.iam.gserviceaccount.com\n' "$PROJECT_ID"
  printf 'TELEGRAM_ALLOWED_USER_IDS=%s\n' "$TELEGRAM_ALLOWED_USER_IDS"
  printf 'TELEGRAM_FUNCTION_SERVICE_ACCOUNT=telegram-webhook@%s.iam.gserviceaccount.com\n' "$PROJECT_ID"
  printf 'WAKE_FUNCTION_SERVICE_ACCOUNT=wake-worker@%s.iam.gserviceaccount.com\n' "$PROJECT_ID"
  printf 'DELIVERY_FUNCTION_SERVICE_ACCOUNT=result-delivery@%s.iam.gserviceaccount.com\n' "$PROJECT_ID"
  printf 'DEFAULT_TIMEZONE=%s\n' "${DEFAULT_TIMEZONE:-Europe/Paris}"
  printf 'DEFAULT_WORKDIR_KEY=%s\n' "$DEFAULT_WORKDIR_KEY"
  printf 'WORKDIR_KEYS=%s\n' "$WORKDIR_KEYS"
  printf 'BOOT_LEAD_SECONDS=%s\n' "${BOOT_LEAD_SECONDS:-90}"
  printf 'CONVERSATION_TTL_MINUTES=%s\n' "${CONVERSATION_TTL_MINUTES:-30}"
  printf 'MAX_TELEGRAM_OUTPUT_CHARS=%s\n' "${MAX_TELEGRAM_OUTPUT_CHARS:-3500}"
  printf 'WAKE_RETRY_DELAY_SECONDS=%s\n' "${WAKE_RETRY_DELAY_SECONDS:-60}"
} > "$TARGET"

echo "Wrote ignored Firebase runtime configuration: $TARGET"
