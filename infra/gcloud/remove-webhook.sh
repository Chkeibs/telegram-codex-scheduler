#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

TOKEN="$(gcloud_project secrets versions access latest --secret=TELEGRAM_BOT_TOKEN)"
{
  printf 'url = "https://api.telegram.org/bot%s/deleteWebhook"\n' "$TOKEN"
  printf 'request = "POST"\n'
} | curl --silent --show-error --fail --config - --data-urlencode 'drop_pending_updates=false'
printf '\nWebhook removed. Pending Telegram updates were preserved.\n'
unset TOKEN
