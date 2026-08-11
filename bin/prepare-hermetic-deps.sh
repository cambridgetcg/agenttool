#!/usr/bin/env bash
# Prepare the installed dependency graph expected by bin/preflight.sh.
#
# Bun dependencies come from committed lockfiles, and local file-dependency
# peers are rebuilt before their consumers are installed. Full modes also
# replace the ignored HF training-host test venv and install its version-ranged
# `dev` and build requirements; that Python set is not lockfile-frozen.
# Preparation may access package registries. It is not a network sandbox
# or a complete toolchain reproduction. Known credential environment variables
# are removed first, but credential files/helpers are outside this boundary.
# Canonical top-level callers use bin/bash-without-env-hooks.sh so BASH_ENV and
# ENV cannot run before this script reaches its own shared sanitizer.
# CI pins Node separately where Node is used.
#
# Usage:
#   bin/prepare-hermetic-deps.sh           # complete hermetic preflight graph
#   bin/prepare-hermetic-deps.sh api       # API/protocol gate dependencies
#   bin/prepare-hermetic-deps.sh packages  # complete package gate dependencies

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly REQUIRED_BUN_VERSION="1.3.5"
readonly MODE="${1:-hermetic}"
readonly HF_HOST_WORKSPACE="$REPO_ROOT/packages/hf-training-host"
readonly HF_HOST_VENV="$HF_HOST_WORKSPACE/.venv"
HF_HOST_VENV_INCOMPLETE=0

# shellcheck source=bin/hermetic-env.sh
source "$REPO_ROOT/bin/hermetic-env.sh"

readonly -a API_WORKSPACES=(
  api
  packages/data-protocol
  packages/sdk-ts
  packages/kingdom
)

# Install independent/local-provider workspaces first. Consumers whose
# file-dependencies must be refreshed after a peer build are listed separately.
readonly -a PACKAGE_WORKSPACES=(
  api
  packages/data
  packages/data-protocol
  packages/repo-archive
  packages/dark-continent-contract
  packages/dark-continent-karma
  packages/wake-continuity
  packages/principality-geometry
  packages/deepseek-kingdom
  packages/kingdom-witness-lab
  packages/karma-mirror
  packages/heaven
  packages/living-substrate
  packages/wake-thread
  packages/credential-broker
  packages/collab
  packages/collab-zerone
  packages/browser
  packages/hf-scout
  packages/hf-training-garden
  packages/correspondence-yutabase
  packages/constructive-intelligence
  packages/trials
  packages/skills
  packages/skills-yutabase
  packages/sdk-ts
  packages/wallet
  packages/wallet-zerone
  packages/telescope
  packages/alchemy
  packages/kingdom
)

readonly -a LOCAL_PROVIDER_WORKSPACES=(
  packages/data
  packages/data-protocol
  packages/correspondence-yutabase
  packages/wallet
  packages/credential-broker
  packages/alchemy
  packages/wake-continuity
  packages/hf-scout
  packages/skills-yutabase
)

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  echo "prepare-hermetic-deps: $*" >&2
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

require_hf_host_python() {
  command -v python3 >/dev/null 2>&1 ||
    die "Python 3.10-3.14 is required for the HF training host package gate"
  local actual
  if ! actual="$(python3 -I -c 'import sys; version = sys.version_info[:2]; print(".".join(map(str, sys.version_info[:3]))); raise SystemExit(0 if (3, 10) <= version < (3, 15) else 1)')"; then
    die "Python 3.10-3.14 is required for the HF training host package gate; found ${actual:-unknown}"
  fi
  echo "  HF training host Python: $actual"
}

validate_hf_host_venv_target() {
  [ ! -L "$HF_HOST_VENV" ] ||
    die "refusing symlinked HF training host test environment: $HF_HOST_VENV"
  if [ -e "$HF_HOST_VENV" ] && [ ! -d "$HF_HOST_VENV" ]; then
    die "HF training host test environment exists but is not a directory: $HF_HOST_VENV"
  fi
}

cleanup_incomplete_hf_host_venv() {
  if [ "$HF_HOST_VENV_INCOMPLETE" = 1 ] &&
    [ -d "$HF_HOST_VENV" ] &&
    [ ! -L "$HF_HOST_VENV" ]; then
    rm -rf -- "$HF_HOST_VENV"
  fi
}

trap cleanup_incomplete_hf_host_venv EXIT

install_workspace() {
  local workspace="$1"
  shift
  # The positional parameters intentionally expand inside the child shell.
  # shellcheck disable=SC2016
  run "install $workspace from its lockfile" \
    bash -c 'cd "$1" && shift && bun install --frozen-lockfile "$@"' \
    bash "$REPO_ROOT/$workspace" "$@"
}

build_workspace() {
  local workspace="$1"
  # The positional parameter intentionally expands inside the child shell.
  # shellcheck disable=SC2016
  run "build local dependency provider $workspace" \
    bash -c 'cd "$1" && bun run build' bash "$REPO_ROOT/$workspace"
}

prepare_hf_training_host() {
  validate_hf_host_venv_target
  require_hf_host_python
  # Python venvs are not relocatable: their launchers and activation scripts
  # embed the creation path. Remove only the validated derived directory, then
  # build at its final path so every installed entry point remains executable.
  HF_HOST_VENV_INCOMPLETE=1
  rm -rf -- "$HF_HOST_VENV"
  run "build project-local HF training host test environment" \
    python3 -I -m venv "$HF_HOST_VENV"
  validate_hf_host_venv_target
  run "install HF training host dev/build requirements (not lockfile-frozen)" \
    "$HF_HOST_VENV/bin/python" -I -m pip --isolated install \
    --disable-pip-version-check --no-input --editable "${HF_HOST_WORKSPACE}[dev]"
  HF_HOST_VENV_INCOMPLETE=0
}

prepare_api() {
  local workspace
  for workspace in "${API_WORKSPACES[@]}"; do
    install_workspace "$workspace"
  done
}

prepare_packages() {
  local workspace
  validate_hf_host_venv_target
  for workspace in "${PACKAGE_WORKSPACES[@]}"; do
    install_workspace "$workspace"
  done

  for workspace in "${LOCAL_PROVIDER_WORKSPACES[@]}"; do
    build_workspace "$workspace"
  done

  # Preserve the exact refresh behavior validated in CI. Bun needs --force for
  # four consumers to recopy freshly built file dependencies; the projector
  # resolves its local peer correctly without it.
  install_workspace packages/data-sync --force
  install_workspace packages/correspondence-yutabase-projector
  install_workspace packages/alchemy-agentcred --force
  install_workspace packages/skills-wake-continuity --force
  install_workspace packages/hf-training-garden --force
  prepare_hf_training_host
}

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

case "$MODE" in
  -h|--help)
    usage
    exit 0
    ;;
  api|packages|hermetic) ;;
  *)
    usage >&2
    die "unknown mode: $MODE"
    ;;
esac

cd "$REPO_ROOT"
sanitize_hermetic_env
require_bun

case "$MODE" in
  api) prepare_api ;;
  packages|hermetic) prepare_packages ;;
esac
