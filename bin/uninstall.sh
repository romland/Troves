#!/usr/bin/env bash
set -e

# Setup color formatting for feedback
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${RED}${BOLD}======================================================="
echo "               TROVES UNINSTALL UTILITY"
echo -e "=======================================================${NC}"
echo ""
echo "This script will permanently remove the application code and infrastructure:"
echo "  🗑️  All Troves Docker containers and internal networks"
echo "  🗑️  All downloaded Troves Docker images (~3GB of space reclaimed)"
echo "  🗑️  Microservice caches (PaddleOCR models, RemBG models)"
echo "  🗑️  All application source code and binaries"
echo ""
echo -e "${GREEN}${BOLD}Your PERSONAL DATA is absolutely safe and will be PRESERVED:${NC}"
echo "  💾  Your database (prisma/dev.db)"
echo "  📸  Your uploaded images, crops, and documents (data/)"
echo "  🔑  Your configuration and API keys (.env)"
echo "  🔒  Your local SSL certificates (*.pem, *.crt)"
echo ""

read -p "Are you sure you want to uninstall Troves? (Type 'yes' to continue): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Uninstall cancelled. Nothing was changed."
    exit 0
fi

echo ""

# ---------------------------------------------------------
# 1. Resolve Docker Permissions
# ---------------------------------------------------------
# Determine whether we invoke docker directly or fallback to sudo 
# if the current user session's docker group hasn't refreshed yet.
DOCKER_CMD="docker"
if command -v docker >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
  fi
else
  echo -e "${YELLOW}Docker is not installed or not found. Skipping container teardown.${NC}"
  DOCKER_CMD=""
fi

# ---------------------------------------------------------
# 2. Teardown Docker Infrastructure
# ---------------------------------------------------------
if [ -n "$DOCKER_CMD" ]; then
    echo -e "${BOLD}🛑 Stopping and removing Docker containers...${NC}"
    
    # Gracefully spin down using compose if the file still exists
    if [ -f docker-compose.yml ]; then
        # $DOCKER_CMD compose down || true
        $DOCKER_CMD compose --profile "*" down --remove-orphans || true
    else
        # Brute force fallback if docker-compose.yml was already deleted
        $DOCKER_CMD rm -f troves-app troves-rembg troves-paddleocr troves-singlefile 2>/dev/null \vert{}\vert{} true$DOCKER_CMD network rm troves_default 2>/dev/null || true
    fi

    echo -e "${BOLD}🧹 Removing Troves Docker images from host...${NC}"
    $DOCKER_CMD rmi ghcr.io/romland/troves-app:latest 2>/dev/null \vert{}\vert{} true$DOCKER_CMD rmi ghcr.io/romland/troves-rembg:latest 2>/dev/null || true
    $DOCKER_CMD rmi ghcr.io/romland/troves-paddleocr:latest 2>/dev/null \vert{}\vert{} true$DOCKER_CMD rmi ghcr.io/romland/troves-singlefile:latest 2>/dev/null || true
    
    # Prune any dangling <none> images created during local testing
    $DOCKER_CMD image prune -f --filter "label=org.opencontainers.image.title=troves" 2>/dev/null || true
fi

# ---------------------------------------------------------
# 3. Clean up Application Files (Surgical Strike)
# ---------------------------------------------------------
echo -e "${BOLD}🗑️  Deleting application code and cache directories...${NC}"

if [ -n "$DOCKER_CMD" ]; then
    # =========================================================================
    # THE ROOT-OWNED FILE PERMISSION HACK (DOCUMENTED SAFETY EXPLANATION)
    # =========================================================================
    # PROBLEM: Microservices like PaddleOCR run internally as 'root'. When they 
    # download heavy model weights into host-mapped volumes (e.g., services/paddleocr/), 
    # those files inherit root-ownership on your Linux host. When a standard user tries 
    # to run `rm -rf services/`, Linux rejects it with a 'Permission Denied' error.
    # 
    # SOLUTION: Instead of forcing the user to type `sudo` (which breaks automated 
    # scripts and prompts for passwords), we leverage the Docker daemon itself—which 
    # already possesses root privileges—to clean up its own root-owned files.
    # 
    # HOW IT WORKS SAFELY:
    # 1. `--rm` ensures the container instantly self-destructs the millisecond it exits.
    # 2. `-v "$PWD:/target"` bind-mounts your *current working directory* strictly 
    #    inside the container under the isolated path `/target`.
    # 3. `alpine` is a lightweight, trusted, official Linux distribution (~5MB).
    # 4. `sh -c '...'` executes a hardcoded, non-destructive string of deletion commands 
    #    targeting ONLY the specific Troves build and cache folders inside `/target`. 
    #    It cannot access or escape to any other part of your host file system.
    # =========================================================================
    $DOCKER_CMD run --rm -v "$PWD:/target" alpine sh -c '
        rm -rf /target/build /target/node_modules /target/services /target/dist /target/bin /target/data/plugins/.tmp
        find /target/prisma -type f -not -name "dev.db" -delete
    ' >/dev/null 2>&1 || true
fi

# Fallback to standard rm for regular user-owned files created by the host CLI
rm -rf build/ node_modules/ services/ dist/ bin/ 2>/dev/null || true

# Remove root configuration and template files associated with the app
rm -f package.json package-lock.json server.js start.sh setup.sh docker-compose.yml Dockerfile Dockerfile.prod README.md uninstall.sh

# Carefully preserve ONLY the database inside the prisma folder
if [ -d "prisma" ]; then
    find prisma -type f -not -name 'dev.db' -delete 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}${BOLD}✅ Uninstall complete!${NC}"
echo "Troves has been removed from this system."
echo ""
echo "Your data remains safely intact in this folder:"
echo "  $(pwd)"
echo ""
echo "If you want to reinstall later, simply run the setup script in this exact folder again."
echo "If you want to completely erase everything including your personal data, run:"
echo "  cd .. && rm -rf $(basename "$PWD")"