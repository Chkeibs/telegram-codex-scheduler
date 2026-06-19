#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

FUNCTION_NAME="${FUNCTION_NAME:-telegramWebhook}"
URL="$(gcloud_project functions describe "$FUNCTION_NAME" --gen2 --region="$REGION" --format='value(serviceConfig.uri)')"
TOKEN="$(gcloud_project secrets versions access latest --secret=TELEGRAM_BOT_TOKEN)"
SECRET="$(gcloud_project secrets versions access latest --secret=TELEGRAM_WEBHOOK_SECRET)"

{
  printf 'url = "https://api.telegram.org/bot%s/setWebhook"\n' "$TOKEN"
  printf 'request = "POST"\n'
} | curl --silent --show-error --fail --config - \
  --data-urlencode "url=$URL" \
  --data-urlencode "secret_token=$SECRET" \
  --data-urlencode 'allowed_updates=["message","callback_query"]' \
  --data-urlencode 'drop_pending_updates=false'
printf '\nWebhook registered for %s\n' "$URL"
unset TOKEN SECRET
