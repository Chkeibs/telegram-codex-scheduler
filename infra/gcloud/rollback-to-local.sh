#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
: "${CONFIRM_ROLLBACK_PROJECT_ID:?Set CONFIRM_ROLLBACK_PROJECT_ID to the dedicated PROJECT_ID}"

if [[ "$CONFIRM_ROLLBACK_PROJECT_ID" != "$PROJECT_ID" ]]; then
  echo "Refusing rollback: project confirmation does not match." >&2
  exit 3
fi

"$SCRIPT_DIR/remove-webhook.sh"
status="$(gcloud_project compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --format='value(status)' 2>/dev/null || true)"
if [[ -n "$status" && "$status" != "TERMINATED" ]]; then
  gcloud_project compute instances stop "$INSTANCE_NAME" --zone="$ZONE" --quiet
fi

echo "Cloud intake is disabled and the worker is stopped. Start the tagged local long-polling release only after reconciling non-terminal Firestore jobs."
