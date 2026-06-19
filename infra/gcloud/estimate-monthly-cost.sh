#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

POWERED_ON_HOURS_PER_MONTH="${POWERED_ON_HOURS_PER_MONTH:-10}"
IPV4_HOURLY_USD="${IPV4_HOURLY_USD:-0.005}"
PD_STANDARD_GB_MONTH_USD="${PD_STANDARD_GB_MONTH_USD:-0.04}"

MACHINE_TYPE="$(gcloud_project compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --format='value(machineType.basename())')"
DISK_NAME="$(gcloud_project compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --format='value(disks[0].source.basename())')"
DISK_SIZE_GB="$(gcloud_project compute disks describe "$DISK_NAME" --zone="$ZONE" --format='value(sizeGb)')"
DISK_TYPE="$(gcloud_project compute disks describe "$DISK_NAME" --zone="$ZONE" --format='value(type.basename())')"

case "$MACHINE_TYPE" in
  e2-micro) DEFAULT_VM_RATE="0" ;;
  e2-small) DEFAULT_VM_RATE="0.01675" ;;
  e2-medium) DEFAULT_VM_RATE="0.03351" ;;
  *) DEFAULT_VM_RATE="" ;;
esac
VM_HOURLY_USD="${VM_HOURLY_USD:-$DEFAULT_VM_RATE}"
if [[ -z "$VM_HOURLY_USD" ]]; then
  echo "Set VM_HOURLY_USD after checking the current official price for $MACHINE_TYPE." >&2
  exit 2
fi

runtime_cost="$(awk -v h="$POWERED_ON_HOURS_PER_MONTH" -v vm="$VM_HOURLY_USD" -v ip="$IPV4_HOURLY_USD" 'BEGIN { printf "%.2f", h * (vm + ip) }')"
disk_cost="$(awk -v gb="$DISK_SIZE_GB" -v rate="$PD_STANDARD_GB_MONTH_USD" 'BEGIN { printf "%.2f", gb * rate }')"
upper_total="$(awk -v runtime="$runtime_cost" -v disk="$disk_cost" 'BEGIN { printf "%.2f", runtime + disk }')"

echo "Deployed worker: $MACHINE_TYPE, $DISK_SIZE_GB GiB $DISK_TYPE"
echo "Assumed powered-on time: $POWERED_ON_HOURS_PER_MONTH hours/month"
echo "Runtime + ephemeral IPv4 estimate: USD $runtime_cost/month"
echo "Persistent disk estimate if not covered by Free Tier: USD $disk_cost/month"
echo "Estimated range before taxes, transfer, logs and Codex usage: USD $runtime_cost–$upper_total/month"
echo "Rates are planning inputs, not a quote. Re-check Google Cloud Pricing and Billing before relying on them."
