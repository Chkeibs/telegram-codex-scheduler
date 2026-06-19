#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
: "${FIREBASE_ACCOUNT:?Set FIREBASE_ACCOUNT explicitly}"

echo "Firebase will now ask you to paste the Telegram bot token interactively. It will not be written to this repository."
npx firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project "$PROJECT_ID" --account "$FIREBASE_ACCOUNT"
openssl rand -hex 32 | npx firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET --project "$PROJECT_ID" --account "$FIREBASE_ACCOUNT" --data-file -
echo "Function secrets created in the new dedicated project."
