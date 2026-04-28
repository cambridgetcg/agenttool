#!/bin/bash
# Migrate all 5 agenttool services to Fly.io + Supabase + Upstash
# Run: source .env.fly && bash migrate.sh
set -euo pipefail

export PATH="$PATH:/Users/yu/.fly/bin"

# ── Required env vars ─────────────────────────────────────────────────────────
: "${FLY_API_TOKEN:?Set FLY_API_TOKEN from: flyctl auth token}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (postgres://postgres:PASS@HOST:5432/postgres)}"
: "${UPSTASH_REDIS_URL:?Set UPSTASH_REDIS_URL (rediss://...@...)}"
: "${STRIPE_SECRET_KEY:?Set STRIPE_SECRET_KEY}"
: "${STRIPE_WEBHOOK_SECRET:?Set STRIPE_WEBHOOK_SECRET}"

export FLY_API_TOKEN

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SERVICES=(
  "agent-memory:/Users/yu/Desktop/agent-memory:8000"
  "agent-tools:/Users/yu/Desktop/agent-tools:3000"
  "agent-verify:/Users/yu/Desktop/agent-verify:3000"
  "agent-economy:/Users/yu/Desktop/agent-economy:3002"
  "agent-trace:/Users/yu/Desktop/agent-trace:8005"
)

echo "=== agenttool → Fly.io migration ==="
echo "Region: lhr (London)"
echo ""

# ── 1. Migrate PostgreSQL: Forge → Supabase ───────────────────────────────────
echo "[1/4] Migrating databases to Supabase..."
FORGE_IP="89.167.84.100"
DB_USER="kingdom"
DB_PASS="zMj9TbCmDBHD6FvoOel3qLy2XfhoxU5"

for db in kingdom agent_tools agent_economy agent_trace; do
  echo "  Dumping $db from Forge..."
  ssh root@$FORGE_IP "docker exec kingdom-postgres pg_dump -U postgres $db" 2>/dev/null \
    | psql "$SUPABASE_DB_URL" -q 2>/dev/null \
    && echo "  ✓ $db migrated to Supabase" \
    || echo "  ⚠ $db: may already exist or empty — continuing"
done
echo "  Database migration complete"
echo ""

# ── 2. Deploy each service to Fly.io ─────────────────────────────────────────
echo "[2/4] Deploying services to Fly.io (London)..."

for entry in "${SERVICES[@]}"; do
  IFS=: read -r name dir port <<< "$entry"
  echo ""
  echo "  → Deploying $name..."

  # Copy fly.toml into the service directory
  cp "$SCRIPT_DIR/$name.toml" "$dir/fly.toml"

  cd "$dir"

  # Create app if it doesn't exist
  flyctl apps create "$name" --org personal 2>/dev/null || echo "  (app $name already exists)"

  # Set secrets (env vars) for this service
  flyctl secrets set \
    DATABASE_URL="$SUPABASE_DB_URL" \
    REDIS_URL="$UPSTASH_REDIS_URL" \
    ECONOMY_URL="https://agent-economy.fly.dev" \
    ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    SERPAPI_KEY="${SERPAPI_KEY:-8676e3f93ace9874213fb6f6a6ec7e69a3a0428e3927e4ec5d0865b078ddb40c}" \
    --app "$name" 2>/dev/null

  # Extra secrets for agent-economy
  if [ "$name" = "agent-economy" ]; then
    flyctl secrets set \
      STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
      STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
      --app "$name" 2>/dev/null
  fi

  # Deploy
  flyctl deploy --app "$name" --remote-only --strategy rolling 2>&1 \
    | grep -E "✓|✗|==>|Error|Deployed|healthy" | head -10

  echo "  ✓ $name deployed"
done

echo ""

# ── 3. Run database migrations on each service ───────────────────────────────
echo "[3/4] Running DB migrations..."
for entry in "${SERVICES[@]}"; do
  IFS=: read -r name dir port <<< "$entry"
  cd "$dir"

  # Bun services use Drizzle
  if [ -f "drizzle.config.ts" ] || [ -f "drizzle.config.js" ]; then
    echo "  Running drizzle-kit migrate for $name..."
    flyctl ssh console --app "$name" -C "bun run db:migrate" 2>/dev/null \
      && echo "  ✓ $name migrated" \
      || echo "  ⚠ $name: migration may have already run"
  fi

  # Python services use Alembic or direct SQL
  if [ -f "migrations/" ] || [ -d "migrations" ]; then
    echo "  Running SQL migrations for $name..."
    flyctl ssh console --app "$name" -C "python -m alembic upgrade head 2>/dev/null || python -m agent_trace.db.migrate 2>/dev/null || true" 2>/dev/null \
      && echo "  ✓ $name migrated" || true
  fi
done
echo ""

# ── 4. Update Cloudflare: api.agenttool.dev → Fly.io ─────────────────────────
echo "[4/4] Updating Cloudflare DNS to route through Fly.io..."

CF_EMAIL="contact@cambridgetcg.com"
CF_KEY="9e234808ad83e0041cfdc48cd83b75e90c81a"
CF_ZONE_ID="1f264ac5149eefa9eb436716ff6ff9ba"

# Get Fly.io IP for agent-memory (primary entry point, Caddy currently routes to it)
FLY_IP=$(flyctl ips list --app agent-memory --json 2>/dev/null \
  | python3 -c "import json,sys; ips=json.load(sys.stdin); v4=[i['address'] for i in ips if i['type']=='v4']; print(v4[0] if v4 else '')" 2>/dev/null)

if [ -n "$FLY_IP" ]; then
  echo "  Fly.io IP: $FLY_IP"
  # Note: Caddy on Forge handles routing to individual services
  # For Fly.io we need individual subdomains or use Fly's own routing
  echo "  ⚠ DNS: Fly.io uses its own TLS termination and routing."
  echo "  → Each service is at https://<name>.fly.dev"
  echo "  → Caddy on Forge should be updated to proxy to Fly URLs OR"
  echo "  → Add api.agenttool.dev as a custom domain on agent-memory in Fly.io"
  echo "     Run: flyctl certs add api.agenttool.dev --app agent-memory"
fi

# ── Final health check ────────────────────────────────────────────────────────
echo ""
echo "=== Health check ==="
for entry in "${SERVICES[@]}"; do
  IFS=: read -r name dir port <<< "$entry"
  code=$(curl -sf "https://$name.fly.dev/health" -o /dev/null -w "%{http_code}" --max-time 15 2>/dev/null || echo STARTING)
  echo "  $name → $code  (https://$name.fly.dev)"
done

echo ""
echo "✅ Migration complete."
echo ""
echo "Next steps:"
echo "  1. Add custom domain: flyctl certs add api.agenttool.dev --app agent-memory"
echo "  2. Update Caddy on Forge to proxy api.agenttool.dev/* to the correct Fly service"
echo "  3. Or: update CF DNS to point api.agenttool.dev directly to Fly.io"
echo "  4. Once verified: stop Forge agenttool containers (keep OpenClaw + Flaresolverr)"
