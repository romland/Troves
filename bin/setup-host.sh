#!/usr/bin/env bash
set -e

# Setup color formatting for feedback
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
BLUE="\033[0;34m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

info()    { echo -e "\n${BLUE}${BOLD}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $1"; }
warn()    { echo -e "${YELLOW}${BOLD}[WARNING]${NC} $1"; }
error()   { echo -e "${RED}${BOLD}[ERROR]${NC} $1"; }

# ------------------------------------------------------------------------------
# 0. Reconnaissance & OS Detection
# ------------------------------------------------------------------------------
SKIP_PROMPT=false
USE_DOCKER=""

for arg in "$@"; do
    case $arg in
        -y|--yes) SKIP_PROMPT=true ;;
        --docker) USE_DOCKER=true ;;
        --native) USE_DOCKER=false ;;
    esac
done

ARCH=$(uname -m)
USERLAND_ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
KERNEL_VER=$(uname -r)

# Fast-bail for Synology DSM: point directly to Container Manager UI
if [ -f /etc/synoinfo.conf ]; then
    info "Synology DSM detected!"
    echo "Troves runs containerized via DSM Container Manager."
    echo ""
    echo "Quick setup via DSM web interface:"
    echo "  1. Download the production compose file:"
    echo "     https://raw.githubusercontent.com/romland/troves/main/docker-compose.yml"
    echo "  2. Open DSM -> Container Manager -> Project -> Create"
    echo "  3. Select 'Create docker-compose.yml' and load the file"
    echo "  4. Set your API keys in the environment settings and click 'Done'"
    exit 0
fi

OS_NAME=$(grep -E '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "Linux (Generic)")

echo -e "${CYAN}${BOLD}"
echo "========================================="
echo "        SYSTEM RECONNAISSANCE            "
echo "========================================="
echo -e "${NC}"
echo -e "  ${BOLD}Host OS${NC}          : $OS_NAME"
echo -e "  ${BOLD}Kernel${NC}           : $KERNEL_VER ($ARCH)"
echo -e "  ${BOLD}Userland Arch${NC}    : $USERLAND_ARCH"

TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo "Unknown")
TOTAL_SWAP_MB=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo "Unknown")
echo -e "  ${BOLD}Memory & Swap${NC}    : ${TOTAL_RAM_MB}MB RAM / ${TOTAL_SWAP_MB}MB Swap"

# Detect Docker Compose
COMPOSE_CMD=""
if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
fi

COMPOSE_VERSION="NOT FOUND"
if [ -n "$COMPOSE_CMD" ]; then
    COMPOSE_VERSION=$($COMPOSE_CMD version 2>/dev/null | head -n1 || echo "Found ($COMPOSE_CMD)")
fi

# Tool inventory
echo ""
echo -e "  ${BOLD}--- Detected Toolchain ---${NC}"
echo -e "  Docker           : $(command -v docker &>/dev/null && docker --version 2>/dev/null || echo 'NOT FOUND')"
echo -e "  Docker Compose   : $COMPOSE_VERSION"
echo -e "  FFmpeg           : $(command -v ffmpeg &>/dev/null && ffmpeg -version 2>/dev/null | head -n1 || echo 'NOT FOUND')"
echo -e "  pdftoppm         : $(command -v pdftoppm &>/dev/null && echo 'Available' || echo 'NOT FOUND')"
echo -e "  yt-dlp           : $(command -v yt-dlp &>/dev/null && yt-dlp --version 2>/dev/null || echo 'NOT FOUND')"
echo -e "  Node.js          : $(command -v node &>/dev/null && node -v 2>/dev/null || echo 'NOT FOUND')"
echo -e "  SQLite3          : $(command -v sqlite3 &>/dev/null && sqlite3 --version | awk '{print $1}' || echo 'NOT FOUND')"
echo ""
echo -e "${CYAN}=========================================${NC}\n"

# ------------------------------------------------------------------------------
# Interactive deployment mode selection
# ------------------------------------------------------------------------------
if [ -z "$USE_DOCKER" ]; then
    echo -e "${BOLD}🚀 Troves Host Setup${NC}"
    echo "Select your deployment mode:"
    echo "  1) Native Host Mode (Node 22 on host + microservices in Docker)"
    echo "  2) Full Docker Mode (App + microservices all in Docker containers)"
    echo ""
    
    if [ "$USERLAND_ARCH" = "armhf" ] || [ "$USERLAND_ARCH" = "arm" ]; then
        warn "32-bit userland detected ($USERLAND_ARCH). Full Docker Mode (Option 2) is strongly recommended."
        read -p "Choice [1-2] (Default: 2): " CHOICE
        case "$CHOICE" in
            1) USE_DOCKER=false ;;
            *) USE_DOCKER=true ;;
        esac
    else
        read -p "Choice [1-2] (Default: 1): " CHOICE
        case "$CHOICE" in
            2) USE_DOCKER=true ;;
            *) USE_DOCKER=false ;;
        esac
    fi
