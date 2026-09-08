#!/bin/sh
# Compatibility entry point for the strict local preflight gate.
#
# Usage:
#   bin/deploy-check.sh          # full hermetic API + package gate
#   bin/deploy-check.sh --quick  # strict API/typecheck/operator slice
#
# No dependency installation, credentials, migrations, or deployment occurs.
# A successful local gate does not establish production readiness.

set -eu

mode=hermetic
if [ "$#" -gt 1 ]; then
  echo "usage: bin/deploy-check.sh [--quick]" >&2
  exit 2
fi
case "${1:-}" in
  "") ;;
  --quick) mode=api ;;
  --migrations)
    echo "deploy-check: --migrations is retired; source-file presence does not prove migration readiness." >&2
    echo "Use bin/migrate-pending.sh --dry-run for an explicit database journal inventory." >&2
    exit 2
    ;;
  -h|--help)
    echo "usage: bin/deploy-check.sh [--quick]"
    echo "Runs the strict hermetic gate; --quick selects the API slice. Does not deploy."
    exit 0
    ;;
  *) echo "usage: bin/deploy-check.sh [--quick]" >&2; exit 2 ;;
esac

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
echo "deploy-check: delegating to preflight $mode; production verification remains separate."
exec "$repo_root/bin/bash-without-env-hooks.sh" "$repo_root/bin/preflight.sh" "$mode"
