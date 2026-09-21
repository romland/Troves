#!/usr/bin/env bash
set -e

PKG_VERSION=$(node -p "require('./package.json').version")
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
BUILD_DATE=$(date +'%Y%m%d')
VERSION="${PKG_VERSION}-${BUILD_DATE}-${GIT_HASH}"

echo "🏷️ Packaging Troves ${VERSION}..."
echo "🧹 Clearing old dist files..."
rm -rf dist troves-dist.tar.gz troves-*.tar.gz

echo "📦 Building SvelteKit app..."
npm run build

echo "📋 Copying build output..."
mkdir -p dist
rsync -av \
  build/ dist/build/

mkdir -p dist/data/images/u
mkdir -p dist/data/images/containers

echo "${VERSION}" > dist/VERSION

echo "🗄️ Copying Prisma (excluding local databases)..."
mkdir -p dist/prisma
rsync -av \
  --exclude='*.db' \
  --exclude='*.db-journal' \
  --exclude='*.db-wal' \
  --exclude='*.sqlite' \
  prisma/ dist/prisma/

cp package.json package-lock.json .env.example server.js dist/
# Use the dedicated production Dockerfile to ensure a clean runner environment
[ -f Dockerfile.prod ] && cp Dockerfile.prod dist/Dockerfile
[ -f docker-compose.yml ] && cp docker-compose.yml dist/

echo "🧩 Copying scripts and example extensions..."
mkdir -p dist/scripts dist/docs/extensions
[ -f scripts/teardown-fts.js ] && cp scripts/teardown-fts.js dist/scripts/
[ -d docs/extensions/99-more-examples ] && cp -r docs/extensions/99-more-examples dist/docs/extensions/

echo "🧹 Adding uninstall script to release..."
# Place it right in the root next to start.sh for easy access
[ -f bin/uninstall.sh ] && cp bin/uninstall.sh dist/uninstall.sh && chmod +x dist/uninstall.sh
[ -f bin/troves.sh ] && cp bin/troves.sh dist/troves.sh && chmod +x dist/troves.sh

echo "🐳 Copying Docker services (excluding caches & virtualenvs)..."
rsync -av \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.venv' \
  --exclude='venv' \
  --exclude='singlefile/chrome-data' \
  --exclude='singlefile/node_modules' \
  --exclude='rembg-data' \
  --exclude='paddleocr/paddlex_cache' \
  --exclude='paddleocr/downloads' \
  --exclude='*.log' \
  --exclude='*.pid' \
  --exclude='Singleton*' \
  services/ dist/services/

echo "📜 Generating launch script..."
cat << 'EOF' > dist/start.sh
#!/usr/bin/env bash
set -e

# ---------------------------------------------------------
# Transparent Docker Permission Resolution
# ---------------------------------------------------------
# If the user was just added to the 'docker' group, it requires a logout.
# We intercept the failure and dynamically apply the group to this execution
# using 'sg', preventing the "permission denied" socket crash elegantly.
DOCKER_CMD="docker"
if command -v docker >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    if groups "$USER" 2>/dev/null | grep -q '\bdocker\b'; then
      echo "🔄 Applying pending 'docker' group permissions (no logout required)..."
      exec sg docker -c "\"\$0\" \"\$@\""
      exit 0
    else
      echo "🔒 Elevating Docker permissions via sudo..."
      DOCKER_CMD="sudo docker"
    fi
  fi
fi

mkdir -p data/images/u
mkdir -p data/images/containers
mkdir -p prisma
mkdir -p services/rembg-data
mkdir -p services/singlefile/chrome-data
mkdir -p services/paddleocr/downloads
mkdir -p services/paddleocr/paddlex_cache

if [ ! -f .env ]; then
  echo "⚠️ No .env found, copying from .env.example..."
  cp .env.example .env
fi

# Source .env so this script knows which port to announce
if [ -f .env ]; then
  export $(grep -E '^(PORT|TROVES_PORT)=' .env | xargs) 2>/dev/null || true
fi

