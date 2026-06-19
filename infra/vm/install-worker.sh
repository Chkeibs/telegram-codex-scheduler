#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this installer as root on the dedicated worker VM." >&2
  exit 2
fi

: "${REPOSITORY_URL:?Set REPOSITORY_URL to this public GitHub repository}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="/opt/telegram-codex-scheduler"
CONFIG_DIR="/etc/telegram-codex-scheduler"
PROJECTS_DIR="/srv/codex/projects"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg git build-essential bubblewrap jq sudo

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs

if ! id codexworker >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash codexworker
fi
install -d -o codexworker -g codexworker -m 0750 "$PROJECTS_DIR"
install -d -o root -g codexworker -m 0750 "$CONFIG_DIR"
install -d -o codexworker -g codexworker -m 0700 /home/codexworker/.codex

if [[ -d "$INSTALL_DIR/.git" ]]; then
  sudo -u codexworker git -C "$INSTALL_DIR" fetch --prune origin
  sudo -u codexworker git -C "$INSTALL_DIR" checkout "$BRANCH"
  sudo -u codexworker git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
else
  rm -rf "$INSTALL_DIR"
  install -d -o codexworker -g codexworker -m 0755 "$INSTALL_DIR"
  sudo -u codexworker git clone --branch "$BRANCH" --depth 1 "$REPOSITORY_URL" "$INSTALL_DIR"
fi

sudo -u codexworker npm ci --prefix "$INSTALL_DIR"
sudo -u codexworker npm run build --prefix "$INSTALL_DIR"
sudo -u codexworker npm prune --omit=dev --prefix "$INSTALL_DIR"
npm install --global @openai/codex

install -o root -g root -m 0644 "$INSTALL_DIR/infra/systemd/telegram-codex-worker.service" /etc/systemd/system/telegram-codex-worker.service
install -o root -g root -m 0644 "$INSTALL_DIR/infra/systemd/telegram-codex-watchdog.service" /etc/systemd/system/telegram-codex-watchdog.service
install -o root -g root -m 0644 "$INSTALL_DIR/infra/systemd/telegram-codex-shutdown.path" /etc/systemd/system/telegram-codex-shutdown.path
install -o root -g root -m 0644 "$INSTALL_DIR/infra/systemd/telegram-codex-shutdown.service" /etc/systemd/system/telegram-codex-shutdown.service
rm -f /etc/sudoers.d/telegram-codex-worker

if [[ ! -f "$CONFIG_DIR/workdirs.json" ]]; then
  printf '%s\n' '{"default":"/srv/codex/projects/default"}' > "$CONFIG_DIR/workdirs.json"
  chown root:codexworker "$CONFIG_DIR/workdirs.json"
  chmod 0640 "$CONFIG_DIR/workdirs.json"
fi
install -d -o codexworker -g codexworker -m 0750 "$PROJECTS_DIR/default"

systemctl daemon-reload
systemctl disable telegram-codex-worker.service telegram-codex-watchdog.service telegram-codex-shutdown.path >/dev/null 2>&1 || true

echo "Worker software installed. Configure $CONFIG_DIR/worker.env, authenticate as codexworker, then enable the worker, watchdog, and shutdown path units."
