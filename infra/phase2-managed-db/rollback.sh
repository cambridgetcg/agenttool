#!/bin/bash
# Phase 2 Rollback: revert services back to kingdom-postgres on Forge
# Run if anything goes wrong after phase2/deploy.sh
set -euo pipefail

source "$(dirname "$0")/../.env.infra" 2>/dev/null || true
FORGE_IP="${FORGE_IP:-89.167.84.100}"
DB_USER="${DB_USER:-kingdom}"
DB_PASS="${DB_PASS:-zMj9TbCmDBHD6FvoOel3qLy2XfhoxU5}"

echo "=== Phase 2 Rollback: reverting to kingdom-postgres ==="

ssh root@$FORGE_IP "
  # Revert all services back to local postgres (via pgbouncer if present, else direct)
  TARGET=pgbouncer:6432
  if ! docker ps --format '{{.Names}}' | grep -q pgbouncer; then
    TARGET=kingdom-postgres:5432
  fi

  for svc in agent-memory agent-tools agent-verify agent-economy agent-trace; do
    if [ -f /root/\$svc/.env ]; then
      # Restore user/pass
      sed -i \"s|${MANAGED_DB_USER:-postgres}:${MANAGED_DB_PASS:-}|\${DB_USER}:\${DB_PASS}|g\" /root/\$svc/.env 2>/dev/null || true
      # Restore host
      sed -i \"s|${MANAGED_DB_HOST:-managed}:${MANAGED_DB_PORT:-5432}|\$TARGET|g\" /root/\$svc/.env 2>/dev/null || true
      echo \"  Reverted \$svc/.env\"
    fi
  done

  cd /root && bash start-all.sh
  sleep 5

  echo '=== Health after rollback ==='
  for port in 8001 8002 8003 8004 8005; do
    code=\$(curl -sf http://localhost:\$port/health -o /dev/null -w '%{http_code}' 2>/dev/null || echo FAIL)
    echo \"  :\$port → \$code\"
  done
" 2>&1

echo ""
echo "✅ Rollback complete. Services back on local PostgreSQL."
echo "   Note: The managed DB ($MANAGED_DB_ID) is still running — delete it manually"
echo "   via Hetzner console if you want to stop the billing."
