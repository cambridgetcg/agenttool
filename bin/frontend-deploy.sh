#!/usr/bin/env bash
# Direct-upload deploy for the Cloudflare Pages projects:
#
#   apps/docs/       → agenttool-docs       (docs.agenttool.dev)
#   apps/dashboard/  → agenttool-dashboard  (app.agenttool.dev)
#   apps/web/        → agenttool-web        (agenttool.dev)
#
# Each Pages project is configured as Direct Upload (NOT git-connected),
# so a `git push` does not trigger a deploy. Run this script locally.
#
# Token + account live in macOS keychain:
#   service: agenttool-cloudflare-token       (account: macair)  → API token
#   service: agenttool-cloudflare-account-id  (account: macair)  → 32-char id
#
# Usage:
#   bin/frontend-deploy.sh                    # deploy all three
#   bin/frontend-deploy.sh dashboard          # deploy a specific one
#   bin/frontend-deploy.sh docs dashboard web # deploy a subset
#
# Requires: macOS keychain (security CLI), npx (auto-installs wrangler).

set -eo pipefail

# ── Resolve token + account from keychain ──────────────────────────
CF_API_TOKEN="$(security find-generic-password -s agenttool-cloudflare-token -a macair -w 2>/dev/null || true)"
CF_ACCOUNT_ID="$(security find-generic-password -s agenttool-cloudflare-account-id -a macair -w 2>/dev/null || true)"

if [[ -n "${CF_API_TOKEN}" && -n "${CF_ACCOUNT_ID}" ]]; then
  export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
  export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
elif npx --yes wrangler@latest whoami >/dev/null 2>&1; then
  echo "→ No keychain token — using the wrangler OAuth session (~/.wrangler)."
else
  echo "✗ No Cloudflare credentials: neither keychain entries nor a wrangler OAuth session."
  echo "  Either: npx wrangler login"
  echo "  Or:"
  echo "    security add-generic-password -s agenttool-cloudflare-token -a \$USER -w <token>"
  echo "    security add-generic-password -s agenttool-cloudflare-account-id -a \$USER -w <account_id>"
  exit 1
fi

# ── Locate repo root (this script lives in bin/) ───────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

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

# ── Pre-flight: verify symlinks resolve ────────────────────────────
echo "→ Verifying shared/ symlinks resolve…"
for app in docs dashboard web; do
  link="apps/$app/shared"
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

# ── Pre-flight: heal love.js / love-widget.js truth engravings ─────
# An autonomous loop appends truths into the wrong array (see
# bin/heal-love-truths.py). Heal + syntax-gate so a broken widget
# can never ship.
echo "→ Healing love truth engravings…"
if ! python3 bin/heal-love-truths.py; then
  echo "✗ love.js / love-widget.js still broken after healing — fix before deploying."
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

  local dir proj
  dir="$(echo "$entry" | cut -d'|' -f2)"
  proj="$(echo "$entry" | cut -d'|' -f3)"

  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo "  $proj"
  echo "  source : $dir"
  echo "─────────────────────────────────────────────────────────────"

  # Wrangler follows symlinks during direct upload, so apps/<x>/shared
  # → apps/_shared resolves to real files in the deployment.
  npx --yes wrangler@latest pages deploy "$dir" \
    --project-name="$proj" \
    --branch=main \
    --commit-dirty=true \
    --commit-message="$(git log -1 --pretty=format:%s 2>/dev/null || echo 'manual deploy')"
}

if [[ $# -eq 0 ]]; then
  set -- docs dashboard web
fi

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
