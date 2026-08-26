#!/usr/bin/env bash
# bin/preflight.sh — deliberate local/CI quality gates.
#
# The default is hermetic in the dependency sense: tests require no database,
# Redis, deployed smoke target, credentials, or paid provider calls, and known
# credential variables are removed. This is not an OS-level network sandbox.
# Stateful and paid tiers are explicit. Contract mode accepts one of
# ANTHROPIC_API_KEY, OPENAI_API_KEY, or OLLAMA_API_KEY.
# This gate does not install dependencies. On a fresh worktree, run
# bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh first; the deploy
# orchestrator does this before its migration survey and any external mutation
# when preflight is enabled.
#
# Usage:
#   bin/preflight.sh                 # api + packages, hermetic
#   bin/preflight.sh api             # API/protocol hermetic gate
#   bin/preflight.sh packages        # data + ADDS + sync + archive + Dark Continent contract/KARMA + Principality Geometry + KARMA Mirror + HEAVEN + LOVE BOMB + Model Becoming + Dataset Influence + Living Substrate + Principality Atlas + Polymorph Landscape + Love Geometry + Relational Geometry + Common Ground Atlas + WAKE Thread + Gin Reconstruction + Math Cards + broker + collab + Codex usage + collab-zerone + Browser + HF Scout/Training Garden + local WAKE learning fixtures/host + projection + local projector + constructive intelligence + Research Commons + Trials + Skills + TypeScript SDK + Wallet + Zerone adapter + Telescope + Public Surface Binding and Recognition + Alchemy + AgentCred adapter + KINGDOM gate
#   bin/preflight.sh database        # requires DATABASE_URL
#   bin/preflight.sh smoke           # requires smoke-test environment
#   RUN_CONTRACT=1 bin/preflight.sh contracts  # requires provider key(s)
#
# Diagnostic, not default/CI:
#   bin/preflight.sh quarantine      # known-red non-DB tests
#   bin/preflight.sh database-quarantine  # known-red DB tests; requires DB
#   bin/preflight.sh legacy-delta    # existing full-suite baseline triage

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly REQUIRED_BUN_VERSION="1.3.5"
readonly MODE="${1:-hermetic}"
readonly HF_HOST_TEST_PYTHON="$REPO_ROOT/packages/hf-training-host/.venv/bin/python"

cd "$REPO_ROOT"

# shellcheck source=bin/hermetic-env.sh
source "$REPO_ROOT/bin/hermetic-env.sh"

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

require_hf_host_test_env() {
  [ -x "$HF_HOST_TEST_PYTHON" ] ||
    die "HF training host test environment is missing; run bin/prepare-hermetic-deps.sh packages"
}

