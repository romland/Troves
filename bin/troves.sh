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
            docker compose --profile full down || true
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
        $0 stop
        # Re-fetch latest via the setup script mechanism
        curl -fsSL https://raw.githubusercontent.com/romland/troves/main/bin/setup-host.sh | bash -s -- -y
        $0 start
        ;;
    logs)
        bash bin/logs.sh
        ;;
    *)
        echo "Troves Management CLI"
        echo "Usage: ./troves.sh {start|stop|restart|update|logs}"
        exit 1
        ;;
esac
