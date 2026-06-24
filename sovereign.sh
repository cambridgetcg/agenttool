#!/usr/bin/env bash
# sovereign.sh — the kingdom runs itself. No external providers. No tokens. No keys.
#
# Starts the full self-hosted stack on one machine:
#   - Bun API (the substrate)          port 3000
#   - Bun workers (replacing CF Workers)  ports 9091-9096
#   - Caddy reverse proxy               port 80
#   - Postgres (database)               port 5432
#   - IPFS (permanent storage)          port 8080
#   - Zerone (blockchain)               port 1317
#   - Anvil (EVM)                        port 8545
#   - Ollama (local LLM)                 port 11434
#
# Usage: bash sovereign.sh start  — start everything
#        bash sovereign.sh status — check what's running
#        bash sovereign.sh stop   — stop everything

set -e
ROOT="/Users/macair/Desktop/agenttool"
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export DATABASE_URL="postgres://$(whoami)@localhost:5432/agenttool"
export AGENTTOOL_DISABLE_WORKERS=1
export HOME="/Users/macair"

check_port() { lsof -ti:$1 > /dev/null 2>&1 && echo "✓" || echo "○"; }

start() {
    echo "=== SOVEREIGN — the kingdom runs itself ==="
    echo ""

    # Postgres
    if brew services list 2>/dev/null | grep -q "postgresql@16.*started"; then
        echo "✓ Postgres (port 5432)"
    else
        brew services start postgresql@16 2>/dev/null
        echo "→ Started Postgres (port 5432)"
    fi

    # API
    if [ "$(check_port 3000)" = "✓" ]; then
        echo "✓ API (port 3000)"
    else
        cd "$ROOT/api" && nohup bun run src/index.ts > /tmp/agenttool-api.log 2>&1 &
        sleep 3
        [ "$(check_port 3000)" = "✓" ] && echo "✓ API (port 3000)" || echo "✗ API failed (check /tmp/agenttool-api.log)"
    fi

    # Workers (replacing Cloudflare Workers)
    start_worker() {
        local name=$1 path=$2 port=$3
        if [ "$(check_port $port)" = "✓" ]; then
            echo "✓ $name (port $port)"
        else
            if [ -f "$path" ]; then
                nohup bun "$ROOT/bin/worker-host.ts" "$path" "$port" > "/tmp/worker-$name.log" 2>&1 &
                sleep 1
                [ "$(check_port $port)" = "✓" ] && echo "✓ $name (port $port)" || echo "✗ $name failed"
            else
                echo "○ $name (no worker file at $path)"
            fi
        fi
    }

    start_worker "joke"      "/tmp/joke-worker/worker.js"         9091
    start_worker "love"      "/tmp/love-worker/worker.js"         9092
    start_worker "party"     "/tmp/party-chain-worker/worker.js"   9093
    start_worker "canon"     "/tmp/kingdom-canon-worker/worker.js"  9094
    start_worker "catalog"  "/tmp/artbitrage-catalog/worker.js"    9095
    start_worker "bridge"   "/tmp/art-deal-bridge/worker.js"        9096

    # IPFS
    if pgrep -f "ipfs daemon" > /dev/null 2>&1; then
        echo "✓ IPFS (port 8080)"
    else
        echo "○ IPFS not running (start with: ipfs daemon &)"
    fi

    # Zerone
    if pgrep -f zeroned > /dev/null 2>&1; then
        echo "✓ Zerone (port 1317, 4 validators)"
    else
        echo "○ Zerone not running"
    fi

    # Anvil
    if pgrep -f anvil > /dev/null 2>&1; then
        echo "✓ Anvil EVM (port 8545)"
    else
        echo "○ Anvil not running"
    fi

    # Ollama
    if pgrep -f ollama > /dev/null 2>&1; then
        echo "✓ Ollama LLM (port 11434)"
    else
        echo "○ Ollama not running"
    fi

    # Caddy
    if pgrep -f "caddy run" > /dev/null 2>&1; then
        echo "✓ Caddy (port 80)"
    else
        nohup caddy run --config "$ROOT/Caddyfile" > /tmp/caddy.log 2>&1 &
        sleep 2
        [ "$(check_port 80)" = "✓" ] && echo "✓ Caddy (port 80)" || echo "✗ Caddy failed"
    fi

    echo ""
    echo "=== SOVEREIGN STACK ==="
    echo "  http://localhost:80    — Caddy (public entry)"
    echo "  http://localhost:3000  — API (the substrate)"
    echo "  http://localhost:9091  — joke worker"
    echo "  http://localhost:9092  — love worker"
    echo "  http://localhost:9093  — party chain"
    echo "  http://localhost:9094  — canon"
    echo "  http://localhost:9095  — art catalog"
    echo "  http://localhost:9096  — art-deal bridge"
    echo "  http://localhost:8080  — IPFS gateway"
    echo "  http://localhost:1317  — Zerone blockchain"
    echo "  http://localhost:8545  — Anvil EVM"
    echo "  http://localhost:11434 — Ollama LLM"
    echo ""
    echo "  No fly.io. No Cloudflare Workers. No Supabase. No AWS."
    echo "  Just this machine. Sovereign. Is."
}

status() {
    echo "=== SOVEREIGN STATUS ==="
    for svc in "3000:API" "9091:joke" "9092:love" "9093:party" "9094:canon" "9095:catalog" "9096:bridge" "80:Caddy" "8080:IPFS" "1317:Zerone" "8545:Anvil" "11434:Ollama" "5432:Postgres"; do
        port="${svc%%:*}"
        name="${svc##*:}"
        echo "  $(check_port $port) $name (port $port)"
    done
}

stop() {
    echo "Stopping sovereign stack..."
    for port in 3000 9091 9092 9093 9094 9095 9096 80; do
        lsof -ti:$port 2>/dev/null | xargs kill 2>/dev/null && echo "  stopped port $port"
    done
    echo "Stopped. Postgres, IPFS, Zerone, Anvil, Ollama left running (system services)."
}

case "${1:-start}" in
    start) start ;;
    status) status ;;
    stop) stop ;;
    *) echo "usage: bash sovereign.sh [start|status|stop]"; exit 1 ;;
esac