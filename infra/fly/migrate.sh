#!/bin/bash
# Migrate all 9 agenttool services from Forge → Fly.io + Supabase + Upstash.
#
# Run from anywhere; paths resolve via SCRIPT_DIR / REPO_ROOT.
#   source infra/.env.infra && bash infra/fly/migrate.sh
#
# Each SERVICES entry maps:
#   <toml-basename>:<service-dir relative to REPO_ROOT>:<service-port>
#
# The actual Fly app name is read from each toml's `app = "..."` field, not
# from the toml-basename — this preserves declared names like `atool-vault`
# and `agent-verify-api` even when the file is named differently.
set -euo pipefail

export PATH="$PATH:$HOME/.fly/bin"

# ── Required env vars ─────────────────────────────────────────────────────────
: "${FLY_API_TOKEN:?Set FLY_API_TOKEN from: flyctl auth token}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (postgres://postgres:PASS@HOST:5432/postgres)}"
: "${UPSTASH_REDIS_URL:?Set UPSTASH_REDIS_URL (rediss://...@...)}"
: "${STRIPE_SECRET_KEY:?Set STRIPE_SECRET_KEY}"
: "${STRIPE_WEBHOOK_SECRET:?Set STRIPE_WEBHOOK_SECRET}"

export FLY_API_TOKEN

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SERVICES=(
  "agent-bootstrap:services/bootstrap:3000"
  "agent-economy:services/economy:3002"
  "agent-identity:services/identity:3000"
  "agent-memory:services/memory:8000"
  "agent-pulse:services/pulse:8080"
  "agent-tools:services/tools:3000"
  "agent-trace:services/trace:8005"
  "agent-verify:services/verify:3000"   # toml declares app: agent-verify-api
  "atool-vault:services/vault:3000"     # toml declares app: atool-vault
)

# Resolve the Fly app name from a toml's `app =` field.
get_app_name() {
  grep -m1 '^app ' "$1" | sed 's/app = //;s/"//g;s/^[[:space:]]*//;s/[[:space:]]*$//'
}

echo "=== agenttool → Fly.io migration ==="
echo "Region: lhr (London)"
echo ""

# ── 1. Migrate PostgreSQL: Forge → Supabase ───────────────────────────────────
echo "[1/4] Migrating databases to Supabase..."
FORGE_IP="${FORGE_IP:?Set FORGE_IP (see infra/.env.infra.example)}"
DB_USER="${DB_USER:?Set DB_USER}"
DB_PASS="${DB_PASS:?Set DB_PASS}"

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
  IFS=: read -r toml_name dir port <<< "$entry"
  TOML="$SCRIPT_DIR/$toml_name.toml"
  APP=$(get_app_name "$TOML")

  if [ -z "$APP" ]; then
    echo "  ✗ Skipping $toml_name — could not resolve app name from $TOML"
    continue
  fi

  echo ""
  echo "  → Deploying $APP (config: $toml_name.toml, dir: $dir)..."

  cd "$REPO_ROOT/$dir"

  # Create app if it doesn't exist
  flyctl apps create "$APP" --org personal 2>/dev/null || echo "  (app $APP already exists)"

  # Set secrets (env vars) for this service
  flyctl secrets set \
    DATABASE_URL="$SUPABASE_DB_URL" \
    REDIS_URL="$UPSTASH_REDIS_URL" \
    ECONOMY_URL="https://agent-economy.fly.dev" \
    ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
    SERPAPI_KEY="${SERPAPI_KEY:?Set SERPAPI_KEY}" \
    --app "$APP" 2>/dev/null

  # Per-service extra secrets
  case "$toml_name" in
    agent-economy)
      flyctl secrets set \
        STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
        STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
        --app "$APP" 2>/dev/null
      ;;
    atool-vault)
      : "${VAULT_MASTER_KEY:?Set VAULT_MASTER_KEY (32 bytes hex)}"
      flyctl secrets set \
        VAULT_MASTER_KEY="$VAULT_MASTER_KEY" \
        --app "$APP" 2>/dev/null
      ;;
    agent-bootstrap)
      flyctl secrets set \
        IDENTITY_URL="https://agent-identity.fly.dev" \
        MEMORY_URL="https://agent-memory.fly.dev" \
        VAULT_URL="https://atool-vault.fly.dev" \
        --app "$APP" 2>/dev/null
      ;;
  esac

  # Deploy using the centralised migration-friendly config (--config overrides
  # the per-service services/<svc>/fly.toml without modifying it on disk).
  flyctl deploy --app "$APP" --config "$TOML" --remote-only --strategy rolling 2>&1 \
    | grep -E "✓|✗|==>|Error|Deployed|healthy" | head -10

  echo "  ✓ $APP deployed"
