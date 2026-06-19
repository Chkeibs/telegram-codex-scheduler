#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

RESULTS_BUCKET="${RESULTS_BUCKET:-$PROJECT_ID-codex-results}"
if gcloud storage buckets describe "gs://$RESULTS_BUCKET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Results bucket already exists: gs://$RESULTS_BUCKET"
else
  gcloud storage buckets create "gs://$RESULTS_BUCKET" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi
gcloud storage buckets update "gs://$RESULTS_BUCKET" \
  --project="$PROJECT_ID" \
  --lifecycle-file="$SCRIPT_DIR/result-lifecycle.json"

gcloud storage buckets add-iam-policy-binding "gs://$RESULTS_BUCKET" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:codex-worker@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$RESULTS_BUCKET" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:result-delivery@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin" >/dev/null

echo "Configured private temporary result bucket gs://$RESULTS_BUCKET with a one-day cleanup lifecycle."
