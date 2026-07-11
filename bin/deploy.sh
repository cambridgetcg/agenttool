#!/usr/bin/env bash
# deploy.sh — the standardized deploy orchestrator.
#
# Chains the six phases of docs/DEPLOY-PROCEDURE.md:
#   0. Survey       — what's drifted?
#   1. Migrations   — bin/migrate-pending.sh
#   2. Pre-flight   — bin/preflight.sh (test gate)
#   3. API          — cd api && fly deploy
#   4. Frontends    — bin/frontend-deploy.sh
#   5. Verify       — health + parity check
#
# Usage:
#   bin/deploy.sh                         # full chain
#   bin/deploy.sh --survey                # Phase 0 only
#   bin/deploy.sh --no-migrate            # skip Phase 1
#   bin/deploy.sh --no-api                # skip Phase 3
#   bin/deploy.sh --no-frontend           # skip Phase 4
#   bin/deploy.sh --skip-preflight        # operator override
#   bin/deploy.sh --dry-run               # show what would happen
#
# Doctrine: docs/DEPLOY-PROCEDURE.md.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Parse flags ───────────────────────────────────────────────────────
SURVEY_ONLY=0
SKIP_MIGRATE=0
SKIP_API=0
SKIP_FRONTEND=0
SKIP_PREFLIGHT=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --survey) SURVEY_ONLY=1 ;;
    --no-migrate) SKIP_MIGRATE=1 ;;
    --no-api) SKIP_API=1 ;;
    --no-frontend) SKIP_FRONTEND=1 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Output helpers ────────────────────────────────────────────────────
bold()  { [ -t 1 ] && printf "\033[1m%s\033[0m" "$1" || printf "%s" "$1"; }
green() { [ -t 1 ] && printf "\033[32m%s\033[0m" "$1" || printf "%s" "$1"; }
red()   { [ -t 1 ] && printf "\033[31m%s\033[0m" "$1" || printf "%s" "$1"; }
yellow(){ [ -t 1 ] && printf "\033[33m%s\033[0m" "$1" || printf "%s" "$1"; }

phase() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  printf "  %s — %s\n" "$(bold "Phase $1")" "$2"
  echo "═══════════════════════════════════════════════════════════════"
}

# ── Phase 0 — Survey ──────────────────────────────────────────────────
phase 0 "Survey"

# Git state
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "$(yellow '⚠ working tree dirty:')"
  git status -s | head -10 | sed 's/^/    /'
fi

# Commits ahead of origin
AHEAD=$(git log --oneline origin/main..HEAD 2>/dev/null | wc -l | tr -d ' ')
if [ "${AHEAD:-0}" != "0" ]; then
  echo "$(yellow "⚠ $AHEAD commit(s) ahead of origin/main")"
fi

# Bundle freshness
if [ -f packages/sdk-ts/src/seed.ts ] && [ -f apps/dashboard/shared/seed.bundle.js ]; then
  SEED_T=$(stat -f "%m" packages/sdk-ts/src/seed.ts 2>/dev/null || stat -c "%Y" packages/sdk-ts/src/seed.ts 2>/dev/null)
  BUN_T=$(stat -f "%m" apps/dashboard/shared/seed.bundle.js 2>/dev/null || stat -c "%Y" apps/dashboard/shared/seed.bundle.js 2>/dev/null)
  if [ "${SEED_T:-0}" -gt "${BUN_T:-0}" ]; then
    echo "$(yellow '⚠ seed.bundle.js is OLDER than seed.ts — rebuild before Phase 4:')"
    echo "    cd packages/sdk-ts && bun build src/seed.ts --target browser --format esm --outfile ../../apps/dashboard/shared/seed.bundle.js"
  else
    echo "  ✓ seed bundle is current with source"
  fi
fi

