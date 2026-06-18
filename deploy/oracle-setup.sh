#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Oracle Cloud Free Tier Setup Script
# For: Telegram Codex Scheduler Bot
# Target: Ubuntu 22.04/24.04 on ARM64 (Ampere A1) or x86_64 (AMD)
# =============================================================================
#
# BEFORE RUNNING THIS SCRIPT:
#
# 1. Create an Oracle Cloud account at https://cloud.oracle.com
# 2. IMPORTANT: Upgrade to Pay-As-You-Go (still free, but gives you priority)
#    - Go to: Billing & Cost Management > Upgrade and Manage Payment
#    - Add a payment method and upgrade
#    - Set a budget alert at $0: Billing > Budgets > Create Budget
# 3. Create a VM:
#    - Shape: VM.Standard.A1.Flex (ARM) or VM.Standard.E2.1.Micro (AMD x86)
#    - OS: Ubuntu 22.04 or 24.04
#    - 1 OCPU, 2-4 GB RAM, 50 GB boot volume
#    - Add your SSH public key
#    - VERIFY the "Always Free" label before clicking Create
# 4. SSH into the VM:
#    ssh -i ~/.ssh/your_key ubuntu@<public-ip>
# 5. Run this script:
#    bash deploy/oracle-setup.sh
#
# =============================================================================

echo "============================================"
echo " Telegram Codex Scheduler - Oracle Setup"
echo "============================================"
echo ""

ARCH=$(uname -m)
echo "Detected architecture: $ARCH"

# -- Step 1: System updates and required packages --
echo ""
echo "[1/8] Updating system and installing dependencies..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential bubblewrap

# -- Step 2: Install Node.js 24 via NodeSource --
echo ""
echo "[2/8] Installing Node.js 24 LTS..."
if command -v node &>/dev/null && [[ "$(node -v)" == v24* ]]; then
    echo "Node.js 24 already installed: $(node -v)"
else
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# -- Step 3: Install Codex CLI --
echo ""
echo "[3/8] Installing Codex CLI..."
if command -v codex &>/dev/null; then
    echo "Codex CLI already installed: $(codex --version 2>&1 || echo 'installed')"
else
    if [ "$ARCH" = "aarch64" ]; then
        echo "Downloading ARM64 binary..."
        curl -fL -o /tmp/codex.tar.gz https://github.com/openai/codex/releases/latest/download/codex-aarch64-unknown-linux-musl.tar.gz
        tar -xzf /tmp/codex.tar.gz -C /tmp/
        sudo install -m 0755 /tmp/codex-aarch64-unknown-linux-musl /usr/local/bin/codex
        rm -f /tmp/codex.tar.gz /tmp/codex-aarch64-unknown-linux-musl
    elif [ "$ARCH" = "x86_64" ]; then
        echo "Downloading x86_64 binary..."
        curl -fL -o /tmp/codex.tar.gz https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-musl.tar.gz
        tar -xzf /tmp/codex.tar.gz -C /tmp/
        sudo install -m 0755 /tmp/codex-x86_64-unknown-linux-musl /usr/local/bin/codex
        rm -f /tmp/codex.tar.gz /tmp/codex-x86_64-unknown-linux-musl
    else
        echo "Unsupported architecture: $ARCH"
        echo "Try: npm install -g @openai/codex"
        exit 1
    fi
fi
echo "Codex CLI: $(codex --version 2>&1 || echo 'binary installed')"

# -- Step 4: Create a dedicated service user --
echo ""
echo "[4/8] Creating service user 'codexbot'..."
if id codexbot &>/dev/null; then
    echo "User 'codexbot' already exists."
else
    sudo useradd -r -m -s /bin/bash codexbot
    echo "Created user 'codexbot'."
fi

# -- Step 5: Clone the repository --
echo ""
echo "[5/8] Setting up the project..."
PROJECT_DIR="/opt/telegram-codex-scheduler"
if [ -d "$PROJECT_DIR" ]; then
    echo "Project directory already exists at $PROJECT_DIR"
    echo "Pulling latest changes..."
    sudo -u codexbot git -C "$PROJECT_DIR" pull 2>/dev/null || echo "Pull skipped (not a git remote or no changes)."
