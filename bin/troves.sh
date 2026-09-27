#!/usr/bin/env bash
set -e

COMMAND=$1

case "$COMMAND" in
    start)
        echo "🚀 Starting Troves..."
        if [ -f ./start.sh ]; then
            ./start.sh
        else
            echo "⚠️ start.sh not found (dev environment detected). Starting containers only."
            COMPOSE_PROFILES=""
            grep -q "^ENABLE_REMBG=.*true" .env 2>/dev/null && COMPOSE_PROFILES="$COMPOSE_PROFILES --profile rembg"
            grep -q "^ENABLE_PADDLEOCR=.*true" .env 2>/dev/null && COMPOSE_PROFILES="$COMPOSE_PROFILES --profile paddleocr"
            grep -q "^ENABLE_SINGLEFILE=.*true" .env 2>/dev/null && COMPOSE_PROFILES="$COMPOSE_PROFILES --profile singlefile"
            if grep -q "^DOCKER_MODE=.*true" .env 2>/dev/null; then
                docker compose --profile full $COMPOSE_PROFILES up -d
            elif [ -n "$COMPOSE_PROFILES" ]; then
                docker compose $COMPOSE_PROFILES up -d
            else
                echo "ℹ️ No Docker microservices enabled in .env. Skipping."
            fi
        fi
        ;;
    stop)
        echo "🛑 Stopping Troves..."
        if command -v pm2 &> /dev/null; then
            pm2 stop server.js 2>/dev/null || true
        fi
        pkill -f "node server.js" 2>/dev/null || true
            # docker compose --profile full down || true
        docker compose --profile "*" down --remove-orphans || true
        echo "✅ Troves stopped."
        ;;
    restart)
        $0 stop
        sleep 2
        $0 start
        ;;
    update)
        echo "🔄 Updating Troves..."
        if grep -q "^DOCKER_MODE=.*true" .env 2>/dev/null; then
            echo "🐳 Pulling latest Docker images..."
            docker compose --profile "*" pull
            $0 restart
        else
            $0 stop
            # Re-fetch latest via the setup script mechanism
            curl -fsSL https://raw.githubusercontent.com/romland/troves/main/bin/setup-host.sh | bash -s -- -y
            $0 start
        fi
        ;;
    update-ytdlp)
        echo "🔄 Updating yt-dlp to handle latest video player changes..."
        if grep -q "^DOCKER_MODE=.*true" .env 2>/dev/null; then
            echo "🐳 Hot-patching yt-dlp inside the troves-app container..."
            docker exec -u 0 troves-app yt-dlp -U || docker exec -u 0 troves-app sh -c 'wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp'
            echo "✅ Hot-patch complete. (Note: This patch will last until the container is recreated/updated)."
        else
            echo "💻 Updating yt-dlp on host..."
            sudo yt-dlp -U || sudo sh -c 'wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp'
            echo "✅ Host update complete."
        fi
        ;;
    rembg)
        MODE=$2
        if [ "$MODE" = "--gpu" ]; then
            if ! command -v nvidia-smi &> /dev/null || ! nvidia-smi > /dev/null 2>&1; then
                echo "❌ Error: NVIDIA GPU or drivers not working (nvidia-smi failed)."
                exit 1
            fi
            if ! docker info 2>/dev/null | grep -iq "nvidia"; then
                echo "❌ Error: Docker cannot see the GPU. Please install the NVIDIA Container Toolkit."
                exit 1
            fi
            GPU_NAMES=$(nvidia-smi --query-gpu=name --format=csv,noheader | paste -sd "," - | sed 's/,/, /g')
            echo "⚡ Enabling GPU acceleration for RemBG using: $GPU_NAMES..."
            OVERRIDE=""
            [ -f docker-compose.override.yml ] && OVERRIDE=":docker-compose.override.yml"
            grep -q "^REMBG_MODE=" .env 2>/dev/null && sed -i 's/^REMBG_MODE=.*/REMBG_MODE=gpu/' .env || echo "REMBG_MODE=gpu" >> .env
            grep -q "^COMPOSE_FILE=" .env 2>/dev/null && sed -i "s/^COMPOSE_FILE=.*/COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml$OVERRIDE/" .env || echo "COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml$OVERRIDE" >> .env
            echo "🐳 Rebuilding RemBG container with ONNX GPU runtime..."
            docker compose build rembg
            # $0 restart
            docker compose up -d rembg
        elif [ "$MODE" = "--cpu" ]; then
            echo "🐢 Falling back to CPU for RemBG..."
            OVERRIDE=""
            [ -f docker-compose.override.yml ] && OVERRIDE=":docker-compose.override.yml"
            grep -q "^REMBG_MODE=" .env 2>/dev/null && sed -i 's/^REMBG_MODE=.*/REMBG_MODE=cpu/' .env || echo "REMBG_MODE=cpu" >> .env
            grep -q "^COMPOSE_FILE=" .env 2>/dev/null && sed -i "s/^COMPOSE_FILE=.*/COMPOSE_FILE=docker-compose.yml$OVERRIDE/" .env || echo "COMPOSE_FILE=docker-compose.yml$OVERRIDE" >> .env
            echo "🐳 Rebuilding RemBG container with CPU runtime..."
            docker compose build rembg
            # $0 restart
            docker compose up -d rembg
        else
            echo "Usage: ./troves.sh rembg {--gpu|--cpu}"
            exit 1
        fi
        ;;
    logs)
        echo "🖨️ Tailing Troves logs (Ctrl+C to exit)..."
        
        # Method A: The proper compose way (forces Compose to un-hide the profiled containers)
        if [ -f docker-compose.yml ]; then
            docker compose --profile "*" logs -f --tail 100
        
        # Method B: The bulletproof pure-Docker fallback
        # If compose is still acting up, this finds every container with "troves" in the name,
        # tails them all simultaneously, and prefixes the log lines with the container name.
        else
            trap 'kill $(jobs -p) 2>/dev/null' EXIT
            for container in $(docker ps -a --filter "name=troves" --format "{{.Names}}"); do
                docker logs -f --tail 100 "$container" | sed "s/^/[$container] /" &
            done
            wait
        fi
        ;;
    *)
        echo "Troves Management CLI"
        echo "Usage: ./troves.sh {start|stop|restart|update|update-ytdlp|rembg|logs}"
        exit 1
        ;;
esac