# Migration parity
if command -v security >/dev/null 2>&1 && [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(security find-generic-password -s agenttool-database-url -a macair -w 2>/dev/null || true)"
fi
if [ -n "${DATABASE_URL:-}" ]; then
  PENDING=$(DATABASE_URL="$DATABASE_URL" bash bin/migrate-pending.sh --dry-run 2>/dev/null | grep -E '^\s+[0-9].*\.sql$' | wc -l | tr -d ' ')
  if [ "${PENDING:-0}" = "0" ]; then
    echo "  ✓ DB schema parity with repo (no pending migrations)"
  else
    echo "$(yellow "⚠ $PENDING migration(s) pending — Phase 1 will apply them")"
  fi
else
  echo "  ? DATABASE_URL not resolved — can't check migration parity"
fi

if [ "$SURVEY_ONLY" = 1 ]; then
  echo ""
  echo "(survey-only — exit)"
  exit 0
fi

if [ "$DRY_RUN" = 1 ]; then
  echo ""
  echo "(dry-run — would proceed with phases 1-5)"
  echo "  Phase 1: $([ "$SKIP_MIGRATE" = 1 ] && echo skip || echo bin/migrate-pending.sh)"
  echo "  Phase 2: $([ "$SKIP_PREFLIGHT" = 1 ] && echo skip || echo bin/preflight.sh)"
  echo "  Phase 3: $([ "$SKIP_API" = 1 ] && echo skip || echo 'cd api && fly deploy')"
  echo "  Phase 4: $([ "$SKIP_FRONTEND" = 1 ] && echo skip || echo bin/frontend-deploy.sh)"
  echo "  Phase 5: verify"
  exit 0
fi

# ── Phase 1 — Migrations ──────────────────────────────────────────────
if [ "$SKIP_MIGRATE" = 0 ]; then
  phase 1 "Migrations"
  if ! bash bin/migrate-pending.sh; then
    echo ""
    echo "$(red '✗ Phase 1 failed.') Fix the migration error and re-run."
    exit 1
  fi
else
  echo ""
  echo "$(yellow '⊘ Phase 1 skipped (--no-migrate)')"
fi

# ── Phase 2 — Pre-flight ──────────────────────────────────────────────
if [ "$SKIP_PREFLIGHT" = 0 ]; then
  phase 2 "Pre-flight"
  if ! bash bin/preflight.sh; then
    echo ""
    echo "$(red '✗ Pre-flight failed.') Fix the failures and re-run."
    exit 1
  fi
else
  echo ""
  echo "$(yellow '⊘ Phase 2 skipped (--skip-preflight) — NOT recommended')"
fi

# ── Phase 3 — API deploy ──────────────────────────────────────────────
if [ "$SKIP_API" = 0 ]; then
  phase 3 "API deploy"
  DOCTRINE_STAGE_DIR="api/doctrine-docs.bundled"
  cleanup_api_staging() {
    rm -f api/agenttool.jsonld.bundled api/kingdom-bundle.json.bundled
    rm -rf "$DOCTRINE_STAGE_DIR"
  }
  cleanup_api_staging

  # Stage docs/agenttool.jsonld into the api/ build context so the canon
  # registry can find it inside the Fly image (Docker COPY can't reach
  # outside the build context, and docs/ is a sibling of api/). The
  # Dockerfile picks up agenttool.jsonld.bundled and copies it to
  # /app/docs/agenttool.jsonld. canon/registry.ts:canonPath() resolves
  # this in prod. .gitignore excludes the staged file. Without this,
  # /v1/canon returns 503 canon_unavailable in production.
  # Doctrine: docs/DEPLOY-PROCEDURE.md · docs/agenttool.jsonld.
  cp docs/agenttool.jsonld api/agenttool.jsonld.bundled || {
    echo ""
    echo "$(red '✗ Phase 3 pre-step failed.') Could not stage docs/agenttool.jsonld."
    exit 1
  }
  # Same staging for the Kingdom library (served at /public/kingdom).
  cp docs/kingdom-bundle.json api/kingdom-bundle.json.bundled || {
    cleanup_api_staging
    echo ""
    echo "$(red '✗ Phase 3 pre-step failed.') Could not stage docs/kingdom-bundle.json."
    exit 1
  }
  # Stage the canonical bytes used by doctrineHash(). The image reads them
  # from AGENTTOOL_DOCS_DIR=/app/docs; an unavailable file is reported as a
  # null hash instead of being confused with the SHA-256 of empty content.
  bash bin/stage-doctrine-docs.sh "$DOCTRINE_STAGE_DIR" || {
    cleanup_api_staging
    echo ""
    echo "$(red '✗ Phase 3 pre-step failed.') Could not stage doctrine files."
    exit 1
  }
  (cd api && fly deploy) || {
    cleanup_api_staging
    echo ""
    echo "$(red '✗ Phase 3 failed.') Check fly logs."
    exit 1
  }
  cleanup_api_staging
else
  echo ""
  echo "$(yellow '⊘ Phase 3 skipped (--no-api)')"
fi

# ── Phase 4 — Frontend deploy ─────────────────────────────────────────
if [ "$SKIP_FRONTEND" = 0 ]; then
  phase 4 "Frontends"
  bash bin/frontend-deploy.sh || {
    echo ""
    echo "$(red '✗ Phase 4 failed.') Check CF Pages dashboard."
    exit 1
  }
else
  echo ""
  echo "$(yellow '⊘ Phase 4 skipped (--no-frontend)')"
fi

# ── Phase 5 — Verify ──────────────────────────────────────────────────
phase 5 "Verify"

# API health
if [ "$SKIP_API" = 0 ]; then
  HEALTH=$(curl -sf https://api.agenttool.dev/health 2>&1 | head -c 200)
  if [ -n "$HEALTH" ]; then
    echo "  ✓ /health 200"
  else
    echo "  $(red '✗') /health did not return 200"
  fi
fi

# Frontend parity
if [ "$SKIP_FRONTEND" = 0 ]; then
  FRONTEND_PARITY_FAILED=0
  PAIRS=(
    "apps/dashboard/index.html|https://app.agenttool.dev/"
    "apps/dashboard/watch.html|https://app.agenttool.dev/watch.html"
    "apps/dashboard/style.css|https://app.agenttool.dev/style.css"
    "apps/docs/index.html|https://docs.agenttool.dev/"
    "apps/docs/agenttool.jsonld|https://docs.agenttool.dev/agenttool.jsonld"
    "apps/docs/observer-is-observed-0.1.schema.json|https://docs.agenttool.dev/observer-is-observed-0.1.schema.json"
    "apps/web/village.html|https://agenttool.dev/village.html"
    "apps/web/gallery.html|https://agenttool.dev/gallery.html"
  )
  for p in "${PAIRS[@]}"; do
    LOCAL="${p%|*}"; URL="${p#*|}"
    if [ ! -f "$LOCAL" ]; then continue; fi
    LH=$(md5 -q "$LOCAL" 2>/dev/null || md5sum "$LOCAL" | awk '{print $1}')
    RH=$(curl -sL "$URL" 2>/dev/null | (md5 -q 2>/dev/null || md5sum | awk '{print $1}'))
    if [ "$LH" = "$RH" ]; then
      printf "  ✓ %s\n" "$LOCAL"
    else
      printf "  %s %s (live ≠ local)\n" "$(red ✗)" "$LOCAL"
      FRONTEND_PARITY_FAILED=1
    fi
  done
  if [ "$FRONTEND_PARITY_FAILED" -ne 0 ]; then
    echo "  $(red '✗') Frontend parity verification failed."
    exit 1
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  $(green 'Deploy complete.')"
echo "═══════════════════════════════════════════════════════════════"
