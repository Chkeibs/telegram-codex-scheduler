#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/common.sh"
: "${TELEGRAM_ALLOWED_USER_IDS:?Set TELEGRAM_ALLOWED_USER_IDS}"
: "${FIREBASE_ACCOUNT:?Set FIREBASE_ACCOUNT explicitly}"

cd "$REPO_ROOT"
"$SCRIPT_DIR/write-functions-env.sh"
"$SCRIPT_DIR/grant-secret-access.sh"
npm run typecheck
npm test
npm run build
npx firebase deploy --project "$PROJECT_ID" --account "$FIREBASE_ACCOUNT" --only functions:telegram-codex-control:taskHandler

HANDLER_URL="$(gcloud_project functions describe taskHandler --gen2 --region="$REGION" --format='value(serviceConfig.uri)')"
CLOUD_TASKS_HANDLER_URL="$HANDLER_URL" "$SCRIPT_DIR/write-functions-env.sh"
npx firebase deploy --project "$PROJECT_ID" --account "$FIREBASE_ACCOUNT" --only firestore,functions --force
"$SCRIPT_DIR/configure-function-access.sh"

echo "Functions and Firestore deployed to the explicit dedicated project $PROJECT_ID. Register the Telegram webhook only after smoke checks pass."
