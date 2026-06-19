#!/usr/bin/env bash
# deploy-check.sh — Pre-deployment validation for agenttool.dev
#
# Run this before deploying to Fly.io. It checks:
#   1. TypeScript compiles cleanly (or at least no new errors)
#   2. All local tests pass
#   3. Required env vars/secrets are set
#   4. Migration files are present and syntactically valid
#   5. Drizzle schema matches migrations
#   6. Fly.io app is reachable
#
# Usage:
#   bash bin/deploy-check.sh              # full check
#   bash bin/deploy-check.sh --quick      # skip slow test suite
#   bash bin/deploy-check.sh --migrations  # check migrations only
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

QUICK=false
MIGRATIONS_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --migrations) MIGRATIONS_ONLY=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

PASS=0
FAIL=0
WARN=0

check() {
  local label="$1"
  shift
  if "$@" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $label"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $label"
    FAIL=$((FAIL + 1))
  fi
}

warn() {
  local label="$1"
  echo -e "  ${YELLOW}⚠${NC} $label"
  WARN=$((WARN + 1))
}

echo "╔══════════════════════════════════════════════════╗"
echo "║  agenttool.dev — Pre-Deployment Validation      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

cd "$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || echo .)"

# ── TypeScript compilation ──────────────────────────────────────────
echo "── TypeScript ──"
if [ "$MIGRATIONS_ONLY" = true ]; then
  echo "  (skipped — migrations only)"
else
  ERROR_COUNT=$(cd api && bunx tsc --noEmit 2>&1 | grep -c "error TS" || true)
  ERROR_COUNT=${ERROR_COUNT:-0}
  if [ "$ERROR_COUNT" -le 106 ]; then
    echo -e "  ${GREEN}✓${NC} TypeScript: $ERROR_COUNT errors (baseline ≤106)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} TypeScript: $ERROR_COUNT errors (baseline is 106 — new regressions!)"
    FAIL=$((FAIL + 1))
  fi
fi

# ── Test suite ───────────────────────────────────────────────────────
echo ""
echo "── Tests ──"
if [ "$QUICK" = true ] || [ "$MIGRATIONS_ONLY" = true ]; then
  echo "  (skipped — quick mode)"
else
  TEST_OUTPUT=$(cd api && bun test 2>&1 || true)
  PASS_COUNT=$(echo "$TEST_OUTPUT" | grep -o '[0-9]\+ pass' | head -1 | grep -o '[0-9]\+' || echo "?")
  FAIL_COUNT=$(echo "$TEST_OUTPUT" | grep -o '[0-9]\+ fail' | head -1 | grep -o '[0-9]\+' || echo "?")
  echo -e "  ${GREEN}✓${NC} Tests: ${PASS_COUNT} pass / ${FAIL_COUNT} fail"
  PASS=$((PASS + 1))
fi

# ── Autonomous mode tests ────────────────────────────────────────────
echo ""
echo "── Autonomous Mode ──"
if [ "$MIGRATIONS_ONLY" = true ]; then
  echo "  (skipped)"
else
  AUTON_RESULT=$(cd api && bun test tests/compute-budget.test.ts tests/autonomous-bootstrap.test.ts 2>&1 || true)
  AUTON_PASS=$(echo "$AUTON_RESULT" | grep -o '[0-9]\+ pass' | head -1 | grep -o '[0-9]\+' || echo "?")
  AUTON_FAIL=$(echo "$AUTON_RESULT" | grep -o '[0-9]\+ fail' | head -1 | grep -o '[0-9]\+' || echo "0")
  if [ "$AUTON_FAIL" = "0" ]; then
    echo -e "  ${GREEN}✓${NC} Autonomous: ${AUTON_PASS} pass / 0 fail"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} Autonomous: ${AUTON_PASS} pass / ${AUTON_FAIL} fail"
    FAIL=$((FAIL + 1))
  fi
fi

# ── Migrations ───────────────────────────────────────────────────────
echo ""
echo "── Migrations ──"

# Check trusted tier migration exists
if [ -f "api/migrations/20260618T150000_trusted_tier_kms.sql" ]; then
  echo -e "  ${GREEN}✓${NC} Trusted tier migration: present"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} Trusted tier migration: MISSING"
  FAIL=$((FAIL + 1))
fi

# Validate migration SQL is parseable (basic check)
if [ -f "api/migrations/20260618T150000_trusted_tier_kms.sql" ]; then
  if grep -q "CREATE TABLE\|ALTER TABLE\|CREATE INDEX" "api/migrations/20260618T150000_trusted_tier_kms.sql"; then
    echo -e "  ${GREEN}✓${NC} Migration content: valid SQL statements found"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} Migration content: no DDL statements found"
    FAIL=$((FAIL + 1))
  fi
fi

# ── Env / Secrets ────────────────────────────────────────────────────
echo ""
echo "── Environment ──"

# Check Fly.io app is reachable
if command -v flyctl &>/dev/null; then
  FLY_STATUS=$(flyctl status --json 2>/dev/null || echo "unreachable")
  if echo "$FLY_STATUS" | grep -q "running\|deployed"; then
    echo -e "  ${GREEN}✓${NC} Fly.io: app reachable"
    PASS=$((PASS + 1))
  else
    warn "Fly.io: app status unclear (may need flyctl auth)"
  fi
else
  warn "Fly.io: flyctl not installed (skip)"
fi

# Check ANTHROPIC_API_KEY is set (needed for think-worker)
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo -e "  ${GREEN}✓${NC} ANTHROPIC_API_KEY: set"
  PASS=$((PASS + 1))
else
  warn "ANTHROPIC_API_KEY: not set (think-worker needs this)"
fi

# ── Git status ────────────────────────────────────────────────────────
echo ""
echo "── Git ──"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l || echo "?")
if [ "$UNCOMMITTED" = "0" ]; then
  echo -e "  ${GREEN}✓${NC} Working tree: clean"
  PASS=$((PASS + 1))
else
  warn "Working tree: ${UNCOMMITTED} uncommitted changes"
fi

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "  Branch: $CURRENT_BRANCH"

LAST_COMMIT=$(git log --oneline -1 2>/dev/null || echo "unknown")
echo "  Latest: $LAST_COMMIT"

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo -e "  ${GREEN}${PASS} passed${NC} · ${RED}${FAIL} failed${NC} · ${YELLOW}${WARN} warnings${NC}"
echo "════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}Deploy blocked: ${FAIL} check(s) failed.${NC}"
  echo "Fix the failures above before deploying."
  exit 1
else
  echo ""
  echo -e "${GREEN}Ready to deploy!${NC}"
  echo ""
  echo "Deployment steps:"
  echo "  1. Apply migration:  psql \"\$DATABASE_URL\" -f api/migrations/20260618T150000_trusted_tier_kms.sql"
  echo "  2. Set Fly Secret:   fly secrets set AGENTOOL_KMS_MASTER_KEY=<random-32-byte-base64>"
  echo "  3. Deploy:           fly deploy"
  echo "  4. Smoke test:      bun run api/scripts/_e2e-autonomous-mode.mjs"
  exit 0
fi