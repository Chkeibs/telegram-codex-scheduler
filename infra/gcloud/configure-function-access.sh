#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

TASK_HANDLER_SERVICE="${TASK_HANDLER_SERVICE:-taskhandler}"
DELIVERY_SERVICE="${DELIVERY_SERVICE:-deliverresult}"

gcloud_project run services add-iam-policy-binding "$TASK_HANDLER_SERVICE" \
  --region="$REGION" \
  --member="serviceAccount:cloud-tasks-invoker@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" >/dev/null

echo "Cloud Tasks invoker may invoke only the private task handler service."

gcloud_project run services add-iam-policy-binding "$DELIVERY_SERVICE" \
  --region="$REGION" \
  --member="serviceAccount:result-delivery@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" >/dev/null

echo "Eventarc delivery identity may invoke only the result delivery service."
