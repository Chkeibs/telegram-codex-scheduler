#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

: "${BILLING_ACCOUNT_ID:?Set BILLING_ACCOUNT_ID}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-10}"

gcloud billing budgets create \
  --billing-project="$PROJECT_ID" \
  --billing-account="$BILLING_ACCOUNT_ID" \
  --display-name="Telegram Codex Scheduler - $PROJECT_ID" \
  --budget-amount="$BUDGET_AMOUNT" \
  --filter-projects="projects/$PROJECT_ID" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0

echo "Budget created. Confirm that billing-account administrators receive notifications. Budgets alert; they do not cap spending."