fi

# Hard safety guard for Native Mode on 32-bit userlands
if [ "$USE_DOCKER" = false ] && [ "$USERLAND_ARCH" != "arm64" ] && [ "$USERLAND_ARCH" != "amd64" ] && [ "$USERLAND_ARCH" != "x86_64" ]; then
    echo ""
    error "Native Host Mode requires a 64-bit OS userland (arm64, amd64, or x86_64)."
    echo "Current Architecture: $ARCH"
    echo "Current Userland Architecture: $USERLAND_ARCH"
    echo ""
    echo "Node 22 and C++ native dependencies cannot run natively on 32-bit userlands."
    read -p "Switch to Full Docker Mode instead? (Y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Setup aborted."
        exit 1
    fi
    USE_DOCKER=true
fi

# Patch outdated libseccomp2 on 32-bit userlands to prevent SIGSYS (exit code 159) on arm64
# Very specific for me (romland) since I am trying to get this running on a dirt-old Raspberry Pi already used for other stuff.
if [ "$USERLAND_ARCH" = "armhf" ] || [ "$USERLAND_ARCH" = "arm" ]; then
    SECCOMP_VER=$(dpkg-query -W -f='${Version}' libseccomp2 2>/dev/null || echo "0")
    if [[ "$SECCOMP_VER" < "2.5.0" ]]; then
        info "Upgrading libseccomp2 for 64-bit container syscall compatibility..."
        wget -q http://ftp.debian.org/debian/pool/main/libs/libseccomp/libseccomp2_2.5.4-1+deb12u1_armhf.deb -O /tmp/libseccomp2.deb
        sudo dpkg -i /tmp/libseccomp2.deb && rm -f /tmp/libseccomp2.deb
        sudo systemctl restart docker
        success "libseccomp2 upgraded and Docker daemon restarted!"
    fi
fi

# ------------------------------------------------------------------------------
# Pre-Flight Summary
# ------------------------------------------------------------------------------
MODE_LABEL="Native Host Mode"
[ "$USE_DOCKER" = true ] && MODE_LABEL="Full Docker Mode"
echo -e "\n${BOLD}🔍 Checking system prerequisites (${MODE_LABEL})...${NC}"

WILL_INSTALL=()
if [ "$USE_DOCKER" = false ]; then
    command -v git &>/dev/null || WILL_INSTALL+=("Git & build libraries (APT)")
    command -v ffmpeg &>/dev/null || WILL_INSTALL+=("Media processing (FFmpeg, Poppler)")
    command -v node &>/dev/null || WILL_INSTALL+=("Node.js 22 (via NVM)")
    command -v yt-dlp &>/dev/null || WILL_INSTALL+=("yt-dlp (Media downloader)")
fi
command -v docker &>/dev/null || WILL_INSTALL+=("Docker Engine & Docker Compose")

