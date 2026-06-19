#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

echo "Project identity"
gcloud projects describe "$PROJECT_ID" --format='yaml(projectId,name,projectNumber,lifecycleState)'
echo "Firebase functions"
gcloud_project functions list --v2 --regions="$REGION" --format='table(name.basename(),state,serviceConfig.uri,serviceConfig.serviceAccountEmail)'
echo "Task queue"
gcloud_project tasks queues describe "${QUEUE:-codex-wakeups}" --location="$REGION" --format='yaml(name,state,rateLimits,retryConfig)'
echo "Worker VM"
gcloud_project compute instances describe "$INSTANCE_NAME" --zone="$ZONE" \
  --format='table(name,status,machineType.basename():label=MACHINE_TYPE,disks[0].diskSizeGb:label=DISK_GB,networkInterfaces[0].networkIP:label=INTERNAL_IP,networkInterfaces[0].accessConfigs[0].natIP:label=EPHEMERAL_IP,serviceAccounts[0].email:label=SERVICE_ACCOUNT)'
echo "Firestore rules are deployment-managed; direct client access is denied by infra/firestore.rules."
"$SCRIPT_DIR/audit-cost-resources.sh"
