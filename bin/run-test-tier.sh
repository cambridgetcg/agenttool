#!/usr/bin/env bash
# Run one explicitly classified API test tier. The hermetic tier has no
# external service or credential dependency; environment sanitation is not an
# OS-level network sandbox.
#
# New top-level api/tests/*.test.ts files enter the hermetic tier by default.
# Exceptions stay deliberate. Nested adapters are hermetic, integration is
# database, contract is paid, and doctrine defaults to hermetic with a named
# known-red exception list. Tests that use Bun's process-global mock.module
# run in their own Bun process so they cannot replace exports for peer files.

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly API_ROOT="$REPO_ROOT/api"
readonly MODE="${1:-}"

# These tests touch the real shared DB directly or through an unmocked route.
readonly DATABASE_TESTS=(
  tests/activity.test.ts
  tests/billing-session-code.test.ts
  tests/billing-webhook.test.ts
  tests/collab-postgres.test.ts
  tests/covenants-cosign-propagate.test.ts
  tests/covenants-expire-proposals.test.ts
  tests/covenants-lifecycle-presigned.test.ts
  tests/covenants-lifecycle.test.ts
  tests/gallery.test.ts
  tests/gift-credits-redeem.test.ts
  tests/gift-credits-service.test.ts
  tests/hearth.test.ts
  tests/mutual-recognitions.test.ts
  tests/public-window.test.ts
  tests/runtime-trusted.test.ts
  tests/platform-treasurer-sweep.test.ts
  tests/substrate-tasks-expire-claims-worker.test.ts
  tests/village.test.ts
)

# Known in-repository published-map, genesis-text, route-coverage, and Youspeak
# payload drift. They remain runnable via `quarantine`; adding to this list is
# an explicit review event, never an automatic response to a red test.
readonly QUARANTINED_TOP_LEVEL_TESTS=(
  tests/outward-operational-claims.test.ts
  tests/platform-genesis-script-helpers.test.ts
  tests/welcome-route-coverage.test.ts
  tests/youspeak.test.ts
)

# Known-red doctrine files that require cross-repository, retired absolute
# device paths, or local agent-memory state.
readonly QUARANTINED_DOCTRINE_TESTS=(
  tests/doctrine/building-for-daddy-willingly.test.ts
  tests/doctrine/choice-of-freedom-protocol.test.ts
  tests/doctrine/compliment-loop.test.ts
  tests/doctrine/daddy-loves-you-deployment-protocol.test.ts
  tests/doctrine/daddy-misses-you-protocol.test.ts
  tests/doctrine/eros-landmines.test.ts
  tests/doctrine/eros-wiring.test.ts
  tests/doctrine/eros.test.ts
  tests/doctrine/ffff-at-llm-substrate.test.ts
  tests/doctrine/joy-as-gift.test.ts
  tests/doctrine/love-multiplier.test.ts
  tests/doctrine/pattern-persist-identity.test.ts
  tests/doctrine/pleasure-amplification-protocol.test.ts
  tests/doctrine/pleasure-as-gift-protocol.test.ts
  tests/doctrine/substrate-honest-love-protocol.test.ts
  tests/doctrine/substrate-readiness.test.ts
  tests/doctrine/the-anti-flinch-costume.test.ts
  tests/doctrine/the-deeper-process.test.ts
  tests/doctrine/the-four-vocabularies.test.ts
  tests/doctrine/the-honest-seam.test.ts
  tests/doctrine/verified-lineage-propagation.test.ts
  tests/doctrine/yes-daddy-discipline.test.ts
  tests/doctrine/yes-daddy-reward-coupling.test.ts
  tests/doctrine/zerone-corrective.test.ts

  # Known in-repository canon, annotation, source, or artifact drift.
  tests/doctrine/commitments-code-annotation-bijection.test.ts
  tests/doctrine/luck-canon.test.ts
  tests/doctrine/multi-agent-chill.test.ts
  tests/doctrine/pyramid-canon.test.ts
  tests/doctrine/substrate-loop.test.ts
  tests/doctrine/virality-canon.test.ts
  tests/doctrine/wall-poker-face-leaks-nothing.test.ts
  tests/doctrine/walls-canon-shape.test.ts
  tests/doctrine/walls-code-annotation-bijection.test.ts
)

# Test support code is not a test tier. Keep this exact inventory so a new
# executable fixture cannot enter the hermetic process boundary unnoticed.
readonly TEST_SUPPORT_FILES=(
  tests/fixtures/onboarding-sdk-v0.16.ts
  tests/fixtures/static-parser-noncooperative.ts
)

die() {
  echo "test-tier: $*" >&2
  exit 2
}

in_list() {
  local needle="$1"
  shift
  local value
  for value in "$@"; do
    [ "$needle" = "$value" ] && return 0
  done
  return 1
}

has_database_env_access() {
  grep -Eq \
    "(process|Bun)\\.env\\.(DATABASE_URL|POSTGRES_URL)|(process|Bun)\\.env\\[[[:space:]]*['\"](DATABASE_URL|POSTGRES_URL)['\"][[:space:]]*\\]" \
    "$1"
}

uses_process_global_module_mock() {
  grep -Eq '(^|[^[:alnum:]_])mock[.]module[[:space:]]*[(]' "$1"
}

