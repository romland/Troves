#!/usr/bin/env bash
set -e

COMMAND=$1

case "$COMMAND" in
    start)
        echo "🚀 Starting Troves..."
        ./start.sh
        ;;
    stop)
        echo "🛑 Stopping Troves..."
        if command -v pm2 &> /dev/null; then
            pm2 stop server.js 2>/dev/null || true
        fi
        pkill -f "node server.js" 2>/dev/null || true
        if grep -q "^DOCKER_MODE=true" .env 2>/dev/null; then
            # docker compose --profile full down || true
            docker compose --profile "*" down --remove-orphans || true
        else
            docker compose down || true
        fi
        echo "✅ Troves stopped."
        ;;
    restart)
        $0 stop
        sleep 2
        $0 start
        ;;
    update)
        echo "🔄 Updating Troves..."
        if grep -q "^DOCKER_MODE=true" .env 2>/dev/null; then
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
        echo "Usage: ./troves.sh {start|stop|restart|update|logs}"
        exit 1
        ;;
esac
