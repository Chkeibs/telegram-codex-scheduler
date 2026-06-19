#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-nam5}"
if gcloud_project firestore databases describe --database='(default)' >/dev/null 2>&1; then
  echo "Firestore default database already exists."
else
  gcloud_project firestore databases create \
    --database='(default)' \
    --location="$FIRESTORE_LOCATION" \
    --type=firestore-native \
    --delete-protection
fi
