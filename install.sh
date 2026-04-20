#!/bin/bash
set -e

echo "======================================="
echo "        EarnBox Full Installer"
echo "======================================="

# --- AUTO-DETECT TIMEZONE ---
TZ_VALUE=$(cat /etc/timezone 2>/dev/null)

if [ -z "$TZ_VALUE" ]; then
    echo "Could not auto-detect timezone. Defaulting to America/Edmonton."
    TZ_VALUE="America/Edmonton"
fi

echo "Detected Timezone: $TZ_VALUE"
echo ""

# --- CREDENTIAL PROMPTS ---
echo "Enter your service credentials:"
echo ""

read -p "Honeygain Email: " HONEYGAIN_EMAIL
read -p "Honeygain Password: " HONEYGAIN_PASSWORD
read -p "Honeygain Device Name: " HONEYGAIN_DEVICE

echo ""

read -p "Pawns Email: " PAWNS_EMAIL
read -p "Pawns Password: " PAWNS_PASSWORD
read -p "Pawns Device Name: " PAWNS_DEVICE

echo ""

read -p "EarnApp Email: " EARNAPP_EMAIL
read -p "EarnApp Password: " EARNAPP_PASSWORD

echo ""
echo "Saving credentials..."

# --- WRITE .env FILE ---
cat <<EOF > .env
HONEYGAIN_EMAIL="$HONEYGAIN_EMAIL"
HONEYGAIN_PASSWORD="$HONEYGAIN_PASSWORD"
HONEYGAIN_DEVICE="$HONEYGAIN_DEVICE"

PAWNS_EMAIL="$PAWNS_EMAIL"
PAWNS_PASSWORD="$PAWNS_PASSWORD"
PAWNS_DEVICE="$PAWNS_DEVICE"

EARNAPP_EMAIL="$EARNAPP_EMAIL"
EARNAPP_PASSWORD="$EARNAPP_PASSWORD"

TZ="$TZ_VALUE"
EOF

echo ".env created successfully."
echo ""

# ---------------------------------------------------------
# Install Docker
# ---------------------------------------------------------
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "Docker installed."
fi

# ---------------------------------------------------------
# Install docker-compose plugin
# ---------------------------------------------------------
if ! docker compose version &> /dev/null; then
    echo "Installing docker-compose plugin..."
    sudo apt update -y
    sudo apt install -y docker-compose-plugin
fi

# ---------------------------------------------------------
# Install Node.js (backend requires it)
# ---------------------------------------------------------
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# ---------------------------------------------------------
# Enable cgroup memory (needed for RAM stats)
# ---------------------------------------------------------
echo "Enabling cgroup memory..."
if ! grep -q "cgroup_enable=memory" /boot/firmware/cmdline.txt 2>/dev/null; then
    sudo sed -i 's/$/ cgroup_enable=memory cgroup_memory=1/' /boot/firmware/cmdline.txt 2>/dev/null || \
    sudo sed -i 's/$/ cgroup_enable=memory cgroup_memory=1/' /boot/cmdline.txt
    echo "cgroups enabled. Reboot recommended."
fi

# ---------------------------------------------------------
# Build & Start Docker Stack
# ---------------------------------------------------------
echo ""
echo "Building containers..."
docker compose down || true
docker compose build --no-cache
docker compose up -d

echo ""
echo "======================================="
echo " Install Complete!"
echo " Dashboard running on: http://<your_pi_ip>"
echo "======================================="
