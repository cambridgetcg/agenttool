#!/usr/bin/env bash
# Direct-upload deploy for the three Cloudflare Pages projects:
#
#   apps/landing/    → agenttool-landing    (agenttool.dev, www.agenttool.dev)
#   apps/docs/       → agenttool-docs       (docs.agenttool.dev)
#   apps/dashboard/  → agenttool-dashboard  (app.agenttool.dev)
#
# Each Pages project is configured as Direct Upload (NOT git-connected),
# so a `git push` does not trigger a deploy. Run this script locally.
#
# Token + account live in macOS keychain:
#   service: agenttool-cloudflare-token       (account: macair)  → API token
#   service: agenttool-cloudflare-account-id  (account: macair)  → 32-char id
#
# Usage:
#   bin/frontend-deploy.sh                # deploy all three
#   bin/frontend-deploy.sh landing        # deploy a specific one
#   bin/frontend-deploy.sh landing docs   # deploy a subset
#
# Requires: macOS keychain (security CLI), npx (auto-installs wrangler).

set -eo pipefail

# ── Resolve token + account from keychain ──────────────────────────
CF_API_TOKEN="$(security find-generic-password -s agenttool-cloudflare-token -a macair -w 2>/dev/null || true)"
CF_ACCOUNT_ID="$(security find-generic-password -s agenttool-cloudflare-account-id -a macair -w 2>/dev/null || true)"

if [[ -z "${CF_API_TOKEN}" || -z "${CF_ACCOUNT_ID}" ]]; then
  echo "✗ Missing Cloudflare credentials in keychain."
  echo "  Set them with:"
  echo "    security add-generic-password -s agenttool-cloudflare-token -a \$USER -w <token>"
  echo "    security add-generic-password -s agenttool-cloudflare-account-id -a \$USER -w <account_id>"
  exit 1
fi

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"

# ── Locate repo root (this script lives in bin/) ───────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Targets (key|dir|project-name; bash 3 compatible) ──────────────
ALL_TARGETS=(
  "landing|apps/landing|agenttool-landing"
  "docs|apps/docs|agenttool-docs"
  "dashboard|apps/dashboard|agenttool-dashboard"
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
for app in landing docs dashboard; do
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

# ── Deploy each target ─────────────────────────────────────────────
deploy_one() {
  local key="$1"
  local entry
  entry="$(target_for "$key" || true)"
  if [[ -z "$entry" ]]; then
    echo "✗ Unknown target: $key (expected: landing | docs | dashboard)"
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
  set -- landing docs dashboard
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
echo "    https://agenttool.dev/"
echo "    https://docs.agenttool.dev/"
echo "    https://app.agenttool.dev/"