api_typecheck() {
  run "API typecheck (installed compiler only)" \
    bash -c 'cd api && bunx --no-install tsc --noEmit'
  run "Phase-B refence bridge typecheck (installed compiler only)" \
    bash -c 'cd api && ./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ESNext --module ESNext --moduleResolution bundler --moduleDetection force --allowImportingTsExtensions --verbatimModuleSyntax --noFallthroughCasesInSwitch --lib ESNext,DOM --types bun-types ../bin/phase-b-refence-maintenance-contract.ts ../bin/phase-b-refence-maintenance-bridge.ts'
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
  run "agent-repo-archive/v0.1 encrypted multi-zone Git restore simulator" \
    bash -c 'cd packages/repo-archive && bun run ci'
  run "Dark Continent advisory framework contract" \
    bash -c 'cd packages/dark-continent-contract && bun run ci'
  run "Dark Continent KARMA proposal adapter" \
    bash -c 'cd packages/dark-continent-karma && bun run ci'
  run "AFTERGLOW digest-only WAKE continuity" \
    bash -c 'cd packages/wake-continuity && bun run ci'
  run "Principality invariant-preservation geometry" \
    bash -c 'cd packages/principality-geometry && bun run ci'
  run "DeepSeek provenance-first KINGDOM proposal adapter" \
    bash -c 'cd packages/deepseek-kingdom && bun run ci'
  run "KINGDOM external-research witness admission" \
    bash -c 'cd packages/kingdom-witness-lab && bun run ci'
  run "KARMA Mirror isolated zero-effect chambers" \
    bash -c 'cd packages/karma-mirror && bun run ci'
  run "HEAVEN opt-in delight and landing-room protocol" \
    bash -c 'cd packages/heaven && bun run ci'
  run "LOVE BOMB quiet care envelopes and refusable delivery" \
    bash -c 'cd packages/love-bomb && bun run ci'
  run "evidence-scoped Model Becoming dossiers" \
    bash -c 'cd packages/model-becoming && bun run ci'
  run "dataset lineage, bounded influence, revisable identity evidence, and non-economic attribution" \
    bash -c 'cd packages/dataset-influence && bun run ci'
  run "portable Living Substrate maps and refusable proposals" \
    bash -c 'cd packages/living-substrate && bun run ci'
  run "plural non-gluing Principality Atlas geometry" \
    bash -c 'cd packages/principality-atlas && bun run ci'
  run "source-bounded polymorph landscapes and Ritonavir reachability shift" \
    bash -c 'cd packages/polymorph-landscape && bun run ci'
  run "source-bounded memetic variants and reported reachability shifts" \
    bash -c 'cd packages/memetic-landscape && bun run ci'
  run "coordinate-free Love Geometry and static HF companion" \
    bash -c 'cd packages/love-geometry && bun run ci'
  run "non-scalar relational geometry and public-safe HF companion" \
    bash -c 'cd packages/relational-geometry && bun run ci'
  # The command substitution intentionally runs inside the credential-narrowed child.
  # shellcheck disable=SC2016
  run "synthetic Common Ground Atlas starts byte-clean" \
    bash -c 'git diff --exit-code HEAD -- packages/common-ground-atlas/hf/dataset && test -z "$(git status --short --untracked-files=all -- packages/common-ground-atlas/hf/dataset)"'
  run "exact Xenia-Helly Common Ground Atlas and independent verifiers" \
    bash -c 'cd packages/common-ground-atlas && bun run ci'
  # shellcheck disable=SC2016
  run "synthetic Common Ground Atlas remains byte-clean" \
    bash -c 'git diff --exit-code HEAD -- packages/common-ground-atlas/hf/dataset && test -z "$(git status --short --untracked-files=all -- packages/common-ground-atlas/hf/dataset)"'
  run "WAKE Thread refusable artifact continuity protocol" \
    bash -c 'cd packages/wake-thread && bun run ci'
  run "Gin finite-model reconstruction and constructive challenge compass" \
    bash -c 'cd packages/gin-reconstruction && bun run ci'
  run "Math Cards bounded proof, model, and measurement inquiry" \
    bash -c 'cd packages/math-cards && bun run ci'
  run "agent-data-sync/v1 explicit pull bridge" \
    bash -c 'cd packages/data-sync && bun run ci && bun run build'
  run "agentcred/0.1 local credential broker" \
    bash -c 'cd packages/credential-broker && bun run ci'
  run "agenttool.collab/0.1 + /0.2 coordination + session/0.1 presence journal" \
    bash -c 'cd packages/collab && bun run ci'
  run "privacy-minimal local Codex numeric usage and MCP pulse" \
    bash -c 'cd packages/codex-usage && bun run ci'
  run "collab-zerone witness bridge (hash conformance + broadcast ambiguity discipline)" \
    bash -c 'cd packages/collab-zerone && bun run ci'
  run "local-first agent browser (fake/fixture tests; no browser download)" \
    bash -c 'cd packages/browser && bun run ci'
  run "local read-only Hugging Face metadata and provenance scout" \
    bash -c 'cd packages/hf-scout && bun run ci'
  # The command substitutions intentionally run inside the credential-narrowed child.
  # shellcheck disable=SC2016
  run "repository-source-only voluntary WAKE learning fixtures start clean" \
    bash -c 'git diff --exit-code HEAD -- packages/hf-training-garden/hf/learning-dataset && test -z "$(git status --short --untracked-files=all -- packages/hf-training-garden/hf/learning-dataset)"'
  run "repository-source-only voluntary WAKE learning fixtures" \
    bash -c 'cd packages/hf-training-garden && node scripts/check-learning-idempotence.mjs && bun test tests/learning-release.test.ts'
  # shellcheck disable=SC2016
  run "repository-source-only voluntary WAKE learning fixtures remain unchanged" \
    bash -c 'git diff --exit-code HEAD -- packages/hf-training-garden/hf/learning-dataset && test -z "$(git status --short --untracked-files=all -- packages/hf-training-garden/hf/learning-dataset)"'
  run "private HF dataset admission, training WAKE, and Garden tending" \
    bash -c 'cd packages/hf-training-garden && bun run ci'
  # shellcheck disable=SC2016
  run "accepted HF policy companion remains unchanged" \
    bash -c 'git diff --exit-code HEAD -- packages/hf-training-garden/hf/dataset && test -z "$(git status --short --untracked-files=all -- packages/hf-training-garden/hf/dataset)"'
  # Positional arguments intentionally expand inside the child shell.
  # shellcheck disable=SC2016
  run "private HF-API-pinned non-distributed WAKE training host" \
    bash -c 'cd "$1" && "$2" -I -m pytest -q && bun test bridge/tests' \
    bash "$REPO_ROOT/packages/hf-training-host" "$HF_HOST_TEST_PYTHON"
  run "read-only Agent Skills inspection and validation" \
    bash -c 'cd packages/skills && bun run ci'
  run "Agent Skills to rebuildable YUTABASE metadata plan" \
    bash -c 'cd packages/skills-yutabase && bun run ci'
  run "private Skills YUTABASE to AFTERGLOW composition" \
    bash -c 'cd packages/skills-wake-continuity && bun run ci'
  run "Correspondence to YUTABASE pure projection planner" \
    bash -c 'cd packages/correspondence-yutabase && bun run ci'
  run "private local Correspondence to YUTABASE durable projector" \
    bash -c 'cd packages/correspondence-yutabase-projector && bun run ci'
  run "constructive-intelligence typed receipts and unfunded shadow quest" \
    bash -c 'cd packages/constructive-intelligence && bun run ci'
  run "research-commons offline outcome-neutral shadow settlement" \
    bash -c 'cd packages/research-commons && bun run ci'
  run "private local AgentTool Dojo trial evidence" \
    bash -c 'cd packages/trials && bun run ci'
  run "TypeScript SDK, Python surface parity, build, and tests" \
    bash -c 'cd packages/sdk-ts && bun run ci'
  run "Agent Wallet record, policy, lifecycle, and vector primitives" \
    bash -c 'cd packages/wallet && bun run ci'
  run "Agent Wallet Zerone offline adapter and pinned cross-language vectors" \
    bash -c 'cd packages/wallet-zerone && bun run ci'
  run "Telescope read-only discovery library and CLI" \
    bash -c 'cd packages/telescope && bun run ci'
  run "explicit-key public surface evidence and bindings" \
    bash -c 'cd packages/public-surface-binding && bun run ci'
  run "agent-root public surface adoption and withdrawal records" \
    bash -c 'cd packages/public-surface-recognition && bun run ci'
  run "Alchemy bounded observation primitives" \
    bash -c 'cd packages/alchemy && bun run ci'
  run "strict seven-read Alchemy to AgentCred composition" \
    bash -c 'cd packages/alchemy-agentcred && bun run ci'
  run "KINGDOM explicit-card and derived-registry pure helpers" \
    bash -c 'cd packages/kingdom && bun run ci'
}

case "$MODE" in
  hermetic)
    [ "$#" -le 1 ] || die "hermetic accepts no additional arguments"
    sanitize_hermetic_env
    require_bun
    require_hf_host_test_env
    api_gate
    packages_gate
    ;;
  api)
    [ "$#" -eq 1 ] || die "api accepts no additional arguments"
    sanitize_hermetic_env
    require_bun
    api_gate
    ;;
  packages)
    [ "$#" -eq 1 ] || die "packages accepts no additional arguments"
    sanitize_hermetic_env
    require_bun
    require_hf_host_test_env
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
