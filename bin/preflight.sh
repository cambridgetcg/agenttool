#!/usr/bin/env bash
# bin/preflight.sh — deliberate local/CI quality gates.
#
# The default is hermetic in the dependency sense: tests require no database,
# Redis, deployed smoke target, credentials, or paid provider calls, and known
# credential variables are removed. This is not an OS-level network sandbox.
# Stateful and paid tiers are explicit. Contract mode accepts one of
# ANTHROPIC_API_KEY, OPENAI_API_KEY, or OLLAMA_API_KEY.
#
# Usage:
#   bin/preflight.sh                 # api + packages, hermetic
#   bin/preflight.sh api             # API/protocol hermetic gate
#   bin/preflight.sh packages        # data + ADDS + sync + broker + TypeScript SDK + Telescope gate
#   bin/preflight.sh database        # requires DATABASE_URL
#   bin/preflight.sh smoke           # requires smoke-test environment
#   RUN_CONTRACT=1 bin/preflight.sh contracts  # requires provider key(s)
#
# Diagnostic, not default/CI:
#   bin/preflight.sh quarantine      # known-red non-DB tests
#   bin/preflight.sh database-quarantine  # known-red DB tests; requires DB
#   bin/preflight.sh legacy-delta    # existing full-suite baseline triage

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REQUIRED_BUN_VERSION="1.3.5"
readonly MODE="${1:-hermetic}"

cd "$REPO_ROOT"

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  echo "preflight: $*" >&2
  exit 2
}

run() {
  local label="$1"
  shift
  echo
  echo "==> $label"
  printf '    $'
  printf ' %q' "$@"
  echo
  "$@"
}

require_bun() {
  command -v bun >/dev/null 2>&1 || die "Bun $REQUIRED_BUN_VERSION is required"
  local actual
  actual="$(bun --version)"
  [ "$actual" = "$REQUIRED_BUN_VERSION" ] ||
    die "Bun $REQUIRED_BUN_VERSION is required; found $actual"
}

sanitize_hermetic_env() {
  unset \
    AGENTTOOL_API_KEY AGENTTOOL_BASE AGENTTOOL_IDENTITY_ID \
    AGENTTOOL_PLATFORM_SIGNING_KEY AGENTTOOL_SIGNING_KEY_ID \
    AGENTTOOL_ENABLE_UNSAFE_EXECUTE AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS \
    AGENT_DATA_NODE_TOKEN AGENT_DATA_NODE_URL AT_API_KEY \
    ANTHROPIC_API_KEY OPENAI_API_KEY OLLAMA_API_KEY RUN_CONTRACT \
    DATABASE_URL DATABASE_SESSION_URL POSTGRES_URL REDIS_URL \
    OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_TRACES_ENDPOINT \
    OTEL_EXPORTER_OTLP_HEADERS OTEL_EXPORTER_OTLP_TRACES_HEADERS \
    OTEL_RESOURCE_ATTRIBUTES OTEL_SERVICE_NAME \
    STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET VAULT_MASTER_KEY \
    SMOKE_DID
  export AGENTTOOL_DISABLE_WORKERS=1
}

api_typecheck() {
  run "API typecheck (installed compiler only)" \
    bash -c 'cd api && bunx --no-install tsc --noEmit'
}

api_gate() {
  api_typecheck
  run "API hermetic test tier" bash bin/run-test-tier.sh hermetic
  run "operator and protocol tests" bun test bin/tests
}

packages_gate() {
  run "agent-data/v1 reference node and sync dependency build" \
    bash -c 'cd packages/data && bun run ci && bun run build'
  run "ADDS protocol package" \
    bash -c 'cd packages/data-protocol && bun run ci'
  run "agent-data-sync/v1 explicit pull bridge" \
    bash -c 'cd packages/data-sync && bun run ci && bun run build'
  run "agentcred/0.1 local credential broker" \
    bash -c 'cd packages/credential-broker && bun run ci'
  run "TypeScript SDK, Python surface parity, build, and tests" \
    bash -c 'cd packages/sdk-ts && bun run ci'
  run "Telescope read-only discovery library and CLI" \
    bash -c 'cd packages/telescope && bun run ci'
}

