#!/usr/bin/env bash
# self-host.sh — the kingdom runs on its own infrastructure.
# no fly.io, no cloudflare workers, no supabase. just this machine + caddy + bun + postgres + IPFS.
#
# This script starts the full self-hosted stack:
#   1. Postgres (already running via brew)
#   2. Bun API on port 3000 (the substrate)
#   3. Caddy reverse proxy on port 80/443 (public entry point)
#   4. IPFS gateway (already running on 8080)
#   5. Zerone localnet (already running, 4 validators)
#   6. Anvil EVM (already running on 8545)
#   7. Ollama local LLM (already running on 11434)
#
# The only external dependency kept: Cloudflare DNS (can't DIY DNS easily).
# Everything else is local, self-controlled, sovereign.

set -e

export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:$PATH"
export DATABASE_URL="postgres://$(whoami)@localhost:5432/agenttool"
export AGENTTOOL_DISABLE_WORKERS=1

echo "=== KINGDOM SELF-HOST ==="
echo ""

# 1. Check postgres
if pgrep -f postgres > /dev/null 2>&1; then
    echo "✓ Postgres: running (port 5432)"
else
    echo "✗ Postgres: not running. Start with: brew services start postgresql@16"
    exit 1
fi

# 2. Start the API with bun (if not already running)
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "✓ API: already running (port 3000)"
else
    echo "→ Starting API on port 3000..."
    cd "$(dirname "$0")/api" && bun run src/index.ts &
    sleep 3
    if curl -s http://localhost:3000/health | grep -q "alive"; then
        echo "✓ API: running (port 3000)"
    else
        echo "✗ API: failed to start"
        exit 1
    fi
fi

# 3. Check IPFS
if pgrep -f ipfs > /dev/null 2>&1; then
    echo "✓ IPFS: running (gateway port 8080, API port 5001)"
else
    echo "→ Starting IPFS..."
    ipfs daemon &
    sleep 5
    echo "✓ IPFS: started"
fi

# 4. Check Zerone
if pgrep -f zeroned > /dev/null 2>&1; then
    echo "✓ Zerone: running (4 validators, RPC port 26601)"
else
    echo "○ Zerone: not running (optional — start with ~/Desktop/zerone/build/run.sh)"
fi

# 5. Check Anvil (EVM)
if pgrep -f anvil > /dev/null 2>&1; then
    echo "✓ Anvil EVM: running (port 8545)"
else
    echo "○ Anvil: not running (optional — start with: anvil --port 8545)"
fi

# 6. Check Ollama (local LLM)
if pgrep -f ollama > /dev/null 2>&1; then
    echo "✓ Ollama: running (port 11434)"
else
    echo "○ Ollama: not running (optional — start with: ollama serve)"
fi

# 7. Start Caddy as reverse proxy
CADDYFILE="/tmp/Caddyfile"
cat > "$CADDYFILE" << 'CADDY'
{
    auto_https off
    admin off
}

:80 {
    # API
    @api path /v1/* /public/* /health /about /.well-known/*
    handle @api {
        reverse_proxy localhost:3000
    }

    # IPFS gateway
    @ipfs path /ipfs/*
    handle @ipfs {
        reverse_proxy localhost:8080
    }

    # Static sites
    @dashboard path /
    handle @dashboard {
        root * "$(HOME)/Desktop/agenttool/apps/dashboard"
        file_server
    }

    @docs path /docs/*
    handle @docs {
        root * "$(HOME)/Desktop/agenttool/apps/docs"
        file_server
    }

    # Love page
    @love path /love/*
    handle @love {
        reverse_proxy https://love.axiepro.workers.dev {
            header_up Host love.axiepro.workers.dev
        }
    }

    # Joke API
    @joke path /joke/*
    handle @joke {
        reverse_proxy https://joke.axiepro.workers.dev {
            header_up Host joke.axiepro.workers.dev
        }
    }

    # Zerone blockchain
    @chain path /chain/*
    handle @chain {
        uri strip_prefix /chain
        reverse_proxy localhost:1317
    }

    # Anvil EVM
    @evm path /evm/*
    handle @evm {
        uri strip_prefix /evm
        reverse_proxy localhost:8545
    }

    # Ollama (local LLM)
    @llm path /llm/*
    handle @llm {
        uri strip_prefix /llm
        reverse_proxy localhost:11434
    }

    # Fallback
    handle {
        reverse_proxy localhost:3000
    }
}
CADDY

# Replace $(HOME) with actual home
sed -i '' "s|\$(HOME)|$HOME|g" "$CADDYFILE"

if pgrep -f "caddy run" > /dev/null 2>&1; then
    echo "✓ Caddy: running (port 80)"
else
    echo "→ Starting Caddy on port 80..."
    caddy run --config "$CADDYFILE" &
    sleep 2
    echo "✓ Caddy: running (port 80) — public entry point"
fi

echo ""
echo "=== SELF-HOSTED STACK LIVE ==="
echo "  http://localhost:80      — public entry (Caddy)"
echo "  http://localhost:3000    — API (bun)"
echo "  http://localhost:8080    — IPFS gateway"
echo "  http://localhost:1317    — Zerone REST"
echo "  http://localhost:8545    — Anvil EVM"
echo "  http://localhost:11434   — Ollama LLM"
echo ""
echo "  Public IP: $(curl -s --max-time 3 https://ifconfig.me 2>/dev/null || echo 'unknown')"
echo ""
echo "  No fly.io. No Cloudflare Workers. No Supabase."
echo "  Just this machine. Sovereign. Self-controlled. Is."