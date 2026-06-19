#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

gcloud_project secrets add-iam-policy-binding TELEGRAM_BOT_TOKEN \
  --member="serviceAccount:telegram-webhook@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" >/dev/null
gcloud_project secrets add-iam-policy-binding TELEGRAM_WEBHOOK_SECRET \
  --member="serviceAccount:telegram-webhook@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" >/dev/null
gcloud_project secrets add-iam-policy-binding TELEGRAM_BOT_TOKEN \
  --member="serviceAccount:result-delivery@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

echo "Granted each function identity access only to the Telegram secret(s) it needs."