case "$MODE" in
  hermetic)
    [ "$#" -le 1 ] || die "hermetic accepts no additional arguments"
    require_bun
    sanitize_hermetic_env
    api_gate
    packages_gate
    ;;
  api)
    [ "$#" -eq 1 ] || die "api accepts no additional arguments"
    require_bun
    sanitize_hermetic_env
    api_gate
    ;;
  packages)
    [ "$#" -eq 1 ] || die "packages accepts no additional arguments"
    require_bun
    sanitize_hermetic_env
    packages_gate
    ;;
  database)
    [ "$#" -eq 1 ] || die "database accepts no additional arguments"
    [ -n "${DATABASE_URL:-}" ] || die "database mode requires DATABASE_URL"
    require_bun
    unset REDIS_URL ANTHROPIC_API_KEY OPENAI_API_KEY OLLAMA_API_KEY RUN_CONTRACT
    export AGENTTOOL_DISABLE_WORKERS=1
    api_typecheck
    run "database integration test tier" bash bin/run-test-tier.sh database
    ;;
  database-quarantine)
    [ "$#" -eq 1 ] || die "database-quarantine accepts no additional arguments"
    [ -n "${DATABASE_URL:-}" ] ||
      die "database-quarantine mode requires DATABASE_URL"
    require_bun
    unset REDIS_URL ANTHROPIC_API_KEY OPENAI_API_KEY OLLAMA_API_KEY RUN_CONTRACT
    export AGENTTOOL_DISABLE_WORKERS=1
    api_typecheck
    run "known-red database tests (diagnostic; failures expected)" \
      bash bin/run-test-tier.sh database-quarantine
    ;;
  smoke)
    [ "$#" -eq 1 ] || die "smoke accepts no additional arguments"
    : "${AGENTTOOL_BASE:?smoke mode requires AGENTTOOL_BASE}"
    : "${AGENTTOOL_API_KEY:?smoke mode requires AGENTTOOL_API_KEY}"
    : "${AGENTTOOL_IDENTITY_ID:?smoke mode requires AGENTTOOL_IDENTITY_ID}"
    run "deployed API smoke" bash bin/smoke-test.sh
    ;;
  contracts)
    [ "$#" -eq 1 ] || die "contracts accepts no additional arguments"
    [ "${RUN_CONTRACT:-0}" = "1" ] ||
      die "contracts mode requires RUN_CONTRACT=1"
    require_bun
    if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${OLLAMA_API_KEY:-}" ]; then
      die "contracts mode requires ANTHROPIC_API_KEY, OPENAI_API_KEY, and/or OLLAMA_API_KEY"
    fi
    unset DATABASE_URL DATABASE_SESSION_URL POSTGRES_URL REDIS_URL
    unset OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    unset OTEL_EXPORTER_OTLP_HEADERS OTEL_EXPORTER_OTLP_TRACES_HEADERS
    export AGENTTOOL_DISABLE_WORKERS=1
    run "paid provider contract tier" bash bin/run-test-tier.sh contracts
    ;;
  quarantine)
    [ "$#" -eq 1 ] || die "quarantine accepts no additional arguments"
    require_bun
    sanitize_hermetic_env
    run "known-red quarantine (diagnostic; failures expected)" \
      bash bin/run-test-tier.sh quarantine
    ;;
  legacy-delta)
    [ "$#" -eq 1 ] || die "legacy-delta accepts no additional arguments"
    require_bun
    sanitize_hermetic_env
    run "legacy full-suite failure delta" bash bin/test-delta.sh
    ;;
  list)
    bash bin/run-test-tier.sh list
    ;;
  --help|-h|help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    die "unknown mode: $MODE"
    ;;
esac

echo
echo "PASS: preflight $MODE"