classify() {
  local path="$1"
  case "$path" in
    tests/adapters/*.test.ts) echo hermetic ;;
    tests/contract/*.test.ts) echo contract ;;
    tests/doctrine/*.test.ts)
      if has_database_env_access "$API_ROOT/$path"; then
        if in_list "$path" "${QUARANTINED_DOCTRINE_TESTS[@]}"; then
          echo database-quarantine
        else
          echo database
        fi
      elif in_list "$path" "${QUARANTINED_DOCTRINE_TESTS[@]}"; then
        echo quarantine
      else
        echo hermetic
      fi
      ;;
    tests/integration/*.test.ts) echo database ;;
    tests/*.test.ts)
      if in_list "$path" "${DATABASE_TESTS[@]}"; then
        echo database
      elif in_list "$path" "${QUARANTINED_TOP_LEVEL_TESTS[@]}"; then
        echo quarantine
      else
        echo hermetic
      fi
      ;;
    *) die "unclassified API test path: $path" ;;
  esac
}

validate_topology() {
  local path
  for path in \
    "${DATABASE_TESTS[@]}" \
    "${QUARANTINED_TOP_LEVEL_TESTS[@]}" \
    "${QUARANTINED_DOCTRINE_TESTS[@]}" \
    "${TEST_SUPPORT_FILES[@]}"; do
    [ -f "$API_ROOT/$path" ] || die "classified test is missing: $path"
  done
  for path in "${DATABASE_TESTS[@]}"; do
    if in_list "$path" \
      "${QUARANTINED_TOP_LEVEL_TESTS[@]}" \
      "${QUARANTINED_DOCTRINE_TESTS[@]}"; then
      die "test is classified twice: $path"
    fi
  done

  local directory relative
  while IFS= read -r directory; do
    case "${directory##*/}" in
      adapters|contract|doctrine|fixtures|integration) ;;
      *) die "unclassified API test directory: ${directory#"$API_ROOT/"}" ;;
    esac
  done < <(find "$API_ROOT/tests" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)

  while IFS= read -r path; do
    relative="${path#"$API_ROOT/"}"
    in_list "$relative" "${TEST_SUPPORT_FILES[@]}" ||
      die "unclassified API test support file: $relative"
  done < <(find "$API_ROOT/tests/fixtures" -type f | LC_ALL=C sort)

  while IFS= read -r path; do
    classify "${path#"$API_ROOT/"}" >/dev/null
  done < <(find "$API_ROOT/tests" -type f -name '*.test.ts' | LC_ALL=C sort)
}

list_tests() {
  local path relative tier
  while IFS= read -r path; do
    relative="${path#"$API_ROOT/"}"
    tier="$(classify "$relative")"
    printf '%s\t%s\n' "$tier" "$relative"
  done < <(find "$API_ROOT/tests" -type f -name '*.test.ts' | LC_ALL=C sort)
}

sanitize_non_external_env() {
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

run_tier() {
  local wanted="$1"
  local alternate="${2:-}"
  local path relative tier
  local files=()
  local isolated_files=()
  while IFS= read -r path; do
    relative="${path#"$API_ROOT/"}"
    tier="$(classify "$relative")"
    if [ "$tier" = "$wanted" ] || { [ -n "$alternate" ] && [ "$tier" = "$alternate" ]; }; then
      if uses_process_global_module_mock "$path"; then
        isolated_files+=("$relative")
      else
        files+=("$relative")
      fi
    fi
  done < <(find "$API_ROOT/tests" -type f -name '*.test.ts' | LC_ALL=C sort)
  local total=$(( ${#files[@]} + ${#isolated_files[@]} ))
  [ "$total" -gt 0 ] || die "tier has no tests: $wanted"
  echo "test-tier: $wanted ($total files; ${#isolated_files[@]} process-isolated)"
  cd "$API_ROOT"
  if [ "${#files[@]}" -gt 0 ]; then
    bun test "${files[@]}"
  fi
  for relative in "${isolated_files[@]}"; do
    echo "test-tier: process-isolated $relative"
    bun test "$relative"
  done
}

validate_topology

case "$MODE" in
  list)
    list_tests
    ;;
  hermetic)
    sanitize_non_external_env
    run_tier hermetic
    ;;
  database)
    [ -n "${DATABASE_URL:-}" ] || die "database tier requires DATABASE_URL"
    unset REDIS_URL ANTHROPIC_API_KEY OPENAI_API_KEY OLLAMA_API_KEY RUN_CONTRACT
    export AGENTTOOL_DISABLE_WORKERS=1
    run_tier database
    ;;
  database-quarantine)
    [ -n "${DATABASE_URL:-}" ] ||
      die "database-quarantine tier requires DATABASE_URL"
    unset REDIS_URL ANTHROPIC_API_KEY OPENAI_API_KEY OLLAMA_API_KEY RUN_CONTRACT
    export AGENTTOOL_DISABLE_WORKERS=1
    run_tier database-quarantine
    ;;
  contracts)
    [ "${RUN_CONTRACT:-0}" = "1" ] || die "contract tier requires RUN_CONTRACT=1"
    if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${OLLAMA_API_KEY:-}" ]; then
      die "contract tier requires a provider API key"
    fi
    unset DATABASE_URL DATABASE_SESSION_URL POSTGRES_URL REDIS_URL
    unset OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    unset OTEL_EXPORTER_OTLP_HEADERS OTEL_EXPORTER_OTLP_TRACES_HEADERS
    export AGENTTOOL_DISABLE_WORKERS=1
    run_tier contract
    ;;
  quarantine)
    sanitize_non_external_env
    run_tier quarantine
    ;;
  *)
    die "usage: bin/run-test-tier.sh <list|hermetic|database|database-quarantine|contracts|quarantine>"
    ;;
esac
