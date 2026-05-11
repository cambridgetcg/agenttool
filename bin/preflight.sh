#!/usr/bin/env bash
# bin/preflight.sh — the unified pre-deploy gate.
#
# Runs every test layer in order, gating each on the previous. Exit code
# is non-zero on any failure. This is the single command an operator
# should run before `bin/frontend-deploy.sh` or `cd api && fly deploy`.
#
# Layers, in order of cost:
#
#   1. Typecheck      — api + sdk-ts (free, fast, catches half of regressions)
#   2. Unit tests     — api/ + packages/sdk-ts/ (no network, no DB)
#   3. SDK parity     — py↔ts surface (only meaningful if SDK changed)
#   4. Smoke harness  — bin/smoke-test.sh against $AGENTTOOL_BASE
#                       (includes the wake-doctrine route-level harness)
#   5. Contract       — real LLM provider calls; gated on RUN_CONTRACT=1
#                       + ANTHROPIC_API_KEY / OPENAI_API_KEY. Verifies the
#                       wake's cache_control fires on Anthropic, auto-cache
#                       fires on OpenAI, and the agent BEHAVES as the wake
#                       describes (identity, walls, register, witness).
#
# Optional layers (run separately, gated on credentials):
#   - Playwright e2e — cd tests/playwright && npx playwright test
#
# Required env (only for layer 4):
#   AGENTTOOL_BASE          e.g. http://localhost:3000 or https://api.agenttool.dev
#   AGENTTOOL_API_KEY       a valid bearer with read access
#   AGENTTOOL_IDENTITY_ID   the agent's identity UUID (smoke-test.sh requirement)
#
# Optional env:
#   SKIP_SMOKE=1     skip layer 4 (e.g. when no server reachable from this machine)
#   SKIP_PARITY=1    skip layer 3 (when no SDK changes are pending)
#   RUN_CONTRACT=1   enable layer 5 (real LLM calls; default off)
#   ANTHROPIC_API_KEY  enables layer 5's anthropic suite
#   OPENAI_API_KEY     enables layer 5's openai suite
#
# Usage:
#   bin/preflight.sh
#   SKIP_SMOKE=1 bin/preflight.sh           # fast unit-only gate
#   AGENTTOOL_BASE=http://localhost:3000 \
#     AGENTTOOL_API_KEY=$(bin/agenttool-secret get agenttool-soma-bearer) \
#     AGENTTOOL_IDENTITY_ID=$(bin/agenttool-secret get agenttool-sophia-identity-id) \
#     bin/preflight.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Output helpers ─────────────────────────────────────────────────────

layer_pass=0
layer_fail=0
layer_skip=0

bold()   { printf "\033[1m%s\033[0m" "$1"; }
green()  { printf "\033[32m%s\033[0m" "$1"; }
red()    { printf "\033[31m%s\033[0m" "$1"; }
yellow() { printf "\033[33m%s\033[0m" "$1"; }

# Detect TTY: if NOT a terminal (e.g. piped), strip color codes.
if [ ! -t 1 ]; then
  bold()   { printf "%s" "$1"; }
  green()  { printf "%s" "$1"; }
  red()    { printf "%s" "$1"; }
  yellow() { printf "%s" "$1"; }
fi

layer_header() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  printf "  %s %s\n" "$(bold "Layer $1:")" "$2"
  echo "═══════════════════════════════════════════════════════════════"
}

layer_ok() {
  echo ""
  printf "  %s  Layer $1 — $2\n" "$(green '✓ PASS')"
  layer_pass=$((layer_pass + 1))
}

layer_no() {
  echo ""
  printf "  %s  Layer $1 — $2\n" "$(red '✗ FAIL')"
  layer_fail=$((layer_fail + 1))
}

layer_skipped() {
  echo ""
  printf "  %s  Layer $1 — $2\n" "$(yellow '⊘ SKIP')"
  layer_skip=$((layer_skip + 1))
}

run() {
  local label=$1
  shift
  echo ""
  echo "  $ $*"
  if "$@"; then
    return 0
  else
    echo ""
    printf "    %s  $label\n" "$(red 'failed')"
    return 1
  fi
}

# ── Layer 1: Typecheck ────────────────────────────────────────────────

layer_header "1" "typecheck (api + sdk-ts)"

LAYER1_OK=true

if ! run "api typecheck" bash -c "cd api && bunx tsc --noEmit"; then
  LAYER1_OK=false
