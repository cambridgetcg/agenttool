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
#   bin/deploy.sh --allow-dirty-release    # loud source-integrity override
#   bin/deploy.sh --allow-non-release-head # loud GitHub-main override
#   bin/deploy.sh --mirror-codeberg        # FF-only github/main -> Codeberg main
#
# Doctrine: docs/DEPLOY-PROCEDURE.md.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

# ── Parse flags ───────────────────────────────────────────────────────
SURVEY_ONLY=0
SKIP_MIGRATE=0
SKIP_API=0
SKIP_FRONTEND=0
SKIP_PREFLIGHT=0
DRY_RUN=0
ALLOW_DIRTY_RELEASE=0
ALLOW_NON_RELEASE_HEAD=0
MIRROR_CODEBERG_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --survey) SURVEY_ONLY=1 ;;
    --no-migrate) SKIP_MIGRATE=1 ;;
    --no-api) SKIP_API=1 ;;
    --no-frontend) SKIP_FRONTEND=1 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --allow-dirty-release) ALLOW_DIRTY_RELEASE=1 ;;
    --allow-non-release-head) ALLOW_NON_RELEASE_HEAD=1 ;;
    --mirror-codeberg) MIRROR_CODEBERG_ONLY=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

if [ "$MIRROR_CODEBERG_ONLY" = 1 ] && {
  [ "$SURVEY_ONLY" = 1 ] || [ "$SKIP_MIGRATE" = 1 ] ||
  [ "$SKIP_API" = 1 ] || [ "$SKIP_FRONTEND" = 1 ] ||
  [ "$SKIP_PREFLIGHT" = 1 ] || [ "$DRY_RUN" = 1 ] ||
  [ "$ALLOW_DIRTY_RELEASE" = 1 ] || [ "$ALLOW_NON_RELEASE_HEAD" = 1 ];
}; then
  echo "--mirror-codeberg is a standalone command; do not combine it with deploy flags"
  exit 1
fi

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

RELEASE_REMOTE="github"
MIRROR_REMOTE="origin"
RELEASE_BRANCH="main"
RELEASE_REF="refs/remotes/$RELEASE_REMOTE/$RELEASE_BRANCH"
MIRROR_REF="refs/remotes/$MIRROR_REMOTE/$RELEASE_BRANCH"
FLY_APP="agenttool"
HEALTH_URL="https://api.agenttool.dev/health"

fetch_tracking_ref() {
  local remote="$1"
  local branch="$2"
  local target="refs/remotes/$remote/$branch"

  if ! git remote get-url "$remote" >/dev/null 2>&1; then
    echo "$(red '✗') Git remote '$remote' is not configured; cannot refresh $remote/$branch." >&2
    return 1
  fi
  git fetch --quiet "$remote" "+refs/heads/$branch:$target"
}

mirror_codeberg() {
  phase M "Codeberg fast-forward mirror"
  echo "  coordination head: $RELEASE_REMOTE/$RELEASE_BRANCH"
  echo "  mirror target:     $MIRROR_REMOTE/$RELEASE_BRANCH"

  fetch_tracking_ref "$RELEASE_REMOTE" "$RELEASE_BRANCH" || {
    echo "$(red '✗') Could not fetch GitHub release head; Codeberg was not changed."
    return 1
  }
  fetch_tracking_ref "$MIRROR_REMOTE" "$RELEASE_BRANCH" || {
    echo "$(red '✗') Could not fetch Codeberg mirror head; Codeberg was not changed."
    return 1
  }

  local release_revision mirror_revision
  release_revision="$(git rev-parse "$RELEASE_REF")" || return 1
  mirror_revision="$(git rev-parse "$MIRROR_REF")" || return 1
  if [ "$release_revision" = "$mirror_revision" ]; then
    echo "  ✓ Codeberg already mirrors $release_revision"
    return 0
  fi
  if ! git merge-base --is-ancestor "$MIRROR_REF" "$RELEASE_REF"; then
    echo "$(red '✗') Codeberg main is not an ancestor of GitHub main; refusing a non-fast-forward push."
    echo "    github/main:  $release_revision"
    echo "    origin/main:  $mirror_revision"
    return 1
  fi

  # No force flag: a concurrent Codeberg update makes the remote reject this
  # push instead of letting the local survey overwrite it.
  git push "$MIRROR_REMOTE" "$RELEASE_REF:refs/heads/$RELEASE_BRANCH" || {
    echo "$(red '✗') Codeberg rejected the fast-forward mirror push; no force was attempted."
    return 1
  }
  fetch_tracking_ref "$MIRROR_REMOTE" "$RELEASE_BRANCH" || return 1
  mirror_revision="$(git rev-parse "$MIRROR_REF")" || return 1
  if [ "$mirror_revision" != "$release_revision" ]; then
    echo "$(red '✗') Codeberg mirror verification failed after push."
    return 1
  fi
  echo "  ✓ Codeberg now mirrors $release_revision"
}