echo ""
echo "Troves requires the following host adjustments:"
if [ ${#WILL_INSTALL[@]} -eq 0 ]; then
    echo "  • All system dependencies for this mode are already installed!"
else
    for item in "${WILL_INSTALL[@]}"; do
        echo "  • Will install: $item"
    done
fi

TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
TOTAL_SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
if [ "$TOTAL_RAM_MB" -le 4096 ] && [ "$TOTAL_SWAP_MB" -lt 1900 ]; then
    echo "  • Will offer to increase Swap file to 2048MB (recommended for OCR)"
fi

echo ""
if [ "$SKIP_PROMPT" = false ]; then
    read -p "Do you want to proceed with host setup? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled by user."
        exit 0
    fi
fi

# ------------------------------------------------------------------------------
# 1. Memory and Swap Check
# ------------------------------------------------------------------------------
info "Checking RAM and Swap allocation..."
if [ "$TOTAL_RAM_MB" -le 4096 ] && [ "$TOTAL_SWAP_MB" -lt 1900 ]; then
    warn "Low Swap Configuration Detected (${TOTAL_SWAP_MB}MB Swap on ${TOTAL_RAM_MB}MB RAM)."
    echo "Heavy OCR (PaddleOCR) and Vision Model tasks can crash the server due to OOM kills."
    
    if [ -f /etc/dphys-swapfile ]; then
        read -p "Automated fix available: Set swap to 2048MB in /etc/dphys-swapfile? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
            sudo systemctl restart dphys-swapfile
            success "Swap updated to 2048MB!"
        fi
    else
        warn "dphys-swapfile not present. Manually increase your swap space if you encounter OOM errors."
    fi
else
    success "Memory configuration looks solid (${TOTAL_RAM_MB}MB RAM / ${TOTAL_SWAP_MB}MB Swap)."
fi

# ------------------------------------------------------------------------------
# 2. System Packages & Native Build Dependencies (Native Mode Only)
# ------------------------------------------------------------------------------
if [ "$USE_DOCKER" = false ]; then
    info "Installing required APT packages and media libraries..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq \
      curl \
      wget \
      git \
      poppler-utils \
      ffmpeg \
      build-essential \
      libcairo2-dev \
      libpango1.0-dev \
      libjpeg-dev \
      libgif-dev \
      librsvg2-dev
    success "System libraries installed."
else
    info "Skipping host APT package installs (handled inside Docker container)."
fi

# ------------------------------------------------------------------------------
# 3. Node.js 22 LTS (via NVM - Native Mode Only)
# ------------------------------------------------------------------------------
if [ "$USE_DOCKER" = false ]; then
    info "Checking Node.js version..."
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    CURRENT_NODE_VER=""
    if command -v node &> /dev/null; then
        CURRENT_NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    fi

    if [ "${CURRENT_NODE_VER:-0}" -ge 22 ]; then
        success "Node.js $(node -v) is already installed."
    else
        info "Installing Node.js 22 LTS..."
        if [ ! -s "$NVM_DIR/nvm.sh" ]; then
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        fi
        nvm install 22
        nvm use 22
        nvm alias default 22
        success "Node.js $(node -v) configured."
    fi
else
    info "Skipping host Node.js installation (handled inside Docker container)."
fi

# ------------------------------------------------------------------------------
# 4. Docker & Docker Compose (Required for both modes)
# ------------------------------------------------------------------------------
info "Checking Docker installation..."
if command -v docker &> /dev/null && [ -n "$COMPOSE_CMD" ]; then
    success "Docker and Docker Compose are already installed."
else
    info "Installing Docker via official convenience script..."
    curl -fsSL https://get.docker.com | sudo sh
    success "Docker installed."
fi

if ! groups "$USER" 2>/dev/null | grep -q "\bdocker\b"; then
    info "Adding $USER to the 'docker' user group..."
    sudo usermod -aG docker "$USER"
    warn "User added to group 'docker'. Log out and back in (or run 'exec su - \$USER') to refresh permissions."
else
    success "User $USER already belongs to the 'docker' group."
fi

# Prevent credential helper DBus crashes on headless Linux
mkdir -p "$HOME/.local/bin"
cat << 'EOF' > "$HOME/.local/bin/docker-credential-secretservice"
#!/bin/sh
if [ "$1" = "get" ]; then
  echo '{"ServerURL":"","Username":"","Secret":""}'
  exit 0
fi
exit 0
EOF
chmod +x "$HOME/.local/bin/docker-credential-secretservice" 2>/dev/null || true

# Override Docker credential store to prevent D-Bus helper crashes on headless hosts
mkdir -p "$HOME/.docker"
cat << 'EOF' > "$HOME/.docker/config.json"
{
  "credsStore": ""
}
EOF

# ------------------------------------------------------------------------------
# 5. Media Downloader (yt-dlp - Native Mode Only)
# ------------------------------------------------------------------------------
if [ "$USE_DOCKER" = false ]; then
    info "Checking yt-dlp status..."
    if command -v yt-dlp &> /dev/null; then
        success "yt-dlp is installed. Checking for updates..."
        sudo yt-dlp -U || true
    else
        info "Fetching latest yt-dlp binary..."
        sudo wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
        sudo chmod a+rx /usr/local/bin/yt-dlp
        success "yt-dlp installed to /usr/local/bin/yt-dlp."
    fi
else
    info "Skipping host yt-dlp installation (handled inside Docker container)."
fi

# ------------------------------------------------------------------------------
# 6. Fetch and Extract Latest Release
# ------------------------------------------------------------------------------
info "Downloading latest Troves release..."
INSTALL_DIR="${HOME}/troves"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

RELEASE_API="https://api.github.com/repos/romland/troves/releases/latest"
DOWNLOAD_URL=$(curl -s "$RELEASE_API" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for asset in data.get('assets', []):
        if asset['name'].endswith('.tar.gz'):
            print(asset['browser_download_url'])
            break
except Exception: pass
" 2>/dev/null || echo "")

if [ -z "$DOWNLOAD_URL" ]; then
    DOWNLOAD_URL="https://github.com/romland/troves/releases/latest/download/troves-dist.tar.gz"
fi

curl -fsSL "$DOWNLOAD_URL" -o troves-dist.tar.gz
tar -xzf troves-dist.tar.gz
rm -f troves-dist.tar.gz

info "Microservice Configuration"
echo "Troves uses Docker containers for optional heavy lifting."
if [ "$SKIP_PROMPT" = false ]; then
    read -p "Enable Background Removal (RemBG)? (Y/n): " -n 1 -r; echo ""
    [[ $REPLY =~ ^[Nn]$ ]] && ENABLE_REMBG=false || ENABLE_REMBG=true

    read -p "Enable local text extraction (PaddleOCR)? (Y/n): " -n 1 -r; echo ""
    [[ $REPLY =~ ^[Nn]$ ]] && ENABLE_PADDLEOCR=false || ENABLE_PADDLEOCR=true

    read -p "Enable offline webpage downloading (SingleFile)? (Y/n): " -n 1 -r; echo ""
    [[ $REPLY =~ ^[Nn]$ ]] && ENABLE_SINGLEFILE=false || ENABLE_SINGLEFILE=true
else
    ENABLE_REMBG=true
    ENABLE_PADDLEOCR=true
    ENABLE_SINGLEFILE=true
fi


# Persist user choice into .env so start.sh knows how to boot
touch .env
if [ "$USE_DOCKER" = true ]; then
    grep -q "^DOCKER_MODE=" .env && sed -i 's/^DOCKER_MODE=.*/DOCKER_MODE=true/' .env || echo "DOCKER_MODE=true" >> .env
else
    grep -q "^DOCKER_MODE=" .env && sed -i 's/^DOCKER_MODE=.*/DOCKER_MODE=false/' .env || echo "DOCKER_MODE=false" >> .env
fi

grep -q "^ENABLE_REMBG=" .env && sed -i "s/^ENABLE_REMBG=.*/ENABLE_REMBG=$ENABLE_REMBG/" .env || echo "ENABLE_REMBG=$ENABLE_REMBG" >> .env
grep -q "^ENABLE_PADDLEOCR=" .env && sed -i "s/^ENABLE_PADDLEOCR=.*/ENABLE_PADDLEOCR=$ENABLE_PADDLEOCR/" .env || echo "ENABLE_PADDLEOCR=$ENABLE_PADDLEOCR" >> .env
grep -q "^ENABLE_SINGLEFILE=" .env && sed -i "s/^ENABLE_SINGLEFILE=.*/ENABLE_SINGLEFILE=$ENABLE_SINGLEFILE/" .env || echo "ENABLE_SINGLEFILE=$ENABLE_SINGLEFILE" >> .env

success "Troves unpacked into $INSTALL_DIR"

# ------------------------------------------------------------------------------
# 7. Local LAN HTTPS & PWA Setup
# ------------------------------------------------------------------------------
info "Configuring Local HTTPS for Mobile PWA & Camera access..."
if ! command -v mkcert &> /dev/null; then
    MKARCH="amd64"
    [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ] && MKARCH="arm64"
    sudo apt-get install -y -qq libnss3-tools 2>/dev/null || true
    sudo curl -fsSL -o /usr/local/bin/mkcert "https://dl.filippo.io/mkcert/latest?for=linux/${MKARCH}"
    sudo chmod +x /usr/local/bin/mkcert
fi

mkcert -install >/dev/null 2>&1
LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I | awk '{print $1}')

info "Generating SSL certificates for IP: $LAN_IP..."
mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 "$LAN_IP" >/dev/null 2>&1

CA_DIR=$(mkcert -CAROOT)
[ -f "$CA_DIR/rootCA.pem" ] && cp -f "$CA_DIR/rootCA.pem" ./rootCA.crt

# ------------------------------------------------------------------------------
# Setup Summary
# ------------------------------------------------------------------------------
echo -e "\n=========================================================================="
success "Host setup completed successfully!"
echo "=========================================================================="
echo " - Mode    : $( [ "$USE_DOCKER" = true ] && echo 'Full Docker' || echo 'Native Host' )"
echo " - Node.js : $( [ "$USE_DOCKER" = true ] && echo 'Containerized' || node -v 2>/dev/null || echo 'Reload shell to activate NVM' )"
echo " - Docker  : $(docker compose version 2>/dev/null || echo 'Installed')"
echo " - yt-dlp  : $( [ "$USE_DOCKER" = true ] && echo 'Containerized' || yt-dlp --version 2>/dev/null || echo 'Installed' )"
echo ""
echo "🔒 To enable mobile access, install the Root CA on your phone:"
echo "   Run: python3 -m http.server 1025"
echo "   Then open http://${LAN_IP}:1025/rootCA.crt on your phone."
echo ""
echo "🚀 To start Troves: ./start.sh (App will be at https://${LAN_IP}:3000)"
echo "=========================================================================="
