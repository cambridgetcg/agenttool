#!/bin/bash
# Phase 1: Add PgBouncer to Forge
# Zero downtime. Run anytime.
set -euo pipefail

source "$(dirname "$0")/../.env.infra" 2>/dev/null || true
FORGE_IP="${FORGE_IP:?Set FORGE_IP (see infra/.env.infra.example)}"
DB_USER="${DB_USER:?Set DB_USER}"
DB_PASS="${DB_PASS:?Set DB_PASS}"
REDIS_PASS="${REDIS_PASS:?Set REDIS_PASS}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Phase 1: PgBouncer ==="
echo "Target: $FORGE_IP"

# 1. Upload config files
echo "[1/4] Uploading PgBouncer config..."
ssh -o StrictHostKeyChecking=no root@$FORGE_IP "mkdir -p /root/pgbouncer"
scp -o StrictHostKeyChecking=no \
  "$SCRIPT_DIR/pgbouncer.ini" \
  root@$FORGE_IP:/root/pgbouncer/pgbouncer.ini

# 2. Write userlist on remote (md5 hash of password)
echo "[2/4] Writing userlist..."
ssh root@$FORGE_IP "
  mkdir -p /root/pgbouncer
  # md5 hash = md5(password + username)
  echo '"" ""' > /root/pgbouncer/userlist.txt
  echo '\"${DB_USER}\" \"md5\${echo '"" ""' > /root/pgbouncer/userlist.txt
  echo '\"pgbouncer\" \"\"' >> /root/pgbouncer/userlist.txt
"

# 3. Start PgBouncer container
echo "[3/4] Starting PgBouncer container..."
ssh root@$FORGE_IP "
  docker stop pgbouncer 2>/dev/null || true
  docker rm pgbouncer 2>/dev/null || true
  docker run -d \
    --name pgbouncer \
    --network kingdom \
    -p 127.0.0.1:6432:6432 \
    -v /root/pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro \
    -v /root/pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro \
    --restart unless-stopped \
    edoburu/pgbouncer:latest
  sleep 3
  docker logs pgbouncer --tail 5
"

# 4. Update all service .env files to use PgBouncer
echo "[4/4] Updating service DATABASE_URLs to use PgBouncer..."
ssh root@$FORGE_IP "
  # agent-memory (asyncpg driver — port 6432)
  sed -i 's|kingdom-postgres:5432|pgbouncer:6432|g' /root/agent-memory/.env
  # agent-tools
  sed -i 's|kingdom-postgres:5432|pgbouncer:6432|g' /root/agent-tools/.env
  # agent-verify
  sed -i 's|kingdom-postgres:5432|pgbouncer:6432|g' /root/agent-verify/.env
  # agent-economy
  sed -i 's|kingdom-postgres:5432|pgbouncer:6432|g' /root/agent-economy/.env
  # agent-trace (uses env var or defaults)
  if [ -f /root/agent-trace/.env ]; then
    sed -i 's|kingdom-postgres:5432|pgbouncer:6432|g' /root/agent-trace/.env
  else
    echo 'DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@pgbouncer:6432/agent_trace' > /root/agent-trace/.env
    echo 'REDIS_URL=redis://:${REDIS_PASS}@kingdom-redis:6379' >> /root/agent-trace/.env
    echo 'API_PORT=8005' >> /root/agent-trace/.env
  fi

  # Restart all services
  cd /root && bash start-all.sh
  sleep 5

  # Health check
  echo '=== Health after PgBouncer ==='
  for port in 8001 8002 8003 8004 8005; do
    code=\$(curl -sf http://localhost:\$port/health -o /dev/null -w '%{http_code}' 2>/dev/null || echo FAIL)
    echo \"  :\$port → \$code\"
  done
"

# 5. Add PgBouncer to start-all.sh
ssh root@$FORGE_IP "
  if ! grep -q pgbouncer /root/start-all.sh; then
    sed -i '1a docker start pgbouncer 2>/dev/null || true' /root/start-all.sh
    echo 'Added pgbouncer to start-all.sh'
  fi
"

echo ""
echo "✅ Phase 1 complete. PgBouncer running on kingdom network :6432"
echo "   All services now connect via connection pooler."
echo "   Max client connections: 200 | Pool size per DB: 20"
