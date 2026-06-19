#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

echo "Project identity"
gcloud projects describe "$PROJECT_ID" --format='yaml(projectId,name,projectNumber,lifecycleState)'
echo "Firebase functions"
gcloud_project functions list --gen2 --regions="$REGION" --format='table(name.basename(),state,serviceConfig.uri,serviceConfig.serviceAccountEmail)'
echo "Task queue"
gcloud_project tasks queues describe "${QUEUE:-codex-wakeups}" --location="$REGION" --format='yaml(name,state,rateLimits,retryConfig)'
echo "Worker VM"
gcloud_project compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --format='yaml(name,status,machineType,disks,networkInterfaces,serviceAccounts)'
echo "Firestore rules are deployment-managed; direct client access is denied by infra/firestore.rules."
"$SCRIPT_DIR/audit-cost-resources.sh"
