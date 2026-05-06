#!/bin/bash
# rename-apps.sh — Migrate live Fly apps from `atool-*` to `agent-*` names.
#
# Run ONCE after merging the consolidate-names commit. Repo configs already
# point at the new names; this script creates the new Fly apps, sets secrets,
# deploys from the renamed configs, updates dependents (agent-bootstrap's
# VAULT_URL), and prints destroy commands for the old apps — to be run by you
# after manual verification of traffic cutover.
#
# Run from anywhere; paths resolve via SCRIPT_DIR / REPO_ROOT.
#   source infra/.env.infra && bash infra/fly/rename-apps.sh
set -euo pipefail

export PATH="$PATH:$HOME/.fly/bin"

# ── Required env vars ─────────────────────────────────────────────────────────
: "${FLY_API_TOKEN:?Set FLY_API_TOKEN from: flyctl auth token}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL}"
: "${UPSTASH_REDIS_URL:?Set UPSTASH_REDIS_URL}"
: "${VAULT_MASTER_KEY:?Set VAULT_MASTER_KEY (must match the live atool-vault key)}"

export FLY_API_TOKEN

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# format:  <old-fly-app>:<new-fly-app>:<service-dir>:<config-toml-basename>
MIGRATIONS=(
  "atool-vault:agent-vault:services/vault:agent-vault.toml"
  "atool-proof:agent-verify:services/verify:agent-verify.toml"
)

echo "=== Fly app rename: atool-* → agent-* ==="
echo ""

for entry in "${MIGRATIONS[@]}"; do
  IFS=: read -r OLD NEW DIR TOML <<< "$entry"
  CONFIG="$SCRIPT_DIR/$TOML"

  echo "──────────────────────────────────────────────────"
  echo " $OLD → $NEW"
  echo "──────────────────────────────────────────────────"

  # Sanity: old app exists; if new exists, skip create.
  if ! flyctl status --app "$OLD" >/dev/null 2>&1; then
    echo "  ⚠ Old app '$OLD' not found on Fly — skipping (already migrated?)."
    continue
  fi
  if flyctl status --app "$NEW" >/dev/null 2>&1; then
    echo "  ⚠ New app '$NEW' already exists — skipping create, will redeploy."
  else
    echo "  → Creating $NEW..."
    flyctl apps create "$NEW" --org personal
  fi

  # Per-service extra secrets
  EXTRA_ARGS=()
  case "$NEW" in
    agent-vault)
      EXTRA_ARGS+=("VAULT_MASTER_KEY=$VAULT_MASTER_KEY")
      ;;
  esac

  echo "  → Setting secrets on $NEW..."
  cd "$REPO_ROOT/$DIR"
  flyctl secrets set \
    DATABASE_URL="$SUPABASE_DB_URL" \
    REDIS_URL="$UPSTASH_REDIS_URL" \
    ECONOMY_URL="https://agent-economy.fly.dev" \
    "${EXTRA_ARGS[@]}" \
    --app "$NEW" --stage 2>&1 | grep -v 'release pending' || true

  echo "  → Deploying $NEW from $TOML..."
  flyctl deploy --app "$NEW" --config "$CONFIG" --remote-only --strategy rolling 2>&1 \
    | grep -E "✓|✗|==>|Error|Deployed|healthy" | head -10

  echo "  → Health check..."
  HEALTHY=0
  for i in 1 2 3 4 5 6; do
    code=$(curl -sf "https://$NEW.fly.dev/health" -o /dev/null -w "%{http_code}" --max-time 15 2>/dev/null || echo "")
    if [ "$code" = "200" ]; then
      echo "    ✓ $NEW healthy (200)"
      HEALTHY=1
      break
    fi
    echo "    waiting for $NEW... ($i/6)"
    sleep 5
  done
  if [ "$HEALTHY" -ne 1 ]; then
    echo "  ✗ $NEW did not return 200 from /health within 30s. Investigate before destroying $OLD."
  fi

  echo ""
done

# ── Update dependents ─────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────"
echo " Updating dependents"
echo "──────────────────────────────────────────────────"
echo "  → agent-bootstrap: VAULT_URL → https://agent-vault.fly.dev"
flyctl secrets set \
  VAULT_URL="https://agent-vault.fly.dev" \
  --app agent-bootstrap 2>&1 | grep -v 'release pending' || true

echo ""
echo "✅ New apps deployed. Dependents updated."
echo ""
echo "── MANUAL STEPS REMAINING ─────────────────────────"
echo ""
echo "  1. If api.agenttool.dev/v1/verify or /v1/vault routes through Caddy"
echo "     or a load balancer, update those rules to point at the new URLs:"
echo "       https://agent-vault.fly.dev"
echo "       https://agent-verify.fly.dev"
echo ""
echo "  2. Watch traffic on the OLD apps for a few hours. When it drops"
echo "     to zero (no in-flight clients), they are safe to destroy:"
echo ""
echo "       flyctl logs --app atool-vault   # confirm no recent traffic"
echo "       flyctl logs --app atool-proof"
echo ""
echo "  3. Destroy the old apps (irreversible):"
echo ""
echo "       flyctl apps destroy atool-vault --yes"
echo "       flyctl apps destroy atool-proof --yes"
echo ""
echo "  4. Verify final state — should show 9 apps, all agent-*:"
echo ""
echo "       flyctl apps list"
echo ""
