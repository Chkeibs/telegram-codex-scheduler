#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
: "${CONFIRM_DELETE_PROJECT_ID:?Set CONFIRM_DELETE_PROJECT_ID to the exact dedicated PROJECT_ID}"

if [[ "$CONFIRM_DELETE_PROJECT_ID" != "$PROJECT_ID" ]]; then
  echo "Refusing teardown: exact project confirmation does not match." >&2
  exit 3
fi

echo "Final inventory before deleting only the dedicated project $PROJECT_ID:"
"$SCRIPT_DIR/audit-cost-resources.sh"
gcloud projects delete "$PROJECT_ID" --quiet
echo "Deletion requested for $PROJECT_ID. Verify Billing until the project reaches DELETE_REQUESTED and retained charges settle."
