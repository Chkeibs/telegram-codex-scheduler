#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to the NEW dedicated project ID}"
: "${CONFIRM_NEW_DEDICATED_PROJECT:?Set CONFIRM_NEW_DEDICATED_PROJECT=yes}"

if [[ "$CONFIRM_NEW_DEDICATED_PROJECT" != "yes" ]]; then
  echo "Refusing to continue: CONFIRM_NEW_DEDICATED_PROJECT must equal yes" >&2
  exit 2
fi

if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{5,29}$ ]]; then
  echo "Invalid Google Cloud project ID: $PROJECT_ID" >&2
  exit 2
fi

REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
INSTANCE_NAME="${INSTANCE_NAME:-telegram-codex-worker}"

gcloud_project() {
  gcloud "$@" --project="$PROJECT_ID"
}