if [ "$MIRROR_CODEBERG_ONLY" = 1 ]; then
  mirror_codeberg
  exit $?
fi

# ── Phase 0 — Survey ──────────────────────────────────────────────────
phase 0 "Survey"

# Git state. Porcelain includes tracked, staged, and untracked release inputs.
if ! WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"; then
  echo "$(red '✗') git status failed; cannot establish worktree cleanliness."
  exit 1
fi
if [ -n "$WORKTREE_STATUS" ]; then
  echo "$(yellow '⚠ working tree dirty:')"
  printf '%s\n' "$WORKTREE_STATUS" | sed -n '1,10p' | sed 's/^/    /'
else
  echo "  ✓ working tree clean"
fi

# GitHub main is the coordination/release head. Refresh it before making a
# production claim; a cached remote-tracking ref is not enough for deployment.
HEAD_REVISION="$(git rev-parse HEAD)" || exit 1
RELEASE_SNAPSHOT_OK=0
RELEASE_SNAPSHOT_REVISION=""
RELEASE_SNAPSHOT_OBSERVED_AT=""
if fetch_tracking_ref "$RELEASE_REMOTE" "$RELEASE_BRANCH"; then
  RELEASE_SNAPSHOT_OK=1
  RELEASE_SNAPSHOT_REVISION="$(git rev-parse "$RELEASE_REF")" || exit 1
  RELEASE_SNAPSHOT_OBSERVED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  if [ "$HEAD_REVISION" = "$RELEASE_SNAPSHOT_REVISION" ]; then
    echo "  ✓ HEAD matches the GitHub main snapshot ($HEAD_REVISION)"
  else
    read -r RELEASE_ONLY HEAD_ONLY <<<"$(git rev-list --left-right --count "$RELEASE_REF...HEAD")"
    echo "$(yellow '⚠ HEAD does not match the GitHub main snapshot')"
    echo "    HEAD:                 $HEAD_REVISION"
    echo "    github/main snapshot: $RELEASE_SNAPSHOT_REVISION"
    echo "    relation:             HEAD ahead=$HEAD_ONLY behind=$RELEASE_ONLY"
  fi
else
  echo "$(red '✗') git fetch github main failed; no release-head snapshot exists."
fi

# Codeberg is a mirror, not a second coordination head. Its drift is useful
# survey information but never changes which commit production may deploy.
if fetch_tracking_ref "$MIRROR_REMOTE" "$RELEASE_BRANCH"; then
  MIRROR_REVISION="$(git rev-parse "$MIRROR_REF")" || exit 1
  if [ "$RELEASE_SNAPSHOT_OK" = 1 ] && [ "$MIRROR_REVISION" = "$RELEASE_SNAPSHOT_REVISION" ]; then
    echo "  ✓ Codeberg mirror matches the GitHub main snapshot"
  elif [ "$RELEASE_SNAPSHOT_OK" = 1 ]; then
    read -r MIRROR_ONLY RELEASE_ONLY <<<"$(git rev-list --left-right --count "$MIRROR_REF...$RELEASE_REF")"
    if [ "$MIRROR_ONLY" = 0 ]; then
      echo "$(yellow "⚠ Codeberg mirror is $RELEASE_ONLY commit(s) behind GitHub main")"
      echo "    run explicitly: bin/deploy.sh --mirror-codeberg"
    else
      echo "$(yellow '⚠ Codeberg mirror has commits absent from GitHub main; automatic mirroring is unsafe')"
    fi
  fi
