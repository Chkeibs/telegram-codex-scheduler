#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

NETWORK="${NETWORK:-telegram-codex-network}"
SUBNET="${SUBNET:-telegram-codex-subnet}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-medium}"

if ! gcloud_project compute networks describe "$NETWORK" >/dev/null 2>&1; then
  gcloud_project compute networks create "$NETWORK" --subnet-mode=custom
fi
if ! gcloud_project compute networks subnets describe "$SUBNET" --region="$REGION" >/dev/null 2>&1; then
  gcloud_project compute networks subnets create "$SUBNET" --network="$NETWORK" --region="$REGION" --range=10.10.0.0/24
fi
if ! gcloud_project compute firewall-rules describe telegram-codex-allow-iap-ssh >/dev/null 2>&1; then
  gcloud_project compute firewall-rules create telegram-codex-allow-iap-ssh \
    --network="$NETWORK" \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:22 \
    --source-ranges=35.235.240.0/20 \
    --target-tags=telegram-codex-worker
fi

if gcloud_project compute instances describe "$INSTANCE_NAME" --zone="$ZONE" >/dev/null 2>&1; then
  echo "Refusing to replace existing instance: $INSTANCE_NAME" >&2
  exit 3
fi

gcloud_project compute instances create "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --network-interface="network=$NETWORK,subnet=$SUBNET,network-tier=STANDARD" \
  --maintenance-policy=MIGRATE \
  --provisioning-model=STANDARD \
  --service-account="codex-worker@$PROJECT_ID.iam.gserviceaccount.com" \
  --scopes=cloud-platform \
  --tags=telegram-codex-worker \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-type=pd-standard \
  --boot-disk-size=30GB \
  --boot-disk-device-name="$INSTANCE_NAME" \
  --metadata=enable-oslogin=TRUE \
  --deletion-protection

echo "Created $INSTANCE_NAME. Review its billing estimate and stop it after provisioning."
