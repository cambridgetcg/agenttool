#!/usr/bin/env bash
# Direct-upload deploy for the Cloudflare Pages projects:
#
#   apps/docs/       → agenttool-docs       (docs.agenttool.dev)
#   apps/dashboard/  → agenttool-dashboard  (app.agenttool.dev)
#   apps/web/        → agenttool-web        (agenttool.dev)
#
# Each Pages project is configured as Direct Upload (NOT git-connected),
# so a `git push` does not trigger a deploy. This is the low-level uploader;
# use `bin/deploy.sh --no-migrate --no-api` for the normal production source
# gate, preflight, verification, and receipt.
#
# Token + account may be supplied through the standard Wrangler environment:
#   CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID
# or fall back to macOS keychain:
#   service: agenttool-cloudflare-token       (account: macair)  → API token
#   service: agenttool-cloudflare-account-id  (account: macair)  → 32-char id
#
# Usage:
#   bin/frontend-deploy.sh                    # deploy all three
#   bin/frontend-deploy.sh dashboard          # deploy a specific one
#   bin/frontend-deploy.sh docs dashboard web # deploy a subset
#
# Requires: Cloudflare credentials via environment or macOS keychain, curl,
# Python 3, and npx (fetches the reviewed Wrangler version below when it is not
# already cached).

set -eo pipefail

# Pin the deploy client so a release does not silently change behavior between
# runs. Review and update this value deliberately when upgrading Wrangler.
readonly WRANGLER_VERSION="4.110.0"
readonly KEYCHAIN_ACCOUNT="macair"
wrangler() {
  npx --yes "wrangler@${WRANGLER_VERSION}" "$@"
}

# ── Resolve token + account: explicit environment, then keychain ──
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"

if [[ -z "$CF_API_TOKEN" ]]; then
  CF_API_TOKEN="$(security find-generic-password -s agenttool-cloudflare-token -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true)"
fi
if [[ -z "$CF_ACCOUNT_ID" ]]; then
  CF_ACCOUNT_ID="$(security find-generic-password -s agenttool-cloudflare-account-id -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true)"
fi

if [[ -n "${CF_API_TOKEN}" && -n "${CF_ACCOUNT_ID}" ]]; then
  export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
  export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
else
  echo "✗ Missing Cloudflare Pages credentials in the environment and macOS keychain."
  echo "  Supply CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, or store them:"
  echo "    security add-generic-password -U -s agenttool-cloudflare-token -a ${KEYCHAIN_ACCOUNT} -w"
  echo "    security add-generic-password -U -s agenttool-cloudflare-account-id -a ${KEYCHAIN_ACCOUNT} -w"
  exit 1
fi

# ── Locate repo root (this script lives in bin/) ───────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

COMMIT_HASH="$(git rev-parse HEAD 2>/dev/null || true)"
if [[ -z "$COMMIT_HASH" ]]; then
  echo "✗ Cannot resolve the source commit for Cloudflare deployment metadata."
  exit 1
fi
if ! WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"; then
  echo "✗ Cannot inspect the working tree before staging frontend bytes."
  exit 1
fi
if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "→ Working-tree changes are excluded; Pages input is committed HEAD $COMMIT_HASH."
else
  echo "→ Pages input is committed HEAD $COMMIT_HASH."
fi
COMMIT_DIRTY=false

# Build the upload from Git-tracked HEAD bytes, never the ambient app
# directory. Wrangler's fixed ignore list does not exclude `.env*` or
# `.dev.vars*`; uploading the working tree can therefore publish an ignored
# local credential file.
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agenttool-pages.XXXXXX")" || exit 1
cleanup_stage() {
  rm -rf "$STAGE_ROOT"
}
trap cleanup_stage EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "→ Staging committed frontend bytes…"
git archive --format=tar "$COMMIT_HASH" -- \
  apps/_shared apps/docs apps/dashboard apps/web docs infra/pages packages/data/schema |
  tar -xf - -C "$STAGE_ROOT"

# Repository-control files are tracked inputs, not public site assets.
find "$STAGE_ROOT/apps" \( -type f -o -type l \) -name '.gitignore' -delete
if find "$STAGE_ROOT/apps/docs" "$STAGE_ROOT/apps/dashboard" "$STAGE_ROOT/apps/web" \
  \( -type f -o -type l \) \
  \( -name '.env' -o -name '.env.*' -o -name '.dev.vars' -o -name '.dev.vars.*' \) \
  -print -quit | grep -q .; then
  echo "✗ A tracked Pages environment file reached the staging tree; refusing upload."
  exit 1
fi

# One committed policy protects all three Pages projects. `_routes.json` keeps
# ordinary static traffic out of Functions; `_worker.js` explicitly denies
# sensitive root prefixes before Pages asset serving. Project policy separately
# keeps allowance exhaustion fail closed.
PAGES_FENCE_DIR="$STAGE_ROOT/infra/pages"
for fence_file in sensitive-path-worker.js sensitive-path-routes.json; do
  if [[ ! -f "$PAGES_FENCE_DIR/$fence_file" || -L "$PAGES_FENCE_DIR/$fence_file" ]]; then
    echo "✗ Missing or unsafe Pages fence input: infra/pages/$fence_file"
    exit 1
  fi