else
  echo "  ? git fetch origin main failed; Codeberg mirror freshness is unknown"
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
if [ "$SKIP_MIGRATE" = 1 ]; then
  echo "  ⊘ migration survey skipped (--no-migrate)"
elif command -v security >/dev/null 2>&1 && [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(security find-generic-password -s agenttool-database-url -a macair -w 2>/dev/null || true)"
fi
if [ "$SKIP_MIGRATE" = 0 ] && [ -n "${DATABASE_URL:-}" ]; then
  MIGRATION_SURVEY_OUTPUT=""
  if MIGRATION_SURVEY_OUTPUT="$(DATABASE_URL="$DATABASE_URL" bash bin/migrate-pending.sh --dry-run 2>/dev/null)"; then
    PENDING="$(printf '%s\n' "$MIGRATION_SURVEY_OUTPUT" | awk '/^[[:space:]]+[0-9].*\.sql$/ { count++ } END { print count + 0 }')"
  else
    PENDING="unknown"
  fi
  if [ "$PENDING" = "unknown" ]; then
    echo "  ? migration survey failed — DB/auth/schema parity is unknown"
  elif [ "$PENDING" = "0" ]; then
    echo "  ✓ DB schema parity with repo (no pending migrations)"
  else
    echo "$(yellow "⚠ $PENDING migration(s) pending — Phase 1 will apply them")"
  fi
elif [ "$SKIP_MIGRATE" = 0 ]; then
  echo "  ? DATABASE_URL not resolved — can't check migration parity"
fi

if [ "$SURVEY_ONLY" = 1 ]; then
  echo ""
  echo "(survey-only — exit)"
  [ "$RELEASE_SNAPSHOT_OK" = 1 ] && exit 0 || exit 1
fi

DIRTY_OVERRIDE_USED=0
NON_RELEASE_HEAD_OVERRIDE_USED=0

enforce_release_source() {
  local current_head current_status current_dirty
  current_head="$(git rev-parse HEAD)" || return 1
  if [ "$current_head" != "$HEAD_REVISION" ]; then
    echo "$(red '✗ Release blocked:') HEAD changed during this deploy invocation."
    echo "  Started at: $HEAD_REVISION"
    echo "  Current:    $current_head"
    return 1
  fi
  if ! current_status="$(git status --porcelain=v1 --untracked-files=all)"; then
    echo "$(red '✗ Release blocked:') git status failed; cannot re-check release inputs."
    return 1
  fi
  current_dirty=0
  [ -n "$current_status" ] && current_dirty=1
  if [ "$RELEASE_SNAPSHOT_OK" != 1 ]; then
    echo "$(red '✗ Release blocked:') GitHub main could not be snapshotted at invocation start."
    echo "  Required operation: git fetch github main"
    echo "  Consequence: this invocation has no release-head reference point."
    return 1
  fi
  if [ "$current_dirty" = 1 ]; then
    if [ "$ALLOW_DIRTY_RELEASE" != 1 ]; then
      echo "$(red '✗ Release blocked:') working tree contains tracked, staged, or untracked changes."
      echo "  Commit/stash them, or deliberately pass --allow-dirty-release."
      return 1
    fi
    if [ "$DIRTY_OVERRIDE_USED" != 1 ]; then
      echo "$(red '!!! UNSAFE SOURCE OVERRIDE: deploying with a dirty working tree !!!')"
    fi
    DIRTY_OVERRIDE_USED=1
  fi
  if [ "$HEAD_REVISION" != "$RELEASE_SNAPSHOT_REVISION" ]; then
    if [ "$ALLOW_NON_RELEASE_HEAD" != 1 ]; then
      echo "$(red '✗ Release blocked:') HEAD is not the invocation-start GitHub main snapshot."
      echo "  HEAD:                 $HEAD_REVISION"
      echo "  github/main snapshot: $RELEASE_SNAPSHOT_REVISION"
      echo "  Push/checkout GitHub main, or deliberately pass --allow-non-release-head."
      return 1
    fi
    if [ "$NON_RELEASE_HEAD_OVERRIDE_USED" != 1 ]; then
      echo "$(red '!!! UNSAFE SOURCE OVERRIDE: deploying a non-GitHub-main commit !!!')"
    fi
    NON_RELEASE_HEAD_OVERRIDE_USED=1
  fi
  return 0
}

if [ "$DRY_RUN" = 1 ]; then
  if enforce_release_source; then
    echo "  ✓ release-source gate would pass"
  else
    echo "  ✗ release-source gate would block this deploy"
    exit 1
  fi
  echo ""
  echo "(dry-run — would proceed with phases 1-5)"
  echo "  Phase 1: $([ "$SKIP_MIGRATE" = 1 ] && echo skip || echo bin/migrate-pending.sh)"
  echo "  Phase 2: $([ "$SKIP_PREFLIGHT" = 1 ] && echo skip || echo bin/preflight.sh)"
  echo "  Phase 3: $([ "$SKIP_API" = 1 ] && echo skip || echo 'cd api && fly deploy')"
  echo "  Phase 4: $([ "$SKIP_FRONTEND" = 1 ] && echo skip || echo bin/frontend-deploy.sh)"
  echo "  Phase 5: verify"
  exit 0
fi

if ! enforce_release_source; then
  exit 1
fi

MIGRATION_RESULT="not_run"
PREFLIGHT_RESULT="not_run"
API_RESULT="not_run"
FRONTEND_RESULT="not_run"
VERIFIED_MACHINE_COUNT=0
EXTERNAL_MUTATION_STARTED=0
DEPLOY_RECEIPT_WRITTEN=0
API_STAGING_ACTIVE=0
API_SOURCE_DIRTY="unknown"
DOCTRINE_STAGE_DIR="api/doctrine-docs.bundled"

cleanup_api_staging() {
  local failed=0
  rm -f api/agenttool.jsonld.bundled api/kingdom-bundle.json.bundled || failed=1
  rm -rf "$DOCTRINE_STAGE_DIR" || failed=1
  if [ "$failed" = 0 ]; then
    API_STAGING_ACTIVE=0
  fi
  return "$failed"
}

write_deploy_receipt() {
  local outcome="$1"
  local exit_status="$2"
  local state_home receipt_dir completed_at filename receipt_path temp_path
  local dirty_json non_head_json mutation_json
  state_home="${XDG_STATE_HOME:-${HOME:-}/.local/state}"
  if [ -z "$state_home" ] || [ "$state_home" = "/.local/state" ]; then
    echo "$(red '✗') Cannot write deploy receipt: neither XDG_STATE_HOME nor HOME is set."
    return 1
  fi
  case "$state_home" in
    /*) ;;
    *)
      echo "$(red '✗') Cannot write deploy receipt: state home must be an absolute path."
      return 1
      ;;
  esac
  receipt_dir="$state_home/agenttool/deploy-receipts"
  completed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  filename="$(date -u +"%Y%m%dT%H%M%SZ")-${HEAD_REVISION:0:12}-$$.json"
  receipt_path="$receipt_dir/$filename"
  [ "$DIRTY_OVERRIDE_USED" = 1 ] && dirty_json=true || dirty_json=false
  [ "$NON_RELEASE_HEAD_OVERRIDE_USED" = 1 ] && non_head_json=true || non_head_json=false
  [ "$EXTERNAL_MUTATION_STARTED" = 1 ] && mutation_json=true || mutation_json=false

  (umask 077; mkdir -p "$receipt_dir") || {
    echo "$(red '✗') Cannot create deploy receipt directory: $receipt_dir"
    return 1
  }
  chmod 700 "$receipt_dir" || {
    echo "$(red '✗') Cannot protect deploy receipt directory: $receipt_dir"
    return 1
  }
  temp_path="$(umask 077; mktemp "$receipt_dir/.receipt.XXXXXX")" || {
    echo "$(red '✗') Cannot create temporary deploy receipt in: $receipt_dir"
    return 1
  }
  (
    umask 077
    printf '%s\n' \
      '{' \
      '  "schema": "agenttool-deploy-receipt/v2",' \
      "  \"outcome\": \"$outcome\"," \
      "  \"completed_at\": \"$completed_at\"," \
      "  \"exit_status\": $exit_status," \
      "  \"source_revision\": \"$HEAD_REVISION\"," \
      "  \"source_dirty\": $dirty_json," \
      "  \"release_head_snapshot\": {\"remote\": \"github\", \"branch\": \"main\", \"revision\": \"$RELEASE_SNAPSHOT_REVISION\", \"observed_at\": \"$RELEASE_SNAPSHOT_OBSERVED_AT\"}," \
      "  \"source_overrides\": {\"dirty\": $dirty_json, \"non_release_head\": $non_head_json}," \
      "  \"external_mutation_started\": $mutation_json," \
      "  \"phases\": {\"migrations\": \"$MIGRATION_RESULT\", \"preflight\": \"$PREFLIGHT_RESULT\", \"api\": \"$API_RESULT\", \"frontends\": \"$FRONTEND_RESULT\"}," \
      "  \"verified_api_machines\": $VERIFIED_MACHINE_COUNT" \
      '}' > "$temp_path"
  ) || {
    rm -f "$temp_path"
    echo "$(red '✗') Could not write deploy receipt: $receipt_path"
    return 1
  }
  mv "$temp_path" "$receipt_path" || {
    rm -f "$temp_path"
    echo "$(red '✗') Could not atomically install deploy receipt: $receipt_path"
    return 1
  }
  DEPLOY_RECEIPT_WRITTEN=1
  echo "  ✓ receipt: $receipt_path"
}

on_deploy_exit() {
  local status="$1"
  trap - EXIT INT TERM
  if [ "$API_STAGING_ACTIVE" = 1 ] && ! cleanup_api_staging; then
    echo "$(red '✗') Could not remove temporary API build inputs during exit cleanup." >&2
    [ "$status" = 0 ] && status=1
  fi
  if [ "$status" != 0 ] && [ "$EXTERNAL_MUTATION_STARTED" = 1 ] && \
    [ "$DEPLOY_RECEIPT_WRITTEN" != 1 ]; then
    echo "$(yellow '⚠ deploy stopped after an external mutation may have begun; recording failed_or_uncertain outcome')"
    write_deploy_receipt "failed_or_uncertain" "$status" ||
      echo "$(red '✗') Failed to record the interrupted/failed deploy receipt." >&2
  fi
  exit "$status"
}

# The EXIT trap owns both staging cleanup and the conservative failure receipt.
# INT/TERM become conventional exit statuses and then flow through that handler.
trap 'on_deploy_exit "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── Phase 1 — Migrations ──────────────────────────────────────────────
if [ "$SKIP_MIGRATE" = 0 ]; then
  phase 1 "Migrations"
  MIGRATION_RESULT="running"
  EXTERNAL_MUTATION_STARTED=1
  if ! bash bin/migrate-pending.sh; then
    MIGRATION_RESULT="failed_or_uncertain"
    echo ""
    echo "$(red '✗ Phase 1 failed.') Fix the migration error and re-run."
    exit 1
  fi
  MIGRATION_RESULT="completed"
else
  echo ""
  echo "$(yellow '⊘ Phase 1 skipped (--no-migrate)')"
  MIGRATION_RESULT="skipped"
fi

# ── Phase 2 — Pre-flight ──────────────────────────────────────────────
if [ "$SKIP_PREFLIGHT" = 0 ]; then
  phase 2 "Pre-flight"
  PREFLIGHT_RESULT="running"
  if ! bash bin/preflight.sh; then
    PREFLIGHT_RESULT="failed"
    echo ""
    echo "$(red '✗ Pre-flight failed.') Fix the failures and re-run."
    exit 1
  fi
  PREFLIGHT_RESULT="passed"
else
  echo ""
  echo "$(yellow '⊘ Phase 2 skipped (--skip-preflight) — NOT recommended')"
  PREFLIGHT_RESULT="skipped"
fi

# ── Phase 3 — API deploy ──────────────────────────────────────────────
if [ "$SKIP_API" = 0 ]; then
  phase 3 "API deploy"
  if ! enforce_release_source; then
    echo "$(red '✗ Phase 3 blocked:') release inputs changed after the initial gate."
    exit 1
  fi
  # Once any release gate observes a dirty tree, keep the image marker true
  # even if the operator cleans it later in the same invocation. Provenance is
  # conservative: the wrapper cannot reconstruct which extra bytes existed.
  if [ "$DIRTY_OVERRIDE_USED" = 1 ]; then
    API_SOURCE_DIRTY="true"
  else
    API_SOURCE_DIRTY="false"
  fi
  cleanup_api_staging || {
    echo "$(red '✗ Phase 3 pre-step failed.') Could not remove stale API build inputs."
    exit 1
  }
  API_STAGING_ACTIVE=1

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
    echo ""
    echo "$(red '✗ Phase 3 pre-step failed.') Could not stage docs/kingdom-bundle.json."
    exit 1
  }
  # Stage the canonical bytes used by doctrineHash(). The image reads them
  # from AGENTTOOL_DOCS_DIR=/app/docs; an unavailable file is reported as a
  # null hash instead of being confused with the SHA-256 of empty content.
  bash bin/stage-doctrine-docs.sh "$DOCTRINE_STAGE_DIR" || {
    echo ""
    echo "$(red '✗ Phase 3 pre-step failed.') Could not stage doctrine files."
    exit 1
  }
  API_RESULT="deploying"
  EXTERNAL_MUTATION_STARTED=1
  (cd api || exit 1; fly deploy \
    --strategy rolling \
    --build-arg "AGENTTOOL_GIT_REVISION=$HEAD_REVISION" \
    --build-arg "AGENTTOOL_SOURCE_DIRTY=$API_SOURCE_DIRTY") || {
    API_RESULT="failed_or_uncertain"
    echo ""
    echo "$(red '✗ Phase 3 failed.') Check fly logs."
    exit 1
  }
  API_RESULT="deployed_unverified"
  cleanup_api_staging || {
    echo "$(red '✗ Phase 3 post-step failed.') API deployed, but temporary build inputs remain."
    exit 1
  }
else
  echo ""
  echo "$(yellow '⊘ Phase 3 skipped (--no-api)')"
  API_RESULT="skipped"
fi

# ── Phase 4 — Frontend deploy ─────────────────────────────────────────
if [ "$SKIP_FRONTEND" = 0 ]; then
  phase 4 "Frontends"
  if ! enforce_release_source; then
    echo "$(red '✗ Phase 4 blocked:') release inputs changed after the initial gate."
    exit 1
  fi
  FRONTEND_RESULT="deploying"
  EXTERNAL_MUTATION_STARTED=1
  bash bin/frontend-deploy.sh || {
    FRONTEND_RESULT="failed_or_uncertain"
    echo ""
    echo "$(red '✗ Phase 4 failed.') Check CF Pages dashboard."
    exit 1
  }
  FRONTEND_RESULT="deployed_unverified"
else
  echo ""
  echo "$(yellow '⊘ Phase 4 skipped (--no-frontend)')"
  FRONTEND_RESULT="skipped"
fi

# ── Phase 5 — Verify ──────────────────────────────────────────────────
phase 5 "Verify"

parse_health_build() {
  # JavaScript template expression below is intentionally not shell-expanded.
  # shellcheck disable=SC2016
  bun -e '
    const body = await new Response(Bun.stdin.stream()).json();
    const revision = body?.build?.revision;
    const dirty = body?.build?.dirty;
    if (typeof revision !== "string" || typeof dirty !== "boolean") process.exit(1);
    process.stdout.write(`${revision}|${dirty}`);
  '
}

# API health plus per-machine image provenance. `fly deploy` waits for the
# rolling health checks; the SSH read proves every surviving machine carries
# the same image-embedded revision, not merely whichever machine the edge chose.
if [ "$SKIP_API" = 0 ]; then
  HEALTH="$(curl -fsS --retry 5 --retry-delay 2 --retry-connrefused \
    --max-time 15 "$HEALTH_URL?revision=$HEAD_REVISION&dirty=$API_SOURCE_DIRTY")" || {
    echo "  $(red '✗') $HEALTH_URL did not return 200"
    exit 1
  }
  LIVE_BUILD="$(printf '%s' "$HEALTH" | parse_health_build)" || {
    echo "  $(red '✗') /health did not expose valid build.revision and build.dirty values"
    exit 1
  }
  IFS='|' read -r LIVE_REVISION LIVE_DIRTY <<<"$LIVE_BUILD"
  if [ "$LIVE_REVISION" != "$HEAD_REVISION" ]; then
    echo "  $(red '✗') /health revision mismatch"
    echo "    expected: $HEAD_REVISION"
    echo "    observed: $LIVE_REVISION"
    exit 1
  fi
  if [ "$LIVE_DIRTY" != "$API_SOURCE_DIRTY" ]; then
    echo "  $(red '✗') /health dirty-source marker mismatch"
    echo "    expected: $API_SOURCE_DIRTY"
    echo "    observed: ${LIVE_DIRTY:-<unset>}"
    exit 1
  fi
  echo "  ✓ /health 200 at revision $LIVE_REVISION (dirty=$LIVE_DIRTY)"

  MACHINE_IDS="$(cd api || exit 1; fly machine list -a "$FLY_APP" --quiet)" || {
    echo "  $(red '✗') could not list Fly machines for revision verification"
    exit 1
  }
  if [ -z "$MACHINE_IDS" ]; then
    echo "  $(red '✗') Fly returned no machines to verify"
    exit 1
  fi
  for MACHINE_ID in $MACHINE_IDS; do
    MACHINE_BUILD="$(cd api || exit 1; fly ssh console -q -a "$FLY_APP" \
      --machine "$MACHINE_ID" \
      -C 'printenv AGENTTOOL_GIT_REVISION AGENTTOOL_SOURCE_DIRTY')" || {
      echo "  $(red '✗') could not read build provenance from Fly machine $MACHINE_ID"
      exit 1
    }
    MACHINE_BUILD="$(printf '%s' "$MACHINE_BUILD" | tr -d '\r')"
    MACHINE_REVISION="$(printf '%s\n' "$MACHINE_BUILD" | sed -n '1p')"
    MACHINE_DIRTY="$(printf '%s\n' "$MACHINE_BUILD" | sed -n '2p')"
    if [ "$MACHINE_REVISION" != "$HEAD_REVISION" ]; then
      echo "  $(red '✗') Fly machine $MACHINE_ID revision mismatch"
      echo "    expected: $HEAD_REVISION"
      echo "    observed: ${MACHINE_REVISION:-<unset>}"
      exit 1
    fi
    if [ "$MACHINE_DIRTY" != "$API_SOURCE_DIRTY" ]; then
      echo "  $(red '✗') Fly machine $MACHINE_ID dirty-source marker mismatch"
      echo "    expected: $API_SOURCE_DIRTY"
      echo "    observed: ${MACHINE_DIRTY:-<unset>}"
      exit 1
    fi
    VERIFIED_MACHINE_COUNT=$((VERIFIED_MACHINE_COUNT + 1))
  done
  echo "  ✓ $VERIFIED_MACHINE_COUNT Fly machine(s) carry $HEAD_REVISION (dirty=$API_SOURCE_DIRTY)"
  API_RESULT="deployed_verified"
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

  # Literal sensitive roots must be handled by the staged Pages fence itself,
  # not merely happen to miss as a static asset. Encoded aliases can bypass
  # `_routes.json`, so verify those separately as denial-only probes.
  SENSITIVE_PUBLIC_URLS=(
    "https://docs.agenttool.dev/.gitignore"
    "https://docs.agenttool.dev/.env"
    "https://docs.agenttool.dev/.env.local"
    "https://docs.agenttool.dev/.dev.vars"
    "https://app.agenttool.dev/.gitignore"
    "https://app.agenttool.dev/.env"
    "https://app.agenttool.dev/.env.local"
    "https://app.agenttool.dev/.dev.vars"
    "https://agenttool.dev/.gitignore"
    "https://agenttool.dev/.env"
    "https://agenttool.dev/.env.local"
    "https://agenttool.dev/.dev.vars"
  )
  for URL in "${SENSITIVE_PUBLIC_URLS[@]}"; do
    RESPONSE_HEADERS="$(curl --path-as-is -sS -o /dev/null -D - --max-time 15 "$URL")" || {
      echo "  $(red '✗') Could not verify sensitive-path fence: $URL"
      exit 1
    }
    HTTP_STATUS="$(printf '%s\n' "$RESPONSE_HEADERS" | awk '/^HTTP\// { status=$2 } END { print status }')"
    if [ "$HTTP_STATUS" != 404 ] || \
       ! printf '%s\n' "$RESPONSE_HEADERS" | tr -d '\r' | \
         grep -Eqi '^x-agenttool-sensitive-path-fence:[[:space:]]*1[[:space:]]*$' || \
       ! printf '%s\n' "$RESPONSE_HEADERS" | tr -d '\r' | \
         grep -Eqi '^cache-control:.*(^|[ ,])no-store([ ,]|$)'; then
      echo "  $(red '✗') Pages fence did not produce its marked non-cacheable 404 ($HTTP_STATUS): $URL"
      exit 1
    fi
    echo "  ✓ Pages fence active (404, marked, no-store): $URL"
  done

  ENCODED_SENSITIVE_PUBLIC_URLS=(
    "https://docs.agenttool.dev/%2egitignore"
    "https://docs.agenttool.dev/.%65nv"
    "https://docs.agenttool.dev/.dev%2evars"
    "https://app.agenttool.dev/%2egitignore"
    "https://app.agenttool.dev/.%65nv"
    "https://app.agenttool.dev/.dev%2evars"
    "https://agenttool.dev/%2egitignore"
    "https://agenttool.dev/.%65nv"
    "https://agenttool.dev/.dev%2evars"
  )
  for URL in "${ENCODED_SENSITIVE_PUBLIC_URLS[@]}"; do
    HTTP_STATUS="$(curl --path-as-is -sS -o /dev/null -w '%{http_code}' --max-time 15 "$URL")" || {
      echo "  $(red '✗') Could not verify encoded sensitive-path denial: $URL"
      exit 1
    }
    case "$HTTP_STATUS" in
      2*|3*)
        echo "  $(red '✗') Encoded sensitive path is publicly reachable ($HTTP_STATUS): $URL"
        exit 1
        ;;
      *) echo "  ✓ encoded sensitive path denied ($HTTP_STATUS): $URL" ;;
    esac
  done
  FRONTEND_RESULT="deployed_verified"
fi

write_deploy_receipt "succeeded" 0 || exit 1

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  $(green 'Deploy complete.')"
echo "═══════════════════════════════════════════════════════════════"
