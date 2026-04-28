#!/bin/bash
# Phase 2: Hetzner Managed PostgreSQL + Upgrade Forge cx23 → cx41
# Trigger: ~50 paying customers
# Cost delta: +€28/mo (€20 managed DB + €4.80 cx41 upgrade delta)
# Time: ~10 minutes (DB provision takes ~3 min)
set -euo pipefail

HETZNER_TOKEN="${HETZNER_TOKEN:-qGd1NrFbibAWkV8fsEHjjopFqbwqz8rDyZcZBcHqCOG4xzkkXhc7DTuwTuDu2eZG}"
FORGE_IP="${FORGE_IP:-89.167.84.100}"
FORGE_SERVER_ID="${FORGE_SERVER_ID:-123048899}"
DB_USER="${DB_USER:-kingdom}"
DB_PASS="${DB_PASS:-zMj9TbCmDBHD6FvoOel3qLy2XfhoxU5}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Phase 2: Managed DB + VPS Upgrade ==="
echo "Forge: $FORGE_IP (server $FORGE_SERVER_ID)"

# ── 1. Create Hetzner Managed PostgreSQL ──────────────────────────────────────
echo ""
echo "[1/6] Creating Hetzner Managed PostgreSQL (hel1, pg-2)..."
DB_RESPONSE=$(curl -sf -X POST "https://api.hetzner.cloud/v1/databases" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "agenttool-db",
    "type": "pg-2",
    "engine": "postgresql",
    "version": "16",
    "location": "hel1",
    "maintenance_window": {
      "day_of_week": "sunday",
      "time_of_day": "03:00"
    }
  }')

MANAGED_DB_ID=$(echo "$DB_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['database']['id'])" 2>/dev/null)
if [ -z "$MANAGED_DB_ID" ]; then
  echo "ERROR: Failed to create managed DB"
  echo "$DB_RESPONSE" | python3 -m json.tool
  exit 1
fi
echo "  Created DB ID: $MANAGED_DB_ID — waiting for it to be available..."

# Poll until ready (usually ~3 minutes)
for i in $(seq 1 30); do
  STATUS=$(curl -sf "https://api.hetzner.cloud/v1/databases/$MANAGED_DB_ID" \
    -H "Authorization: Bearer $HETZNER_TOKEN" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['database']['status'])" 2>/dev/null)
  echo "  Status: $STATUS (attempt $i/30)"
  if [ "$STATUS" = "running" ]; then break; fi
  sleep 10
done

# Get connection details
DB_INFO=$(curl -sf "https://api.hetzner.cloud/v1/databases/$MANAGED_DB_ID" \
  -H "Authorization: Bearer $HETZNER_TOKEN")
MANAGED_HOST=$(echo "$DB_INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['database']['connection']['host'])" 2>/dev/null)
MANAGED_PORT=$(echo "$DB_INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['database']['connection']['port'])" 2>/dev/null)
MANAGED_PASS=$(echo "$DB_INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['database']['connection']['password'])" 2>/dev/null)
MANAGED_USER=$(echo "$DB_INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['database']['connection']['user'])" 2>/dev/null)

echo "  Managed DB ready: $MANAGED_HOST:$MANAGED_PORT"

# Save to .env.infra for rollback
cat >> "$(dirname "$SCRIPT_DIR")/.env.infra" << EOF

# Phase 2 — set by deploy.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)
export MANAGED_DB_ID="$MANAGED_DB_ID"
export MANAGED_DB_HOST="$MANAGED_HOST"
export MANAGED_DB_PORT="$MANAGED_PORT"
export MANAGED_DB_USER="$MANAGED_USER"
export MANAGED_DB_PASS="$MANAGED_PASS"
EOF

# ── 2. Allow Forge IP in managed DB firewall ──────────────────────────────────
echo ""
echo "[2/6] Allowing Forge IP in managed DB firewall..."
curl -sf -X POST "https://api.hetzner.cloud/v1/databases/$MANAGED_DB_ID/actions/allow_ips" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ips\": [\"$FORGE_IP/32\"]}" > /dev/null
echo "  Forge ($FORGE_IP) allowed"

