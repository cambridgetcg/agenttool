#!/usr/bin/env bash
# bin/edge-deploy.sh — deploy Supabase Edge Functions.
#
# Move 6 — public read-mostly surface ports to the edge for ~50ms cold
# start + CDN cacheability. The Bun api routes stay as fallback; the
# edge functions are the preferred path served from Cloudflare/Supabase
# infra.
#
# Usage:
#   bin/edge-deploy.sh                 # deploy all configured functions
#   bin/edge-deploy.sh welcome         # deploy a specific function
#   bin/edge-deploy.sh --dry-run       # show what would deploy
#
# Auth:
#   Requires `supabase` CLI installed (https://supabase.com/docs/guides/cli)
#   and a Supabase Management API token in keychain entry
#   `agenttool-supabase-management-token` (an sbp_… personal access token,
#   distinct from the project's sb_secret_… service-role key).
#
# Doctrine: docs/EDGE-SURFACE.md · docs/SUPABASE-INTEGRATION-PLAN.md § Move 6.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done

# ── Resolve Supabase management token ──────────────────────────────────
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  if command -v security >/dev/null 2>&1; then
    SUPABASE_ACCESS_TOKEN="$(bin/agenttool-secret get agenttool-supabase-management-token 2>/dev/null || true)"
  fi
fi
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "✗ SUPABASE_ACCESS_TOKEN not set in env or keychain (agenttool-supabase-management-token)" >&2
  echo "  Get one at: https://supabase.com/dashboard/account/tokens" >&2
  echo "  Store with: echo -n '<sbp_...>' | bin/agenttool-secret set agenttool-supabase-management-token -" >&2
  exit 1
fi
export SUPABASE_ACCESS_TOKEN

PROJECT_REF="$(bin/agenttool-secret get agenttool-supabase-project-ref 2>/dev/null || echo "")"
if [ -z "$PROJECT_REF" ]; then
  echo "✗ project ref missing from keychain (agenttool-supabase-project-ref)" >&2
  exit 1
fi

# ── Resolve supabase CLI ───────────────────────────────────────────────
SUPABASE_BIN=""
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_BIN="supabase"
elif [ -x "$HOME/.local/bin/supabase" ]; then
  SUPABASE_BIN="$HOME/.local/bin/supabase"
elif [ -x "/opt/homebrew/bin/supabase" ]; then
  SUPABASE_BIN="/opt/homebrew/bin/supabase"
fi
if [ -z "$SUPABASE_BIN" ]; then
  echo "✗ supabase CLI not found in PATH" >&2
  echo "  Install with: brew install supabase/tap/supabase" >&2
  echo "         or:    npm install -g supabase" >&2
  exit 1
fi

# ── Enumerate functions ────────────────────────────────────────────────
FUNCTIONS=()
for d in "$REPO_ROOT/supabase/functions"/*/; do
  [ -f "${d}index.ts" ] || continue
  name="$(basename "$d")"
  # Skip _shared dir
  [ "${name#_}" != "$name" ] && continue
  FUNCTIONS+=("$name")
done

if [ -n "$TARGET" ]; then
  # Only deploy the requested function.
  if [[ ! " ${FUNCTIONS[*]} " =~ " ${TARGET} " ]]; then
    echo "✗ unknown function: $TARGET" >&2
    echo "  available: ${FUNCTIONS[*]}" >&2
    exit 1
  fi
  FUNCTIONS=("$TARGET")
fi

# ── Dry run ────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = 1 ]; then
  echo "would deploy ${#FUNCTIONS[@]} function(s) to project $PROJECT_REF:"
  for f in "${FUNCTIONS[@]}"; do echo "  $f"; done
  exit 0
fi

# ── Deploy ─────────────────────────────────────────────────────────────
echo "deploying ${#FUNCTIONS[@]} function(s) to project $PROJECT_REF…"
for f in "${FUNCTIONS[@]}"; do
  echo ""
  echo "─── $f ───"
  if ! $SUPABASE_BIN functions deploy "$f" --project-ref "$PROJECT_REF" --no-verify-jwt; then
    echo "✗ deploy of $f failed" >&2
    exit 1
  fi
done

echo ""
echo "✓ all functions deployed"
echo ""
echo "verify:"
for f in "${FUNCTIONS[@]}"; do
  case "$f" in
    welcome)
      echo "  curl -sS https://${PROJECT_REF}.functions.supabase.co/welcome | head -c 200"
      ;;
    *)
      echo "  curl -sS https://${PROJECT_REF}.functions.supabase.co/$f"
      ;;
  esac
done
