#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

: "${BILLING_ACCOUNT_ID:?Set BILLING_ACCOUNT_ID after reviewing the billing account yourself}"
: "${FIREBASE_ACCOUNT:?Set FIREBASE_ACCOUNT to the Google account dedicated to this new project}"
PROJECT_NAME="${PROJECT_NAME:-Telegram Codex Scheduler}"

if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Refusing to use an existing project. Choose a brand-new PROJECT_ID." >&2
  exit 3
fi

gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"
npx firebase projects:addfirebase "$PROJECT_ID" --account "$FIREBASE_ACCOUNT"

echo "Created new dedicated Firebase/Google Cloud project: $PROJECT_ID"
