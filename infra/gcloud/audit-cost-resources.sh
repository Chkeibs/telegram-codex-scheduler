#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

echo "Compute instances"
gcloud_project compute instances list --format='table(name,zone.basename(),status,machineType.basename(),networkInterfaces[0].accessConfigs[0].natIP)'
echo "Persistent disks"
gcloud_project compute disks list --format='table(name,zone.basename(),sizeGb,type.basename(),status)'
echo "Reserved external IP addresses (must be empty)"
gcloud_project compute addresses list --format='table(name,region.basename(),address,status)'
echo "Cloud NAT gateways (must be empty)"
gcloud_project compute routers list --format='table(name,region.basename(),network.basename())'
echo "Load balancer forwarding rules (must be empty)"
gcloud_project compute forwarding-rules list --format='table(name,region.basename(),IPAddress,target.basename())'
echo "Cloud SQL instances (must be empty)"
gcloud_project sql instances list --format='table(name,region,databaseVersion,state)' 2>/dev/null || true
echo "Result bucket lifecycle"
gcloud storage buckets describe "gs://${RESULTS_BUCKET:-$PROJECT_ID-codex-results}" --project="$PROJECT_ID" --format='yaml(name,location,storageClass,public_access_prevention,uniform_bucket_level_access,lifecycle_config)'