# ---------------------------------------------------------
# Auto-adapt to 32-bit userland on 64-bit kernel
# ---------------------------------------------------------
if [ "$(uname -m)" = "aarch64" ] && [ "$(dpkg --print-architecture 2>/dev/null || echo '')" = "armhf" ]; then
  export DOCKER_DEFAULT_PLATFORM=linux/arm64
  echo "⚙️ 64-bit kernel with 32-bit userland detected. Auto-targeting linux/arm64."

  # Self-heal outdated host seccomp to prevent SIGSYS (159) during 64-bit builds
  SECCOMP_VER=$(dpkg-query -W -f='${Version}' libseccomp2 2>/dev/null || echo "0")
  if dpkg --compare-versions "$SECCOMP_VER" lt "2.5.0"; then
      echo "🚨 CRITICAL: Host libseccomp2 ($SECCOMP_VER) is too old and will crash 64-bit containers during build."
      echo "🛠️ Patching libseccomp2 to enable modern syscalls..."
      wget -q http://ftp.debian.org/debian/pool/main/libs/libseccomp/libseccomp2_2.5.4-1+deb12u1_armhf.deb -O /tmp/libseccomp2.deb
      sudo dpkg -i /tmp/libseccomp2.deb && rm -f /tmp/libseccomp2.deb
      sudo systemctl restart docker
      echo "✅ libseccomp2 patched and Docker daemon restarted!"
      sleep 3
  fi

  echo "🛡️ Bootstrapping unconfined 64-bit BuildKit engine to bypass host seccomp poison..."
  $DOCKER_CMD rm -f franken-buildkitd 2>/dev/null || true
  $DOCKER_CMD buildx rm franken-builder 2>/dev/null || true
  
  # Launch an entirely isolated, privileged build engine bound to localhost
  $DOCKER_CMD run -d --name franken-buildkitd --privileged -p 127.0.0.1:8338:8338 moby/buildkit:latest --addr tcp://0.0.0.0:8338
  sleep 3
  $DOCKER_CMD buildx create --use --name franken-builder --driver remote tcp://127.0.0.1:8338
fi

# Ensure NVM is loaded if running native mode
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Determine execution mode from flag or .env file
RUN_DOCKER=false
if [ "$1" = "--docker" ] || grep -q "^DOCKER_MODE=true" .env 2>/dev/null; then
  RUN_DOCKER=true
fi
if [ "$1" = "--native" ]; then
  RUN_DOCKER=false
fi

# Dynamic profiles based on user settings
COMPOSE_PROFILES=""
grep -q "^ENABLE_REMBG=true" .env && COMPOSE_PROFILES="$COMPOSE_PROFILES --profile rembg"
grep -q "^ENABLE_PADDLEOCR=true" .env && COMPOSE_PROFILES="$COMPOSE_PROFILES --profile paddleocr"
grep -q "^ENABLE_SINGLEFILE=true" .env && COMPOSE_PROFILES="$COMPOSE_PROFILES --profile singlefile"

if [ "$RUN_DOCKER" = true ]; then
  echo "🐳 Starting Troves in Full Docker Mode..."
  if [ -f docker-compose.yml ]; then
    $DOCKER_CMD compose --profile full $COMPOSE_PROFILES up -d
  else
    (cd services && $DOCKER_CMD compose --profile full $COMPOSE_PROFILES up -d)
  fi
  echo "🚀 Troves is running on https://localhost:${TROVES_PORT:-${PORT:-3000}}"
else
  echo "🐳 Starting Docker microservices (RemBG, PaddleOCR, SingleFile)..."
  if [ -f docker-compose.yml ]; then
    $DOCKER_CMD compose $COMPOSE_PROFILES up -d
  else
    (cd services && $DOCKER_CMD compose $COMPOSE_PROFILES up -d)
  fi

  echo "📦 Installing production dependencies..."
  npm ci --omit=dev

  echo "🗄️ Running database migrations..."
   # Bypass interactive installation prompts since npm ci --omit=dev removes the local CLI
   npx --yes prisma migrate deploy || npm run updatedbschema

  echo "🚀 Starting Troves server on port ${PORT:-3000}..."
  PORT=${PORT:-3000} node server.js
fi
EOF

chmod +x dist/start.sh

echo "🗜️ Creating archive troves-${VERSION}.tar.gz..."
tar -czf "troves-${VERSION}.tar.gz" -C dist .
cp "troves-${VERSION}.tar.gz" troves-dist.tar.gz

echo "=================================================================="
echo "✅ Distribution package created successfully!"
echo "=================================================================="