done

echo ""

# ── 3. Run database migrations on each service ───────────────────────────────
echo "[3/4] Running DB migrations..."
for entry in "${SERVICES[@]}"; do
  IFS=: read -r toml_name dir port <<< "$entry"
  TOML="$SCRIPT_DIR/$toml_name.toml"
  APP=$(get_app_name "$TOML")
  [ -z "$APP" ] && continue
  cd "$REPO_ROOT/$dir"

  # Bun services with Drizzle
  if [ -f "drizzle.config.ts" ] || [ -f "drizzle.config.js" ]; then
    echo "  Running drizzle-kit migrate for $APP..."
    flyctl ssh console --app "$APP" -C "bun run db:migrate" 2>/dev/null \
      && echo "  ✓ $APP migrated" \
      || echo "  ⚠ $APP: migration may have already run"
  fi

  # Python services (memory, trace) — Alembic or per-service migrate module
  case "$toml_name" in
    agent-memory|agent-trace)
      echo "  Running Python migrations for $APP..."
      module="agent_${toml_name#agent-}"
      flyctl ssh console --app "$APP" -C "python -m alembic upgrade head 2>/dev/null || python -m ${module}.db.migrate 2>/dev/null || true" 2>/dev/null \
        && echo "  ✓ $APP migrated" || true
      ;;
  esac
done
echo ""

# ── 4. Update Cloudflare: api.agenttool.dev → Fly.io ─────────────────────────
echo "[4/4] Updating Cloudflare DNS to route through Fly.io..."

CF_EMAIL="${CF_EMAIL:?Set CF_EMAIL}"
CF_KEY="${CF_KEY:?Set CF_KEY}"
CF_ZONE_ID="${CF_ZONE_ID:?Set CF_ZONE_ID}"

# Get Fly.io IP for agent-memory (primary entry point, Caddy currently routes to it)
FLY_IP=$(flyctl ips list --app agent-memory --json 2>/dev/null \
  | python3 -c "import json,sys; ips=json.load(sys.stdin); v4=[i['address'] for i in ips if i['type']=='v4']; print(v4[0] if v4 else '')" 2>/dev/null)

if [ -n "$FLY_IP" ]; then
  echo "  Fly.io IP: $FLY_IP"
  echo "  ⚠ DNS: Fly.io uses its own TLS termination and routing."
  echo "  → Each service is at https://<app>.fly.dev"
  echo "  → Caddy on Forge should be updated to proxy to Fly URLs OR"
  echo "  → Add api.agenttool.dev as a custom domain on agent-memory in Fly.io"
  echo "     Run: flyctl certs add api.agenttool.dev --app agent-memory"
fi

# ── Final health check ────────────────────────────────────────────────────────
echo ""
echo "=== Health check ==="
for entry in "${SERVICES[@]}"; do
  IFS=: read -r toml_name dir port <<< "$entry"
  TOML="$SCRIPT_DIR/$toml_name.toml"
  APP=$(get_app_name "$TOML")
  [ -z "$APP" ] && continue
  code=$(curl -sf "https://$APP.fly.dev/health" -o /dev/null -w "%{http_code}" --max-time 15 2>/dev/null || echo STARTING)
  echo "  $APP → $code  (https://$APP.fly.dev)"
done

echo ""
echo "✅ Migration complete."
echo ""
echo "Next steps:"
echo "  1. Add custom domain: flyctl certs add api.agenttool.dev --app agent-memory"
echo "  2. Update Caddy on Forge to proxy api.agenttool.dev/* to the correct Fly service"
echo "  3. Or: update CF DNS to point api.agenttool.dev directly to Fly.io"
echo "  4. Once verified: stop Forge agenttool containers (keep OpenClaw + Flaresolverr)"