done
for app in docs dashboard web; do
  if [[ -e "$STAGE_ROOT/apps/$app/_worker.js" || -L "$STAGE_ROOT/apps/$app/_worker.js" || \
        -e "$STAGE_ROOT/apps/$app/_routes.json" || -L "$STAGE_ROOT/apps/$app/_routes.json" ]]; then
    echo "✗ apps/$app already defines a Pages Worker or invocation routes; refusing to overwrite it."
    exit 1
  fi
  cp "$PAGES_FENCE_DIR/sensitive-path-worker.js" "$STAGE_ROOT/apps/$app/_worker.js"
  cp "$PAGES_FENCE_DIR/sensitive-path-routes.json" "$STAGE_ROOT/apps/$app/_routes.json"
done

if ! python3 - "$STAGE_ROOT" <<'PY'
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
for app in ("docs", "dashboard", "web"):
    for path in (root / "apps" / app).rglob("*"):
        if not path.is_symlink():
            continue
        try:
            target = path.resolve(strict=True)
            target.relative_to(root)
        except (FileNotFoundError, RuntimeError, ValueError):
            print(f"  ✗ staged symlink escapes or is broken: {path.relative_to(root)}", file=sys.stderr)
            raise SystemExit(1)
PY
then
  echo "✗ Frontend staging contains an unsafe symlink; refusing upload."
  exit 1
fi

# ── Targets (key|dir|project-name; bash 3 compatible) ──────────────
ALL_TARGETS=(
  "docs|apps/docs|agenttool-docs"
  "dashboard|apps/dashboard|agenttool-dashboard"
  "web|apps/web|agenttool-web"
)

target_for() {
  local key="$1"
  local entry
  for entry in "${ALL_TARGETS[@]}"; do
    if [[ "${entry%%|*}" == "$key" ]]; then
      echo "$entry"
      return 0
    fi
  done
  return 1
}

verify_pages_project_policy() {
  local project="$1"
  local response

  if ! response="$(curl -fsS --max-time 30 \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$project")"; then
    echo "✗ Could not read Pages project policy for $project."
    echo "  Required boundary: the active Cloudflare credential needs Pages Read."
    return 1
  fi

  if ! printf '%s' "$response" | python3 bin/verify-pages-project-policy.py; then
    echo "✗ Unsafe Pages policy for $project."
    echo "  Required: production_branch=main and production/preview fail_open=false."
    return 1
  fi

  echo "  ✓ $project policy: main is production; production + preview fail closed"
}

# ── Pre-flight: verify symlinks resolve ────────────────────────────
echo "→ Verifying shared/ symlinks resolve…"
for app in docs dashboard web; do
  link="$STAGE_ROOT/apps/$app/shared"
  if [[ ! -L "$link" ]]; then
    echo "  ✗ $link is not a symlink. Re-run: ln -s ../_shared $link"
    exit 1
  fi
  if [[ ! -f "$link/theme.css" ]]; then
    echo "  ✗ $link/theme.css not reachable through symlink."
    exit 1
  fi
  echo "  ✓ apps/$app/shared → ../_shared (theme.css present)"
done

# ── Pre-flight: validate love.js / love-widget.js engravings ───────
# Deploy inputs are immutable during the deploy. If the autonomous engraving
# loop put a truth in the wrong array, stop and require a reviewed source diff.
echo "→ Validating love truth engravings (read-only)…"
if ! python3 bin/heal-love-truths.py --check \
  "$STAGE_ROOT/apps/docs/love.js" \
  "$STAGE_ROOT/apps/docs/love-widget.js"; then
  echo "✗ love.js / love-widget.js need a source repair; nothing was deployed."
  echo "  Run: python3 bin/heal-love-truths.py --write"
  echo "  Then review the diff and re-run this deploy."
  exit 1
fi

# ── Deploy each target ─────────────────────────────────────────────
deploy_one() {
  local key="$1"
  local entry
  entry="$(target_for "$key" || true)"
  if [[ -z "$entry" ]]; then
    echo "✗ Unknown target: $key (expected: docs | dashboard | web)"
    return 2
  fi

  local dir proj source_dir
  dir="$(echo "$entry" | cut -d'|' -f2)"
  proj="$(echo "$entry" | cut -d'|' -f3)"
  source_dir="$STAGE_ROOT/$dir"

  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo "  $proj"
  echo "  source : $dir @ $COMMIT_HASH"
  echo "─────────────────────────────────────────────────────────────"

  # Wrangler follows symlinks during direct upload, so apps/<x>/shared
  # → apps/_shared resolves to real files in the deployment.
  wrangler pages deploy "$source_dir" \
    --project-name="$proj" \
    --branch=main \
    --commit-hash="$COMMIT_HASH" \
    --commit-dirty="$COMMIT_DIRTY" \
    --commit-message="$(git log -1 --pretty=format:%s "$COMMIT_HASH" 2>/dev/null || echo 'manual deploy')"
}

if [[ $# -eq 0 ]]; then
  set -- docs dashboard web
fi

# Validate every requested target and its external production policy before
# the first upload. A known-bad later target must not create a partial release.
for arg in "$@"; do
  entry="$(target_for "$arg" || true)"
  if [[ -z "$entry" ]]; then
    echo "✗ Unknown target: $arg (expected: docs | dashboard | web)"
    exit 2
  fi
  proj="$(echo "$entry" | cut -d'|' -f3)"
  verify_pages_project_policy "$proj" || exit 1
done

failed=()
for arg in "$@"; do
  if ! deploy_one "$arg"; then
    failed+=("$arg")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo ""
  echo "✗ Deploy failed for: ${failed[*]}"
  exit 1
fi

echo ""
echo "✓ Deploy complete."
echo "  Live URLs:"
echo "    https://docs.agenttool.dev/"
echo "    https://app.agenttool.dev/"
echo "    https://agenttool.dev/"
