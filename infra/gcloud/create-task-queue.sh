#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

QUEUE="${QUEUE:-codex-wakeups}"
if gcloud_project tasks queues describe "$QUEUE" --location="$REGION" >/dev/null 2>&1; then
  echo "Queue already exists: $QUEUE"
else
  gcloud_project tasks queues create "$QUEUE" \
    --location="$REGION" \
    --max-attempts=5 \
    --max-retry-duration=1800s \
    --min-backoff=10s \
    --max-backoff=300s \
    --max-concurrent-dispatches=5
fi