else
    echo ""
    echo "============================================"
    echo " You need to get the code to $PROJECT_DIR"
    echo "============================================"
    echo ""
    echo "Option A - Clone from GitHub:"
    echo "  sudo mkdir -p $PROJECT_DIR"
    echo "  sudo chown codexbot:codexbot $PROJECT_DIR"
    echo "  sudo -u codexbot git clone https://github.com/YOUR_USERNAME/telegram-codex-scheduler.git $PROJECT_DIR"
    echo ""
    echo "Option B - Copy from your local machine:"
    echo "  scp -r ./Bot\\ codex/* ubuntu@<server-ip>:/tmp/bot-code/"
    echo "  sudo mkdir -p $PROJECT_DIR"
    echo "  sudo cp -r /tmp/bot-code/* $PROJECT_DIR/"
    echo "  sudo chown -R codexbot:codexbot $PROJECT_DIR"
    echo ""
    echo "After copying, re-run this script to continue."
    echo ""
    read -p "Has the code been placed at $PROJECT_DIR? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Place the code first, then re-run this script."
        exit 0
    fi
fi

# -- Step 6: Install npm dependencies and build --
echo ""
echo "[6/8] Installing dependencies and building..."
cd "$PROJECT_DIR"
sudo chown -R codexbot:codexbot "$PROJECT_DIR"
sudo -u codexbot npm install
sudo -u codexbot npm run build

# -- Step 7: Configure .env --
echo ""
echo "[7/8] Configuring environment..."
ENV_FILE="$PROJECT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo ".env already exists. Review it manually if needed."
else
    sudo -u codexbot cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    sudo chmod 600 "$ENV_FILE"
    echo ""
    echo "============================================"
    echo " CONFIGURE YOUR .env FILE"
    echo "============================================"
    echo ""
    echo "Edit the file:"
    echo "  sudo -u codexbot nano $ENV_FILE"
    echo ""
    echo "You MUST set:"
    echo "  TELEGRAM_BOT_TOKEN=<from BotFather>"
    echo "  ALLOWED_TELEGRAM_USER_IDS=<your numeric Telegram user ID>"
    echo "  DEFAULT_WORKDIR=$PROJECT_DIR"
    echo "  ALLOWED_WORKDIR_ROOTS=$PROJECT_DIR"
    echo ""
fi

# Create project workdir for Codex if needed
WORKDIR="$PROJECT_DIR"
sudo -u codexbot mkdir -p "$WORKDIR/data"

# -- Step 8: Install systemd service --
echo ""
echo "[8/8] Setting up systemd service..."
SERVICE_FILE="/etc/systemd/system/telegram-codex-scheduler.service"
if [ -f "$SERVICE_FILE" ]; then
    echo "Service file already exists."
else
    sudo cp "$PROJECT_DIR/deploy/systemd/telegram-codex-scheduler.service.example" "$SERVICE_FILE"
    NODE_PATH=$(which node)
    sudo sed -i "s|/usr/bin/node|$NODE_PATH|g" "$SERVICE_FILE"
    sudo systemctl daemon-reload
    echo "Systemd service installed."
fi

echo ""
echo "============================================"
echo " SETUP COMPLETE - REMAINING MANUAL STEPS"
echo "============================================"
echo ""
echo "1. Log in to Codex as the service user:"
echo "   sudo -u codexbot codex login --device-auth"
echo ""
echo "2. Test Codex works:"
echo "   sudo -u codexbot codex --ask-for-approval never exec --sandbox read-only 'echo hello'"
echo ""
echo "3. Edit .env with your Telegram bot token and user ID:"
echo "   sudo -u codexbot nano $PROJECT_DIR/.env"
echo ""
echo "4. Test the bot manually first:"
echo "   cd $PROJECT_DIR && sudo -u codexbot node dist/src/index.js"
echo ""
echo "5. If it works, enable the systemd service:"
echo "   sudo systemctl enable --now telegram-codex-scheduler"
echo "   sudo systemctl status telegram-codex-scheduler"
echo "   sudo journalctl -u telegram-codex-scheduler -f"
echo ""
echo "6. Set up a budget alert in Oracle Cloud Console:"
echo "   Billing > Budgets > Create Budget > Set amount to 0"
echo ""