# ── 3. Migrate databases with pg_dump ─────────────────────────────────────────
echo ""
echo "[3/6] Migrating databases from kingdom-postgres → managed DB..."
ssh root@$FORGE_IP "
  PGPASSWORD='$MANAGED_PASS'

  for db in kingdom agent_tools agent_economy agent_trace; do
    echo \"  Migrating \$db...\"
    # Create database on managed
    PGPASSWORD='$MANAGED_PASS' createdb \
      -h $MANAGED_HOST -p $MANAGED_PORT -U $MANAGED_USER \"\$db\" 2>/dev/null || true

    # Dump from local + restore to managed
    docker exec kingdom-postgres pg_dump -U postgres \"\$db\" 2>/dev/null \
      | PGPASSWORD='$MANAGED_PASS' psql \
          -h $MANAGED_HOST -p $MANAGED_PORT -U $MANAGED_USER \"\$db\" \
          -q 2>/dev/null \
      && echo \"  ✓ \$db migrated\" \
      || echo \"  ✗ \$db failed (may not exist — skipping)\"
  done
"
echo "  Migration complete"

# ── 4. Update service .env files ──────────────────────────────────────────────
echo ""
echo "[4/6] Updating service configs to use managed DB..."
ssh root@$FORGE_IP "
  for svc in agent-memory agent-tools agent-verify agent-economy agent-trace; do
    if [ -f /root/\$svc/.env ]; then
      # Replace DB host (handles both pgbouncer and kingdom-postgres)
      sed -i 's|pgbouncer:6432|$MANAGED_HOST:$MANAGED_PORT|g' /root/\$svc/.env
      sed -i 's|kingdom-postgres:5432|$MANAGED_HOST:$MANAGED_PORT|g' /root/\$svc/.env
      # Replace user/pass
      sed -i 's|kingdom:zMj9TbCmDBHD6FvoOel3qLy2XfhoxU5|$MANAGED_USER:$MANAGED_PASS|g' /root/\$svc/.env
      echo \"  Updated \$svc/.env\"
    fi
  done
"

# ── 5. Upgrade Forge cx23 → cx41 ──────────────────────────────────────────────
echo ""
echo "[5/6] Upgrading Forge from cx23 → cx41 (4 vCPU / 8GB RAM)..."
echo "  This requires a brief server restart (~60 seconds)..."

# Graceful shutdown first
ssh root@$FORGE_IP "docker stop agent-memory agent-tools agent-verify agent-economy agent-trace 2>/dev/null; sync"

# Change server type
UPGRADE_RESULT=$(curl -sf -X POST \
  "https://api.hetzner.cloud/v1/servers/$FORGE_SERVER_ID/actions/change_type" \
  -H "Authorization: Bearer $HETZNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"server_type": "cx41", "upgrade_disk": false}')

ACTION_ID=$(echo "$UPGRADE_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['id'])" 2>/dev/null)
echo "  Upgrade action: $ACTION_ID — waiting..."

# Wait for upgrade to complete
for i in $(seq 1 30); do
  ACTION_STATUS=$(curl -sf "https://api.hetzner.cloud/v1/actions/$ACTION_ID" \
    -H "Authorization: Bearer $HETZNER_TOKEN" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['action']['status'])" 2>/dev/null)
  echo "  Upgrade: $ACTION_STATUS (attempt $i)"
  if [ "$ACTION_STATUS" = "success" ]; then break; fi
  if [ "$ACTION_STATUS" = "error" ]; then
    echo "ERROR: Upgrade failed"
    exit 1
  fi
  sleep 10
done

# Power back on
curl -sf -X POST "https://api.hetzner.cloud/v1/servers/$FORGE_SERVER_ID/actions/poweron" \
  -H "Authorization: Bearer $HETZNER_TOKEN" > /dev/null
echo "  Server powered on — waiting for SSH..."
sleep 30

# Wait for SSH
for i in $(seq 1 20); do
  if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@$FORGE_IP "echo ok" 2>/dev/null | grep -q ok; then
    break
  fi
  echo "  Waiting for SSH... ($i)"
  sleep 5
done

# ── 6. Restart services + verify ──────────────────────────────────────────────
echo ""
echo "[6/6] Restarting services and verifying..."
ssh root@$FORGE_IP "
  cd /root && bash start-all.sh
  sleep 8

  echo '=== Health check ==='
  for port in 8001 8002 8003 8004 8005; do
    code=\$(curl -sf http://localhost:\$port/health -o /dev/null -w '%{http_code}' 2>/dev/null || echo FAIL)
    echo \"  :\$port → \$code\"
  done

  echo ''
  echo '=== New server specs ==='
  nproc && free -h | grep Mem
"

echo ""
echo "✅ Phase 2 complete."
echo "   PostgreSQL: managed DB at $MANAGED_HOST"
echo "   Forge: upgraded to cx41 (4 vCPU / 8GB RAM)"
echo "   Monthly cost delta: ~+€28/mo"