fi
if ! run "sdk-ts typecheck" bash -c "cd packages/sdk-ts && bunx tsc --noEmit"; then
  LAYER1_OK=false
fi

if $LAYER1_OK; then
  layer_ok "1" "typecheck clean"
else
  layer_no "1" "typecheck failed — fix before proceeding"
  echo ""
  echo "Aborting preflight. Subsequent layers depend on a clean typecheck."
  exit 1
fi

# ── Layer 2: Unit tests + doctrine ────────────────────────────────────

layer_header "2" "unit tests + doctrine (api + sdk-ts)"

LAYER2_OK=true

if ! run "api bun test" bash -c "cd api && bun test"; then
  LAYER2_OK=false
fi
if ! run "sdk-ts bun test" bash -c "cd packages/sdk-ts && bun test"; then
  LAYER2_OK=false
fi

if $LAYER2_OK; then
  layer_ok "2" "all unit tests + doctrine green"
else
  layer_no "2" "unit / doctrine tests failed — fix before deploying"
  exit 1
fi

# ── Layer 3: SDK parity ────────────────────────────────────────────────

layer_header "3" "py↔ts SDK parity"

if [ "${SKIP_PARITY:-0}" = "1" ]; then
  layer_skipped "3" "skipped (SKIP_PARITY=1)"
elif ! run "sdk parity check" bash -c "cd packages/sdk-ts && bun run check-parity"; then
  layer_no "3" "SDK parity drift detected — add the missing method to whichever side lags"
  exit 1
else
  layer_ok "3" "py↔ts parity holds"
fi

# ── Layer 4: Smoke (route + wake-doctrine harness) ────────────────────

layer_header "4" "route smoke + wake-doctrine harness"

if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  layer_skipped "4" "skipped (SKIP_SMOKE=1)"
elif [ -z "${AGENTTOOL_BASE:-}" ] || [ -z "${AGENTTOOL_API_KEY:-}" ] || [ -z "${AGENTTOOL_IDENTITY_ID:-}" ]; then
  echo ""
  echo "  Set AGENTTOOL_BASE + AGENTTOOL_API_KEY + AGENTTOOL_IDENTITY_ID to enable."
  echo "  Or pass SKIP_SMOKE=1 to acknowledge running without route-level coverage."
  layer_skipped "4" "smoke env not set"
elif ! bash bin/smoke-test.sh; then
  layer_no "4" "smoke + doctrine harness reported failures"
  exit 1
else
  layer_ok "4" "smoke + doctrine harness all green"
fi

# ── Layer 5: Contract (real LLM provider calls) ───────────────────────

layer_header "5" "contract — wake on the wire (real LLM calls)"

if [ "${RUN_CONTRACT:-0}" != "1" ]; then
  echo ""
  echo "  Pass RUN_CONTRACT=1 + ANTHROPIC_API_KEY and/or OPENAI_API_KEY to enable."
  echo "  Costs ~\$0.10/run. Designed for nightly + pre-release, not every PR."
  layer_skipped "5" "skipped (RUN_CONTRACT=1 not set)"
elif [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  layer_skipped "5" "no provider API keys present"
elif ! run "contract tests" bash -c "cd api && bun test tests/contract"; then
  layer_no "5" "contract tests failed — wake's wire-level claim broke"
  exit 1
else
  layer_ok "5" "wake travels on the wire"
fi

# ── Summary ────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  $(bold 'preflight complete')"
echo "═══════════════════════════════════════════════════════════════"
printf "  layers passed:  %s\n" "$(green "$layer_pass")"
printf "  layers failed:  %s\n" "$(red "$layer_fail")"
printf "  layers skipped: %s\n" "$(yellow "$layer_skip")"
echo "═══════════════════════════════════════════════════════════════"

if [ "$layer_fail" -gt 0 ]; then
  echo ""
  echo "$(red 'NOT READY TO DEPLOY.') Fix the failures above and re-run."
  exit 1
fi

if [ "$layer_skip" -gt 0 ]; then
  echo ""
  echo "$(yellow 'Some layers were skipped.') Verify this is intentional before deploy."
fi

echo ""
echo "$(green 'Ready to deploy.') Next:"
echo "  bin/frontend-deploy.sh           # ~30-60s per CF Pages project"
echo "  cd api && fly deploy             # ~3-5 min rolling restart"
echo ""
