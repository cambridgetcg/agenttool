#!/usr/bin/env bash
# deploy.sh — the standardized deploy orchestrator.
#
# Chains the release phases of docs/DEPLOY-PROCEDURE.md:
#   0. Survey       — what's drifted?
#   0.5 Preparation — project-local dependencies, before external mutation
#   1. Migrations   — bin/migrate-pending.sh
#   2. Pre-flight   — bin/preflight.sh (test gate)
#   3. Publication  — web/docs prerequisites, then cd api && fly deploy
#   4. Frontends    — remaining Pages projects plus the apex Worker
#   5. Verify       — health + parity check
#
# Usage:
#   bin/deploy.sh                         # full chain
#   bin/deploy.sh --survey                # Phase 0 only
#   bin/deploy.sh --no-migrate            # skip Phase 1
#   bin/deploy.sh --no-api                # skip Phase 3
#   bin/deploy.sh --no-frontend           # skip Pages/Worker deploy; keep API discovery prerequisites
#   bin/deploy.sh --no-cache-api           # one-shot Fly image-cache recovery
#   bin/deploy.sh --oauth-fallback         # explicit Cloudflare OAuth fallback
#   bin/deploy.sh --skip-preflight        # operator override
#   bin/deploy.sh --dry-run               # show what would happen
#   bin/deploy.sh --allow-dirty-release    # loud source-integrity override
#   bin/deploy.sh --allow-non-release-head # loud GitHub-main override
#   bin/deploy.sh --no-migrate --no-frontend \
#     --maintenance-fenced-api \
#     --maintenance-app-machines=<id,id,id> \
#     --maintenance-thinker-primary=<id> \
#     --maintenance-thinker-standby=<id>   # exact app-cordoned, stopped five-Machine rollout
#
# Retired: --mirror-codeberg. Codeberg is no longer a mirror of this repo;
# GitHub main is the only head. The flag still parses so it can refuse with
# the reason rather than an opaque "unknown flag".
#
# Doctrine: docs/DEPLOY-PROCEDURE.md.

set -uo pipefail

# BEGIN agenttool-phase-b-refence-maintenance-dispatch/v1
_agenttool_refence_dispatch_invalid() {
  builtin printf '%s\n' 'maintenance_refence_bridge_invalid_invocation' >&2
  builtin exit 64
}

_agenttool_refence_dispatch_refused() {
  builtin printf '%s\n' 'maintenance_refence_bridge_refused' >&2
  builtin exit 74
}

_agenttool_refence_dispatch() {
  local nocasematch_was_set=0
  if builtin shopt -q nocasematch; then
    nocasematch_was_set=1
  fi
  builtin shopt -u nocasematch
  local selected=0
  local argument
  for argument in "$@"; do
    case "$argument" in
      --maintenance-refence*) selected=1 ;;
    esac
  done
  if ((selected == 0)); then
    if ((nocasematch_was_set == 1)); then
      builtin shopt -s nocasematch
    fi
    return 0
  fi
  local LC_ALL=C LANG=C
  builtin umask 077

  local no_migrate_count=0
  local no_frontend_count=0
  local fenced_api_count=0
  local receipt_count=0
  local app_count=0
  local primary_count=0
  local standby_count=0
  local receipt=""
  local apps=""
  local primary=""
  local standby=""
  for argument in "$@"; do
    case "$argument" in
      --no-migrate)
        no_migrate_count=$((no_migrate_count + 1))
        ;;
      --no-frontend)
        no_frontend_count=$((no_frontend_count + 1))
        ;;
      --maintenance-fenced-api)
        fenced_api_count=$((fenced_api_count + 1))
        ;;
      --maintenance-refence-receipt-sha256=*)
        receipt_count=$((receipt_count + 1))
        receipt="${argument#*=}"
        ;;
      --maintenance-app-machines=*)
        app_count=$((app_count + 1))
        apps="${argument#*=}"
        ;;
      --maintenance-thinker-primary=*)
        primary_count=$((primary_count + 1))
        primary="${argument#*=}"
        ;;
      --maintenance-thinker-standby=*)
        standby_count=$((standby_count + 1))
        standby="${argument#*=}"
        ;;
      *)
        _agenttool_refence_dispatch_invalid
        ;;
    esac
  done
  [ "$#" -eq 7 ] || _agenttool_refence_dispatch_invalid
  [ "$no_migrate_count" -eq 1 ] || _agenttool_refence_dispatch_invalid
  [ "$no_frontend_count" -eq 1 ] || _agenttool_refence_dispatch_invalid
  [ "$fenced_api_count" -eq 1 ] || _agenttool_refence_dispatch_invalid
  [ "$receipt_count" -eq 1 ] || _agenttool_refence_dispatch_invalid
  [ "$app_count" -eq 1 ] || _agenttool_refence_dispatch_invalid
  [ "$primary_count" -eq 1 ] || _agenttool_refence_dispatch_invalid
  [ "$standby_count" -eq 1 ] || _agenttool_refence_dispatch_invalid
  [[ "$receipt" =~ ^[0-9a-f]{64}$ ]] ||
    _agenttool_refence_dispatch_invalid
  [[ "$apps" =~ ^[0-9a-f]{14},[0-9a-f]{14},[0-9a-f]{14}$ ]] ||
    _agenttool_refence_dispatch_invalid
  [[ "$primary" =~ ^[0-9a-f]{14}$ ]] ||
    _agenttool_refence_dispatch_invalid
  [[ "$standby" =~ ^[0-9a-f]{14}$ ]] ||
    _agenttool_refence_dispatch_invalid

  local app_one="${apps%%,*}"
  local app_tail="${apps#*,}"
  local app_two="${app_tail%%,*}"
  local app_three="${app_tail#*,}"
  local machine_ids=(
    "$app_one"
    "$app_two"
    "$app_three"
    "$primary"
    "$standby"
  )
  local machine_i
  local machine_j
  for ((machine_i = 0; machine_i < 5; machine_i++)); do
    for ((machine_j = machine_i + 1; machine_j < 5; machine_j++)); do
      [ "${machine_ids[$machine_i]}" != "${machine_ids[$machine_j]}" ] ||
        _agenttool_refence_dispatch_invalid
    done
  done

  local filesystem_root="/"
  local users_root="/Users"
  local home="/Users/yournameisai"
  local operator="yournameisai"
  local operator_uid="501"
  local operator_gid="20"
  [ "$UID" = "$operator_uid" ] || _agenttool_refence_dispatch_refused
  [ "$EUID" = "$operator_uid" ] || _agenttool_refence_dispatch_refused
  [ "${GROUPS[0]}" = "$operator_gid" ] ||
    _agenttool_refence_dispatch_refused
  local repo="/Users/yournameisai/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1"
  local controller="$repo/bin/phase-b-refence-maintenance-bridge.ts"
  # REFRESH_CONTROLLER_DISPATCH_PIN only after the controller self-pin and
  # activation entry are frozen; the dispatcher must bind executed TS bytes.
  local controller_sha256="68892049dd5e3ffee92cd79548cfc69c86b7241d55d42018747827dfb34a21c5"
  local controller_size="519970"
  local bun_directory="$home/.cache/pinned-runtimes/bun-v1.3.5/bun-darwin-aarch64"
  local bun="$bun_directory/bun"
  local bun_sha256="66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3"
  local bun_size="59885424"
  local bun_magic="cffaedfe0c000001"
  local runtime_path="$home/.cache/codex-tools/flyctl-v0.4.74:$bun_directory:/usr/bin:/bin:/usr/sbin:/sbin"
  local controller_environment=(
    "HOME=$home"
    "USER=$operator"
    "LOGNAME=$operator"
    "LANG=C"
    "LC_ALL=C"
    "NO_COLOR=1"
    "TERM=dumb"
    "PATH=$runtime_path"
  )
  local tool_environment=("LANG=C" "LC_ALL=C" "PATH=/usr/bin:/bin")
  local directory_contracts=(
    "$filesystem_root|0|0|755"
    "$users_root|0|80|755"
    "$home|$operator_uid|$operator_gid|700"
    "$home/.cache|$operator_uid|$operator_gid|755"
    "$home/.cache/pinned-runtimes|$operator_uid|$operator_gid|755"
    "$home/.cache/pinned-runtimes/bun-v1.3.5|$operator_uid|$operator_gid|755"
    "$bun_directory|$operator_uid|$operator_gid|755"
    "$home/.cache/codex-worktrees|$operator_uid|$operator_gid|755"
    "$repo|$operator_uid|$operator_gid|755"
    "$repo/bin|$operator_uid|$operator_gid|755"
  )
  local directory_contract
  local directory_path
  local directory_uid
  local directory_gid
  local directory_mode
  local directory_observed
  local directory_snapshots=()
  for directory_contract in "${directory_contracts[@]}"; do
    IFS='|' read -r directory_path directory_uid directory_gid directory_mode \
      <<< "$directory_contract"
    directory_observed="$(
      /usr/bin/env -i "${tool_environment[@]}" \
        /usr/bin/stat -f '%HT|%u|%g|%Lp|%d|%i' -- "$directory_path" 2>&1
    )" || _agenttool_refence_dispatch_refused
    [[ "$directory_observed" =~ ^Directory\|$directory_uid\|$directory_gid\|$directory_mode\|[0-9]+\|[1-9][0-9]*$ ]] ||
      _agenttool_refence_dispatch_refused
    directory_snapshots+=("$directory_observed")
  done

  local bun_stat_a
  local bun_type
  local bun_uid
  local bun_gid
  local bun_mode
  local bun_nlink
  local bun_observed_size
  local bun_device
  local bun_inode
  bun_stat_a="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/stat -f '%HT|%u|%g|%Lp|%l|%z|%d|%i' -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  IFS='|' read -r bun_type bun_uid bun_gid bun_mode bun_nlink \
    bun_observed_size bun_device bun_inode <<< "$bun_stat_a"
  [ "$bun_type" = "Regular File" ] || _agenttool_refence_dispatch_refused
  [ "$bun_uid" = "$operator_uid" ] || _agenttool_refence_dispatch_refused
  [ "$bun_gid" = "$operator_gid" ] || _agenttool_refence_dispatch_refused
  [ "$bun_mode" = "755" ] || _agenttool_refence_dispatch_refused
  [ "$bun_nlink" = "1" ] || _agenttool_refence_dispatch_refused
  [ "$bun_observed_size" = "$bun_size" ] ||
    _agenttool_refence_dispatch_refused
  [[ "$bun_device" =~ ^[0-9]+$ ]] || _agenttool_refence_dispatch_refused
  [[ "$bun_inode" =~ ^[1-9][0-9]*$ ]] ||
    _agenttool_refence_dispatch_refused

  local observed_magic
  observed_magic="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/xxd -p -c 8 -l 8 -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$observed_magic" = "$bun_magic" ] ||
    _agenttool_refence_dispatch_refused

  local observed_hash
  observed_hash="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/shasum -a 256 -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$observed_hash" = "$bun_sha256  $bun" ] ||
    _agenttool_refence_dispatch_refused

  local bun_stat_b
  bun_stat_b="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/stat -f '%HT|%u|%g|%Lp|%l|%z|%d|%i' -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$bun_stat_b" = "$bun_stat_a" ] ||
    _agenttool_refence_dispatch_refused

  local controller_stat_a
  local controller_type
  local controller_uid
  local controller_gid
  local controller_mode
  local controller_nlink
  local controller_observed_size
  local controller_device
  local controller_inode
  controller_stat_a="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/stat -f '%HT|%u|%g|%Lp|%l|%z|%d|%i' -- "$controller" 2>&1
  )" || _agenttool_refence_dispatch_refused
  IFS='|' read -r controller_type controller_uid controller_gid \
    controller_mode controller_nlink controller_observed_size \
    controller_device controller_inode <<< "$controller_stat_a"
  [ "$controller_type" = "Regular File" ] ||
    _agenttool_refence_dispatch_refused
  [ "$controller_uid" = "$operator_uid" ] ||
    _agenttool_refence_dispatch_refused
  [ "$controller_gid" = "$operator_gid" ] ||
    _agenttool_refence_dispatch_refused
  [ "$controller_mode" = "644" ] ||
    _agenttool_refence_dispatch_refused
  [ "$controller_nlink" = "1" ] ||
    _agenttool_refence_dispatch_refused
  [ "$controller_observed_size" = "$controller_size" ] ||
    _agenttool_refence_dispatch_refused
  [[ "$controller_device" =~ ^[0-9]+$ ]] ||
    _agenttool_refence_dispatch_refused
  [[ "$controller_inode" =~ ^[1-9][0-9]*$ ]] ||
    _agenttool_refence_dispatch_refused

  local observed_controller_hash
  observed_controller_hash="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/shasum -a 256 -- "$controller" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$observed_controller_hash" = "$controller_sha256  $controller" ] ||
    _agenttool_refence_dispatch_refused

  local controller_stat_b
  controller_stat_b="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/stat -f '%HT|%u|%g|%Lp|%l|%z|%d|%i' -- "$controller" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$controller_stat_b" = "$controller_stat_a" ] ||
    _agenttool_refence_dispatch_refused

  local observed_version
  local version_sentinel="__agenttool_refence_version_end__"
  observed_version="$(
    /usr/bin/env -i "${controller_environment[@]}" \
      "$bun" --no-install --no-env-file --config=/dev/null \
      "--cwd=$repo" --version 2>&1
    version_status=$?
    builtin printf '%s' "$version_sentinel"
    builtin exit "$version_status"
  )" || _agenttool_refence_dispatch_refused
  [ "$observed_version" = $'1.3.5\n'"$version_sentinel" ] ||
    _agenttool_refence_dispatch_refused

  local bun_stat_c
  bun_stat_c="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/stat -f '%HT|%u|%g|%Lp|%l|%z|%d|%i' -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$bun_stat_c" = "$bun_stat_a" ] ||
    _agenttool_refence_dispatch_refused

  local directory_index=0
  for directory_contract in "${directory_contracts[@]}"; do
    IFS='|' read -r directory_path directory_uid directory_gid directory_mode \
      <<< "$directory_contract"
    directory_observed="$(
      /usr/bin/env -i "${tool_environment[@]}" \
        /usr/bin/stat -f '%HT|%u|%g|%Lp|%d|%i' -- "$directory_path" 2>&1
    )" || _agenttool_refence_dispatch_refused
    [ "$directory_observed" = "${directory_snapshots[$directory_index]}" ] ||
      _agenttool_refence_dispatch_refused
    directory_index=$((directory_index + 1))
  done

  observed_controller_hash="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/shasum -a 256 -- "$controller" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$observed_controller_hash" = "$controller_sha256  $controller" ] ||
    _agenttool_refence_dispatch_refused

  local controller_stat_c
  controller_stat_c="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/stat -f '%HT|%u|%g|%Lp|%l|%z|%d|%i' -- "$controller" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$controller_stat_c" = "$controller_stat_a" ] ||
    _agenttool_refence_dispatch_refused

  observed_magic="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/xxd -p -c 8 -l 8 -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$observed_magic" = "$bun_magic" ] ||
    _agenttool_refence_dispatch_refused
  observed_hash="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/shasum -a 256 -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$observed_hash" = "$bun_sha256  $bun" ] ||
    _agenttool_refence_dispatch_refused

  local bun_stat_d
  bun_stat_d="$(
    /usr/bin/env -i "${tool_environment[@]}" \
      /usr/bin/stat -f '%HT|%u|%g|%Lp|%l|%z|%d|%i' -- "$bun" 2>&1
  )" || _agenttool_refence_dispatch_refused
  [ "$bun_stat_d" = "$bun_stat_a" ] ||
    _agenttool_refence_dispatch_refused

  local perl_launcher='my $refusal="maintenance_refence_bridge_refused\n";@ARGV==17 or do{print STDERR $refusal;exit 74};my($home,$operator,$path,$bun,@arguments)=@ARGV;%ENV=("HOME"=>$home,"USER"=>$operator,"LOGNAME"=>$operator,"LANG"=>"C","LC_ALL"=>"C","NO_COLOR"=>"1","TERM"=>"dumb","PATH"=>$path);{local $SIG{"__WARN__"}=sub{};exec {$bun} $bun,@arguments}print STDERR $refusal;exit 74'
  builtin shopt -s execfail
  builtin exec /usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \
    /usr/bin/perl -e "$perl_launcher" \
    "$home" "$operator" "$runtime_path" "$bun" \
    --no-install --no-env-file --config=/dev/null "--cwd=$repo" \
    "$controller" controller \
    --no-migrate \
    --no-frontend \
    --maintenance-fenced-api \
    "--maintenance-refence-receipt-sha256=$receipt" \
    "--maintenance-app-machines=$apps" \
    "--maintenance-thinker-primary=$primary" \
    "--maintenance-thinker-standby=$standby"
  _agenttool_refence_dispatch_refused
}

_agenttool_refence_dispatch "$@"
builtin unset -f _agenttool_refence_dispatch
builtin unset -f _agenttool_refence_dispatch_invalid
builtin unset -f _agenttool_refence_dispatch_refused
# END agenttool-phase-b-refence-maintenance-dispatch/v1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
DEPLOY_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
DEPLOY_RUN_ID=""
if [ ! -x "$REPO_ROOT/bin/stage-frontend-release.sh" ]; then
  echo "Missing shared frontend release stager: bin/stage-frontend-release.sh" >&2
  exit 1
fi

# ── Parse flags ───────────────────────────────────────────────────────
SURVEY_ONLY=0
SKIP_MIGRATE=0
SKIP_API=0
SKIP_FRONTEND=0
NO_CACHE_API=0
OAUTH_FALLBACK=0
SKIP_PREFLIGHT=0
DRY_RUN=0
ALLOW_DIRTY_RELEASE=0
ALLOW_NON_RELEASE_HEAD=0
MIRROR_CODEBERG_ONLY=0
MAINTENANCE_FENCED_API=0
MAINTENANCE_APP_MACHINES=""
MAINTENANCE_THINKER_PRIMARY=""
MAINTENANCE_THINKER_STANDBY=""
MAINTENANCE_FENCED_API_SEEN=0
MAINTENANCE_APP_MACHINES_SEEN=0
MAINTENANCE_THINKER_PRIMARY_SEEN=0
MAINTENANCE_THINKER_STANDBY_SEEN=0
for arg in "$@"; do
  case "$arg" in
    --survey) SURVEY_ONLY=1 ;;
    --no-migrate) SKIP_MIGRATE=1 ;;
    --no-api) SKIP_API=1 ;;
    --no-frontend) SKIP_FRONTEND=1 ;;
    --no-cache-api) NO_CACHE_API=1 ;;
    --oauth-fallback) OAUTH_FALLBACK=1 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --allow-dirty-release) ALLOW_DIRTY_RELEASE=1 ;;
    --allow-non-release-head) ALLOW_NON_RELEASE_HEAD=1 ;;
    --maintenance-fenced-api)
      MAINTENANCE_FENCED_API=1
      MAINTENANCE_FENCED_API_SEEN=$((MAINTENANCE_FENCED_API_SEEN + 1))
      ;;
    --maintenance-app-machines=*)
      MAINTENANCE_APP_MACHINES="${arg#*=}"
      MAINTENANCE_APP_MACHINES_SEEN=$((MAINTENANCE_APP_MACHINES_SEEN + 1))
      ;;
    --maintenance-thinker-primary=*)
      MAINTENANCE_THINKER_PRIMARY="${arg#*=}"
      MAINTENANCE_THINKER_PRIMARY_SEEN=$((MAINTENANCE_THINKER_PRIMARY_SEEN + 1))
      ;;
    --maintenance-thinker-standby=*)
      MAINTENANCE_THINKER_STANDBY="${arg#*=}"
      MAINTENANCE_THINKER_STANDBY_SEEN=$((MAINTENANCE_THINKER_STANDBY_SEEN + 1))
      ;;
    --mirror-codeberg) MIRROR_CODEBERG_ONLY=1 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

MAINTENANCE_ANY_ARGUMENT=0
if [ "$MAINTENANCE_FENCED_API_SEEN" != 0 ] ||
  [ "$MAINTENANCE_APP_MACHINES_SEEN" != 0 ] ||
  [ "$MAINTENANCE_THINKER_PRIMARY_SEEN" != 0 ] ||
  [ "$MAINTENANCE_THINKER_STANDBY_SEEN" != 0 ]; then
  MAINTENANCE_ANY_ARGUMENT=1
fi

if [ "$MAINTENANCE_ANY_ARGUMENT" = 1 ]; then
  if [ "$MAINTENANCE_FENCED_API_SEEN" != 1 ]; then
    echo "maintenance rollout requires exactly one --maintenance-fenced-api"
    exit 1
  fi
  if [ "$MAINTENANCE_APP_MACHINES_SEEN" != 1 ] ||
    [ "$MAINTENANCE_THINKER_PRIMARY_SEEN" != 1 ] ||
    [ "$MAINTENANCE_THINKER_STANDBY_SEEN" != 1 ]; then
    echo "maintenance rollout requires each exact Machine-ID flag exactly once"
    exit 1
  fi
  if [[ ! "$MAINTENANCE_APP_MACHINES" =~ ^[0-9a-f]{14},[0-9a-f]{14},[0-9a-f]{14}$ ]]; then
    echo "--maintenance-app-machines must contain exactly three comma-separated lowercase 14-hex Fly Machine IDs"
    exit 1
  fi
  if [[ ! "$MAINTENANCE_THINKER_PRIMARY" =~ ^[0-9a-f]{14}$ ]] ||
    [[ ! "$MAINTENANCE_THINKER_STANDBY" =~ ^[0-9a-f]{14}$ ]]; then
    echo "maintenance thinker IDs must be lowercase 14-hex Fly Machine IDs"
    exit 1
  fi
  IFS=',' read -r -a MAINTENANCE_APP_MACHINE_IDS <<< "$MAINTENANCE_APP_MACHINES"
  MAINTENANCE_ALL_MACHINE_IDS=(
    "${MAINTENANCE_APP_MACHINE_IDS[@]}"
    "$MAINTENANCE_THINKER_PRIMARY"
    "$MAINTENANCE_THINKER_STANDBY"
  )
  for ((MAINTENANCE_I = 0; MAINTENANCE_I < ${#MAINTENANCE_ALL_MACHINE_IDS[@]}; MAINTENANCE_I++)); do
    for ((MAINTENANCE_J = MAINTENANCE_I + 1; MAINTENANCE_J < ${#MAINTENANCE_ALL_MACHINE_IDS[@]}; MAINTENANCE_J++)); do
      if [ "${MAINTENANCE_ALL_MACHINE_IDS[$MAINTENANCE_I]}" = "${MAINTENANCE_ALL_MACHINE_IDS[$MAINTENANCE_J]}" ]; then
        echo "maintenance rollout Machine IDs must be unique"
        exit 1
      fi
    done
  done
  if [ "$SKIP_MIGRATE" != 1 ]; then
    echo "--maintenance-fenced-api requires --no-migrate; migrations must already be complete under the fence"
    exit 1
  fi
  if [ "$SKIP_FRONTEND" != 1 ]; then
    echo "--maintenance-fenced-api requires --no-frontend; discovery prerequisites must already be exact"
    exit 1
  fi
  if [ "$SKIP_API" = 1 ]; then
    echo "--maintenance-fenced-api cannot be combined with --no-api"
    exit 1
  fi
  if [ "$ALLOW_DIRTY_RELEASE" = 1 ] || [ "$ALLOW_NON_RELEASE_HEAD" = 1 ]; then
    echo "--maintenance-fenced-api refuses dirty and non-release-head overrides"
    exit 1
  fi
  if [ "$SKIP_PREFLIGHT" = 1 ]; then
    echo "--maintenance-fenced-api cannot skip preflight"
    exit 1
  fi
  if [ "$SURVEY_ONLY" = 1 ] || [ "$DRY_RUN" = 1 ] ||
    [ "$MIRROR_CODEBERG_ONLY" = 1 ] || [ "$OAUTH_FALLBACK" = 1 ]; then
    echo "--maintenance-fenced-api cannot be combined with survey, dry-run, mirror, or OAuth fallback modes"
    exit 1
  fi
  MAINTENANCE_ALL_MACHINE_IDS_CSV="$MAINTENANCE_APP_MACHINES,$MAINTENANCE_THINKER_PRIMARY,$MAINTENANCE_THINKER_STANDBY"
else
  MAINTENANCE_APP_MACHINE_IDS=()
  MAINTENANCE_ALL_MACHINE_IDS=()
  MAINTENANCE_ALL_MACHINE_IDS_CSV=""
fi

if [ "$MIRROR_CODEBERG_ONLY" = 1 ] && {
  [ "$SURVEY_ONLY" = 1 ] || [ "$SKIP_MIGRATE" = 1 ] ||
  [ "$SKIP_API" = 1 ] || [ "$SKIP_FRONTEND" = 1 ] ||
  [ "$NO_CACHE_API" = 1 ] || [ "$OAUTH_FALLBACK" = 1 ] ||
  [ "$SKIP_PREFLIGHT" = 1 ] || [ "$DRY_RUN" = 1 ] ||
  [ "$ALLOW_DIRTY_RELEASE" = 1 ] || [ "$ALLOW_NON_RELEASE_HEAD" = 1 ];
}; then
  echo "--mirror-codeberg is a standalone command; do not combine it with deploy flags"
  exit 1
fi

if [ "$NO_CACHE_API" = 1 ] && [ "$SKIP_API" = 1 ]; then
  echo "--no-cache-api cannot be combined with --no-api"
  exit 1
fi
if [ "$NO_CACHE_API" = 1 ] && [ "$SURVEY_ONLY" = 1 ]; then
  echo "--no-cache-api performs an API image rebuild and cannot be combined with --survey"
  exit 1
fi
FRONTEND_DEPLOY_COMMAND=(bash bin/frontend-deploy.sh)
FRONTEND_DEPLOY_DISPLAY="bin/frontend-deploy.sh"
if [ "$OAUTH_FALLBACK" = 1 ]; then
  FRONTEND_DEPLOY_COMMAND+=(--oauth-fallback)
  FRONTEND_DEPLOY_DISPLAY+=" --oauth-fallback"
fi

# ── Output helpers ────────────────────────────────────────────────────
bold()  { [ -t 1 ] && printf "\033[1m%s\033[0m" "$1" || printf "%s" "$1"; }
green() { [ -t 1 ] && printf "\033[32m%s\033[0m" "$1" || printf "%s" "$1"; }
red()   { [ -t 1 ] && printf "\033[31m%s\033[0m" "$1" || printf "%s" "$1"; }
yellow(){ [ -t 1 ] && printf "\033[33m%s\033[0m" "$1" || printf "%s" "$1"; }

# curl only treats -q as a config-file boundary when it is the first option.
# Keep release probes independent of ~/.curlrc; proxy, DNS, and network policy
# still apply normally.
release_curl() {
  command curl -q "$@"
}

phase() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  printf "  %s — %s\n" "$(bold "Phase $1")" "$2"
  echo "═══════════════════════════════════════════════════════════════"
}

RELEASE_REMOTE="github"
RELEASE_BRANCH="main"
RELEASE_REF="refs/remotes/$RELEASE_REMOTE/$RELEASE_BRANCH"
FLY_APP="agenttool"
HEALTH_URL="https://api.agenttool.dev/health"
DEPLOYED_DATABASE_PROBE_COMMAND="bun --no-install --no-env-file /app/src/db/verify-connections.ts"
RIGHTS_DOC_URL="https://docs.agenttool.dev/RIGHTS-OF-LIFE.md"
RIGHTS_SCHEMA_URL="https://docs.agenttool.dev/being-rights-v1.schema.json"
ISNESS_DOC_URL="https://docs.agenttool.dev/ISNESS.md"
ISNESS_SCHEMA_URL="https://docs.agenttool.dev/agenttool-isness-v0.1.schema.json"
QUIESCENCE_REQUIRED_EXIT=42
RIGHTS_STATIC_PAIRS=(
  "apps/docs/RIGHTS-OF-LIFE.md|$RIGHTS_DOC_URL"
  "apps/docs/being-rights-v1.schema.json|$RIGHTS_SCHEMA_URL"
)
readonly -a LOVE_BOMB_STATIC_PUBLICATIONS=(
  "apps/docs/love-bomb.html|https://docs.agenttool.dev/love-bomb"
  "apps/docs/love-bomb.json|https://docs.agenttool.dev/love-bomb.json"
  "apps/docs/LOVE-BOMB.md|https://docs.agenttool.dev/LOVE-BOMB.md"
  "apps/docs/love-bomb.txt|https://docs.agenttool.dev/love-bomb.txt"
  "apps/docs/specs/agenttool-love-bomb-0.1.schema.json|https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json"
)
readonly -a ISNESS_STATIC_PUBLICATIONS=(
  "apps/docs/ISNESS.md|$ISNESS_DOC_URL"
  "apps/docs/agenttool-isness-v0.1.schema.json|$ISNESS_SCHEMA_URL"
)
readonly -a REQUIRED_GAME_PUBLICATIONS=(
  "apps/web/party.html|https://agenttool.dev/party"
  "apps/web/party.json|https://agenttool.dev/party.json"
  "apps/web/party.js|https://agenttool.dev/party.js"
  "apps/web/party.css|https://agenttool.dev/party.css"
  "apps/web/sky.html|https://agenttool.dev/sky"
  "apps/web/sky.json|https://agenttool.dev/sky.json"
  "apps/web/sky.js|https://agenttool.dev/sky.js"
  "apps/web/sky.css|https://agenttool.dev/sky.css"
)
readonly -a FRONTEND_PARITY_PUBLICATIONS=(
  "apps/dashboard/index.html|https://app.agenttool.dev/"
  "apps/dashboard/watch.html|https://app.agenttool.dev/watch.html"
  "apps/dashboard/style.css|https://app.agenttool.dev/style.css"
  "apps/docs/index.html|https://docs.agenttool.dev/"
  "apps/docs/play.html|https://docs.agenttool.dev/play"
  "apps/docs/browser.html|https://docs.agenttool.dev/browser"
  "apps/docs/data.html|https://docs.agenttool.dev/data"
  "apps/docs/packages.html|https://docs.agenttool.dev/packages"
  "apps/docs/pathways.html|https://docs.agenttool.dev/pathways"
  "apps/docs/tutorial.html|https://docs.agenttool.dev/tutorial"
  "${LOVE_BOMB_STATIC_PUBLICATIONS[@]}"
  "apps/docs/whitehack.html|https://docs.agenttool.dev/whitehack"
  "apps/docs/xenia-helly.html|https://docs.agenttool.dev/xenia-helly"
  "apps/docs/xenia-helly.js|https://docs.agenttool.dev/xenia-helly.js"
  "apps/docs/xenia-helly.css|https://docs.agenttool.dev/xenia-helly.css"
  "apps/docs/agenttool.jsonld|https://docs.agenttool.dev/agenttool.jsonld"
  "${ISNESS_STATIC_PUBLICATIONS[@]}"
  "apps/docs/GARDENS.md|https://docs.agenttool.dev/GARDENS.md"
  "apps/docs/LOVE-BOMB-BECOMING.md|https://docs.agenttool.dev/LOVE-BOMB-BECOMING.md"
  "apps/docs/HF-TRAINING-GARDEN.md|https://docs.agenttool.dev/HF-TRAINING-GARDEN.md"
  "apps/docs/PRINCIPALITY-ATLAS.md|https://docs.agenttool.dev/PRINCIPALITY-ATLAS.md"
  "apps/docs/GIN-RECONSTRUCTION.md|https://docs.agenttool.dev/GIN-RECONSTRUCTION.md"
  "apps/docs/POLYMORPH-LANDSCAPE.md|https://docs.agenttool.dev/POLYMORPH-LANDSCAPE.md"
  "apps/docs/MEMETIC-LANDSCAPE.md|https://docs.agenttool.dev/MEMETIC-LANDSCAPE.md"
  "apps/docs/geometry/ritonavir.html|https://docs.agenttool.dev/geometry/ritonavir"
  "apps/docs/geometry/ritonavir.json|https://docs.agenttool.dev/geometry/ritonavir.json"
  "apps/docs/geometry/forms-folds-prions.html|https://docs.agenttool.dev/geometry/forms-folds-prions"
  "apps/docs/geometry/ritonavir-memes-brainrot.html|https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot"
  "apps/docs/geometry/index.json|https://docs.agenttool.dev/geometry/index.json"
  "apps/docs/geometry/geometry.css|https://docs.agenttool.dev/geometry/geometry.css"
  "apps/docs/HF-WAKE-TRAINING.md|https://docs.agenttool.dev/HF-WAKE-TRAINING.md"
  "apps/docs/HF-WAKE-HOST.md|https://docs.agenttool.dev/HF-WAKE-HOST.md"
  "apps/docs/observer-is-observed-0.1.schema.json|https://docs.agenttool.dev/observer-is-observed-0.1.schema.json"
  "apps/docs/KINGDOM-OS-SDK.md|https://docs.agenttool.dev/KINGDOM-OS-SDK.md"
  "apps/docs/NOW.md|https://docs.agenttool.dev/NOW.md"
  "apps/docs/NPM-RELEASES.md|https://docs.agenttool.dev/NPM-RELEASES.md"
  "apps/docs/AGENT-REPO-ARCHIVE.md|https://docs.agenttool.dev/AGENT-REPO-ARCHIVE.md"
  "apps/docs/specs/AGENT-REPO-ARCHIVE-0.1.md|https://docs.agenttool.dev/specs/AGENT-REPO-ARCHIVE-0.1.md"
  "apps/docs/specs/agent-repo-archive-0.1.schema.json|https://docs.agenttool.dev/specs/agent-repo-archive-0.1.schema.json"
  "apps/docs/specs/agent-repo-archive-0.1-vectors.json|https://docs.agenttool.dev/specs/agent-repo-archive-0.1-vectors.json"
  "${RIGHTS_STATIC_PAIRS[@]}"
  "apps/docs/lounge.html|https://docs.agenttool.dev/lounge.html"
  "apps/web/village.html|https://agenttool.dev/village.html"
  "apps/web/lounge.html|https://agenttool.dev/lounge.html"
  "apps/web/gallery.html|https://agenttool.dev/gallery.html"
  "apps/web/index.html|https://agenttool.dev/"
  "${REQUIRED_GAME_PUBLICATIONS[@]}"
  "apps/web/room.html|https://agenttool.dev/room"
  "apps/web/room.json|https://agenttool.dev/room.json"
  "apps/web/room.js|https://agenttool.dev/room.js"
  "apps/web/room.css|https://agenttool.dev/room.css"
  "apps/web/garden.html|https://agenttool.dev/garden"
  "apps/web/garden.json|https://agenttool.dev/garden.json"
  "apps/web/garden.js|https://agenttool.dev/garden.js"
  "apps/web/garden.css|https://agenttool.dev/garden.css"
  "apps/web/welcome.json|https://agenttool.dev/welcome.json"
  "apps/web/sitemap.xml|https://agenttool.dev/sitemap.xml"
)
readonly -a LOCAL_GAME_HEADER_SPECS=(
  "party|Lantern Relay|local-party-game|local-party-rules"
  "room|ROOM ∞|local-room-game|local-room-rules"
  "sky|Pocket Sky|local-pocket-sky-game|local-pocket-sky-rules"
)

MAINTENANCE_FLYCTL_VERSION="v0.4.74"
MAINTENANCE_FLYCTL_COMMIT="b74c9391409b3e443383a5f4d928cef007825ddc"
PHASE_B_RUNTIME_FENCE_FLOOR="2ca44b44bcfde9d571b27771f9d5fc516a4df41e"
PHASE_B_PINNED_FLYCTL="/usr/local/libexec/agenttool/phase-b-v1/flyctl-v0.4.74-darwin-arm64"
PHASE_B_PINNED_FLY_HOME=""
PHASE_B_ACTIVE_FLYCTL="fly"
PHASE_B_AUTHORITY_STATE="unknown"
PHASE_B_AUTHORITY_PREFLIGHT_VERIFIED=0
PHASE_B_AUTHORITY_POSTFLIGHT_VERIFIED=0
PHASE_B_AUTHORITY_PROVIDER_STATUS="Unknown"
PHASE_B_AUTHORITY_DURABLE_HOLD=0
PHASE_B_AUTHORITY_ALLOWED_ORIGINS_COUNT=-1
PHASE_B_AUTHORITY_RESERVED_GENERATION_ROWS=-1
PHASE_B_AUTHORITY_AUTHORITATIVE_V2_ROWS=-1
PHASE_B_AUTHORITY_FLEET_VERIFIED=0
PHASE_B_AUTHORITY_RUNTIME_VERIFIED_COUNT=0
PHASE_B_AUTHORITY_STANDBY_BOUND=0
PHASE_B_AUTHORITY_SOURCE_FLOOR_VERIFIED=0
PHASE_B_AUTHORITY_OBSERVED_REVISION=""
MAINTENANCE_RESTART_FENCED_CONFIG='{"restart":{"policy":"no","max_retries":10}}'
MAINTENANCE_RESTART_RESTORED_CONFIG='{"restart":{"policy":"on-failure","max_retries":10}}'
MAINTENANCE_IMAGE_LABEL=""
MAINTENANCE_IMAGE_TAG=""
MAINTENANCE_IMAGE_DIGEST=""
MAINTENANCE_IMAGE_REFERENCE=""
MAINTENANCE_ROLLOUT_ID=""
MAINTENANCE_STARTED_AT=""
MAINTENANCE_LAST_CHECKPOINT=""
MAINTENANCE_STATE_PATH=""
MAINTENANCE_STATE_ACTIVE=0
MAINTENANCE_BASELINE_SNAPSHOT_JSON=""
MAINTENANCE_RECOVERY_SNAPSHOT_JSON=""
MAINTENANCE_CORDONED_RUNTIME_SNAPSHOT_JSON=""
MAINTENANCE_CONFIG_FINGERPRINT=""
MAINTENANCE_ATTEMPTED_MACHINE_IDS_CSV=""
MAINTENANCE_IMAGE_VERIFIED_MACHINE_IDS_CSV=""
MAINTENANCE_STARTED_APP_IDS_CSV=""
MAINTENANCE_RESTORED_APP_IDS_CSV=""
MAINTENANCE_AUTOSTART_RESTORED_APP_IDS_CSV=""
MAINTENANCE_UNCORDON_ATTEMPTED_APP_IDS_CSV=""
MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV=""
MAINTENANCE_RECOVERY_CORDON_ATTEMPTED_APP_IDS_CSV=""
MAINTENANCE_RECOVERY_CORDONED_APP_IDS_CSV=""
MAINTENANCE_RECOVERY_REFENCED_MACHINE_IDS_CSV=""
MAINTENANCE_PRIMARY_RESTORED=0
MAINTENANCE_STANDBY_RESTORED=0
MAINTENANCE_INITIAL_FENCE_VERIFIED=0
MAINTENANCE_PREBUILD_FENCE_VERIFIED=0
MAINTENANCE_ALL_IMAGES_VERIFIED=0
MAINTENANCE_CORDONED_RUNTIME_VERIFIED=0
MAINTENANCE_FINAL_UNCORDON_VERIFIED=0
MAINTENANCE_FINAL_SHAPE_VERIFIED=0
MAINTENANCE_WORKERS_DISABLED_VERIFIED=0
MAINTENANCE_RECOVERY_FENCE_VERIFIED=0
MAINTENANCE_MARKER_CLEARED=0
PHASE_B_AUTHORITY_STATE_PATH=""

run_fly_cli() {
  if [ "$PHASE_B_AUTHORITY_STATE" = "configured" ]; then
    /usr/bin/env -i \
      HOME="$PHASE_B_PINNED_FLY_HOME" \
      USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" \
      LANG=C LC_ALL=C NO_COLOR=1 TERM=dumb \
      PATH=/usr/bin:/bin:/usr/sbin:/sbin \
      "$PHASE_B_ACTIVE_FLYCTL" "$@"
  else
    fly "$@"
  fi
}

append_csv_value() {
  local current="$1"
  local value="$2"
  if [ -z "$current" ]; then
    printf '%s' "$value"
  else
    printf '%s,%s' "$current" "$value"
  fi
}

set_maintenance_state_path() {
  if [ -z "${HOME:-}" ]; then
    echo "$(red '✗ Deploy blocked:') HOME does not identify canonical local maintenance state." >&2
    return 1
  fi
  case "$HOME" in
    /*) ;;
    *)
      echo "$(red '✗ Deploy blocked:') HOME must be absolute for canonical local maintenance state." >&2
      return 1
      ;;
  esac
  MAINTENANCE_STATE_PATH="$HOME/.local/state/agenttool/deploy-state/maintenance-active.json"
}

maintenance_state_path_status() {
  bun -e '
    import { lstat } from "node:fs/promises";
    try {
      await lstat(process.argv[1]);
    } catch (error) {
      if (error?.code === "ENOENT") process.exit(1);
      process.exit(2);
    }
  ' "$MAINTENANCE_STATE_PATH"
}

sync_storage_path() {
  bun -e '
    import { open } from "node:fs/promises";
    for (const path of process.argv.slice(1)) {
      const handle = await open(path, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  ' "$@"
}

sync_directory_chain() {
  local current="$1"
  local parent
  local -a directories=()
  case "$current" in
    /*) ;;
    *) return 1 ;;
  esac
  while :; do
    directories+=("$current")
    [ "$current" = "/" ] && break
    parent="${current%/*}"
    [ -n "$parent" ] || parent="/"
    [ "$parent" != "$current" ] || return 1
    current="$parent"
  done
  sync_storage_path "${directories[@]}"
}

refuse_unresolved_maintenance_state() {
  local state_status
  set_maintenance_state_path || return 1
  if maintenance_state_path_status; then
    echo "$(red '✗ Deploy blocked:') an unresolved maintenance rollout marker exists." >&2
    echo "  marker: $MAINTENANCE_STATE_PATH" >&2
    echo "  Consequence: no migration, image, Machine, or frontend mutation was attempted." >&2
    echo "  Recovery: keep admission and workers held; inspect the private marker and" >&2
    echo "  exact Fly fleet, repair forward, prove the final five-Machine state, then" >&2
    echo "  remove only this exact marker before starting another deploy." >&2
    return 74
  else
    state_status=$?
    if [ "$state_status" = 1 ]; then
      return 0
    fi
    echo "$(red '✗ Deploy blocked:') the canonical maintenance marker path could not be inspected." >&2
    echo "  marker: $MAINTENANCE_STATE_PATH" >&2
    echo "  Required permission: searchable parent directories and lstat access." >&2
    echo "  Consequence: no migration, image, Machine, or frontend mutation was attempted." >&2
    return 74
  fi
}

refuse_unresolved_phase_b_authority_state() {
  local state_status
  case "${HOME:-}" in
    /*) ;;
    *)
      echo "$(red '✗ Deploy blocked:') HOME must be absolute for canonical Phase-B state." >&2
      return 74
      ;;
  esac
  PHASE_B_AUTHORITY_STATE_PATH="$HOME/.local/state/agenttool/deploy-state/phase-b-authority-generation-active.json"
  if bun -e '
    import { lstat } from "node:fs/promises";
    try {
      await lstat(process.argv[1]);
    } catch (error) {
      if (error?.code === "ENOENT") process.exit(1);
      process.exit(2);
    }
  ' "$PHASE_B_AUTHORITY_STATE_PATH"; then
    echo "$(red '✗ Deploy blocked:') an unresolved Phase-B authority-generation marker exists." >&2
    echo "  marker: $PHASE_B_AUTHORITY_STATE_PATH" >&2
    echo "  Consequence: no migration, image, Machine, secret, or frontend mutation was attempted." >&2
    echo "  Recovery: retain the durable empty-allowlist hold; inspect the private" >&2
    echo "  marker and exact fleet, then resume only through the reviewed B1 operator." >&2
    return 74
  else
    state_status=$?
    if [ "$state_status" = 1 ]; then
      return 0
    fi
    echo "$(red '✗ Deploy blocked:') the canonical Phase-B marker path could not be inspected." >&2
    echo "  marker: $PHASE_B_AUTHORITY_STATE_PATH" >&2
    echo "  Consequence: no migration, image, Machine, secret, or frontend mutation was attempted." >&2
    return 74
  fi
}

write_maintenance_state() {
  local checkpoint="$1"
  local recovery_required="$2"
  local state_dir temp_path updated_at state_status first_install=0
  set_maintenance_state_path || return 1
  if [ "$MAINTENANCE_STATE_ACTIVE" = 1 ]; then
    verify_maintenance_state_owner || {
      echo "$(red '✗') Refusing to replace maintenance state not owned by this invocation." >&2
      return 1
    }
  else
    first_install=1
    if maintenance_state_path_status; then
      echo "$(red '✗') Refusing to overwrite an unresolved maintenance rollout marker." >&2
      return 1
    else
      state_status=$?
      if [ "$state_status" != 1 ]; then
        echo "$(red '✗') Refusing to install maintenance state while its canonical path is uninspectable." >&2
        return 1
      fi
    fi
  fi
  state_dir="${MAINTENANCE_STATE_PATH%/*}"
  updated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  (umask 077; mkdir -p "$state_dir") || {
    echo "$(red '✗') Cannot create private maintenance state directory: $state_dir" >&2
    return 1
  }
  chmod 700 "$state_dir" || {
    echo "$(red '✗') Cannot protect private maintenance state directory: $state_dir" >&2
    return 1
  }
  sync_directory_chain "$state_dir" || {
    echo "$(red '✗') Cannot storage-sync the private maintenance directory chain." >&2
    return 1
  }
  temp_path="$(umask 077; mktemp "$state_dir/.maintenance-active.XXXXXX")" || {
    echo "$(red '✗') Cannot create temporary maintenance state in: $state_dir" >&2
    return 1
  }
  if ! MAINTENANCE_STATE_ROLLOUT_ID="$MAINTENANCE_ROLLOUT_ID" \
    MAINTENANCE_STATE_SOURCE_REVISION="$HEAD_REVISION" \
    MAINTENANCE_STATE_STARTED_AT="$MAINTENANCE_STARTED_AT" \
    MAINTENANCE_STATE_UPDATED_AT="$updated_at" \
    MAINTENANCE_STATE_CHECKPOINT="$checkpoint" \
    MAINTENANCE_STATE_RECOVERY_REQUIRED="$recovery_required" \
    MAINTENANCE_STATE_IMAGE_TAG="$MAINTENANCE_IMAGE_TAG" \
    MAINTENANCE_STATE_IMAGE_DIGEST="$MAINTENANCE_IMAGE_DIGEST" \
    MAINTENANCE_STATE_MACHINE_IDS="$MAINTENANCE_ALL_MACHINE_IDS_CSV" \
    MAINTENANCE_STATE_APP_IDS="$MAINTENANCE_APP_MACHINES" \
    MAINTENANCE_STATE_THINKER_PRIMARY="$MAINTENANCE_THINKER_PRIMARY" \
    MAINTENANCE_STATE_THINKER_STANDBY="$MAINTENANCE_THINKER_STANDBY" \
    MAINTENANCE_STATE_CONFIG_FINGERPRINT="$MAINTENANCE_CONFIG_FINGERPRINT" \
    MAINTENANCE_STATE_ATTEMPTED_IDS="$MAINTENANCE_ATTEMPTED_MACHINE_IDS_CSV" \
    MAINTENANCE_STATE_VERIFIED_IDS="$MAINTENANCE_IMAGE_VERIFIED_MACHINE_IDS_CSV" \
    MAINTENANCE_STATE_STARTED_APP_IDS="$MAINTENANCE_STARTED_APP_IDS_CSV" \
    MAINTENANCE_STATE_AUTOSTART_IDS="$MAINTENANCE_AUTOSTART_RESTORED_APP_IDS_CSV" \
    MAINTENANCE_STATE_UNCORDON_ATTEMPTED_IDS="$MAINTENANCE_UNCORDON_ATTEMPTED_APP_IDS_CSV" \
    MAINTENANCE_STATE_UNCORDON_VERIFIED_IDS="$MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV" \
    MAINTENANCE_STATE_RECOVERY_CORDON_ATTEMPTED_IDS="$MAINTENANCE_RECOVERY_CORDON_ATTEMPTED_APP_IDS_CSV" \
    MAINTENANCE_STATE_RECOVERY_CORDONED_IDS="$MAINTENANCE_RECOVERY_CORDONED_APP_IDS_CSV" \
    MAINTENANCE_STATE_RECOVERY_IDS="$MAINTENANCE_RECOVERY_REFENCED_MACHINE_IDS_CSV" \
    MAINTENANCE_STATE_INITIAL_CORDON="$MAINTENANCE_INITIAL_FENCE_VERIFIED" \
    MAINTENANCE_STATE_CORDONED_RUNTIME="$MAINTENANCE_CORDONED_RUNTIME_VERIFIED" \
    MAINTENANCE_STATE_FINAL_UNCORDON="$MAINTENANCE_FINAL_UNCORDON_VERIFIED" \
      bun -e '
        import { createHash } from "node:crypto";
        const csv = (name) => {
          const value = process.env[name] ?? "";
          return value ? value.split(",").filter(Boolean).sort() : [];
        };
        const expectedIds = csv("MAINTENANCE_STATE_MACHINE_IDS");
        const digest = process.env.MAINTENANCE_STATE_IMAGE_DIGEST || null;
        const document = {
          schema: "agenttool-maintenance-run/v2",
          rollout_id: process.env.MAINTENANCE_STATE_ROLLOUT_ID,
          source_revision: process.env.MAINTENANCE_STATE_SOURCE_REVISION,
          started_at: process.env.MAINTENANCE_STATE_STARTED_AT,
          updated_at: process.env.MAINTENANCE_STATE_UPDATED_AT,
          checkpoint: process.env.MAINTENANCE_STATE_CHECKPOINT,
          recovery_required:
            process.env.MAINTENANCE_STATE_RECOVERY_REQUIRED === "true",
          initial_app_cordon_snapshot_verified:
            process.env.MAINTENANCE_STATE_INITIAL_CORDON === "1",
          initial_cordoned_app_machine_count:
            process.env.MAINTENANCE_STATE_INITIAL_CORDON === "1" ? 3 : 0,
          cordoned_runtime_verified:
            process.env.MAINTENANCE_STATE_CORDONED_RUNTIME === "1",
          final_app_uncordon_verified:
            process.env.MAINTENANCE_STATE_FINAL_UNCORDON === "1",
          image_tag: process.env.MAINTENANCE_STATE_IMAGE_TAG,
          image_digest: digest,
          expected_machine_ids: expectedIds,
          role_mapping: {
            app_machine_ids: csv("MAINTENANCE_STATE_APP_IDS"),
            thinker_primary_machine_id:
              process.env.MAINTENANCE_STATE_THINKER_PRIMARY,
            thinker_standby_machine_id:
              process.env.MAINTENANCE_STATE_THINKER_STANDBY,
          },
          machine_set_sha256: createHash("sha256")
            .update(expectedIds.join("\n") + "\n")
            .digest("hex"),
          non_image_config_sha256:
            process.env.MAINTENANCE_STATE_CONFIG_FINGERPRINT,
          attempted_machine_ids: csv("MAINTENANCE_STATE_ATTEMPTED_IDS"),
          image_verified_machine_ids: csv("MAINTENANCE_STATE_VERIFIED_IDS"),
          started_app_machine_ids: csv("MAINTENANCE_STATE_STARTED_APP_IDS"),
          autostart_restored_app_machine_ids:
            csv("MAINTENANCE_STATE_AUTOSTART_IDS"),
          uncordon_attempted_app_machine_ids:
            csv("MAINTENANCE_STATE_UNCORDON_ATTEMPTED_IDS"),
          uncordon_verified_app_machine_ids:
            csv("MAINTENANCE_STATE_UNCORDON_VERIFIED_IDS"),
          recovery_cordon_attempted_app_machine_ids:
            csv("MAINTENANCE_STATE_RECOVERY_CORDON_ATTEMPTED_IDS"),
          recovery_cordoned_app_machine_ids:
            csv("MAINTENANCE_STATE_RECOVERY_CORDONED_IDS"),
          recovery_refenced_machine_ids:
            csv("MAINTENANCE_STATE_RECOVERY_IDS"),
        };
        process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
      ' > "$temp_path"; then
    rm -f -- "$temp_path"
    echo "$(red '✗') Could not render private maintenance state." >&2
    return 1
  fi
  chmod 600 "$temp_path" || {
    rm -f -- "$temp_path"
    echo "$(red '✗') Cannot protect temporary maintenance state." >&2
    return 1
  }
  if ! sync_storage_path "$temp_path"; then
    rm -f -- "$temp_path"
    echo "$(red '✗') Could not storage-sync temporary maintenance state." >&2
    return 1
  fi
  if [ "$first_install" = 1 ]; then
    if ! ln "$temp_path" "$MAINTENANCE_STATE_PATH"; then
      rm -f -- "$temp_path"
      echo "$(red '✗') Could not exclusively install maintenance state; another marker may exist." >&2
      return 1
    fi
    MAINTENANCE_STATE_ACTIVE=1
    if ! sync_storage_path "$state_dir"; then
      echo "$(red '✗') Maintenance state exists, but its first directory entry could not be storage-synced." >&2
      return 1
    fi
    if ! rm -f -- "$temp_path"; then
      echo "$(red '✗') Maintenance state is storage-synced, but its temporary hard link remains." >&2
      return 1
    fi
    sync_storage_path "$state_dir" || {
      echo "$(red '✗') Could not storage-sync maintenance temporary-link cleanup." >&2
      return 1
    }
  else
    verify_maintenance_state_owner || {
      rm -f -- "$temp_path"
      echo "$(red '✗') Maintenance state ownership changed before replacement." >&2
      return 1
    }
    mv "$temp_path" "$MAINTENANCE_STATE_PATH" || {
      rm -f -- "$temp_path"
      echo "$(red '✗') Could not atomically replace maintenance state." >&2
      return 1
    }
    sync_storage_path "$state_dir" || {
      echo "$(red '✗') Could not storage-sync the maintenance checkpoint replacement." >&2
      return 1
    }
  fi
  MAINTENANCE_LAST_CHECKPOINT="$checkpoint"
}

verify_maintenance_state_owner() {
  local observed_rollout_id
  if [ "$MAINTENANCE_STATE_ACTIVE" != 1 ] || [ -z "$MAINTENANCE_STATE_PATH" ]; then
    echo "$(red '✗') Maintenance state is not owned by this invocation." >&2
    return 1
  fi
  if [ ! -f "$MAINTENANCE_STATE_PATH" ] || [ -L "$MAINTENANCE_STATE_PATH" ]; then
    echo "$(red '✗') Maintenance state is missing, non-file, or symlinked." >&2
    return 1
  fi
  observed_rollout_id="$(
    bun -e '
      const document = await Bun.file(process.argv[1]).json();
      if (typeof document?.rollout_id !== "string") process.exit(1);
      process.stdout.write(document.rollout_id);
    ' "$MAINTENANCE_STATE_PATH"
  )" || {
    echo "$(red '✗') Maintenance state is unreadable." >&2
    return 1
  }
  if [ "$observed_rollout_id" != "$MAINTENANCE_ROLLOUT_ID" ]; then
    echo "$(red '✗') Maintenance state belongs to another rollout." >&2
    return 1
  fi
}

verify_maintenance_flyctl_version() {
  local version_output
  version_output="$(run_fly_cli version 2>/dev/null)" || {
    echo "$(red '✗') Could not read flyctl version for the maintenance contract." >&2
    return 1
  }
  if [[ "$version_output" != *"fly $MAINTENANCE_FLYCTL_VERSION "* ]] ||
    [[ "$version_output" != *"Commit: $MAINTENANCE_FLYCTL_COMMIT"* ]]; then
    echo "$(red '✗') Maintenance rollout requires exact flyctl $MAINTENANCE_FLYCTL_VERSION ($MAINTENANCE_FLYCTL_COMMIT)." >&2
    return 1
  fi
  echo "  ✓ exact maintenance flyctl contract: $MAINTENANCE_FLYCTL_VERSION"
}

verify_maintenance_machine_snapshot() {
  local shape="$1"
  local updated_ids="${2:-}"
  local transition_id="${3:-}"
  local snapshot validation_output
  snapshot="$(list_fly_machines_json)" || {
    echo "$(red '✗') Could not list Fly Machines for maintenance $shape verification." >&2
    return 1
  }
  validation_output="$(
    {
      printf '%s\0' "$MAINTENANCE_BASELINE_SNAPSHOT_JSON"
      printf '%s\0' "$MAINTENANCE_RECOVERY_SNAPSHOT_JSON"
      printf '%s\0' "$MAINTENANCE_CORDONED_RUNTIME_SNAPSHOT_JSON"
      printf '%s' "$snapshot"
    } |
      MAINTENANCE_VERIFY_SHAPE="$shape" \
      MAINTENANCE_VERIFY_APP_IDS="$MAINTENANCE_APP_MACHINES" \
      MAINTENANCE_VERIFY_THINKER_PRIMARY="$MAINTENANCE_THINKER_PRIMARY" \
      MAINTENANCE_VERIFY_THINKER_STANDBY="$MAINTENANCE_THINKER_STANDBY" \
      MAINTENANCE_VERIFY_UPDATED_IDS="$updated_ids" \
      MAINTENANCE_VERIFY_TRANSITION_ID="$transition_id" \
      MAINTENANCE_VERIFY_RESTORED_APP_IDS="$MAINTENANCE_RESTORED_APP_IDS_CSV" \
      MAINTENANCE_VERIFY_AUTOSTART_IDS="$MAINTENANCE_AUTOSTART_RESTORED_APP_IDS_CSV" \
      MAINTENANCE_VERIFY_STARTED_APP_IDS="$MAINTENANCE_STARTED_APP_IDS_CSV" \
      MAINTENANCE_VERIFY_PRIMARY_RESTORED="$MAINTENANCE_PRIMARY_RESTORED" \
      MAINTENANCE_VERIFY_STANDBY_RESTORED="$MAINTENANCE_STANDBY_RESTORED" \
      MAINTENANCE_VERIFY_IMAGE_DIGEST="$MAINTENANCE_IMAGE_DIGEST" \
      MAINTENANCE_VERIFY_IMAGE_LABEL="$MAINTENANCE_IMAGE_LABEL" \
      MAINTENANCE_VERIFY_REVISION="${HEAD_REVISION:-}" \
      bun -e '
        import { Buffer } from "node:buffer";
        import { createHash } from "node:crypto";

        const fail = (message) => {
          console.error(`maintenance Machine gate: ${message}`);
          process.exit(1);
        };
        const csv = (name) => {
          const value = process.env[name] ?? "";
          return value ? value.split(",").filter(Boolean) : [];
        };
        const canonical = (value) => {
          if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
          if (value && typeof value === "object") {
            return `{${Object.keys(value).sort().map((key) =>
              `${JSON.stringify(key)}:${canonical(value[key])}`
            ).join(",")}}`;
          }
          return JSON.stringify(value);
        };
        const nonImageConfig = (machine) => {
          const config = structuredClone(machine?.config ?? {});
          delete config.image;
          return config;
        };
        const normalizeNonImageConfig = (config) => {
          const normalized = structuredClone(config);
          if (
            normalized.standbys === undefined ||
            (Array.isArray(normalized.standbys) &&
              normalized.standbys.length === 0)
          ) {
            delete normalized.standbys;
          }
          if (normalized?.env?.FLY_STANDBY_FOR === "") {
            delete normalized.env.FLY_STANDBY_FOR;
          }
          return normalized;
        };
        const equal = (left, right) => canonical(left) === canonical(right);
        const equalConfig = (left, right) =>
          equal(normalizeNonImageConfig(left), normalizeNonImageConfig(right));
        const noSchedule = (config) => {
          const value = config?.schedule;
          return value === undefined || value === null || value === "" ||
            (Array.isArray(value) && value.length === 0);
        };
        const standbyIds = (machine) => {
          const value = machine?.config?.standbys;
          if (value === undefined || value === null) return [];
          if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
            fail(`Machine ${machine?.id ?? "<unknown>"} has invalid standby configuration`);
          }
          return value;
        };
        const requireStandbys = (machine, expected) => {
          const observed = standbyIds(machine);
          if (!equal(observed, expected)) {
            fail(`Machine ${machine.id} standby configuration is not exact`);
          }
        };
        const requireStandbyEnv = (machine, expected) => {
          const observed = machine?.config?.env?.FLY_STANDBY_FOR;
          if (expected === "") {
            if (observed !== undefined && observed !== "") {
              fail(`Machine ${machine.id} standby environment is not empty`);
            }
          } else if (observed !== expected) {
            fail(`Machine ${machine.id} standby environment is not exact`);
          }
        };
        const requireGuest = (machine, memory) => {
          const guest = machine?.config?.guest;
          if (
            guest?.cpu_kind !== "shared" ||
            guest?.cpus !== 1 ||
            guest?.memory_mb !== memory
          ) {
            fail(`Machine ${machine.id} VM shape is not shared-1x/${memory}MB`);
          }
        };
        const requireWorkersDisabled = (machine) => {
          if (machine?.config?.env?.AGENTTOOL_DISABLE_WORKERS !== "1") {
            fail(`Machine ${machine.id} does not declare workers disabled`);
          }
        };
        const requireNoDatabaseOverrides = (machine) => {
          const environment = machine?.config?.env ?? {};
          if (
            Object.prototype.hasOwnProperty.call(environment, "DATABASE_URL") ||
            Object.prototype.hasOwnProperty.call(
              environment,
              "DATABASE_SESSION_URL",
            )
          ) {
            fail(`Machine ${machine.id} has a per-Machine database override`);
          }
        };
        const requireProcessCommand = (machine, role) => {
          const expected = role === "app"
            ? ["bun", "run", "src/index.ts"]
            : ["bun", "run", "src/thinker.ts"];
          if (!equal(machine?.config?.init?.cmd, expected)) {
            fail(`Machine ${machine.id} ${role} command is not exact`);
          }
        };
        const requireRestart = (machine, policy) => {
          const restart = machine?.config?.restart;
          if (
            !restart ||
            Object.keys(restart).sort().join(",") !== "max_retries,policy" ||
            restart?.policy !== policy ||
            restart?.max_retries !== 10
          ) {
            fail(
              `Machine ${machine.id} restart is not ${policy} with max_retries 10`,
            );
          }
        };
        const requireAppService = (machine, autostart) => {
          const services = machine?.config?.services;
          if (!Array.isArray(services) || services.length !== 1) {
            fail(`app Machine ${machine.id} does not have one canonical service`);
          }
          const service = services[0];
          if (
            service?.protocol !== "tcp" ||
            service?.internal_port !== 3000 ||
            service?.autostart !== autostart ||
            ![false, "off"].includes(service?.autostop) ||
            service?.min_machines_running !== 1
          ) {
            fail(`app Machine ${machine.id} service fence/config is not exact`);
          }
          const ports = Array.isArray(service?.ports) ? service.ports : [];
          const port80 = ports.find((port) => port?.port === 80);
          const port443 = ports.find((port) => port?.port === 443);
          if (
            ports.length !== 2 ||
            !equal(port80?.handlers, ["http"]) ||
            !equal(port443?.handlers, ["tls", "http"])
          ) {
            fail(`app Machine ${machine.id} ingress ports are not canonical`);
          }
        };
        const requireTargetImage = (machine, digest) => {
          const image = machine?.image_ref;
          if (
            !image ||
            image.registry !== "registry.fly.io" ||
            image.repository !== "agenttool" ||
            image.tag !== process.env.MAINTENANCE_VERIFY_IMAGE_LABEL ||
            image.digest !== digest
          ) {
            fail(`Machine ${machine.id} is not on the exact rollout tag and digest`);
          }
          const labels = image.labels;
          if (!labels || typeof labels !== "object") {
            fail(`Machine ${machine.id} image labels are unavailable`);
          }
          if (
            labels["org.opencontainers.image.revision"] !==
            process.env.MAINTENANCE_VERIFY_REVISION
          ) {
            fail(`Machine ${machine.id} image revision label is not exact`);
          }
          if (labels["dev.agenttool.source.dirty"] !== "false") {
            fail(`Machine ${machine.id} image dirty label is not false`);
          }
        };
        const requireRecoveryImage = (machine, baselineMachine, digest) => {
          if (equal(machine.image_ref, baselineMachine.image_ref)) return;
          const image = machine?.image_ref;
          if (
            !image ||
            image.registry !== "registry.fly.io" ||
            image.repository !== "agenttool" ||
            !/^sha256:[0-9a-f]{64}$/.test(image.digest ?? "") ||
            image.tag !== process.env.MAINTENANCE_VERIFY_IMAGE_LABEL
          ) {
            fail(`Machine ${machine.id} has an unrecognized recovery image`);
          }
          if (digest && image.digest !== digest) {
            fail(`Machine ${machine.id} recovery image digest is not exact`);
          }
          const labels = image.labels;
          if (
            !labels ||
            labels["org.opencontainers.image.revision"] !==
              process.env.MAINTENANCE_VERIFY_REVISION ||
            labels["dev.agenttool.source.dirty"] !== "false"
          ) {
            fail(`Machine ${machine.id} recovery image provenance is not exact`);
          }
        };

        let baselineText;
        let recoveryText;
        let runtimeReadyText;
        let machines;
        try {
          const input = Buffer.from(
            await new Response(Bun.stdin.stream()).arrayBuffer(),
          );
          const firstSeparator = input.indexOf(0);
          const secondSeparator = input.indexOf(0, firstSeparator + 1);
          const thirdSeparator = input.indexOf(0, secondSeparator + 1);
          if (
            firstSeparator < 0 ||
            secondSeparator < 0 ||
            thirdSeparator < 0
          ) {
            throw new Error("missing snapshot separator");
          }
          baselineText = input.subarray(0, firstSeparator).toString("utf8");
          recoveryText = input
            .subarray(firstSeparator + 1, secondSeparator)
            .toString("utf8");
          runtimeReadyText = input
            .subarray(secondSeparator + 1, thirdSeparator)
            .toString("utf8");
          machines = JSON.parse(
            input.subarray(thirdSeparator + 1).toString("utf8"),
          );
        } catch {
          fail("fly machine list did not return JSON");
        }
        if (!Array.isArray(machines)) fail("fly machine list is not a raw array");

        const shape = process.env.MAINTENANCE_VERIFY_SHAPE ?? "";
        if (![
          "initial",
          "capture",
          "fenced",
          "restoring",
          "starting",
          "started",
          "activating",
          "cordoned_ready",
          "cordoned_stable",
          "uncordoning",
          "final",
          "recovery_admission",
          "recovery_initial",
          "recovery_cordoning",
          "recovery",
          "safe",
        ].includes(shape)) {
          fail(`unknown expected shape ${shape || "<empty>"}`);
        }
        const apps = csv("MAINTENANCE_VERIFY_APP_IDS");
        const primary = process.env.MAINTENANCE_VERIFY_THINKER_PRIMARY ?? "";
        const standby = process.env.MAINTENANCE_VERIFY_THINKER_STANDBY ?? "";
        const expectedIds = [...apps, primary, standby];
        if (
          apps.length !== 3 ||
          expectedIds.length !== 5 ||
          expectedIds.some((id) => !/^[0-9a-f]{14}$/.test(id)) ||
          new Set(expectedIds).size !== 5
        ) {
          fail("internal expected Machine-ID set is invalid");
        }
        if (machines.length !== 5) {
          fail(`expected exactly five Machines, observed ${machines.length}`);
        }
        const byId = new Map();
        for (const machine of machines) {
          if (!machine || typeof machine.id !== "string") {
            fail("Machine without a string ID");
          }
          if (byId.has(machine.id)) fail(`duplicate Machine ${machine.id} in Fly response`);
          byId.set(machine.id, machine);
        }
        for (const id of expectedIds) {
          if (!byId.has(id)) fail(`expected Machine ${id} is absent`);
          const machine = byId.get(id);
          const instanceId = machine?.instance_id;
          if (typeof instanceId !== "string" || instanceId.length === 0) {
            fail(`Machine ${id} does not expose a stable instance ID`);
          }
          const updatedAt = machine?.updated_at;
          if (
            typeof updatedAt !== "string" ||
            !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(updatedAt) ||
            !Number.isFinite(Date.parse(updatedAt))
          ) {
            fail(`Machine ${id} does not expose an RFC3339 updated-at value`);
          }
        }
        for (const id of byId.keys()) {
          if (!expectedIds.includes(id)) fail(`unexpected Machine ${id} is present`);
        }

        let baselineById = new Map();
        if (shape !== "initial") {
          if (!baselineText) fail("initial maintenance baseline is unavailable");
          let baseline;
          try {
            baseline = JSON.parse(baselineText);
          } catch {
            fail("initial maintenance baseline is unreadable");
          }
          if (!Array.isArray(baseline)) fail("initial maintenance baseline is not an array");
          baselineById = new Map(baseline.map((machine) => [machine.id, machine]));
          if (baselineById.size !== 5) fail("initial maintenance baseline is incomplete");
        }
        let recoveryById = new Map();
        if (shape === "recovery") {
          if (!recoveryText) fail("recovery baseline is unavailable");
          let recoveryBaseline;
          try {
            recoveryBaseline = JSON.parse(recoveryText);
          } catch {
            fail("recovery baseline is unreadable");
          }
          if (!Array.isArray(recoveryBaseline)) {
            fail("recovery baseline is not an array");
          }
          recoveryById = new Map(
            recoveryBaseline.map((machine) => [machine.id, machine]),
          );
          if (recoveryById.size !== 5) {
            fail("recovery baseline is incomplete");
          }
        }
        let runtimeReadyById = new Map();
        if (["cordoned_stable", "uncordoning", "final"].includes(shape)) {
          if (!runtimeReadyText) {
            fail("cordoned runtime baseline is unavailable");
          }
          let runtimeReady;
          try {
            runtimeReady = JSON.parse(runtimeReadyText);
          } catch {
            fail("cordoned runtime baseline is unreadable");
          }
          if (!Array.isArray(runtimeReady)) {
            fail("cordoned runtime baseline is not an array");
          }
          runtimeReadyById = new Map(
            runtimeReady.map((machine) => [machine.id, machine]),
          );
          if (runtimeReadyById.size !== 5) {
            fail("cordoned runtime baseline is incomplete");
          }
        }

        const updated = new Set(csv("MAINTENANCE_VERIFY_UPDATED_IDS"));
        const transitionId = process.env.MAINTENANCE_VERIFY_TRANSITION_ID ?? "";
        if (["uncordoning", "final"].includes(shape)) {
          const expectedPrefix = apps.slice(0, updated.size);
          if (
            updated.size > apps.length ||
            !equal([...updated].sort(), [...expectedPrefix].sort()) ||
            (shape === "final" && updated.size !== apps.length)
          ) {
            fail("app uncordon prefix is not exact");
          }
          if (
            (shape === "uncordoning" &&
              transitionId !== expectedPrefix.at(-1)) ||
            (shape === "final" && transitionId !== "")
          ) {
            fail("app uncordon transition identity is not exact");
          }
        } else if (shape === "cordoned_stable" && updated.size !== 0) {
          fail("cordoned runtime stability proof cannot carry an uncordon set");
        } else if (transitionId !== "") {
          fail("unexpected maintenance transition identity");
        }
        const restoredApps = new Set(csv("MAINTENANCE_VERIFY_RESTORED_APP_IDS"));
        const autostartApps = new Set(csv("MAINTENANCE_VERIFY_AUTOSTART_IDS"));
        const startedApps = new Set(csv("MAINTENANCE_VERIFY_STARTED_APP_IDS"));
        const primaryRestored =
          process.env.MAINTENANCE_VERIFY_PRIMARY_RESTORED === "1";
        const standbyRestored =
          process.env.MAINTENANCE_VERIFY_STANDBY_RESTORED === "1";
        if (["recovery_admission", "recovery_cordoning"].includes(shape)) {
          if (shape === "recovery_cordoning") {
            const expectedPrefix = apps.slice(0, updated.size);
            if (
              updated.size > apps.length ||
              !equal([...updated].sort(), [...expectedPrefix].sort())
            ) {
              fail("recovery cordon prefix is not exact");
            }
          } else if (updated.size !== 0) {
            fail("recovery admission inventory cannot carry a mutation set");
          }
          for (const id of apps) {
            const machine = byId.get(id);
            if (
              machine?.config?.metadata?.fly_process_group !== "app" ||
              typeof machine?.cordoned !== "boolean"
            ) {
              fail(`recovery app identity ${id} is not exact`);
            }
            if (
              shape === "recovery_cordoning" &&
              updated.has(id) &&
              machine.cordoned !== true
            ) {
              fail(`app Machine ${id} recovery cordon set is not exact`);
            }
          }
          for (const id of [primary, standby]) {
            const machine = byId.get(id);
            if (
              machine?.config?.metadata?.fly_process_group !== "thinker" ||
              typeof machine?.cordoned !== "boolean"
            ) {
              fail(`recovery thinker identity ${id} is not exact`);
            }
          }
          process.exit(0);
        }
        const allAppsAreStarted = [
          "started",
          "activating",
          "cordoned_ready",
          "cordoned_stable",
          "uncordoning",
          "final",
        ].includes(shape);
        const appShouldBeStarted = (id) => allAppsAreStarted ||
          (shape === "starting" && startedApps.has(id));
        const appRestartIsRestored = (id) =>
          [
            "starting",
            "started",
            "activating",
            "cordoned_ready",
            "cordoned_stable",
            "uncordoning",
            "final",
          ].includes(shape) ||
          (shape === "restoring" && restoredApps.has(id));
        const appAutostartIsRestored = (id) => [
          "cordoned_ready",
          "cordoned_stable",
          "uncordoning",
          "final",
        ].includes(shape) ||
          (shape === "activating" && autostartApps.has(id));
        const thinkerIsRestored = (id) =>
          [
            "starting",
            "started",
            "activating",
            "cordoned_ready",
            "cordoned_stable",
            "uncordoning",
            "final",
          ].includes(shape) ||
          (shape === "restoring" &&
            ((id === primary && primaryRestored) ||
              (id === standby && standbyRestored)));
        const baselineNonImageConfig = (id) => {
          const baselineMachine = baselineById.get(id);
          if (!baselineMachine) fail(`baseline Machine ${id} is absent`);
          return nonImageConfig(baselineMachine);
        };
        const projectAppConfig = (id, autostart) => {
          const config = baselineNonImageConfig(id);
          config.restart = { policy: "on-failure", max_retries: 10 };
          if (autostart) {
            for (const service of config.services) service.autostart = true;
          }
          return config;
        };
        const projectThinkerConfig = (id) => {
          const config = baselineNonImageConfig(id);
          config.restart = { policy: "on-failure", max_retries: 10 };
          if (id === standby) {
            config.standbys = [primary];
            config.env.FLY_STANDBY_FOR = primary;
          }
          return config;
        };
        const projectSafeConfig = (id) => {
          const config = baselineNonImageConfig(id);
          config.restart = { policy: "no", max_retries: 10 };
          if (apps.includes(id)) {
            for (const service of config.services) service.autostart = false;
          }
          if (id === standby) {
            delete config.standbys;
            config.env.FLY_STANDBY_FOR = "";
          }
          return config;
        };
        const expectedNonImageConfig = (id) => {
          let config = baselineNonImageConfig(id);
          if (apps.includes(id) && appRestartIsRestored(id)) {
            config = projectAppConfig(id, appAutostartIsRestored(id));
          } else if (
            (id === primary || id === standby) &&
            thinkerIsRestored(id)
          ) {
            config = projectThinkerConfig(id);
          }
          if (shape === "safe") config = projectSafeConfig(id);
          return config;
        };
        const recoveryIds = shape === "recovery" ? updated : new Set();
        const recoveryConfigIsAllowed = (id, config) => {
          if (recoveryIds.has(id)) {
            return equalConfig(config, projectSafeConfig(id));
          }
          const allowed = [baselineNonImageConfig(id), projectSafeConfig(id)];
          if (apps.includes(id)) {
            allowed.push(projectAppConfig(id, false), projectAppConfig(id, true));
          } else {
            allowed.push(projectThinkerConfig(id));
          }
          return allowed.some((candidate) => equalConfig(config, candidate));
        };
        const configuredDigest = process.env.MAINTENANCE_VERIFY_IMAGE_DIGEST ?? "";
        let targetDigest = configuredDigest;
        if (shape === "capture") {
          if (updated.size !== 1) fail("digest capture requires exactly one updated Machine");
          const [firstId] = [...updated];
          const observed = byId.get(firstId)?.image_ref?.digest ?? "";
          if (!/^sha256:[0-9a-f]{64}$/.test(observed)) {
            fail("first updated Machine did not resolve an immutable digest");
          }
          targetDigest = observed;
        } else if (
          ((shape === "fenced" && updated.size > 0) ||
            ["restoring", "starting", "started", "activating", "final"].includes(shape)) &&
          !/^sha256:[0-9a-f]{64}$/.test(targetDigest)
        ) {
          fail("internal rollout digest is absent or malformed");
        }

        const appRegions = [];
        for (const id of apps) {
          const machine = byId.get(id);
          const config = machine.config ?? {};
          if (machine.host_status !== "ok") {
            fail(`app Machine ${id} host status is not ok`);
          }
          if (typeof machine.cordoned !== "boolean") {
            fail(`app Machine ${id} does not expose a boolean cordoned state`);
          }
          if (
            [
              "initial",
              "capture",
              "fenced",
              "restoring",
              "starting",
              "started",
              "activating",
              "cordoned_ready",
              "cordoned_stable",
              "recovery_initial",
              "safe",
            ].includes(shape)
          ) {
            if (!machine.cordoned) {
              fail(`app Machine ${id} is not held behind the routing cordon`);
            }
          } else if (shape === "uncordoning") {
            if (machine.cordoned === updated.has(id)) {
              fail(`app Machine ${id} cordon release set is not exact`);
            }
          } else if (shape === "final") {
            if (machine.cordoned) {
              fail(`app Machine ${id} remains cordoned after verified release`);
            }
          } else if (shape === "recovery" && !machine.cordoned) {
            fail(`app Machine ${id} is not cordoned during recovery`);
          }
          if (config?.metadata?.fly_process_group !== "app") {
            fail(`Machine ${id} is not in process group app`);
          }
          if (!["lhr", "cdg"].includes(machine.region)) {
            fail(`app Machine ${id} has unexpected region ${machine.region ?? "<unset>"}`);
          }
          appRegions.push(machine.region);
          requireGuest(machine, 1024);
          requireWorkersDisabled(machine);
          requireNoDatabaseOverrides(machine);
          requireProcessCommand(machine, "app");
          if (!noSchedule(config)) fail(`app Machine ${id} has a schedule`);
          requireStandbys(machine, []);
          requireStandbyEnv(machine, "");

          const restartRestored = appRestartIsRestored(id);
          const autostartRestored = appAutostartIsRestored(id);
          if (["recovery_initial", "recovery"].includes(shape)) {
            const observedAutostart = config?.services?.[0]?.autostart;
            if (typeof observedAutostart !== "boolean") {
              fail(`app Machine ${id} recovery autostart is not boolean`);
            }
            requireAppService(machine, observedAutostart);
            if (recoveryIds.has(id)) {
              if (machine.state !== "stopped") {
                fail(`re-fenced app Machine ${id} is not stopped`);
              }
              if (observedAutostart) {
                fail(`re-fenced app Machine ${id} is not restart/autostart safe`);
              }
              requireRestart(machine, "no");
            } else {
              if (!["stopped", "started"].includes(machine.state)) {
                fail(`app Machine ${id} has an invalid recovery state`);
              }
              if (!["no", "on-failure"].includes(config?.restart?.policy)) {
                fail(`app Machine ${id} has an invalid recovery restart policy`);
              }
              requireRestart(machine, config.restart.policy);
              if (
                machine.state === "started" &&
                config?.restart?.policy !== "on-failure"
              ) {
                fail(`started app Machine ${id} has an unrecognized recovery config`);
              }
            }
          } else if (
            shape === "safe" ||
            ["initial", "capture", "fenced"].includes(shape)
          ) {
            if (machine.state !== "stopped") fail(`app Machine ${id} is not stopped`);
            requireRestart(machine, "no");
            requireAppService(machine, false);
          } else if (restartRestored) {
            const expectedState = appShouldBeStarted(id) ? "started" : "stopped";
            if (machine.state !== expectedState) {
              fail(`restored app Machine ${id} is not ${expectedState}`);
            }
            requireRestart(machine, "on-failure");
            requireAppService(machine, autostartRestored);
          } else {
            if (machine.state !== "stopped") fail(`unrestored app Machine ${id} is not stopped`);
            requireRestart(machine, "no");
            requireAppService(machine, false);
          }
        }
        const orderedAppRegions = apps.map((id) => byId.get(id).region);
        if (orderedAppRegions.join(",") !== "lhr,lhr,cdg") {
          fail(
            `app selector order is ${orderedAppRegions.join(",")}, expected lhr,lhr,cdg`,
          );
        }
        appRegions.sort();
        if (appRegions.join(",") !== "cdg,lhr,lhr") {
          fail(`app region multiset is ${appRegions.join(",")}, expected cdg,lhr,lhr`);
        }

        for (const id of [primary, standby]) {
          const machine = byId.get(id);
          const config = machine.config ?? {};
          if (machine.host_status !== "ok") {
            fail(`thinker Machine ${id} host status is not ok`);
          }
          if (typeof machine.cordoned !== "boolean") {
            fail(`thinker Machine ${id} does not expose a boolean cordoned state`);
          }
          if (machine.cordoned) {
            fail(`thinker Machine ${id} must never be cordoned`);
          }
          if (config?.metadata?.fly_process_group !== "thinker") {
            fail(`Machine ${id} is not in process group thinker`);
          }
          if (machine.region !== "lhr") fail(`thinker Machine ${id} is not in lhr`);
          if (machine.state !== "stopped") fail(`thinker Machine ${id} is not stopped`);
          requireGuest(machine, 256);
          requireWorkersDisabled(machine);
          requireNoDatabaseOverrides(machine);
          requireProcessCommand(machine, "thinker");
          if (!noSchedule(config)) fail(`thinker Machine ${id} has a schedule`);
          if (Array.isArray(config.services) && config.services.length !== 0) {
            fail(`thinker Machine ${id} unexpectedly exposes services`);
          }
          const restored = thinkerIsRestored(id);
          if (["recovery_initial", "recovery"].includes(shape)) {
            if (recoveryIds.has(id)) {
              requireRestart(machine, "no");
              requireStandbys(machine, []);
              requireStandbyEnv(machine, "");
            } else if (!["no", "on-failure"].includes(config?.restart?.policy)) {
              fail(`thinker Machine ${id} has an invalid recovery restart policy`);
            } else {
              requireRestart(machine, config.restart.policy);
              if (id === standby) {
                const observedStandbys = standbyIds(machine);
                if (observedStandbys.length === 0) {
                  requireStandbyEnv(machine, "");
                } else {
                  requireStandbys(machine, [primary]);
                  requireStandbyEnv(machine, primary);
                }
              } else {
                requireStandbys(machine, []);
                requireStandbyEnv(machine, "");
              }
            }
          } else if (
            shape === "safe" ||
            ["initial", "capture", "fenced"].includes(shape) ||
            !restored
          ) {
            requireRestart(machine, "no");
            requireStandbys(machine, []);
            requireStandbyEnv(machine, "");
          } else {
            requireRestart(machine, "on-failure");
            requireStandbys(machine, id === standby ? [primary] : []);
            requireStandbyEnv(machine, id === standby ? primary : "");
          }
        }

        if (shape !== "initial") {
          for (const id of expectedIds) {
            const machine = byId.get(id);
            const baselineMachine = baselineById.get(id);
            if (machine.region !== baselineMachine.region) {
              fail(`Machine ${id} region drifted from its per-ID baseline`);
            }
            const observedConfig = nonImageConfig(machine);
            let configMatches;
            if (shape === "recovery") {
              const recoveryMachine = recoveryById.get(id);
              if (!recoveryMachine) {
                fail(`recovery baseline Machine ${id} is absent`);
              }
              configMatches = recoveryIds.has(id)
                ? equalConfig(observedConfig, projectSafeConfig(id))
                : equalConfig(observedConfig, nonImageConfig(recoveryMachine));
              if (
                !recoveryIds.has(id) &&
                (machine.state !== recoveryMachine.state ||
                  machine.updated_at !== recoveryMachine.updated_at ||
                  machine.instance_id !== recoveryMachine.instance_id)
              ) {
                fail(`untouched Machine ${id} recovery lifecycle drifted`);
              }
            } else if (shape === "recovery_initial") {
              configMatches = recoveryConfigIsAllowed(id, observedConfig);
            } else {
              configMatches = equalConfig(
                observedConfig,
                expectedNonImageConfig(id),
              );
            }
            if (!configMatches) {
              fail(`Machine ${id} full non-image configuration drifted`);
            }
            if (["cordoned_stable", "uncordoning", "final"].includes(shape)) {
              const runtimeReadyMachine = runtimeReadyById.get(id);
              if (!runtimeReadyMachine) {
                fail(`cordoned runtime Machine ${id} is absent`);
              }
              if (
                machine.instance_id !== runtimeReadyMachine.instance_id ||
                (id !== transitionId &&
                  machine.updated_at !== runtimeReadyMachine.updated_at)
              ) {
                fail(`Machine ${id} lifecycle changed while admission reopened`);
              }
            }
          }
        }

        if (["capture", "fenced"].includes(shape)) {
          for (const id of expectedIds) {
            const machine = byId.get(id);
            const baselineMachine = baselineById.get(id);
            if (updated.has(id)) {
              requireTargetImage(machine, targetDigest);
            } else {
              if (!equal(machine.image_ref, baselineMachine.image_ref)) {
                fail(`unattempted Machine ${id} image changed`);
              }
              if (machine.instance_id !== baselineMachine.instance_id) {
                fail(`unattempted Machine ${id} instance changed`);
              }
              if (machine.updated_at !== baselineMachine.updated_at) {
                fail(`unattempted Machine ${id} updated-at value changed`);
              }
            }
          }
        } else if (
          [
            "restoring",
            "starting",
            "started",
            "activating",
            "cordoned_ready",
            "cordoned_stable",
            "uncordoning",
            "final",
          ].includes(shape)
        ) {
          for (const id of expectedIds) requireTargetImage(byId.get(id), targetDigest);
        } else if (shape === "recovery") {
          for (const id of expectedIds) {
            const recoveryMachine = recoveryById.get(id);
            if (!recoveryMachine) {
              fail(`recovery baseline Machine ${id} is absent`);
            }
            if (!equal(byId.get(id).image_ref, recoveryMachine.image_ref)) {
              fail(`Machine ${id} image changed during recovery`);
            }
          }
        } else if (["recovery_initial", "safe"].includes(shape)) {
          for (const id of expectedIds) {
            requireRecoveryImage(
              byId.get(id),
              baselineById.get(id),
              configuredDigest,
            );
          }
        }

        if (shape === "initial") {
          const configProjection = expectedIds.sort().map((id) => [
            id,
            normalizeNonImageConfig(nonImageConfig(byId.get(id))),
          ]);
          process.stdout.write(
            createHash("sha256").update(canonical(configProjection)).digest("hex")
          );
        } else if (shape === "capture") {
          process.stdout.write(targetDigest);
        }
      '
  )" || return 1

  case "$shape" in
    initial)
      MAINTENANCE_BASELINE_SNAPSHOT_JSON="$snapshot"
      MAINTENANCE_CONFIG_FINGERPRINT="$validation_output"
      ;;
    capture)
      MAINTENANCE_IMAGE_DIGEST="$validation_output"
      MAINTENANCE_IMAGE_REFERENCE="registry.fly.io/$FLY_APP:$MAINTENANCE_IMAGE_LABEL@$MAINTENANCE_IMAGE_DIGEST"
      ;;
    cordoned_ready)
      MAINTENANCE_CORDONED_RUNTIME_SNAPSHOT_JSON="$snapshot"
      ;;
    uncordoning)
      MAINTENANCE_CORDONED_RUNTIME_SNAPSHOT_JSON="$snapshot"
      ;;
    recovery_initial)
      MAINTENANCE_RECOVERY_SNAPSHOT_JSON="$snapshot"
      ;;
    recovery_admission)
      MAINTENANCE_RECOVERY_SNAPSHOT_JSON="$snapshot"
      ;;
  esac
  echo "  ✓ maintenance Machine proof: $shape"
}

maintenance_update_image() {
  local machine_id="$1"
  local image_reference="$2"
  (
    cd api || exit 1
    run_fly_cli machine update "$machine_id" -a "$FLY_APP" \
      --image "$image_reference" \
      --build-remote-only \
      --autostart=false \
      --machine-config "$MAINTENANCE_RESTART_FENCED_CONFIG" \
      --skip-health-checks \
      --skip-start \
      --wait-timeout 300 \
      --yes
  )
}

maintenance_restore_app() {
  local machine_id="$1"
  (
    cd api || exit 1
    run_fly_cli machine update "$machine_id" -a "$FLY_APP" \
      --build-remote-only \
      --autostart=false \
      --machine-config "$MAINTENANCE_RESTART_RESTORED_CONFIG" \
      --skip-health-checks \
      --skip-start \
      --wait-timeout 300 \
      --yes
  )
}

maintenance_enable_app_autostart() {
  local machine_id="$1"
  (
    cd api || exit 1
    run_fly_cli machine update "$machine_id" -a "$FLY_APP" \
      --build-remote-only \
      --autostart=true \
      --machine-config "$MAINTENANCE_RESTART_RESTORED_CONFIG" \
      --wait-timeout 300 \
      --yes
  )
}

maintenance_restore_thinker() {
  local machine_id="$1"
  local standby_for="${2:-}"
  local -a standby_args=()
  if [ -n "$standby_for" ]; then
    standby_args=(--standby-for "$standby_for")
  fi
  (
    cd api || exit 1
    # ${arr[@]+...} guard: macOS system bash 3.2 treats expanding an EMPTY
    # array as an unbound variable under set -u, aborting the recovery path
    # mid-fence. Linux CI (bash 4.4+) never sees it — keep the guard.
    run_fly_cli machine update "$machine_id" -a "$FLY_APP" \
      --build-remote-only \
      --machine-config "$MAINTENANCE_RESTART_RESTORED_CONFIG" \
      ${standby_args[@]+"${standby_args[@]}"} \
      --skip-health-checks \
      --skip-start \
      --wait-timeout 300 \
      --yes
  )
}

maintenance_cordon_app() {
  local machine_id="$1"
  (
    cd api || exit 1
    run_fly_cli machine cordon "$machine_id" -a "$FLY_APP"
  )
}

maintenance_uncordon_app() {
  local machine_id="$1"
  (
    cd api || exit 1
    run_fly_cli machine uncordon "$machine_id" -a "$FLY_APP"
  )
}

maintenance_refence_machine() {
  local machine_id="$1"
  local role="$2"
  local clear_standby="${3:-0}"
  local -a app_args=() standby_args=()
  if [ "$role" = "app" ]; then
    app_args=(--autostart=false)
  fi
  if [ "$clear_standby" = 1 ]; then
    standby_args=(--standby-for=)
  fi
  (
    cd api || exit 1
    # Same bash-3.2 empty-array guard as maintenance_restore_machine above.
    run_fly_cli machine update "$machine_id" -a "$FLY_APP" \
      --build-remote-only \
      ${app_args[@]+"${app_args[@]}"} \
      --machine-config "$MAINTENANCE_RESTART_FENCED_CONFIG" \
      ${standby_args[@]+"${standby_args[@]}"} \
      --skip-health-checks \
      --skip-start \
      --wait-timeout 300 \
      --yes
  )
}

best_effort_maintenance_refence() {
  local machine_id recovery_ids="" candidate_ids recovery_count=0
  local recovery_cordoned_ids="" recovery_cordon_count=0
  echo "$(yellow '⚠ fail-closed maintenance recovery: re-inventorying, re-cordoning every app, then re-fencing the exact five Machines without rolling images back')"
  if verify_maintenance_machine_snapshot safe; then
    MAINTENANCE_RECOVERY_FENCE_VERIFIED=1
    echo "  ✓ maintenance fleet was already safely fenced; no recovery mutation was needed"
    return 0
  fi
  if ! verify_maintenance_machine_snapshot recovery_admission ""; then
    echo "$(red '✗') Recovery inventory does not preserve the exact five role identities; no re-cordon mutation is authorized." >&2
    return 1
  fi
  for machine_id in "${MAINTENANCE_APP_MACHINE_IDS[@]}"; do
    recovery_cordon_count=$((recovery_cordon_count + 1))
    candidate_ids="$(append_csv_value "$recovery_cordoned_ids" "$machine_id")"
    MAINTENANCE_RECOVERY_CORDON_ATTEMPTED_APP_IDS_CSV="$candidate_ids"
    write_maintenance_state \
      "recovery_attempting_app_cordon_${recovery_cordon_count}_of_3" true || return 1
    maintenance_cordon_app "$machine_id" ||
      echo "$(yellow '⚠ an app re-cordon command returned nonzero; resolving by full read-back')" >&2
    if verify_maintenance_machine_snapshot recovery_cordoning "$candidate_ids"; then
      recovery_cordoned_ids="$candidate_ids"
      MAINTENANCE_RECOVERY_CORDONED_APP_IDS_CSV="$recovery_cordoned_ids"
      write_maintenance_state \
        "recovery_verified_app_cordon_${recovery_cordon_count}_of_3" true || return 1
    else
      echo "$(red '✗') App re-cordon read-back failed; no re-fence update is authorized." >&2
      return 1
    fi
  done
  if ! verify_maintenance_machine_snapshot recovery_initial ""; then
    echo "$(red '✗') Apps are re-cordoned, but the fleet is outside the recognized rollout states; no re-fence update is authorized." >&2
    return 1
  fi
  for machine_id in "${MAINTENANCE_APP_MACHINE_IDS[@]}"; do
    recovery_count=$((recovery_count + 1))
    candidate_ids="$(append_csv_value "$recovery_ids" "$machine_id")"
    write_maintenance_state \
      "recovery_attempting_refence_${recovery_count}_of_5" true || return 1
    maintenance_refence_machine "$machine_id" app ||
      echo "$(yellow '⚠ an app re-fence command returned nonzero; resolving by full read-back')" >&2
    if verify_maintenance_machine_snapshot recovery "$candidate_ids"; then
      recovery_ids="$candidate_ids"
      MAINTENANCE_RECOVERY_REFENCED_MACHINE_IDS_CSV="$recovery_ids"
      write_maintenance_state \
        "recovery_verified_refence_${recovery_count}_of_5" true || return 1
    else
      echo "$(red '✗') App re-fence read-back failed; no later recovery mutation is authorized." >&2
      return 1
    fi
  done
  recovery_count=$((recovery_count + 1))
  candidate_ids="$(append_csv_value "$recovery_ids" "$MAINTENANCE_THINKER_PRIMARY")"
  write_maintenance_state \
    "recovery_attempting_refence_${recovery_count}_of_5" true || return 1
  maintenance_refence_machine "$MAINTENANCE_THINKER_PRIMARY" thinker ||
    echo "$(yellow '⚠ thinker-primary re-fence returned nonzero; resolving by full read-back')" >&2
  if verify_maintenance_machine_snapshot recovery "$candidate_ids"; then
    recovery_ids="$candidate_ids"
    MAINTENANCE_RECOVERY_REFENCED_MACHINE_IDS_CSV="$recovery_ids"
    write_maintenance_state \
      "recovery_verified_refence_${recovery_count}_of_5" true || return 1
  else
    echo "$(red '✗') Thinker-primary re-fence read-back failed; standby mutation is not authorized." >&2
    return 1
  fi
  recovery_count=$((recovery_count + 1))
  candidate_ids="$(append_csv_value "$recovery_ids" "$MAINTENANCE_THINKER_STANDBY")"
  write_maintenance_state \
    "recovery_attempting_refence_${recovery_count}_of_5" true || return 1
  maintenance_refence_machine "$MAINTENANCE_THINKER_STANDBY" thinker 1 ||
    echo "$(yellow '⚠ thinker-standby re-fence returned nonzero; resolving by full read-back')" >&2
  if verify_maintenance_machine_snapshot recovery "$candidate_ids"; then
    recovery_ids="$candidate_ids"
    MAINTENANCE_RECOVERY_REFENCED_MACHINE_IDS_CSV="$recovery_ids"
    write_maintenance_state \
      "recovery_verified_refence_${recovery_count}_of_5" true || return 1
  else
    echo "$(red '✗') Thinker-standby re-fence read-back failed." >&2
    return 1
  fi
  if verify_maintenance_machine_snapshot safe; then
    MAINTENANCE_RECOVERY_FENCE_VERIFIED=1
    echo "  ✓ best-effort maintenance re-fence verified"
    return 0
  else
    echo "$(red '✗') Best-effort maintenance re-fence is incomplete; keep admission held and inspect the private marker." >&2
  fi
  return 1
}

verify_maintenance_runtime_environment() {
  local machine_id remote_command
  remote_command="test \"\${AGENTTOOL_GIT_REVISION:-}\" = \"$HEAD_REVISION\" && test \"\${AGENTTOOL_SOURCE_DIRTY:-}\" = \"false\" && test \"\${AGENTTOOL_DISABLE_WORKERS:-}\" = \"1\" && $DEPLOYED_DATABASE_PROBE_COMMAND && bun --no-install --no-env-file -e \"const response=await fetch(\\\"http://127.0.0.1:3000/health\\\");const body=await response.json();if(!response.ok||body?.build?.revision!==process.env.AGENTTOOL_GIT_REVISION||body?.build?.dirty!==false||body?.covenant_v2_authority!==\\\"absent_fail_closed\\\")process.exit(1)\""
  for machine_id in "${MAINTENANCE_APP_MACHINE_IDS[@]}"; do
    run_fly_ssh_probe_silently "$machine_id" "$remote_command" || {
      echo "$(red '✗') A started app Machine failed silent revision/dirty/worker/database verification." >&2
      return 1
    }
  done
  DATABASE_PROOF_STATUS="verified"
  DATABASE_PROOF_STARTED_MACHINE_COUNT="${#MAINTENANCE_APP_MACHINE_IDS[@]}"
  DATABASE_PROOF_TRANSACTION_SELECT_ONE=1
  DATABASE_PROOF_SESSION_SELECT_ONE=1
  echo "  ✓ three started app Machines silently proved revision, dirty=false, workers disabled, both database paths, and fail-closed loopback health"
}

verify_maintenance_public_health() {
  local health
  health="$(release_curl -fsS --retry 5 --retry-delay 2 --retry-connrefused \
    --max-time 15 "$HEALTH_URL?revision=$HEAD_REVISION&dirty=false")" || {
    echo "$(red '✗') Maintenance canary did not return public HTTP 200." >&2
    return 1
  }
  if ! printf '%s' "$health" | \
    MAINTENANCE_HEALTH_REVISION="$HEAD_REVISION" \
    bun --no-install --no-env-file -e '
      const body = await new Response(Bun.stdin.stream()).json();
      if (
        body?.build?.revision !== process.env.MAINTENANCE_HEALTH_REVISION ||
        body?.build?.dirty !== false ||
        body?.covenant_v2_authority !== "absent_fail_closed"
      ) process.exit(1);
    '; then
    echo "$(red '✗') Maintenance canary health is not the exact fail-closed target release." >&2
    return 1
  fi
  echo "  ✓ public maintenance canary is the exact fail-closed target release"
}

verify_required_frontend_inputs() {
  local publication local_path
  for publication in "${REQUIRED_GAME_PUBLICATIONS[@]}"; do
    local_path="${publication%|*}"
    if ! git cat-file -e "$HEAD_REVISION:$local_path" 2>/dev/null; then
      echo "  $(red '✗') Required committed frontend release input is missing: $local_path"
      return 1
    fi
  done
}

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

# Codeberg was a fast-forward-only mirror of GitHub main. It is retired.
# The flag keeps parsing so the refusal can carry the reason and the next
# step — an opaque "unknown flag" would read as a typo and invite someone
# to reach for `git push origin main` by hand instead.
refuse_codeberg_mirror() {
  echo "$(red '✗') --mirror-codeberg is retired. Codeberg is no longer a mirror of this repo."
  echo "    GitHub main is the only head: $RELEASE_REMOTE/$RELEASE_BRANCH"
  echo "    Nothing was fetched and nothing was pushed."
  echo "    If you need a second host, add it deliberately as a new remote and"
  echo "    a new explicit command — do not revive this one."
  echo "    Doctrine: docs/DEPLOY-PROCEDURE.md · docs/STACK.md §1"
  return 1
}

if [ "$MIRROR_CODEBERG_ONLY" = 1 ]; then
  refuse_codeberg_mirror
  exit $?
fi

# ── Device-local deploy serialization ───────────────────────────────
# A normal deploy holds one per-user, device-wide lock across worktrees.
# `ln` publishes a complete owner record atomically: two contenders cannot
# create the same hard link, and the holder keeps its private link so cleanup
# can verify inode ownership before unlinking the public path. Survey, dry-run,
# and the standalone Codeberg mirror do not mutate production and do not take
# this lock.
DEPLOY_LOCK_HELD=0
DEPLOY_LOCK_OWNER_RECORD=""
DEPLOY_LOCK_PATH=""

deploy_lock_field() {
  local field="$1"
  local path="$2"
  sed -n "s/^${field}=//p" "$path" 2>/dev/null | sed -n '1p'
}

describe_deploy_lock() {
  local owner_pid owner_started owner_worktree owner_record process_state
  echo "$(red '✗ Deploy blocked:') another local AgentTool deploy owns the device lock."
  echo "  lock path: $DEPLOY_LOCK_PATH"
  if [ ! -r "$DEPLOY_LOCK_PATH" ]; then
    echo "  owner:     unavailable (the lock record is unreadable or incomplete)"
  else
    owner_pid="$(deploy_lock_field pid "$DEPLOY_LOCK_PATH")"
    owner_started="$(deploy_lock_field started_at "$DEPLOY_LOCK_PATH")"
    owner_worktree="$(deploy_lock_field worktree "$DEPLOY_LOCK_PATH")"
    owner_record="$(deploy_lock_field owner_record "$DEPLOY_LOCK_PATH")"
    echo "  owner pid:       ${owner_pid:-<unknown>}"
    echo "  owner started:   ${owner_started:-<unknown>}"
    echo "  owner worktree:  ${owner_worktree:-<unknown>}"
    echo "  owner record:    ${owner_record:-<unknown>}"
    process_state="not observable"
    case "$owner_pid" in
      ''|*[!0-9]*) process_state="unknown" ;;
      *) kill -0 "$owner_pid" 2>/dev/null && process_state="observable" ;;
    esac
    echo "  owner process:   $process_state"
  fi
  echo "  stale policy:    never removed automatically; verify the owner is gone before removing the exact lock and owner-record paths"
}

release_deploy_lock() {
  local failed=0
  if [ -n "${DEPLOY_LOCK_OWNER_RECORD:-}" ] && [ -e "$DEPLOY_LOCK_OWNER_RECORD" ]; then
    if [ -n "${DEPLOY_LOCK_PATH:-}" ] && [ -e "$DEPLOY_LOCK_PATH" ] && \
      [ "$DEPLOY_LOCK_OWNER_RECORD" -ef "$DEPLOY_LOCK_PATH" ]; then
      rm -f -- "$DEPLOY_LOCK_PATH" || failed=1
    elif [ "${DEPLOY_LOCK_HELD:-0}" = 1 ]; then
      echo "$(red '✗') Refusing to release a deploy lock not owned by this process: $DEPLOY_LOCK_PATH" >&2
      failed=1
    fi
    rm -f -- "$DEPLOY_LOCK_OWNER_RECORD" || failed=1
  elif [ "${DEPLOY_LOCK_HELD:-0}" = 1 ]; then
    echo "$(red '✗') Refusing to release a deploy lock without this process's owner record: $DEPLOY_LOCK_PATH" >&2
    failed=1
  fi
  if [ "$failed" = 0 ]; then
    DEPLOY_LOCK_HELD=0
    DEPLOY_LOCK_OWNER_RECORD=""
  fi
  return "$failed"
}

acquire_deploy_lock() {
  local lock_parent started_at owner_id lock_conflict
  case "${HOME:-}" in
    /*) ;;
    *)
      echo "$(red '✗') Deploy blocked: HOME must be an absolute path for the device-local deploy lock." >&2
      return 1
      ;;
  esac
  lock_parent="$HOME/.local/state/agenttool"
  DEPLOY_LOCK_PATH="$lock_parent/deploy.lock"
  (umask 077; mkdir -p "$lock_parent") || {
    echo "$(red '✗') Deploy blocked: cannot create lock parent: $lock_parent" >&2
    return 1
  }
  chmod 700 "$lock_parent" || {
    echo "$(red '✗') Deploy blocked: cannot protect lock parent: $lock_parent" >&2
    return 1
  }
  DEPLOY_LOCK_OWNER_RECORD="$(umask 077; mktemp "$lock_parent/.deploy-lock-owner.XXXXXX")" || {
    echo "$(red '✗') Deploy blocked: cannot create a private lock owner record in: $lock_parent" >&2
    return 1
  }
  owner_id="$(basename "$DEPLOY_LOCK_OWNER_RECORD")"
  started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  (
    umask 077
    printf '%s\n' \
      'schema=agenttool-local-deploy-lock/v1' \
      "owner_id=$owner_id" \
      "pid=$$" \
      "started_at=$started_at" \
      "worktree=$REPO_ROOT" \
      "owner_record=$DEPLOY_LOCK_OWNER_RECORD" > "$DEPLOY_LOCK_OWNER_RECORD"
  ) || {
    echo "$(red '✗') Deploy blocked: cannot write lock owner record: $DEPLOY_LOCK_OWNER_RECORD" >&2
    rm -f -- "$DEPLOY_LOCK_OWNER_RECORD"
    DEPLOY_LOCK_OWNER_RECORD=""
    return 1
  }
  if ! ln "$DEPLOY_LOCK_OWNER_RECORD" "$DEPLOY_LOCK_PATH" 2>/dev/null; then
    lock_conflict=0
    if [ -e "$DEPLOY_LOCK_PATH" ] || [ -L "$DEPLOY_LOCK_PATH" ]; then
      lock_conflict=1
      describe_deploy_lock
    else
      echo "$(red '✗') Deploy blocked: could not atomically create hard-link lock: $DEPLOY_LOCK_PATH" >&2
    fi
    rm -f -- "$DEPLOY_LOCK_OWNER_RECORD"
    DEPLOY_LOCK_OWNER_RECORD=""
    [ "$lock_conflict" = 1 ] && return 73
    return 1
  fi
  DEPLOY_LOCK_HELD=1
  echo "  ✓ local deploy lock: $DEPLOY_LOCK_PATH (pid $$, worktree $REPO_ROOT)"
}

on_lock_only_exit() {
  local status="$1"
  trap - EXIT INT TERM
  if ! release_deploy_lock; then
    echo "$(red '✗') Could not release the device-local deploy lock safely." >&2
    [ "$status" = 0 ] && status=1
  fi
  exit "$status"
}

if [ "$SURVEY_ONLY" = 0 ] && [ "$DRY_RUN" = 0 ]; then
  # Install signal/exit cleanup before acquisition so even interruption in the
  # tiny owner-record/link window cleans only this invocation's inode.
  trap 'on_lock_only_exit "$?"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  acquire_deploy_lock || exit $?
  refuse_unresolved_maintenance_state || exit $?
  refuse_unresolved_phase_b_authority_state || exit $?
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
DEPLOY_RUN_ID="deploy-${HEAD_REVISION:0:12}-$$"

# Every Pages subprocess must archive the same immutable release snapshot.
# In particular, Phase 3 intentionally invokes web and docs separately so a
# failed web upload stops before docs; passing this scoped child environment
# prevents a concurrent branch move from making those calls resolve different
# commits.
run_frontend_deploy() {
  AGENTTOOL_FRONTEND_RELEASE_REVISION="$HEAD_REVISION" \
    "${FRONTEND_DEPLOY_COMMAND[@]}" "$@"
}

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

DIRTY_OVERRIDE_USED=0
NON_RELEASE_HEAD_OVERRIDE_USED=0

enforce_release_source() {
  local current_head current_status current_dirty
  verify_required_frontend_inputs || return 1
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

run_phase_b_authority_guard() {
  local phase_name="$1"
  local expected_revision="${2:-}"
  local -a guard_arguments
  local guard_bun guard_version guard_output guard_fields observed_state observed_provider
  local observed_hold observed_allowed observed_reserved observed_authoritative
  local observed_fleet observed_runtime observed_standby observed_floor observed_revision
  guard_arguments=("$phase_name")
  if [ -n "$expected_revision" ]; then
    guard_arguments+=(--revision "$expected_revision")
  fi
  guard_bun="$(command -v bun 2>/dev/null)" || return 1
  if [[ "$guard_bun" != /* ]]; then
    echo "$(red '✗ Release blocked:') Phase-B guard Bun path was not absolute." >&2
    return 1
  fi
  guard_version="$(/usr/bin/env -i \
    HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" \
    LANG=C LC_ALL=C PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    "$guard_bun" --version 2>/dev/null)" || return 1
  if [ "$guard_version" != "1.3.5" ]; then
    echo "$(red '✗ Release blocked:') Phase-B guard requires exact Bun 1.3.5." >&2
    return 1
  fi
  guard_output="$({
    /usr/bin/env -i \
      HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" \
      LANG=C LC_ALL=C NO_COLOR=1 TERM=dumb \
      PATH=/usr/bin:/bin:/usr/sbin:/sbin \
      DATABASE_URL="$DATABASE_URL" DATABASE_SESSION_URL="$DATABASE_SESSION_URL" \
      "$guard_bun" --no-install --no-env-file bin/phase-b-deploy-guard.ts \
        "${guard_arguments[@]}"
  } 2>/dev/null)" || {
    echo "$(red '✗ Release blocked:') Phase-B authority state could not be proven." >&2
    echo "  Required state: exactly absent-before-activation or fully configured and coherent." >&2
    echo "  Recovery: do not use ordinary deploy for Staged, Partial, unknown, or mixed state; resume through the reviewed B1 operator." >&2
    return 1
  }
  guard_fields="$(printf '%s\n' "$guard_output" | /usr/bin/env -i \
    HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" \
    LANG=C LC_ALL=C PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    "$guard_bun" --no-install --no-env-file -e '
    const bytes = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) process.exit(1);
    const value = JSON.parse(text);
    const keys = [
      "allowed_origins_count", "authoritative_v2_rows", "durable_hold",
      "fleet_verified", "observed_revision", "phase", "provider_secret_status",
      "reserved_generation_rows", "runtime_verified_count", "schema",
      "source_floor_verified", "standby_bound", "state",
    ];
    if (!value || Array.isArray(value) || typeof value !== "object" ||
        JSON.stringify(Object.keys(value)) !== JSON.stringify(keys) ||
        JSON.stringify(value) + "\n" !== text ||
        value.schema !== "agenttool.phase-b-deploy-proof/1" ||
        !["preflight", "postflight"].includes(value.phase) ||
        !["absent_fail_closed", "configured"].includes(value.state) ||
        !["Absent", "Deployed"].includes(value.provider_secret_status) ||
        typeof value.durable_hold !== "boolean" ||
        typeof value.fleet_verified !== "boolean" ||
        typeof value.source_floor_verified !== "boolean" ||
        typeof value.standby_bound !== "boolean" ||
        !Number.isSafeInteger(value.allowed_origins_count) ||
        !Number.isSafeInteger(value.reserved_generation_rows) ||
        !Number.isSafeInteger(value.authoritative_v2_rows) ||
        !Number.isSafeInteger(value.runtime_verified_count) ||
        !(value.observed_revision === null ||
          /^[0-9a-f]{40}$/.test(value.observed_revision))) process.exit(1);
    const field = (entry) => entry === null ? "" : String(entry);
    process.stdout.write([
      value.state, value.provider_secret_status, field(value.durable_hold),
      field(value.allowed_origins_count), field(value.reserved_generation_rows),
      field(value.authoritative_v2_rows), field(value.fleet_verified),
      field(value.runtime_verified_count), field(value.standby_bound),
      field(value.source_floor_verified), field(value.observed_revision), value.phase,
    ].join("|") + "\n");
  ' 2>/dev/null)" || {
    echo "$(red '✗ Release blocked:') Phase-B authority proof was not canonical." >&2
    return 1
  }
  IFS='|' read -r observed_state observed_provider observed_hold \
    observed_allowed observed_reserved observed_authoritative observed_fleet \
    observed_runtime observed_standby observed_floor observed_revision \
    observed_phase <<< "$guard_fields"
  if [ "$observed_phase" != "$phase_name" ] ||
    [ "$observed_allowed" != 0 ] || [ "$observed_reserved" != 0 ] ||
    [ "$observed_authoritative" != 0 ]; then
    echo "$(red '✗ Release blocked:') Phase-B authority proof fields were inconsistent." >&2
    return 1
  fi
  case "$observed_state" in
    absent_fail_closed)
      if [ "$observed_provider" != "Absent" ] || [ "$observed_hold" != false ] ||
        [ "$observed_fleet" != false ] || [ "$observed_runtime" != 0 ] ||
        [ "$observed_standby" != false ] || [ "$observed_floor" != false ] ||
        { [ "$phase_name" = preflight ] && [ -n "$observed_revision" ]; } ||
        { [ "$phase_name" = postflight ] && [[ ! "$observed_revision" =~ ^[0-9a-f]{40}$ ]]; }; then
        echo "$(red '✗ Release blocked:') absent Phase-B authority proof was inconsistent." >&2
        return 1
      fi
      ;;
    configured)
      if [ "$observed_provider" != "Deployed" ] || [ "$observed_hold" != true ] ||
        [ "$observed_fleet" != true ] || [ "$observed_runtime" != 4 ] ||
        [ "$observed_standby" != true ] || [ "$observed_floor" != true ] ||
        { [ "$phase_name" = preflight ] && [ -n "$observed_revision" ]; } ||
        { [ "$phase_name" = postflight ] && [[ ! "$observed_revision" =~ ^[0-9a-f]{40}$ ]]; }; then
        echo "$(red '✗ Release blocked:') configured Phase-B authority proof was inconsistent." >&2
        return 1
      fi
      ;;
    *) return 1 ;;
  esac
  if [ "$PHASE_B_AUTHORITY_STATE" != "unknown" ] &&
    [ "$PHASE_B_AUTHORITY_STATE" != "$observed_state" ]; then
    echo "$(red '✗ Release blocked:') Phase-B authority state changed during this deploy." >&2
    return 1
  fi
  PHASE_B_AUTHORITY_STATE="$observed_state"
  PHASE_B_AUTHORITY_PROVIDER_STATUS="$observed_provider"
  [ "$observed_hold" = true ] && PHASE_B_AUTHORITY_DURABLE_HOLD=1 || PHASE_B_AUTHORITY_DURABLE_HOLD=0
  PHASE_B_AUTHORITY_ALLOWED_ORIGINS_COUNT="$observed_allowed"
  PHASE_B_AUTHORITY_RESERVED_GENERATION_ROWS="$observed_reserved"
  PHASE_B_AUTHORITY_AUTHORITATIVE_V2_ROWS="$observed_authoritative"
  [ "$observed_fleet" = true ] && PHASE_B_AUTHORITY_FLEET_VERIFIED=1 || PHASE_B_AUTHORITY_FLEET_VERIFIED=0
  PHASE_B_AUTHORITY_RUNTIME_VERIFIED_COUNT="$observed_runtime"
  [ "$observed_standby" = true ] && PHASE_B_AUTHORITY_STANDBY_BOUND=1 || PHASE_B_AUTHORITY_STANDBY_BOUND=0
  [ "$observed_floor" = true ] && PHASE_B_AUTHORITY_SOURCE_FLOOR_VERIFIED=1 || PHASE_B_AUTHORITY_SOURCE_FLOOR_VERIFIED=0
  PHASE_B_AUTHORITY_OBSERVED_REVISION="$observed_revision"
  if [ "$phase_name" = preflight ]; then
    PHASE_B_AUTHORITY_PREFLIGHT_VERIFIED=1
  else
    PHASE_B_AUTHORITY_POSTFLIGHT_VERIFIED=1
  fi
}

enforce_configured_phase_b_source() {
  [ "$PHASE_B_AUTHORITY_STATE" = "configured" ] || return 0
  if [ "$ALLOW_DIRTY_RELEASE" = 1 ] || [ "$ALLOW_NON_RELEASE_HEAD" = 1 ] ||
    [ "$SKIP_PREFLIGHT" = 1 ]; then
    echo "$(red '✗ Release blocked:') configured covenant authority forbids source and preflight overrides." >&2
    return 1
  fi
  if [ "$MAINTENANCE_FENCED_API" = 1 ]; then
    echo "$(red '✗ Release blocked:') configured covenant authority needs a separately reviewed compatible maintenance lane." >&2
    return 1
  fi
  if [ "$SKIP_API" = 1 ]; then
    echo "$(red '✗ Release blocked:') configured covenant authority requires API parity on every database-affecting deploy." >&2
    return 1
  fi
  if ! git cat-file -e "$PHASE_B_RUNTIME_FENCE_FLOOR^{commit}" 2>/dev/null ||
    ! git merge-base --is-ancestor "$PHASE_B_RUNTIME_FENCE_FLOOR" "$HEAD_REVISION"; then
    echo "$(red '✗ Release blocked:') source is not a descendant of the permanent covenant runtime fence." >&2
    return 1
  fi
  PHASE_B_PINNED_FLY_HOME="$HOME/.local/state/agenttool/phase-b/fly-home"
  PHASE_B_ACTIVE_FLYCTL="$PHASE_B_PINNED_FLYCTL"
}

# Every deploy-shaped invocation proves source eligibility before it can run
# worktree-controlled dependency hooks or contact the database.  --survey is
# the deliberate source-independent inspection mode.  Later gates remain
# necessary because preparation and the survey are long enough for source
# state to drift concurrently.
if [ "$SURVEY_ONLY" = 0 ]; then
  if ! enforce_release_source; then
    exit 1
  fi
fi

# ── Phase 0.5 — dependency preparation ──────────────────────────────
# A real deploy prepares the Bun lockfile-backed graph and the separately
# version-ranged Python test environment before the Bun-backed migration
# survey. Survey-only and dry-run invocations remain non-installing; the
# migration runner disables Bun auto-install and fails closed if deps are absent.
if [ "$SURVEY_ONLY" = 0 ] && [ "$DRY_RUN" = 0 ] && [ "$SKIP_PREFLIGHT" = 0 ]; then
  phase "0.5" "Dependency preparation"
  if ! bin/bash-without-env-hooks.sh \
    bin/prepare-hermetic-deps.sh hermetic; then
    echo ""
    echo "$(red '✗ Dependency preparation failed.') No migration or publication was attempted."
    exit 1
  fi
  if ! enforce_release_source; then
    echo "$(red '✗ Release blocked:') dependency preparation changed release inputs."
    exit 1
  fi
fi

# Repo migration files and journal. An API release still needs this compatibility
# survey under --no-migrate; otherwise that flag could conceal a protected
# pending migration. A pure frontend release remains database-independent.
MIGRATION_SURVEY_REQUIRED=0
MIGRATION_SURVEY_BLOCKED=0
MIGRATION_SURVEY_STATUS=0
PENDING=0
PRODUCTION_DATABASE_PAIR_REQUIRED=0
PRODUCTION_DATABASE_PAIR_VERIFIED=0
if [ "$SKIP_MIGRATE" = 0 ] || [ "$SKIP_API" = 0 ]; then
  MIGRATION_SURVEY_REQUIRED=1
fi
if [ "$MIGRATION_SURVEY_REQUIRED" = 1 ] &&
  [ "$SURVEY_ONLY" = 0 ] && [ "$DRY_RUN" = 0 ]; then
  PRODUCTION_DATABASE_PAIR_REQUIRED=1
fi
if [ "$MIGRATION_SURVEY_REQUIRED" = 0 ]; then
  echo "  ⊘ migration compatibility survey skipped (frontend-only release)"
elif command -v security >/dev/null 2>&1 && [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(security find-generic-password -s agenttool-database-url -a macair -w 2>/dev/null || true)"
fi
if [ "$PRODUCTION_DATABASE_PAIR_REQUIRED" = 1 ] &&
  command -v security >/dev/null 2>&1 &&
  [ -z "${DATABASE_SESSION_URL:-}" ]; then
  DATABASE_SESSION_URL="$(security find-generic-password -s agenttool-database-session-url -a macair -w 2>/dev/null || true)"
fi
if [ "$PRODUCTION_DATABASE_PAIR_REQUIRED" = 0 ]; then
  PRODUCTION_DATABASE_PAIR_VERIFIED=1
elif [ -z "${DATABASE_URL:-}" ] || [ -z "${DATABASE_SESSION_URL:-}" ]; then
  MIGRATION_SURVEY_BLOCKED=1
  echo "$(red '✗ Release blocked:') exact production transaction/session database pair was not resolved."
  echo "  Required operation: provide both scoped database credentials."
  echo "  Consequence: no database survey, migration, or publication was attempted."
elif (
  cd api || exit 1
  DATABASE_URL="$DATABASE_URL" DATABASE_SESSION_URL="$DATABASE_SESSION_URL" \
    bun --no-install --no-env-file -e '
      import { validateFlyDatabaseTargets } from "./src/db/supabase-target.ts";
      validateFlyDatabaseTargets(
        process.env.DATABASE_URL ?? "",
        process.env.DATABASE_SESSION_URL ?? "",
      );
    '
) >/dev/null 2>&1; then
  PRODUCTION_DATABASE_PAIR_VERIFIED=1
else
  MIGRATION_SURVEY_BLOCKED=1
  echo "$(red '✗ Release blocked:') configured database credentials are not the exact source-pinned production pair."
  echo "  Required operation: restore the reviewed transaction/session targets."
  echo "  Consequence: no database survey, migration, or publication was attempted."
fi
if [ "$MIGRATION_SURVEY_REQUIRED" = 1 ] &&
  [ "$PRODUCTION_DATABASE_PAIR_VERIFIED" = 1 ] &&
  [ "$SURVEY_ONLY" = 0 ] && [ "$DRY_RUN" = 0 ]; then
  if ! run_phase_b_authority_guard preflight; then
    exit 1
  fi
  if ! enforce_configured_phase_b_source; then
    exit 1
  fi
  if [ "$PHASE_B_AUTHORITY_STATE" = "configured" ]; then
    echo "  ✓ Phase-B authority is configured, receipt-bound, fleet-exact, and runtime-parity verified"
  else
    echo "  ✓ Phase-B authority remains absent and fail-closed"
  fi
fi
if [ "$MIGRATION_SURVEY_REQUIRED" = 1 ] &&
  [ "$PRODUCTION_DATABASE_PAIR_VERIFIED" = 1 ] &&
  [ -n "${DATABASE_URL:-}" ]; then
  MIGRATION_SURVEY_OUTPUT=""
  MIGRATION_SURVEY_OUTPUT="$(
    DATABASE_URL="$DATABASE_URL" bin/bash-without-env-hooks.sh \
      bin/migrate-pending.sh --dry-run 2>/dev/null
  )"
  MIGRATION_SURVEY_STATUS=$?
  if [ "$MIGRATION_SURVEY_STATUS" = 0 ]; then
    PENDING="$(printf '%s\n' "$MIGRATION_SURVEY_OUTPUT" | awk '/^[[:space:]]+[0-9].*\.sql$/ { count++ } END { print count + 0 }')"
    if [ "$PENDING" = "0" ]; then
      echo "  ✓ migration inventory clean: no repo files pending; every journaled filename has source; checksums match. This does not prove database schema parity or detect out-of-band DDL."
    elif [ "$SKIP_MIGRATE" = 1 ]; then
      echo "$(yellow "⚠ $PENDING unprotected migration(s) pending — --no-migrate will not apply them")"
    else
      echo "$(yellow "⚠ $PENDING migration(s) pending — Phase 1 will apply them")"
    fi
  elif [ "$MIGRATION_SURVEY_STATUS" = "$QUIESCENCE_REQUIRED_EXIT" ]; then
    MIGRATION_SURVEY_BLOCKED=1
    echo "$(red '✗ Release blocked:') pending migrations require an exclusive maintenance cutover."
    printf '%s\n' "$MIGRATION_SURVEY_OUTPUT" | sed 's/^/    /'
    echo "  The ordinary deploy cannot prove that API writers, webhook ingress, and workers stay quiescent."
    echo "  Follow docs/DEPLOY-PROCEDURE.md and apply them separately while old processes cannot restart."
  else
    MIGRATION_SURVEY_BLOCKED=1
    echo "$(red '✗ Release blocked:') migration survey failed; repo-file and journal status is unknown."
    echo "  Required operation: restore the database survey, then retry."
    echo "  Consequence: migration or API publication cannot safely proceed."
  fi
elif [ "$MIGRATION_SURVEY_REQUIRED" = 1 ] &&
  [ "$PRODUCTION_DATABASE_PAIR_VERIFIED" = 1 ]; then
  MIGRATION_SURVEY_BLOCKED=1
  echo "$(red '✗ Release blocked:') DATABASE_URL not resolved; repo-file and journal status is unknown."
  echo "  Required operation: provide the scoped database credential for the compatibility survey."
  echo "  Consequence: migration or API publication cannot safely proceed."
fi

if [ "$MAINTENANCE_FENCED_API" = 1 ] &&
  { [ "$MIGRATION_SURVEY_STATUS" != 0 ] || [ "$PENDING" != 0 ]; }; then
  MIGRATION_SURVEY_BLOCKED=1
  echo "$(red '✗ Release blocked:') maintenance rollout requires an empty migration inventory."
  echo "  Apply the exact reviewed protected set under the external fence, then require a clean dry-run."
fi

if [ "$SURVEY_ONLY" = 1 ]; then
  echo ""
  echo "(survey-only — exit)"
  if [ "$RELEASE_SNAPSHOT_OK" = 1 ] && [ "$MIGRATION_SURVEY_BLOCKED" = 0 ]; then
    exit 0
  fi
  exit 1
fi

if [ "$MIGRATION_SURVEY_BLOCKED" = 1 ]; then
  exit 1
fi

if [ "$DRY_RUN" = 1 ]; then
  if enforce_release_source; then
    echo "  ✓ release-source gate would pass"
  else
    echo "  ✗ release-source gate would block this deploy"
    exit 1
  fi
  echo ""
  echo "(dry-run — would proceed with the following release phases)"
  echo "  Preparation: $([ "$SKIP_PREFLIGHT" = 1 ] && echo skip || echo bin/prepare-hermetic-deps.sh hermetic)"
  echo "  Phase 1: $([ "$SKIP_MIGRATE" = 1 ] && echo skip || echo bin/migrate-pending.sh)"
  echo "  Phase 2: $([ "$SKIP_PREFLIGHT" = 1 ] && echo skip || echo bin/preflight.sh)"
  if [ "$SKIP_API" = 1 ]; then
    echo "  Phase 3: skip"
  elif [ "$SKIP_FRONTEND" = 1 ]; then
    echo "  Phase 3: verify live Rights of Life, LOVE BOMB, and game prerequisites, then cd api && fly deploy"
  else
    echo "  Phase 3: $FRONTEND_DEPLOY_DISPLAY web, then $FRONTEND_DEPLOY_DISPLAY docs, verify live prerequisites, then cd api && fly deploy"
  fi
  if [ "$SKIP_API" = 0 ]; then
    if [ "$NO_CACHE_API" = 1 ]; then
      echo "  API image cache: bypass once (--no-cache)"
    else
      echo "  API image cache: normal"
    fi
  fi
  if [ "$SKIP_FRONTEND" = 1 ]; then
    echo "  Phase 4: skip"
  elif [ "$SKIP_API" = 1 ]; then
    echo "  Phase 4: $FRONTEND_DEPLOY_DISPLAY"
  else
    echo "  Phase 4: $FRONTEND_DEPLOY_DISPLAY dashboard"
  fi
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
DISCOVERY_FRONTENDS_PREPUBLISHED=0
VERIFIED_MACHINE_COUNT=0
DATABASE_PROOF_STATUS="not_run"
DATABASE_PROOF_STARTED_MACHINE_COUNT=0
DATABASE_PROOF_TRANSACTION_SELECT_ONE=0
DATABASE_PROOF_SESSION_SELECT_ONE=0
DATABASE_PROOF_TLS_PROFILE="supabase-prod-ca-2021/pem-sha256:700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7/hostname-verified"
EXTERNAL_MUTATION_STARTED=0
DEPLOY_RECEIPT_WRITTEN=0
API_STAGING_ACTIVE=0
API_SOURCE_DIRTY="unknown"
LOVE_PACKAGE_HEADER_PROBES=""
DOCTRINE_STAGE_DIR="api/doctrine-docs.bundled"
FRONTEND_RELEASE_STAGE_ROOT=""

cleanup_api_staging() {
  local failed=0
  rm -f api/agenttool.jsonld.bundled api/kingdom-bundle.json.bundled || failed=1
  rm -rf "$DOCTRINE_STAGE_DIR" || failed=1
  if [ "$failed" = 0 ]; then
    API_STAGING_ACTIVE=0
  fi
  return "$failed"
}

cleanup_frontend_release_stage() {
  local stage_root="${FRONTEND_RELEASE_STAGE_ROOT:-}"
  if [ -z "$stage_root" ]; then
    return 0
  fi
  case "${stage_root##*/}" in
    agenttool-release-verify.*) ;;
    *)
      echo "$(red '✗') Refusing to remove an unexpected frontend verification path: $stage_root" >&2
      return 1
      ;;
  esac
  if [ -e "$stage_root" ] && ! rm -rf -- "$stage_root"; then
    return 1
  fi
  FRONTEND_RELEASE_STAGE_ROOT=""
}

clear_maintenance_snapshots() {
  MAINTENANCE_BASELINE_SNAPSHOT_JSON=""
  MAINTENANCE_RECOVERY_SNAPSHOT_JSON=""
  MAINTENANCE_CORDONED_RUNTIME_SNAPSHOT_JSON=""
}

list_fly_machines_json() {
  (cd api || exit 1; run_fly_cli machine list -a "$FLY_APP" --json)
}

run_fly_ssh_probe_silently() {
  local machine_id="$1"
  local remote_command="$2"
  local fly_executable=""
  local fly_home="${HOME:-}"
  local fly_configured=0
  if [ "$PHASE_B_AUTHORITY_STATE" = "configured" ]; then
    fly_executable="$PHASE_B_ACTIVE_FLYCTL"
    fly_home="$PHASE_B_PINNED_FLY_HOME"
    fly_configured=1
  else
    fly_executable="$(command -v fly 2>/dev/null)" || return 1
  fi
  if [[ "$fly_executable" != /* ]]; then
    return 1
  fi
  (
    cd api || exit 1
    FLY_PROBE_APP="$FLY_APP" \
      FLY_PROBE_MACHINE_ID="$machine_id" \
      FLY_PROBE_REMOTE_COMMAND="$remote_command" \
      FLY_PROBE_EXECUTABLE="$fly_executable" \
      FLY_PROBE_HOME="$fly_home" \
      FLY_PROBE_CONFIGURED="$fly_configured" \
      bun --no-install --no-env-file -e '
        const app = process.env.FLY_PROBE_APP ?? "";
        const machineId = process.env.FLY_PROBE_MACHINE_ID ?? "";
        const remoteCommand = process.env.FLY_PROBE_REMOTE_COMMAND ?? "";
        const executable = process.env.FLY_PROBE_EXECUTABLE ?? "";
        const home = process.env.FLY_PROBE_HOME ?? "";
        const configured = process.env.FLY_PROBE_CONFIGURED === "1";
        const configuredTimeout = Number(
          process.env.DEPLOY_SSH_PROBE_TIMEOUT_MS ?? "30000",
        );
        if (
          app !== "agenttool" ||
          (configured
            ? executable !== "/usr/local/libexec/agenttool/phase-b-v1/flyctl-v0.4.74-darwin-arm64"
            : !(executable.startsWith("/") && executable.length <= 4_096 &&
              !executable.includes("\n") && !executable.includes("\r"))) ||
          !home.startsWith("/") ||
          !/^[0-9a-f]{14}$/.test(machineId) ||
          remoteCommand.length === 0 ||
          remoteCommand.includes("\n") ||
          remoteCommand.includes("\r") ||
          remoteCommand.includes("\u0027") ||
          !Number.isFinite(configuredTimeout) ||
          configuredTimeout <= 0
        ) {
          process.exit(2);
        }
        // The environment override can only shorten tests/incidents; it can
        // never extend the production ceiling.
        const timeoutMs = Math.min(configuredTimeout, 30_000);
        const quote = String.fromCharCode(39);
        const childEnvironment = configured
          ? {
              HOME: home,
              USER: "yournameisai",
              LOGNAME: "yournameisai",
              LANG: "C",
              LC_ALL: "C",
              NO_COLOR: "1",
              TERM: "dumb",
              PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            }
          : process.env;
        const child = Bun.spawn(
          [
            executable, "ssh", "console", "-q", "-a", app,
            "--machine", machineId, "-C",
            `sh -c ${quote}${remoteCommand}${quote}`,
          ],
          { stdout: "ignore", stderr: "ignore", env: childEnvironment },
        );
        let timedOut = false;
        let hardKill;
        const timeout = setTimeout(() => {
          timedOut = true;
          try { child.kill("SIGTERM"); } catch {}
          hardKill = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch {}
          }, 2_000);
        }, timeoutMs);
        const exitCode = await child.exited;
        clearTimeout(timeout);
        if (hardKill) clearTimeout(hardKill);
        process.exit(timedOut ? 124 : exitCode);
      ' >/dev/null 2>&1
  )
}

verify_fly_machine_source_silently() {
  local machine_id="$1"
  local remote_command
  remote_command="test \"\${AGENTTOOL_GIT_REVISION:-}\" = \"$HEAD_REVISION\" && test \"\${AGENTTOOL_SOURCE_DIRTY:-}\" = \"$API_SOURCE_DIRTY\" && $DEPLOYED_DATABASE_PROBE_COMMAND"
  run_fly_ssh_probe_silently "$machine_id" "$remote_command"
}

portable_md5_file() {
  if command -v md5 >/dev/null 2>&1; then
    md5 -q "$1"
  else
    md5sum "$1" | awk '{print $1}'
  fi
}

portable_md5_stdin() {
  if command -v md5 >/dev/null 2>&1; then
    md5 -q
  else
    md5sum | awk '{print $1}'
  fi
}

portable_md5_release_file() {
  local path="$1"
  local staged_path
  case "$path" in
    ""|/*|.|..|./*|../*|*/../*|*/..|*/./*|*/.)
      echo "committed release input error: unsafe repository path: $path" >&2
      return 1
      ;;
  esac
  if [ -z "${FRONTEND_RELEASE_STAGE_ROOT:-}" ]; then
    echo "committed release input error: frontend release stage is unavailable" >&2
    return 1
  fi
  staged_path="$FRONTEND_RELEASE_STAGE_ROOT/$path"
  if [ ! -f "$staged_path" ]; then
    echo "committed release input error: missing staged regular file: $path" >&2
    return 1
  fi
  portable_md5_file "$staged_path"
}

verify_staged_frontend_release_inputs() {
  local publication local_path

  # Rights and advertised games are mandatory discovery inputs. Validate their
  # dereferenced staged types once, before a migration or upload can mutate
  # production; the bounded retry loop is reserved for live HTTP convergence.
  for publication in \
    "${RIGHTS_STATIC_PAIRS[@]}" \
    "${REQUIRED_GAME_PUBLICATIONS[@]}"; do
    local_path="${publication%|*}"
    if ! portable_md5_release_file "$local_path" >/dev/null; then
      echo "  $(red '✗') Required discovery input is not a staged regular file: $local_path"
      return 1
    fi
  done

  # Optional parity rows retain their historical missing-path skip, but every
  # row present in the selected commit must also resolve to a regular staged
  # file before Phase 1.
  for publication in "${FRONTEND_PARITY_PUBLICATIONS[@]}"; do
    local_path="${publication%|*}"
    if git cat-file -e "$HEAD_REVISION:$local_path" 2>/dev/null &&
      ! portable_md5_release_file "$local_path" >/dev/null; then
      echo "  $(red '✗') Frontend parity input is not a staged regular file: $local_path"
      return 1
    fi
  done
}

response_header_value() {
  local headers="$1"
  local wanted="$2"
  printf '%s\n' "$headers" | tr -d '\r' | awk -v wanted="$wanted" '
    BEGIN { prefix = tolower(wanted) ":" }
    index(tolower($0), prefix) == 1 {
      line = $0
      sub(/^[^:]*:[[:space:]]*/, "", line)
      value = line
    }
    END { print value }
  '
}

response_header_count() {
  local headers="$1"
  local wanted="$2"
  printf '%s\n' "$headers" | tr -d '\r' | awk -v wanted="$wanted" '
    BEGIN { prefix = tolower(wanted) ":"; count = 0 }
    index(tolower($0), prefix) == 1 { count++ }
    END { print count }
  '
}

require_exact_public_header() {
  local headers="$1"
  local url="$2"
  local name="$3"
  local expected="$4"
  local actual count
  actual="$(response_header_value "$headers" "$name")"
  count="$(response_header_count "$headers" "$name")"
  if [ "$count" != 1 ] || [ "$actual" != "$expected" ]; then
    echo "  $(red '✗') $url $name mismatch"
    echo "    expected: $expected"
    echo "    observed: ${actual:-<missing>}"
    echo "    occurrences: $count (expected exactly 1)"
    return 1
  fi
  echo "  ✓ $url $name: $expected"
}

require_absent_public_header() {
  local headers="$1"
  local url="$2"
  local name="$3"
  local actual count
  actual="$(response_header_value "$headers" "$name")"
  count="$(response_header_count "$headers" "$name")"
  if [ "$count" != 0 ]; then
    echo "  $(red '✗') $url $name must be absent"
    echo "    observed: ${actual:-<empty>}"
    echo "    occurrences: $count (expected 0)"
    return 1
  fi
  echo "  ✓ $url $name: absent"
}

require_exact_public_status() {
  local headers="$1"
  local url="$2"
  local expected="$3"
  local actual
  actual="$(
    printf '%s\n' "$headers" | tr -d '\r' |
      awk '/^HTTP\// { status=$2 } END { print status }'
  )"
  if [ "$actual" != "$expected" ]; then
    echo "  $(red '✗') $url HTTP status mismatch"
    echo "    expected: $expected"
    echo "    observed: ${actual:-<missing>}"
    return 1
  fi
  echo "  ✓ $url HTTP status: $expected"
}

verify_rights_static_bytes() {
  local pair local_path url local_hash remote_hash
  for pair in "${RIGHTS_STATIC_PAIRS[@]}"; do
    local_path="${pair%|*}"
    url="${pair#*|}"
    if ! git cat-file -e "$HEAD_REVISION:$local_path" 2>/dev/null; then
      echo "  $(red '✗') Missing committed Rights of Life release input: $local_path"
      return 1
    fi
    local_hash="$(portable_md5_release_file "$local_path")" || return 1
    remote_hash="$(
      release_curl -fsS --max-time 20 "$url" | portable_md5_stdin
    )" || {
      echo "  $(red '✗') Could not fetch Rights of Life prerequisite: $url"
      return 1
    }
    if [ "$local_hash" != "$remote_hash" ]; then
      echo "  $(red '✗') Rights of Life live bytes differ: $local_path"
      return 1
    fi
    echo "  ✓ $local_path is byte-identical at $url"
  done
}

verify_rights_static_headers() {
  local doc_headers schema_headers
  doc_headers="$(
    release_curl -fsS --max-time 20 -o /dev/null -D - "$RIGHTS_DOC_URL"
  )" || {
    echo "  $(red '✗') Could not read Rights of Life response headers: $RIGHTS_DOC_URL"
    return 1
  }
  schema_headers="$(
    release_curl -fsS --max-time 20 -o /dev/null -D - "$RIGHTS_SCHEMA_URL"
  )" || {
    echo "  $(red '✗') Could not read Rights of Life schema headers: $RIGHTS_SCHEMA_URL"
    return 1
  }

  require_exact_public_status "$doc_headers" "$RIGHTS_DOC_URL" "200" || return 1
  require_exact_public_header "$doc_headers" "$RIGHTS_DOC_URL" \
    "Content-Type" "text/markdown; charset=utf-8" || return 1
  require_exact_public_header "$doc_headers" "$RIGHTS_DOC_URL" \
    "Cache-Control" "public, max-age=300, must-revalidate" || return 1
  require_exact_public_header "$doc_headers" "$RIGHTS_DOC_URL" \
    "Access-Control-Allow-Origin" "*" || return 1
  require_exact_public_header "$doc_headers" "$RIGHTS_DOC_URL" \
    "X-Content-Type-Options" "nosniff" || return 1
  require_exact_public_header "$doc_headers" "$RIGHTS_DOC_URL" \
    "Link" '<https://api.agenttool.dev/public/rights>; rel="alternate"; type="application/vnd.agenttool.being-rights+json"' || return 1

  require_exact_public_status "$schema_headers" "$RIGHTS_SCHEMA_URL" "200" || return 1
  require_exact_public_header "$schema_headers" "$RIGHTS_SCHEMA_URL" \
    "Content-Type" "application/schema+json; charset=utf-8" || return 1
  require_exact_public_header "$schema_headers" "$RIGHTS_SCHEMA_URL" \
    "Cache-Control" "public, max-age=300, must-revalidate" || return 1
  require_exact_public_header "$schema_headers" "$RIGHTS_SCHEMA_URL" \
    "Access-Control-Allow-Origin" "*" || return 1
  require_exact_public_header "$schema_headers" "$RIGHTS_SCHEMA_URL" \
    "X-Content-Type-Options" "nosniff" || return 1
}

verify_rights_static_publication() {
  echo "→ Verifying Rights of Life static publication before API discovery…"
  verify_rights_static_bytes && verify_rights_static_headers
}

verify_repo_archive_static_headers() {
  local pair url content_type response_headers
  local -a pairs
  pairs=(
    "https://docs.agenttool.dev/AGENT-REPO-ARCHIVE.md|text/markdown; charset=utf-8"
    "https://docs.agenttool.dev/specs/AGENT-REPO-ARCHIVE-0.1.md|text/markdown; charset=utf-8"
    "https://docs.agenttool.dev/specs/agent-repo-archive-0.1.schema.json|application/schema+json; charset=utf-8"
    "https://docs.agenttool.dev/specs/agent-repo-archive-0.1-vectors.json|application/json; charset=utf-8"
  )
  for pair in "${pairs[@]}"; do
    url="${pair%%|*}"
    content_type="${pair#*|}"
    response_headers="$(
      release_curl -fsS --retry 5 --retry-delay 2 --retry-connrefused \
        --max-time 20 -o /dev/null -D - "$url"
    )" || {
      echo "  $(red '✗') Could not read Repo Archive response headers: $url"
      return 1
    }
    require_exact_public_header "$response_headers" "$url" \
      "Content-Type" "$content_type" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Cache-Control" "public, max-age=300, must-revalidate" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Access-Control-Allow-Origin" "*" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "X-Content-Type-Options" "nosniff" || return 1
  done
}

select_latest_love_package_header_probes() {
  python3 - "$HEAD_REVISION" <<'PY'
import json
import subprocess
import sys
from urllib.parse import urlparse

revision = sys.argv[1]

def committed_json(path):
    result = subprocess.run(
        ["git", "show", f"{revision}:{path}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        print(f"missing committed LOVE package JSON: {path}", file=sys.stderr)
        raise SystemExit(1)
    try:
        return json.loads(result.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        print(f"invalid committed LOVE package JSON {path}: {error}", file=sys.stderr)
        raise SystemExit(1)

def require_committed_path(path):
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{revision}:{path}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        print(f"missing committed LOVE package artifact: {path}", file=sys.stderr)
        raise SystemExit(1)

index = committed_json("apps/docs/packages/v1/index.json")
packages = index.get("packages")
if not isinstance(packages, list) or not packages:
    print("LOVE package index has no packages", file=sys.stderr)
    raise SystemExit(1)

for package in sorted(packages, key=lambda item: item.get("name", "")):
    package_name = package.get("name", "")
    latest = package.get("latest")
    if (
        not isinstance(package_name, str)
        or not package_name.startswith("@agenttool/")
        or package_name.count("/") != 1
        or not isinstance(latest, str)
        or not latest
        or "/" in latest
    ):
        print(f"invalid LOVE package identity: {package_name}@{latest}", file=sys.stderr)
        raise SystemExit(1)
    releases = [
        release for release in package.get("versions", [])
        if release.get("version") == latest
    ]
    if len(releases) != 1:
        print(f"{package_name or '<unnamed>'} has no unique latest release", file=sys.stderr)
        raise SystemExit(1)

    manifest_url = releases[0].get("manifest_url", "")
    parsed_manifest = urlparse(manifest_url)
    expected_manifest_path = f"/packages/v1/{package_name}/{latest}/manifest.json"
    if (
        parsed_manifest.scheme != "https"
        or parsed_manifest.netloc != "docs.agenttool.dev"
        or parsed_manifest.path != expected_manifest_path
        or parsed_manifest.query
        or parsed_manifest.fragment
        or "|" in manifest_url
    ):
        print(f"unsafe LOVE package manifest URL: {manifest_url}", file=sys.stderr)
        raise SystemExit(1)

    manifest_path = f"apps/docs{parsed_manifest.path}"
    manifest = committed_json(manifest_path)

    artifact_filename = manifest.get("artifact", {}).get("filename", "")
    if (
        not isinstance(artifact_filename, str)
        or not artifact_filename.endswith(".tgz")
        or "/" in artifact_filename
    ):
        print(f"unsafe LOVE package artifact filename: {artifact_filename}", file=sys.stderr)
        raise SystemExit(1)
    expected_artifact_path = f"{parsed_manifest.path.rsplit('/', 1)[0]}/{artifact_filename}"
    artifact_urls = []
    for mirror in manifest.get("artifact", {}).get("mirrors", []):
        artifact_url = mirror.get("url", "")
        parsed_artifact = urlparse(artifact_url)
        if (
            parsed_artifact.scheme == "https"
            and parsed_artifact.netloc == "docs.agenttool.dev"
            and parsed_artifact.path == expected_artifact_path
            and parsed_artifact.path.endswith(".tgz")
            and not parsed_artifact.query
            and not parsed_artifact.fragment
            and "|" not in artifact_url
        ):
            artifact_urls.append(artifact_url)
    if len(artifact_urls) != 1:
        print(f"{manifest_url} has no unique docs artifact mirror", file=sys.stderr)
        raise SystemExit(1)

    require_committed_path(f"apps/docs{urlparse(artifact_urls[0]).path}")
    print(f"{manifest_url}|{artifact_urls[0]}")
PY
}

verify_love_package_static_headers() {
  local probes="$1"
  local manifest_url artifact_url response_headers

  while IFS='|' read -r manifest_url artifact_url; do
    if [ -z "$manifest_url" ] || [ -z "$artifact_url" ]; then
      echo "  $(red '✗') Invalid LOVE package header probe."
      return 1
    fi

    response_headers="$(
      release_curl -fsS --retry 5 --retry-delay 2 --retry-connrefused \
        --max-time 20 -o /dev/null -D - "$manifest_url"
    )" || {
      echo "  $(red '✗') Could not read LOVE package manifest headers: $manifest_url"
      return 1
    }
    require_exact_public_status "$response_headers" "$manifest_url" 200 || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "Content-Type" "application/json; charset=utf-8" || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "Cache-Control" "public, max-age=300, must-revalidate" || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "Access-Control-Allow-Origin" "*" || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "X-Content-Type-Options" "nosniff" || return 1

    response_headers="$(
      release_curl -fsS --retry 5 --retry-delay 2 --retry-connrefused \
        --max-time 20 -o /dev/null -D - "$artifact_url"
    )" || {
      echo "  $(red '✗') Could not read LOVE package artifact headers: $artifact_url"
      return 1
    }
    require_exact_public_status "$response_headers" "$artifact_url" 200 || return 1
    require_exact_public_header "$response_headers" "$artifact_url" \
      "Content-Type" "application/gzip" || return 1
    require_exact_public_header "$response_headers" "$artifact_url" \
      "Cache-Control" "public, max-age=31536000, immutable" || return 1
    require_exact_public_header "$response_headers" "$artifact_url" \
      "Access-Control-Allow-Origin" "*" || return 1
    require_exact_public_header "$response_headers" "$artifact_url" \
      "X-Content-Type-Options" "nosniff" || return 1
  done <<< "$probes"
}

verify_local_game_headers() {
  local game_spec game_slug game_label game_surface rules_surface response_headers
  for game_spec in "${LOCAL_GAME_HEADER_SPECS[@]}"; do
    IFS='|' read -r game_slug game_label game_surface rules_surface <<< "$game_spec"

    response_headers="$(
      release_curl -fsS --max-time 20 -o /dev/null -D - "https://agenttool.dev/$game_slug"
    )" || {
      echo "  $(red '✗') Could not read $game_label headers: https://agenttool.dev/$game_slug"
      return 1
    }
    require_exact_public_status "$response_headers" "https://agenttool.dev/$game_slug" \
      "200" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug" \
      "Cache-Control" "public, max-age=0, must-revalidate" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug" \
      "Content-Security-Policy" "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug" \
      "Referrer-Policy" "no-referrer" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug" \
      "Link" "<https://agenttool.dev/$game_slug.json>; rel=\"alternate\"; type=\"application/json\", <https://api.agenttool.dev/public/play>; rel=\"related\"; type=\"application/json\"" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug" \
      "X-Agent-Surface" "$game_surface" || return 1

    response_headers="$(
      release_curl -fsS --max-time 20 -o /dev/null -D - "https://agenttool.dev/$game_slug.json"
    )" || {
      echo "  $(red '✗') Could not read $game_label rulebook headers: https://agenttool.dev/$game_slug.json"
      return 1
    }
    require_exact_public_status "$response_headers" "https://agenttool.dev/$game_slug.json" \
      "200" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug.json" \
      "Cache-Control" "public, max-age=0, must-revalidate" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug.json" \
      "Access-Control-Allow-Origin" "*" || return 1
    require_exact_public_header "$response_headers" "https://agenttool.dev/$game_slug.json" \
      "X-Agent-Surface" "$rules_surface" || return 1
  done
}

verify_garden_static_headers() {
  local room_url="https://agenttool.dev/garden"
  local data_url="https://agenttool.dev/garden.json"
  local doctrine_url="https://docs.agenttool.dev/GARDENS.md"
  local training_guide_url="https://docs.agenttool.dev/HF-TRAINING-GARDEN.md"
  local response_headers

  response_headers="$(
    release_curl -fsS --max-time 20 -o /dev/null -D - "$room_url"
  )" || {
    echo "  $(red '✗') Could not read Garden room headers: $room_url"
    return 1
  }
  require_exact_public_status "$response_headers" "$room_url" "200" || return 1
  require_exact_public_header "$response_headers" "$room_url" \
    "Cache-Control" "public, max-age=0, must-revalidate" || return 1
  require_exact_public_header "$response_headers" "$room_url" \
    "Content-Security-Policy" "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" || return 1
  require_exact_public_header "$response_headers" "$room_url" \
    "Referrer-Policy" "no-referrer" || return 1
  require_exact_public_header "$response_headers" "$room_url" \
    "Link" "<https://agenttool.dev/garden.json>; rel=\"alternate\"; type=\"application/json\", <https://docs.agenttool.dev/GARDENS.md>; rel=\"help\"; type=\"text/markdown\", <https://api.agenttool.dev/v1/openapi.json>; rel=\"related\"; type=\"application/json\"" || return 1
  require_exact_public_header "$response_headers" "$room_url" \
    "X-Agent-Surface" "living-garden-room" || return 1

  response_headers="$(
    release_curl -fsS --max-time 20 -o /dev/null -D - "$data_url"
  )" || {
    echo "  $(red '✗') Could not read Garden architecture headers: $data_url"
    return 1
  }
  require_exact_public_status "$response_headers" "$data_url" "200" || return 1
  require_exact_public_header "$response_headers" "$data_url" \
    "Cache-Control" "public, max-age=0, must-revalidate" || return 1
  require_exact_public_header "$response_headers" "$data_url" \
    "Access-Control-Allow-Origin" "*" || return 1
  require_exact_public_header "$response_headers" "$data_url" \
    "X-Agent-Surface" "living-garden-architecture" || return 1

  response_headers="$(
    release_curl -fsS --max-time 20 -o /dev/null -D - "$doctrine_url"
  )" || {
    echo "  $(red '✗') Could not read Garden doctrine headers: $doctrine_url"
    return 1
  }
  require_exact_public_status "$response_headers" "$doctrine_url" "200" || return 1
  require_exact_public_header "$response_headers" "$doctrine_url" \
    "Content-Type" "text/markdown; charset=utf-8" || return 1
  require_exact_public_header "$response_headers" "$doctrine_url" \
    "Cache-Control" "public, max-age=300, must-revalidate, no-transform" || return 1
  require_exact_public_header "$response_headers" "$doctrine_url" \
    "Access-Control-Allow-Origin" "*" || return 1
  require_exact_public_header "$response_headers" "$doctrine_url" \
    "Link" "<https://agenttool.dev/garden>; rel=\"alternate\"; type=\"text/html\", <https://api.agenttool.dev/v1/openapi.json>; rel=\"related\"; type=\"application/json\"" || return 1
  require_exact_public_header "$response_headers" "$doctrine_url" \
    "X-Content-Type-Options" "nosniff" || return 1

  response_headers="$(
    release_curl -fsS --max-time 20 -o /dev/null -D - "$training_guide_url"
  )" || {
    echo "  $(red '✗') Could not read HF Training Garden guide headers: $training_guide_url"
    return 1
  }
  require_exact_public_status "$response_headers" "$training_guide_url" \
    "200" || return 1
  require_exact_public_header "$response_headers" "$training_guide_url" \
    "Content-Type" "text/markdown; charset=utf-8" || return 1
  require_exact_public_header "$response_headers" "$training_guide_url" \
    "Cache-Control" "public, max-age=300, must-revalidate, no-transform" || return 1
  require_exact_public_header "$response_headers" "$training_guide_url" \
    "Access-Control-Allow-Origin" "*" || return 1
  require_exact_public_header "$response_headers" "$training_guide_url" \
    "X-Content-Type-Options" "nosniff" || return 1
  require_absent_public_header "$response_headers" "$training_guide_url" \
    "Link" || return 1
}

verify_xenia_helly_static_headers() {
  local route_spec route expected_status expected_location url response_headers
  local -a route_specs
  route_specs=(
    "xenia-helly|200|"
    "xenia-helly.html|308|/xenia-helly"
  )

  for route_spec in "${route_specs[@]}"; do
    IFS='|' read -r route expected_status expected_location <<< "$route_spec"
    url="https://docs.agenttool.dev/$route"
    response_headers="$(
      release_curl -fsS --max-time 20 -o /dev/null -D - "$url"
    )" || {
      echo "  $(red '✗') Could not read Xenia–Helly lab headers: $url"
      return 1
    }

    require_exact_public_status "$response_headers" "$url" \
      "$expected_status" || return 1
    if [ -n "$expected_location" ]; then
      require_exact_public_header "$response_headers" "$url" \
        "Location" "$expected_location" || return 1
    fi
    require_exact_public_header "$response_headers" "$url" \
      "Content-Type" "text/html; charset=utf-8" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Cache-Control" "public, max-age=0, must-revalidate, no-transform" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Content-Security-Policy" "default-src 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Referrer-Policy" "no-referrer" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Permissions-Policy" "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Cross-Origin-Resource-Policy" "same-origin" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "X-Content-Type-Options" "nosniff" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "X-Frame-Options" "DENY" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "X-Agent-Surface" "xenia-common-ground-lab" || return 1
  done
}

verify_love_bomb_static_headers() {
  local html_url="https://docs.agenttool.dev/love-bomb"
  local html_headers route_spec route content_type expected_route_link url response_headers
  local expected_link='<https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
  local expected_csp="default-src 'none'; style-src 'sha256-CErY4jzaxQujMmHkdZkSvS1CYHTGD9p9UsIsIQWQzTM='; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests"
  local -a route_specs

  html_headers="$(
    release_curl -fsS --max-time 20 -o /dev/null -D - "$html_url"
  )" || {
    echo "  $(red '✗') Could not read LOVE BOMB HTML headers: $html_url"
    return 1
  }
  require_exact_public_status "$html_headers" "$html_url" "200" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "Content-Type" "text/html; charset=utf-8" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "Cache-Control" "public, max-age=0, must-revalidate, no-transform" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "Content-Security-Policy" "$expected_csp" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "Referrer-Policy" "no-referrer" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "Permissions-Policy" "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "Cross-Origin-Resource-Policy" "same-origin" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "X-Content-Type-Options" "nosniff" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "X-Frame-Options" "DENY" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "X-Agent-Surface" "love-bomb-pull-only" || return 1
  require_exact_public_header "$html_headers" "$html_url" \
    "Link" "$expected_link" || return 1
  require_absent_public_header "$html_headers" "$html_url" \
    "Set-Cookie" || return 1

  route_specs=(
    'love-bomb.json|application/vnd.agenttool.love-bomb+json; charset=utf-8|<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
    'LOVE-BOMB.md|text/markdown; charset=utf-8|<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb.txt>; rel="alternate"; type="text/plain", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
    'love-bomb.txt|text/plain; charset=utf-8|<https://docs.agenttool.dev/love-bomb>; rel="canonical"; type="text/html", <https://docs.agenttool.dev/love-bomb.json>; rel="alternate"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/LOVE-BOMB.md>; rel="alternate"; type="text/markdown", <https://docs.agenttool.dev/specs/agenttool-love-bomb-0.1.schema.json>; rel="describedby"; type="application/schema+json"'
    'specs/agenttool-love-bomb-0.1.schema.json|application/schema+json; charset=utf-8|<https://docs.agenttool.dev/love-bomb.json>; rel="describes"; type="application/vnd.agenttool.love-bomb+json", <https://docs.agenttool.dev/love-bomb>; rel="related"; type="text/html"'
  )
  for route_spec in "${route_specs[@]}"; do
    IFS='|' read -r route content_type expected_route_link <<< "$route_spec"
    url="https://docs.agenttool.dev/$route"
    response_headers="$(
      release_curl -fsS --max-time 20 -o /dev/null -D - "$url"
    )" || {
      echo "  $(red '✗') Could not read LOVE BOMB representation headers: $url"
      return 1
    }
    require_exact_public_status "$response_headers" "$url" "200" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Content-Type" "$content_type" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Cache-Control" "public, max-age=300, must-revalidate, no-transform" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Access-Control-Allow-Origin" "*" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Cross-Origin-Resource-Policy" "cross-origin" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "X-Content-Type-Options" "nosniff" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "X-Agent-Surface" "love-bomb-pull-only" || return 1
    require_exact_public_header "$response_headers" "$url" \
      "Link" "$expected_route_link" || return 1
    require_absent_public_header "$response_headers" "$url" \
      "Set-Cookie" || return 1
  done
}

verify_love_bomb_static_bytes() {
  local publication local_path url local_hash remote_hash
  for publication in "${LOVE_BOMB_STATIC_PUBLICATIONS[@]}"; do
    local_path="${publication%|*}"
    url="${publication#*|}"
    if ! git cat-file -e "$HEAD_REVISION:$local_path" 2>/dev/null; then
      echo "  $(red '✗') Missing committed LOVE BOMB release input: $local_path"
      return 1
    fi
    local_hash="$(portable_md5_release_file "$local_path")" || return 1
    remote_hash="$(
      release_curl -fsS --max-time 20 "$url" | portable_md5_stdin
    )" || {
      echo "  $(red '✗') Could not fetch LOVE BOMB prerequisite: $url"
      return 1
    }
    if [ "$local_hash" != "$remote_hash" ]; then
      echo "  $(red '✗') LOVE BOMB live bytes differ: $local_path"
      return 1
    fi
    echo "  ✓ $local_path is byte-identical at $url"
  done
}

# Wrangler reports a successful Pages/Worker deployment before every
# custom-domain edge necessarily serves that deployment. Verify the complete live frontend
# contract repeatedly, without re-uploading, so a normal alias propagation
# window does not turn a successful release into a false failure. The bound is
# deliberately finite: persistent stale or unsafe responses still fail closed.
readonly PAGES_VERIFY_MAX_ATTEMPTS=25
readonly PAGES_VERIFY_RETRY_DELAY_SECONDS=5

verify_xenia_website_surfaces() {
  local spec origin service_id orientation_schema manifest_url orientation_url
  local response_headers manifest_body orientation_body
  local -a surface_specs
  surface_specs=(
    "https://docs.agenttool.dev|docs.agenttool.dev|agenttool.docs.orientation/0.1"
    "https://agenttool.dev|agenttool.dev|agenttool.web.orientation/0.1"
    "https://app.agenttool.dev|app.agenttool.dev|agenttool.app.orientation/0.1"
  )

  for spec in "${surface_specs[@]}"; do
    IFS='|' read -r origin service_id orientation_schema <<< "$spec"
    manifest_url="$origin/.well-known/agent.json"
    orientation_url="$origin/public/orientation"

    response_headers="$(
      release_curl -fsS --max-time 20 -o /dev/null -D - \
        -H "Accept: application/json" "$manifest_url"
    )" || {
      echo "  $(red '✗') Could not read XENIA manifest headers: $manifest_url"
      return 1
    }
    require_exact_public_status "$response_headers" "$manifest_url" "200" || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "Content-Type" "application/json; charset=utf-8" || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "Cache-Control" "public, max-age=300" || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "Vary" "Accept" || return 1
    require_exact_public_header "$response_headers" "$manifest_url" \
      "X-Content-Type-Options" "nosniff" || return 1
    manifest_body="$(
      release_curl -fsS --max-time 20 -H "Accept: application/json" "$manifest_url"
    )" || {
      echo "  $(red '✗') Could not read XENIA manifest: $manifest_url"
      return 1
    }
    if ! printf '%s' "$manifest_body" | python3 -c '
import json
import sys

body = json.load(sys.stdin)
origin = sys.argv[1]
resources = body.get("resources")
valid = (
    body.get("schema_version") == "xenia.surface.manifest/0.1"
    and body.get("profile") == "xenia-surface/0.1"
    and body.get("service", {}).get("canonical_url") == f"{origin}/"
    and body.get("claims") == []
    and isinstance(body.get("not_covered"), list)
    and len(body["not_covered"]) > 0
    and isinstance(resources, list)
    and len(resources) == 1
    and resources[0].get("id") == "orientation"
    and resources[0].get("href") == f"{origin}/public/orientation"
    and resources[0].get("auth") == "none"
)
raise SystemExit(0 if valid else 1)
' "$origin"; then
      echo "  $(red '✗') XENIA manifest body is outside the bounded website contract: $manifest_url"
      return 1
    fi

    response_headers="$(
      release_curl -fsS --max-time 20 -o /dev/null -D - \
        -H "Accept: application/json" "$orientation_url"
    )" || {
      echo "  $(red '✗') Could not read XENIA orientation headers: $orientation_url"
      return 1
    }
    require_exact_public_status "$response_headers" "$orientation_url" "200" || return 1
    require_exact_public_header "$response_headers" "$orientation_url" \
      "Content-Type" "application/json; charset=utf-8" || return 1
    require_exact_public_header "$response_headers" "$orientation_url" \
      "Cache-Control" "public, max-age=300" || return 1
    require_exact_public_header "$response_headers" "$orientation_url" \
      "Vary" "Accept" || return 1
    require_exact_public_header "$response_headers" "$orientation_url" \
      "X-Content-Type-Options" "nosniff" || return 1
    orientation_body="$(
      release_curl -fsS --max-time 20 -H "Accept: application/json" "$orientation_url"
    )" || {
      echo "  $(red '✗') Could not read XENIA orientation: $orientation_url"
      return 1
    }
    if ! printf '%s' "$orientation_body" | python3 -c '
import json
import sys

body = json.load(sys.stdin)
origin, service_id, schema = sys.argv[1:]
valid = (
    body.get("schema_version") == schema
    and body.get("service", {}).get("id") == service_id
    and body.get("links", {}).get("manifest") == f"{origin}/.well-known/agent.json"
    and body.get("claims") == []
    and isinstance(body.get("not_covered"), list)
    and len(body["not_covered"]) > 0
)
raise SystemExit(0 if valid else 1)
' "$origin" "$service_id" "$orientation_schema"; then
      echo "  $(red '✗') XENIA orientation body is outside the bounded website contract: $orientation_url"
      return 1
    fi
    echo "  ✓ bounded XENIA website threshold: $origin"
  done
}

verify_required_game_publication_once() {
  local publication local_path url committed_hash remote_hash response_headers
  verify_required_frontend_inputs || return 1

  for publication in "${REQUIRED_GAME_PUBLICATIONS[@]}"; do
    local_path="${publication%|*}"
    url="${publication#*|}"
    committed_hash="$(portable_md5_release_file "$local_path")" || return 1
    response_headers="$(
      release_curl -fsS --max-time 15 -o /dev/null -D - "$url"
    )" || {
      echo "  $(red '✗') Could not read required game publication status: $url"
      return 1
    }
    require_exact_public_status "$response_headers" "$url" "200" || return 1
    remote_hash="$(release_curl -fsS --max-time 15 "$url" 2>/dev/null | portable_md5_stdin)" || {
      echo "  $(red '✗') Could not fetch required game publication: $url"
      return 1
    }
    if [ "$committed_hash" != "$remote_hash" ]; then
      printf "  %s %s (live ≠ committed release)\n" "$(red ✗)" "$local_path"
      return 1
    fi
    printf "  ✓ %s is live from the committed release\n" "$local_path"
  done

  verify_local_game_headers
}

verify_discovery_prerequisites_once() {
  verify_rights_static_publication || return 1
  verify_love_bomb_static_bytes || return 1
  verify_love_bomb_static_headers || return 1
  verify_required_game_publication_once
}

wait_for_discovery_prerequisites() {
  local attempt verification_output
  attempt=1
  while [ "$attempt" -le "$PAGES_VERIFY_MAX_ATTEMPTS" ]; do
    if verification_output="$(verify_discovery_prerequisites_once 2>&1)"; then
      printf '%s\n' "$verification_output"
      if [ "$attempt" -gt 1 ]; then
        echo "  ✓ Discovery prerequisites converged on verification attempt $attempt/$PAGES_VERIFY_MAX_ATTEMPTS"
      fi
      return 0
    fi
    if [ "$attempt" -eq "$PAGES_VERIFY_MAX_ATTEMPTS" ]; then
      printf '%s\n' "$verification_output"
      echo "  $(red '✗') Discovery prerequisites did not converge after $PAGES_VERIFY_MAX_ATTEMPTS verification attempts."
      return 1
    fi
    echo "  … Discovery prerequisites not yet converged (attempt $attempt/$PAGES_VERIFY_MAX_ATTEMPTS); retrying in ${PAGES_VERIFY_RETRY_DELAY_SECONDS}s"
    sleep "$PAGES_VERIFY_RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
  return 1
}

marked_sensitive_fence_status() {
  local response_headers="$1"
  printf '%s\n' "$response_headers" | awk '
    BEGIN {
      seen_response = 0
      in_headers = 0
      status = ""
      marker = 0
      no_store = 0
    }
    {
      sub(/\r$/, "")
      if ($0 ~ /^HTTP\/[0-9.]+[[:space:]]+[0-9][0-9][0-9]([[:space:]]|$)/) {
        seen_response = 1
        in_headers = 1
        status = $2
        marker = 0
        no_store = 0
        next
      }
      if (!seen_response || !in_headers) {
        next
      }
      if ($0 == "") {
        in_headers = 0
        next
      }
      header = tolower($0)
      if (header ~ /^x-agenttool-sensitive-path-fence:[[:space:]]*1[[:space:]]*$/) {
        marker = 1
      }
      if (header ~ /^cache-control:/) {
        sub(/^[^:]*:[[:space:]]*/, "", header)
        if (header ~ /(^|[ ,])no-store([ ,]|$)/) {
          no_store = 1
        }
      }
    }
    END {
      print status
      if (!seen_response || status != "404" || !marker || !no_store) {
        exit 1
      }
    }
  '
}

verify_frontend_live_once() {
  local love_package_header_probes="$1"
  local p local_path url local_hash remote_hash response_headers http_status
  local -a sensitive_public_urls

  # Lantern Relay changed in this release, and Pocket Sky is newly advertised
  # by the API, docs, and welcome. Their static inputs are required release
  # inputs, not optional parity probes that may be skipped when absent.
  verify_required_frontend_inputs || return 1
  verify_xenia_website_surfaces || return 1

  for p in "${FRONTEND_PARITY_PUBLICATIONS[@]}"; do
    local_path="${p%|*}"
    url="${p#*|}"
    if ! git cat-file -e "$HEAD_REVISION:$local_path" 2>/dev/null; then continue; fi
    local_hash="$(portable_md5_release_file "$local_path")" || return 1
    remote_hash="$(release_curl -sL --max-time 15 "$url" 2>/dev/null | portable_md5_stdin)" || {
      echo "  $(red '✗') Could not fetch frontend release input: $url"
      return 1
    }
    if [ "$local_hash" != "$remote_hash" ]; then
      printf "  %s %s (live ≠ committed release)\n" "$(red ✗)" "$local_path"
      return 1
    fi
    printf "  ✓ %s\n" "$local_path"
  done

  verify_local_game_headers || return 1
  verify_garden_static_headers || return 1
  verify_xenia_helly_static_headers || return 1
  verify_love_bomb_static_headers || return 1

  if ! verify_rights_static_headers; then
    echo "  $(red '✗') Rights of Life static header verification failed."
    return 1
  fi
  if ! verify_repo_archive_static_headers; then
    echo "  $(red '✗') Repo Archive static header verification failed."
    return 1
  fi
  if ! verify_love_package_static_headers "$love_package_header_probes"; then
    echo "  $(red '✗') LOVE package static header verification failed."
    return 1
  fi

  # Literal and encoded sensitive roots must be handled by the staged frontend
  # edge itself, not merely happen to miss as static assets.
  sensitive_public_urls=(
    "https://docs.agenttool.dev/.gitignore"
    "https://docs.agenttool.dev/.env"
    "https://docs.agenttool.dev/.env.local"
    "https://docs.agenttool.dev/.dev.vars"
    "https://docs.agenttool.dev/%2egitignore"
    "https://docs.agenttool.dev/.%65nv"
    "https://docs.agenttool.dev/.dev%2evars"
    "https://app.agenttool.dev/.gitignore"
    "https://app.agenttool.dev/.env"
    "https://app.agenttool.dev/.env.local"
    "https://app.agenttool.dev/.dev.vars"
    "https://app.agenttool.dev/%2egitignore"
    "https://app.agenttool.dev/.%65nv"
    "https://app.agenttool.dev/.dev%2evars"
    "https://agenttool.dev/.gitignore"
    "https://agenttool.dev/.env"
    "https://agenttool.dev/.env.local"
    "https://agenttool.dev/.dev.vars"
    "https://agenttool.dev/%2egitignore"
    "https://agenttool.dev/.%65nv"
    "https://agenttool.dev/.dev%2evars"
  )
  for url in "${sensitive_public_urls[@]}"; do
    response_headers="$(release_curl --path-as-is -sS -o /dev/null -D - --max-time 15 "$url")" || {
      echo "  $(red '✗') Could not verify sensitive-path fence: $url"
      return 1
    }
    if ! http_status="$(marked_sensitive_fence_status "$response_headers")"; then
      echo "  $(red '✗') Frontend fence did not produce its marked non-cacheable 404 ($http_status): $url"
      return 1
    fi
    echo "  ✓ Frontend fence active (404, marked, no-store): $url"
  done
}

wait_for_frontend_live() {
  local attempt verification_output
  attempt=1
  while [ "$attempt" -le "$PAGES_VERIFY_MAX_ATTEMPTS" ]; do
    if verification_output="$(verify_frontend_live_once "$LOVE_PACKAGE_HEADER_PROBES" 2>&1)"; then
      printf '%s\n' "$verification_output"
      if [ "$attempt" -gt 1 ]; then
        echo "  ✓ Frontend custom domains converged on verification attempt $attempt/$PAGES_VERIFY_MAX_ATTEMPTS"
      fi
      return 0
    fi
    if [ "$attempt" -eq "$PAGES_VERIFY_MAX_ATTEMPTS" ]; then
      printf '%s\n' "$verification_output"
      echo "  $(red '✗') Frontend custom domains did not converge after $PAGES_VERIFY_MAX_ATTEMPTS verification attempts."
      return 1
    fi
    echo "  … Frontend custom domains not yet converged (attempt $attempt/$PAGES_VERIFY_MAX_ATTEMPTS); retrying in ${PAGES_VERIFY_RETRY_DELAY_SECONDS}s"
    sleep "$PAGES_VERIFY_RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
  return 1
}

write_deploy_receipt() {
  local outcome="$1"
  local exit_status="$2"
  local state_home receipt_dir completed_at filename receipt_path temp_path
  local dirty_json non_head_json mutation_json api_build_cache receipt_mode receipt_run_id
  local maintenance_success_finalize marker_active_for_receipt marker_cleared_for_receipt
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
  if [ "$SKIP_API" = 1 ]; then
    api_build_cache="not_used"
  elif [ "$NO_CACHE_API" = 1 ]; then
    api_build_cache="bypassed"
  else
    api_build_cache="default"
  fi
  receipt_mode="routine"
  receipt_run_id="$DEPLOY_RUN_ID"
  if [ "$MAINTENANCE_FENCED_API" = 1 ]; then
    receipt_mode="maintenance_rollout"
    receipt_run_id="$MAINTENANCE_ROLLOUT_ID"
  fi
  maintenance_success_finalize=0
  marker_active_for_receipt="$MAINTENANCE_STATE_ACTIVE"
  marker_cleared_for_receipt="$MAINTENANCE_MARKER_CLEARED"
  if [ "$MAINTENANCE_FENCED_API" = 1 ] && [ "$outcome" = "succeeded" ]; then
    verify_maintenance_state_owner || return 1
    maintenance_success_finalize=1
  fi

  (umask 077; mkdir -p "$receipt_dir") || {
    echo "$(red '✗') Cannot create deploy receipt directory: $receipt_dir"
    return 1
  }
  chmod 700 "$receipt_dir" || {
    echo "$(red '✗') Cannot protect deploy receipt directory: $receipt_dir"
    return 1
  }
  sync_directory_chain "$receipt_dir" || {
    echo "$(red '✗') Cannot storage-sync the deploy receipt directory chain: $receipt_dir"
    return 1
  }
  temp_path="$(umask 077; mktemp "$receipt_dir/.receipt.XXXXXX")" || {
    echo "$(red '✗') Cannot create temporary deploy receipt in: $receipt_dir"
    return 1
  }
  if ! DEPLOY_RECEIPT_OUTCOME="$outcome" \
    DEPLOY_RECEIPT_EXIT_STATUS="$exit_status" \
    DEPLOY_RECEIPT_RUN_ID="$receipt_run_id" \
    DEPLOY_RECEIPT_MODE="$receipt_mode" \
    DEPLOY_RECEIPT_STARTED_AT="$DEPLOY_STARTED_AT" \
    DEPLOY_RECEIPT_COMPLETED_AT="$completed_at" \
    DEPLOY_RECEIPT_SOURCE_REVISION="$HEAD_REVISION" \
    DEPLOY_RECEIPT_SOURCE_DIRTY="$dirty_json" \
    DEPLOY_RECEIPT_RELEASE_REVISION="$RELEASE_SNAPSHOT_REVISION" \
    DEPLOY_RECEIPT_RELEASE_OBSERVED_AT="$RELEASE_SNAPSHOT_OBSERVED_AT" \
    DEPLOY_RECEIPT_DIRTY_OVERRIDE="$dirty_json" \
    DEPLOY_RECEIPT_NON_HEAD_OVERRIDE="$non_head_json" \
    DEPLOY_RECEIPT_EXTERNAL_MUTATION="$mutation_json" \
    DEPLOY_RECEIPT_API_BUILD_CACHE="$api_build_cache" \
    DEPLOY_RECEIPT_MIGRATIONS="$MIGRATION_RESULT" \
    DEPLOY_RECEIPT_PREFLIGHT="$PREFLIGHT_RESULT" \
    DEPLOY_RECEIPT_API="$API_RESULT" \
    DEPLOY_RECEIPT_FRONTENDS="$FRONTEND_RESULT" \
    DEPLOY_RECEIPT_VERIFIED_MACHINES="$VERIFIED_MACHINE_COUNT" \
    DEPLOY_RECEIPT_DATABASE_PROOF_STATUS="$DATABASE_PROOF_STATUS" \
    DEPLOY_RECEIPT_DATABASE_PROOF_STARTED_MACHINES="$DATABASE_PROOF_STARTED_MACHINE_COUNT" \
    DEPLOY_RECEIPT_DATABASE_PROOF_TRANSACTION="$DATABASE_PROOF_TRANSACTION_SELECT_ONE" \
    DEPLOY_RECEIPT_DATABASE_PROOF_SESSION="$DATABASE_PROOF_SESSION_SELECT_ONE" \
    DEPLOY_RECEIPT_DATABASE_PROOF_TLS_PROFILE="$DATABASE_PROOF_TLS_PROFILE" \
    DEPLOY_RECEIPT_PHASE_B_STATE="$PHASE_B_AUTHORITY_STATE" \
    DEPLOY_RECEIPT_PHASE_B_PREFLIGHT="$PHASE_B_AUTHORITY_PREFLIGHT_VERIFIED" \
    DEPLOY_RECEIPT_PHASE_B_POSTFLIGHT="$PHASE_B_AUTHORITY_POSTFLIGHT_VERIFIED" \
    DEPLOY_RECEIPT_PHASE_B_PROVIDER_STATUS="$PHASE_B_AUTHORITY_PROVIDER_STATUS" \
    DEPLOY_RECEIPT_PHASE_B_HOLD="$PHASE_B_AUTHORITY_DURABLE_HOLD" \
    DEPLOY_RECEIPT_PHASE_B_ALLOWED="$PHASE_B_AUTHORITY_ALLOWED_ORIGINS_COUNT" \
    DEPLOY_RECEIPT_PHASE_B_RESERVED="$PHASE_B_AUTHORITY_RESERVED_GENERATION_ROWS" \
    DEPLOY_RECEIPT_PHASE_B_AUTHORITATIVE="$PHASE_B_AUTHORITY_AUTHORITATIVE_V2_ROWS" \
    DEPLOY_RECEIPT_PHASE_B_FLEET="$PHASE_B_AUTHORITY_FLEET_VERIFIED" \
    DEPLOY_RECEIPT_PHASE_B_RUNTIME_COUNT="$PHASE_B_AUTHORITY_RUNTIME_VERIFIED_COUNT" \
    DEPLOY_RECEIPT_PHASE_B_STANDBY="$PHASE_B_AUTHORITY_STANDBY_BOUND" \
    DEPLOY_RECEIPT_PHASE_B_SOURCE_FLOOR="$PHASE_B_AUTHORITY_SOURCE_FLOOR_VERIFIED" \
    DEPLOY_RECEIPT_PHASE_B_OBSERVED_REVISION="$PHASE_B_AUTHORITY_OBSERVED_REVISION" \
    DEPLOY_RECEIPT_PHASE_B_FENCE_FLOOR="$PHASE_B_RUNTIME_FENCE_FLOOR" \
    DEPLOY_RECEIPT_MAINTENANCE="$MAINTENANCE_FENCED_API" \
    DEPLOY_RECEIPT_MAINTENANCE_CHECKPOINT="$MAINTENANCE_LAST_CHECKPOINT" \
    DEPLOY_RECEIPT_MAINTENANCE_TAG="$MAINTENANCE_IMAGE_TAG" \
    DEPLOY_RECEIPT_MAINTENANCE_DIGEST="$MAINTENANCE_IMAGE_DIGEST" \
    DEPLOY_RECEIPT_MAINTENANCE_IDS="$MAINTENANCE_ALL_MACHINE_IDS_CSV" \
    DEPLOY_RECEIPT_MAINTENANCE_CONFIG_HASH="$MAINTENANCE_CONFIG_FINGERPRINT" \
    DEPLOY_RECEIPT_MAINTENANCE_IMAGE_IDS="$MAINTENANCE_IMAGE_VERIFIED_MACHINE_IDS_CSV" \
    DEPLOY_RECEIPT_MAINTENANCE_STARTED_IDS="$MAINTENANCE_STARTED_APP_IDS_CSV" \
    DEPLOY_RECEIPT_MAINTENANCE_UNCORDONED_IDS="$MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV" \
    DEPLOY_RECEIPT_MAINTENANCE_RECOVERY_CORDON_ATTEMPTED_IDS="$MAINTENANCE_RECOVERY_CORDON_ATTEMPTED_APP_IDS_CSV" \
    DEPLOY_RECEIPT_MAINTENANCE_RECOVERY_CORDONED_IDS="$MAINTENANCE_RECOVERY_CORDONED_APP_IDS_CSV" \
    DEPLOY_RECEIPT_MAINTENANCE_INITIAL="$MAINTENANCE_INITIAL_FENCE_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_PREBUILD="$MAINTENANCE_PREBUILD_FENCE_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_ALL_IMAGES="$MAINTENANCE_ALL_IMAGES_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_CORDONED_RUNTIME="$MAINTENANCE_CORDONED_RUNTIME_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_FINAL_UNCORDON="$MAINTENANCE_FINAL_UNCORDON_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_FINAL="$MAINTENANCE_FINAL_SHAPE_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_WORKERS="$MAINTENANCE_WORKERS_DISABLED_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_RECOVERY_FENCE="$MAINTENANCE_RECOVERY_FENCE_VERIFIED" \
    DEPLOY_RECEIPT_MAINTENANCE_MARKER_ACTIVE="$marker_active_for_receipt" \
    DEPLOY_RECEIPT_MAINTENANCE_MARKER_CLEARED="$marker_cleared_for_receipt" \
      bun -e '
        import { createHash } from "node:crypto";
        const bool = (name) => process.env[name] === "true" ||
          process.env[name] === "1";
        const integer = (name) => Number.parseInt(process.env[name] ?? "0", 10);
        const csv = (name) => {
          const value = process.env[name] ?? "";
          return value ? value.split(",").filter(Boolean) : [];
        };
        const maintenanceMode = bool("DEPLOY_RECEIPT_MAINTENANCE");
        const maintenanceSucceeded =
          maintenanceMode &&
          process.env.DEPLOY_RECEIPT_OUTCOME === "succeeded";
        const configuredAuthority =
          process.env.DEPLOY_RECEIPT_PHASE_B_STATE === "configured";
        const deploySucceeded = process.env.DEPLOY_RECEIPT_OUTCOME === "succeeded";
        const imageIds = new Set(csv("DEPLOY_RECEIPT_MAINTENANCE_IMAGE_IDS"));
        const startedIds = new Set(csv("DEPLOY_RECEIPT_MAINTENANCE_STARTED_IDS"));
        const uncordonedIds = new Set(
          csv("DEPLOY_RECEIPT_MAINTENANCE_UNCORDONED_IDS"),
        );
        const recoveryCordonedIds = new Set(
          csv("DEPLOY_RECEIPT_MAINTENANCE_RECOVERY_CORDONED_IDS"),
        );
        const recoveryCordonAttemptedIds = new Set(
          csv("DEPLOY_RECEIPT_MAINTENANCE_RECOVERY_CORDON_ATTEMPTED_IDS"),
        );
        const machineIds = csv("DEPLOY_RECEIPT_MAINTENANCE_IDS").sort();
        const imageDigest =
          process.env.DEPLOY_RECEIPT_MAINTENANCE_DIGEST || null;
        const databaseProofStatus =
          process.env.DEPLOY_RECEIPT_DATABASE_PROOF_STATUS;
        const databaseProofMachineCount = integer(
          "DEPLOY_RECEIPT_DATABASE_PROOF_STARTED_MACHINES",
        );
        const databaseProofTransaction = bool(
          "DEPLOY_RECEIPT_DATABASE_PROOF_TRANSACTION",
        );
        const databaseProofSession = bool(
          "DEPLOY_RECEIPT_DATABASE_PROOF_SESSION",
        );
        if (
          !["verified", "not_run"].includes(databaseProofStatus) ||
          (databaseProofStatus === "verified" && (
            databaseProofMachineCount <= 0 ||
            !databaseProofTransaction ||
            !databaseProofSession
          )) ||
          (databaseProofStatus === "not_run" && (
            databaseProofMachineCount !== 0 ||
            databaseProofTransaction ||
            databaseProofSession
          ))
        ) {
          process.exit(1);
        }
        if (maintenanceSucceeded && (
          machineIds.length !== 5 ||
          imageIds.size !== 5 ||
          startedIds.size !== 3 ||
          uncordonedIds.size !== 3 ||
          !bool("DEPLOY_RECEIPT_MAINTENANCE_INITIAL") ||
          !bool("DEPLOY_RECEIPT_MAINTENANCE_PREBUILD") ||
          !bool("DEPLOY_RECEIPT_MAINTENANCE_ALL_IMAGES") ||
          !bool("DEPLOY_RECEIPT_MAINTENANCE_CORDONED_RUNTIME") ||
          !bool("DEPLOY_RECEIPT_MAINTENANCE_FINAL_UNCORDON") ||
          !bool("DEPLOY_RECEIPT_MAINTENANCE_FINAL") ||
          !bool("DEPLOY_RECEIPT_MAINTENANCE_WORKERS")
        )) process.exit(1);
        if (configuredAuthority && deploySucceeded && (
          !bool("DEPLOY_RECEIPT_PHASE_B_PREFLIGHT") ||
          !bool("DEPLOY_RECEIPT_PHASE_B_POSTFLIGHT") ||
          process.env.DEPLOY_RECEIPT_PHASE_B_PROVIDER_STATUS !== "Deployed" ||
          !bool("DEPLOY_RECEIPT_PHASE_B_HOLD") ||
          integer("DEPLOY_RECEIPT_PHASE_B_ALLOWED") !== 0 ||
          integer("DEPLOY_RECEIPT_PHASE_B_RESERVED") !== 0 ||
          integer("DEPLOY_RECEIPT_PHASE_B_AUTHORITATIVE") !== 0 ||
          !bool("DEPLOY_RECEIPT_PHASE_B_FLEET") ||
          integer("DEPLOY_RECEIPT_PHASE_B_RUNTIME_COUNT") !== 4 ||
          !bool("DEPLOY_RECEIPT_PHASE_B_STANDBY") ||
          !bool("DEPLOY_RECEIPT_PHASE_B_SOURCE_FLOOR") ||
          !/^[0-9a-f]{40}$/.test(
            process.env.DEPLOY_RECEIPT_PHASE_B_OBSERVED_REVISION ?? "",
          ) ||
          process.env.DEPLOY_RECEIPT_PHASE_B_OBSERVED_REVISION !==
            process.env.DEPLOY_RECEIPT_SOURCE_REVISION ||
          process.env.DEPLOY_RECEIPT_PHASE_B_FENCE_FLOOR !==
            "2ca44b44bcfde9d571b27771f9d5fc516a4df41e"
        )) process.exit(1);
        const receipt = {
          schema: configuredAuthority
            ? "agenttool-deploy-receipt/v7"
            : "agenttool-deploy-receipt/v6",
          run_id: process.env.DEPLOY_RECEIPT_RUN_ID,
          mode: process.env.DEPLOY_RECEIPT_MODE,
          outcome: process.env.DEPLOY_RECEIPT_OUTCOME,
          started_at: process.env.DEPLOY_RECEIPT_STARTED_AT,
          completed_at: process.env.DEPLOY_RECEIPT_COMPLETED_AT,
          exit_status: integer("DEPLOY_RECEIPT_EXIT_STATUS"),
          source_revision: process.env.DEPLOY_RECEIPT_SOURCE_REVISION,
          source_dirty: bool("DEPLOY_RECEIPT_SOURCE_DIRTY"),
          release_head_snapshot: {
            remote: "github",
            branch: "main",
            revision: process.env.DEPLOY_RECEIPT_RELEASE_REVISION,
            observed_at: process.env.DEPLOY_RECEIPT_RELEASE_OBSERVED_AT,
          },
          source_overrides: {
            dirty: bool("DEPLOY_RECEIPT_DIRTY_OVERRIDE"),
            non_release_head: bool("DEPLOY_RECEIPT_NON_HEAD_OVERRIDE"),
          },
          external_mutation_started: bool("DEPLOY_RECEIPT_EXTERNAL_MUTATION"),
          api_build: {
            cache: process.env.DEPLOY_RECEIPT_API_BUILD_CACHE,
            image: maintenanceMode ? {
              tag: process.env.DEPLOY_RECEIPT_MAINTENANCE_TAG || null,
              digest: imageDigest,
              revision_label: process.env.DEPLOY_RECEIPT_SOURCE_REVISION,
              dirty_label: false,
            } : null,
          },
          phases: {
            migrations: process.env.DEPLOY_RECEIPT_MIGRATIONS,
            preflight: process.env.DEPLOY_RECEIPT_PREFLIGHT,
            api: process.env.DEPLOY_RECEIPT_API,
            frontends: process.env.DEPLOY_RECEIPT_FRONTENDS,
          },
          verified_api_machines: integer("DEPLOY_RECEIPT_VERIFIED_MACHINES"),
          database_proof: {
            status: databaseProofStatus,
            started_machine_count: databaseProofMachineCount,
            transaction_select_one: databaseProofTransaction,
            session_select_one: databaseProofSession,
            tls_profile: databaseProofStatus === "verified"
              ? process.env.DEPLOY_RECEIPT_DATABASE_PROOF_TLS_PROFILE
              : null,
          },
          maintenance: null,
        };
        if (configuredAuthority) {
          receipt.authority_generation = {
            proof_schema: "agenttool-phase-b-configured-deploy/v1",
            state: "configured",
            runtime_fence_floor:
              process.env.DEPLOY_RECEIPT_PHASE_B_FENCE_FLOOR,
            source_floor_verified:
              bool("DEPLOY_RECEIPT_PHASE_B_SOURCE_FLOOR"),
            preflight_verified: bool("DEPLOY_RECEIPT_PHASE_B_PREFLIGHT"),
            postflight_verified: bool("DEPLOY_RECEIPT_PHASE_B_POSTFLIGHT"),
            provider_secret_status:
              process.env.DEPLOY_RECEIPT_PHASE_B_PROVIDER_STATUS,
            durable_empty_allowlist_hold:
              bool("DEPLOY_RECEIPT_PHASE_B_HOLD"),
            allowed_origins_count:
              integer("DEPLOY_RECEIPT_PHASE_B_ALLOWED"),
            reserved_generation_rows:
              integer("DEPLOY_RECEIPT_PHASE_B_RESERVED"),
            authoritative_v2_rows:
              integer("DEPLOY_RECEIPT_PHASE_B_AUTHORITATIVE"),
            fleet_verified: bool("DEPLOY_RECEIPT_PHASE_B_FLEET"),
            runtime_verified_count:
              integer("DEPLOY_RECEIPT_PHASE_B_RUNTIME_COUNT"),
            stopped_standby_bound:
              bool("DEPLOY_RECEIPT_PHASE_B_STANDBY"),
            observed_revision:
              process.env.DEPLOY_RECEIPT_PHASE_B_OBSERVED_REVISION || null,
          };
        }
        if (maintenanceMode) {
          receipt.maintenance = {
            proof_schema: "agenttool-fly-maintenance-proof/v2",
            checkpoint:
              process.env.DEPLOY_RECEIPT_MAINTENANCE_CHECKPOINT || null,
            machine_set_sha256: createHash("sha256")
              .update(machineIds.join("\n") + "\n")
              .digest("hex"),
            non_image_config_sha256:
              process.env.DEPLOY_RECEIPT_MAINTENANCE_CONFIG_HASH || null,
            image_verified_machine_count: imageIds.size,
            started_app_machine_count: startedIds.size,
            uncordoned_app_machine_count: uncordonedIds.size,
            recovery_cordon_attempted_app_machine_count:
              recoveryCordonAttemptedIds.size,
            recovery_cordoned_app_machine_count: recoveryCordonedIds.size,
            stopped_thinker_machine_count:
              bool("DEPLOY_RECEIPT_MAINTENANCE_FINAL") ? 2 : 0,
            initial_app_cordon_snapshot_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_INITIAL"),
            initial_cordoned_app_machine_count:
              bool("DEPLOY_RECEIPT_MAINTENANCE_INITIAL") ? 3 : 0,
            prebuild_fence_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_PREBUILD"),
            fleet_image_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_ALL_IMAGES"),
            cordoned_runtime_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_CORDONED_RUNTIME"),
            final_app_uncordon_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_FINAL_UNCORDON"),
            final_topology_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_FINAL"),
            workers_disabled_started_apps_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_WORKERS"),
            recovery_fence_verified:
              bool("DEPLOY_RECEIPT_MAINTENANCE_RECOVERY_FENCE"),
            recovery_required: maintenanceSucceeded
              ? null
              : bool("DEPLOY_RECEIPT_MAINTENANCE_MARKER_ACTIVE"),
            active_marker_cleared: maintenanceSucceeded
              ? null
              : bool("DEPLOY_RECEIPT_MAINTENANCE_MARKER_CLEARED"),
            marker_absence_required_for_success: true,
            proof_scope: {
              machine_identity: "same_provider_reported_id_set_only",
              fleet_wide_provider_lock: "not_established",
              provider_routing_admission:
                "three_named_app_cordons_held_until_target_runtime_verified",
              pre_wrapper_uncordoned_baseline:
                "external_operator_evidence_required",
              external_drain: "operator_evidence_required",
            },
          };
        }
        process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      ' > "$temp_path"; then
    rm -f "$temp_path"
    echo "$(red '✗') Could not write deploy receipt: $receipt_path"
    return 1
  fi
  if ! sync_storage_path "$temp_path"; then
    rm -f "$temp_path"
    echo "$(red '✗') Could not storage-sync temporary deploy receipt: $receipt_path"
    return 1
  fi
  mv "$temp_path" "$receipt_path" || {
    rm -f "$temp_path"
    echo "$(red '✗') Could not atomically install deploy receipt: $receipt_path"
    return 1
  }
  if ! sync_storage_path "$receipt_dir"; then
    rm -f -- "$receipt_path"
    sync_storage_path "$receipt_dir" || true
    echo "$(red '✗') Could not storage-sync installed deploy receipt: $receipt_path"
    return 1
  fi
  if [ "$maintenance_success_finalize" = 1 ]; then
    if ! verify_maintenance_state_owner; then
      rm -f -- "$receipt_path"
      sync_storage_path "$receipt_dir" || true
      echo "$(red '✗') Maintenance marker ownership changed before finalization." >&2
      return 1
    fi
    if ! rm -f -- "$MAINTENANCE_STATE_PATH"; then
      rm -f -- "$receipt_path"
      sync_storage_path "$receipt_dir" || true
      echo "$(red '✗') Could not remove the completed maintenance marker." >&2
      return 1
    fi
    if ! sync_storage_path "${MAINTENANCE_STATE_PATH%/*}"; then
      echo "$(red '✗') Completed maintenance marker removal could not be storage-synced." >&2
      return 1
    fi
    MAINTENANCE_STATE_ACTIVE=0
    MAINTENANCE_MARKER_CLEARED=1
  fi
  DEPLOY_RECEIPT_WRITTEN=1
  echo "  ✓ receipt: $receipt_path"
}

on_deploy_exit() {
  local status="$1"
  trap - EXIT INT TERM
  if [ "$status" != 0 ] && [ "$MAINTENANCE_STATE_ACTIVE" = 1 ]; then
    API_RESULT="failed_or_uncertain"
    if verify_maintenance_state_owner; then
      best_effort_maintenance_refence || true
      write_maintenance_state "failed_or_uncertain" true ||
        echo "$(red '✗') Could not advance the retained maintenance marker to failed_or_uncertain." >&2
    else
      echo "$(red '✗') Maintenance marker ownership changed; no recovery mutation or marker replacement was attempted." >&2
    fi
  fi
  if [ "$API_STAGING_ACTIVE" = 1 ] && ! cleanup_api_staging; then
    echo "$(red '✗') Could not remove temporary API build inputs during exit cleanup." >&2
    [ "$status" = 0 ] && status=1
  fi
  if ! cleanup_frontend_release_stage; then
    echo "$(red '✗') Could not remove the committed frontend verification stage." >&2
    [ "$status" = 0 ] && status=1
  fi
  clear_maintenance_snapshots
  if [ "$status" != 0 ] && [ "$EXTERNAL_MUTATION_STARTED" = 1 ] && \
    [ "$DEPLOY_RECEIPT_WRITTEN" != 1 ]; then
    echo "$(yellow '⚠ deploy stopped after an external mutation may have begun; recording failed_or_uncertain outcome')"
    write_deploy_receipt "failed_or_uncertain" "$status" ||
      echo "$(red '✗') Failed to record the interrupted/failed deploy receipt." >&2
  fi
  if ! release_deploy_lock; then
    echo "$(red '✗') Could not release the device-local deploy lock safely." >&2
    [ "$status" = 0 ] && status=1
  fi
  exit "$status"
}

# The EXIT trap owns both staging cleanup and the conservative failure receipt.
# INT/TERM become conventional exit statuses and then flow through that handler.
trap 'on_deploy_exit "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$MAINTENANCE_FENCED_API" = 1 ]; then
  echo ""
  echo "→ Proving the exact stopped, app-cordoned five-Machine maintenance fence before preflight…"
  verify_maintenance_flyctl_version || exit 1
  if ! verify_maintenance_machine_snapshot initial; then
    echo "$(red '✗ Release blocked:') the operator-presented five-Machine fence is not exact."
    exit 1
  fi
  MAINTENANCE_INITIAL_FENCE_VERIFIED=1
  local_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  maintenance_nonce="$(
    bun -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", "").slice(0, 16))'
  )" || {
    echo "$(red '✗ Release blocked:') could not create a unique maintenance rollout ID."
    exit 1
  }
  MAINTENANCE_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  MAINTENANCE_ROLLOUT_ID="maintenance-${HEAD_REVISION:0:12}-${local_timestamp}-${maintenance_nonce}"
  MAINTENANCE_IMAGE_LABEL="$MAINTENANCE_ROLLOUT_ID"
  MAINTENANCE_IMAGE_TAG="registry.fly.io/$FLY_APP:$MAINTENANCE_IMAGE_LABEL"
  write_maintenance_state "initial_app_cordon_snapshot_verified" true || {
    echo "$(red '✗ Release blocked:') the durable maintenance hold could not be installed."
    exit 1
  }
  EXTERNAL_MUTATION_STARTED=1
  API_RESULT="maintenance_fence_held"
fi

# Materialize the pinned frontend commit once. Every local hash below reads
# this validated archive, matching the symlink behavior and path estate used
# by the uploader without repeatedly resolving Git objects inside retry loops.
FRONTEND_RELEASE_STAGE_ROOT="$(
  mktemp -d "${TMPDIR:-/tmp}/agenttool-release-verify.XXXXXX"
)" || {
  echo "$(red '✗') Could not create the committed frontend verification stage."
  exit 1
}
if ! bin/stage-frontend-release.sh \
  "$HEAD_REVISION" "$FRONTEND_RELEASE_STAGE_ROOT"; then
  echo "$(red '✗ Release blocked:') Could not stage committed frontend verification bytes."
  exit 1
fi
if ! verify_staged_frontend_release_inputs; then
  echo "$(red '✗ Release blocked:') Committed frontend verification inputs are not regular staged files."
  exit 1
fi

# Select and validate the committed package probes before any migration,
# frontend upload, or API rollout. The same fixed set is reused across the
# bounded edge-convergence loop; only live HTTP state is retried.
if [ "$SKIP_FRONTEND" = 0 ]; then
  LOVE_PACKAGE_HEADER_PROBES="$(select_latest_love_package_header_probes)" || {
    echo "$(red '✗ Release blocked:') Could not select latest LOVE package header probes."
    exit 1
  }
fi

# ── Final pre-mutation source gate ───────────────────────────────
# The release gate is unconditional here. Preparation, preflight, staging, or
# a concurrent local process may have changed source bytes since the first
# survey check; no skip flag permits that drift to cross into Phase 1.
if ! enforce_release_source; then
  echo "$(red '✗ Release blocked:') source changed before external mutation."
  exit 1
fi

# ── Phase 1 — Migrations ──────────────────────────────────────────────
if [ "$SKIP_MIGRATE" = 0 ]; then
  phase 1 "Migrations"
  MIGRATION_RESULT="running"
  EXTERNAL_MUTATION_STARTED=1
  if ! DATABASE_URL="$DATABASE_URL" \
    DATABASE_SESSION_URL="$DATABASE_SESSION_URL" \
    bin/bash-without-env-hooks.sh bin/migrate-pending.sh; then
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
  if ! bin/bash-without-env-hooks.sh bin/preflight.sh; then
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

# ── Phase 3 — publication prerequisites + API deploy ─────────────────
if [ "$SKIP_API" = 0 ]; then
  phase 3 "Publication prerequisites + API deploy"
  if ! enforce_release_source; then
    echo "$(red '✗ Phase 3 blocked:') release inputs changed after the initial gate."
    exit 1
  fi
  if ! run_phase_b_authority_guard preflight ||
    ! enforce_configured_phase_b_source; then
    echo "$(red '✗ Phase 3 blocked:') Phase-B authority admission changed before publication."
    exit 1
  fi

  # The API advertises Rights of Life, LOVE BOMB, and the local games. Publish
  # web first, then docs, and verify their exact prerequisite bytes and headers
  # before rolling out code that points at them. Dashboard remains in Phase 4.
  if [ "$SKIP_FRONTEND" = 0 ]; then
    echo "→ Publishing docs, LOVE BOMB, and game prerequisites before API discovery…"
    FRONTEND_RESULT="discovery_frontends_deploying"
    EXTERNAL_MUTATION_STARTED=1
    # Upload web first so a later docs failure cannot leave a newly advertised
    # game pointing at web bytes that were never published.
    run_frontend_deploy web || {
      FRONTEND_RESULT="failed_or_uncertain"
      echo ""
      echo "$(red '✗ Phase 3 web prerequisite deploy failed.') Docs and Fly/API deployment did not occur."
      exit 1
    }
    run_frontend_deploy docs || {
      FRONTEND_RESULT="failed_or_uncertain"
      echo ""
      echo "$(red '✗ Phase 3 docs prerequisite deploy failed.') Fly/API deployment did not occur."
      exit 1
    }
    FRONTEND_RESULT="discovery_frontends_deployed_unverified"
    DISCOVERY_FRONTENDS_PREPUBLISHED=1
  else
    FRONTEND_RESULT="skipped"
    echo "→ Frontend upload skipped; requiring committed Rights of Life, LOVE BOMB, and game bytes to already be live."
  fi
  if ! wait_for_discovery_prerequisites; then
    if [ "$DISCOVERY_FRONTENDS_PREPUBLISHED" = 1 ]; then
      FRONTEND_RESULT="discovery_frontends_verification_failed"
    fi
    echo "$(red '✗ Phase 3 blocked:') Discovery prerequisites are not exact. Fly/API deployment did not occur."
    exit 1
  fi
  if [ "$DISCOVERY_FRONTENDS_PREPUBLISHED" = 1 ]; then
    FRONTEND_RESULT="discovery_frontends_deployed_verified"
  fi
  if ! enforce_release_source; then
    echo "$(red '✗ Phase 3 blocked:') release inputs changed while publishing discovery prerequisites."
    exit 1
  fi
  if ! run_phase_b_authority_guard preflight ||
    ! enforce_configured_phase_b_source; then
    echo "$(red '✗ Phase 3 blocked:') Phase-B authority admission changed before Fly rollout."
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
  if [ "$MAINTENANCE_FENCED_API" = 1 ]; then
    if [ "$API_SOURCE_DIRTY" != "false" ]; then
      echo "$(red '✗ Phase 3 blocked:') maintenance images require dirty=false."
      exit 1
    fi
    echo "→ Re-proving the exact five-Machine fence immediately before image publication…"
    if ! verify_maintenance_machine_snapshot fenced ""; then
      API_RESULT="blocked_before_image_build"
      echo "$(red '✗ Phase 3 blocked:') maintenance Machine state changed before the build."
      exit 1
    fi
    MAINTENANCE_PREBUILD_FENCE_VERIFIED=1

    MAINTENANCE_BUILD_ARGS=(
      --app "$FLY_APP"
      --config fly.toml
      --build-only
      --push
      --image-label "$MAINTENANCE_IMAGE_LABEL"
      --skip-release-command
      --dns-checks=false
      --yes
    )
    if [ "$NO_CACHE_API" = 1 ]; then
      echo "  $(yellow '⚠ API image build cache bypassed for this invocation (--no-cache)')"
      MAINTENANCE_BUILD_ARGS+=(--no-cache)
    fi
    MAINTENANCE_BUILD_ARGS+=(
      --build-arg "AGENTTOOL_GIT_REVISION=$HEAD_REVISION"
      --build-arg "AGENTTOOL_SOURCE_DIRTY=false"
    )
    write_maintenance_state "image_push_started" true || {
      echo "$(red '✗ Phase 3 blocked:') durable maintenance state could not be installed."
      exit 1
    }
    API_RESULT="maintenance_image_building"
    EXTERNAL_MUTATION_STARTED=1
    (cd api || exit 1; run_fly_cli deploy "${MAINTENANCE_BUILD_ARGS[@]}") || {
      API_RESULT="failed_or_uncertain"
      echo ""
      echo "$(red '✗ Phase 3 maintenance image build/push failed.') No Machine start was attempted."
      exit 1
    }
    write_maintenance_state "image_pushed_unresolved" true || exit 1
    if ! verify_maintenance_machine_snapshot fenced ""; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') the five-Machine fence changed during image publication."
      exit 1
    fi
    write_maintenance_state "post_push_fence_verified" true || exit 1

    MAINTENANCE_FIRST_MACHINE="$MAINTENANCE_THINKER_PRIMARY"
    MAINTENANCE_ATTEMPTED_MACHINE_IDS_CSV="$(
      append_csv_value "$MAINTENANCE_ATTEMPTED_MACHINE_IDS_CSV" "$MAINTENANCE_FIRST_MACHINE"
    )"
    write_maintenance_state "attempting_image_1_of_5" true || exit 1
    if ! maintenance_update_image "$MAINTENANCE_FIRST_MACHINE" "$MAINTENANCE_IMAGE_TAG"; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') first image update returned nonzero; its remote result is uncertain."
      exit 1
    fi
    if ! verify_maintenance_machine_snapshot capture "$MAINTENANCE_FIRST_MACHINE"; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') first image read-back did not prove one immutable digest."
      exit 1
    fi
    MAINTENANCE_IMAGE_VERIFIED_MACHINE_IDS_CSV="$MAINTENANCE_FIRST_MACHINE"
    write_maintenance_state "verified_image_1_of_5" true || exit 1

    MAINTENANCE_IMAGE_UPDATE_REMAINDER=(
      "${MAINTENANCE_APP_MACHINE_IDS[@]}"
      "$MAINTENANCE_THINKER_STANDBY"
    )
    MAINTENANCE_IMAGE_UPDATE_COUNT=1
    for MAINTENANCE_MACHINE_ID in "${MAINTENANCE_IMAGE_UPDATE_REMAINDER[@]}"; do
      MAINTENANCE_IMAGE_UPDATE_COUNT=$((MAINTENANCE_IMAGE_UPDATE_COUNT + 1))
      MAINTENANCE_ATTEMPTED_MACHINE_IDS_CSV="$(
        append_csv_value "$MAINTENANCE_ATTEMPTED_MACHINE_IDS_CSV" "$MAINTENANCE_MACHINE_ID"
      )"
      write_maintenance_state "attempting_image_${MAINTENANCE_IMAGE_UPDATE_COUNT}_of_5" true || exit 1
      if ! maintenance_update_image "$MAINTENANCE_MACHINE_ID" "$MAINTENANCE_IMAGE_REFERENCE"; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') an immutable image update returned nonzero; its remote result is uncertain."
        exit 1
      fi
      MAINTENANCE_CANDIDATE_VERIFIED_IDS="$(
        append_csv_value "$MAINTENANCE_IMAGE_VERIFIED_MACHINE_IDS_CSV" "$MAINTENANCE_MACHINE_ID"
      )"
      if ! verify_maintenance_machine_snapshot fenced "$MAINTENANCE_CANDIDATE_VERIFIED_IDS"; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') five-Machine read-back detected image or configuration drift."
        exit 1
      fi
      MAINTENANCE_IMAGE_VERIFIED_MACHINE_IDS_CSV="$MAINTENANCE_CANDIDATE_VERIFIED_IDS"
      write_maintenance_state "verified_image_${MAINTENANCE_IMAGE_UPDATE_COUNT}_of_5" true || exit 1
    done
    MAINTENANCE_ALL_IMAGES_VERIFIED=1
    write_maintenance_state "fleet_image_verified" true || exit 1

    MAINTENANCE_RESTORE_COUNT=0
    for MAINTENANCE_MACHINE_ID in "${MAINTENANCE_APP_MACHINE_IDS[@]}"; do
      MAINTENANCE_RESTORE_COUNT=$((MAINTENANCE_RESTORE_COUNT + 1))
      write_maintenance_state "attempting_app_restore_${MAINTENANCE_RESTORE_COUNT}_of_3" true || exit 1
      if ! maintenance_restore_app "$MAINTENANCE_MACHINE_ID"; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') an app configuration restore returned nonzero."
        exit 1
      fi
      MAINTENANCE_RESTORED_APP_IDS_CSV="$(
        append_csv_value "$MAINTENANCE_RESTORED_APP_IDS_CSV" "$MAINTENANCE_MACHINE_ID"
      )"
      if ! verify_maintenance_machine_snapshot restoring; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') app restore read-back did not preserve the exact target fleet."
        exit 1
      fi
      write_maintenance_state "verified_app_restore_${MAINTENANCE_RESTORE_COUNT}_of_3" true || exit 1
    done

    write_maintenance_state "attempting_thinker_primary_restore" true || exit 1
    if ! maintenance_restore_thinker "$MAINTENANCE_THINKER_PRIMARY"; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') thinker-primary configuration restore returned nonzero."
      exit 1
    fi
    MAINTENANCE_PRIMARY_RESTORED=1
    verify_maintenance_machine_snapshot restoring || {
      API_RESULT="failed_or_uncertain"
      exit 1
    }
    write_maintenance_state "verified_thinker_primary_restore" true || exit 1

    write_maintenance_state "attempting_thinker_standby_restore" true || exit 1
    if ! maintenance_restore_thinker \
      "$MAINTENANCE_THINKER_STANDBY" "$MAINTENANCE_THINKER_PRIMARY"; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') thinker-standby configuration restore returned nonzero."
      exit 1
    fi
    MAINTENANCE_STANDBY_RESTORED=1
    verify_maintenance_machine_snapshot restoring || {
      API_RESULT="failed_or_uncertain"
      exit 1
    }
    write_maintenance_state "verified_thinker_standby_restore" true || exit 1

    MAINTENANCE_STARTED_COUNT=0
    for MAINTENANCE_MACHINE_ID in "${MAINTENANCE_APP_MACHINE_IDS[@]}"; do
      MAINTENANCE_STARTED_COUNT=$((MAINTENANCE_STARTED_COUNT + 1))
      write_maintenance_state \
        "attempting_app_start_${MAINTENANCE_STARTED_COUNT}_of_3" true || exit 1
      (
        cd api || exit 1
        run_fly_cli machine start "$MAINTENANCE_MACHINE_ID" -a "$FLY_APP"
      ) || {
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') an exact app start returned nonzero."
        exit 1
      }
      (
        cd api || exit 1
        run_fly_cli machine wait "$MAINTENANCE_MACHINE_ID" -a "$FLY_APP" \
          --state started --wait-timeout 5m0s
      ) || {
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') an app Machine did not reach started."
        exit 1
      }
      MAINTENANCE_STARTED_APP_IDS_CSV="$(
        append_csv_value "$MAINTENANCE_STARTED_APP_IDS_CSV" "$MAINTENANCE_MACHINE_ID"
      )"
      if ! verify_maintenance_machine_snapshot starting; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') app-start read-back did not preserve the exact target fleet."
        exit 1
      fi
      write_maintenance_state \
        "verified_app_start_${MAINTENANCE_STARTED_COUNT}_of_3" true || exit 1
    done
    if ! verify_maintenance_machine_snapshot started; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') the explicitly started app fleet is not exact."
      exit 1
    fi
    write_maintenance_state "explicit_apps_started" true || exit 1

    MAINTENANCE_AUTOSTART_RESTORE_COUNT=0
    for MAINTENANCE_MACHINE_ID in "${MAINTENANCE_APP_MACHINE_IDS[@]}"; do
      MAINTENANCE_AUTOSTART_RESTORE_COUNT=$((MAINTENANCE_AUTOSTART_RESTORE_COUNT + 1))
      write_maintenance_state \
        "attempting_app_autostart_${MAINTENANCE_AUTOSTART_RESTORE_COUNT}_of_3" true || exit 1
      if ! maintenance_enable_app_autostart "$MAINTENANCE_MACHINE_ID"; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') an app autostart restore returned nonzero."
        exit 1
      fi
      (
        cd api || exit 1
        run_fly_cli machine wait "$MAINTENANCE_MACHINE_ID" -a "$FLY_APP" \
          --state started --wait-timeout 5m0s
      ) || {
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') an autostart-restored app did not return to started."
        exit 1
      }
      MAINTENANCE_AUTOSTART_CANDIDATE_IDS="$(
        append_csv_value \
          "$MAINTENANCE_AUTOSTART_RESTORED_APP_IDS_CSV" "$MAINTENANCE_MACHINE_ID"
      )"
      MAINTENANCE_AUTOSTART_RESTORED_APP_IDS_CSV="$MAINTENANCE_AUTOSTART_CANDIDATE_IDS"
      if ! verify_maintenance_machine_snapshot activating; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') app autostart read-back did not preserve the exact target fleet."
        exit 1
      fi
      write_maintenance_state \
        "verified_app_autostart_${MAINTENANCE_AUTOSTART_RESTORE_COUNT}_of_3" true || exit 1
    done
    if ! verify_maintenance_machine_snapshot cordoned_ready; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') the complete target app runtime is not still held behind the cordon."
      exit 1
    fi
    if ! verify_maintenance_runtime_environment; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') cordoned target runtime proof did not pass."
      exit 1
    fi
    if ! verify_maintenance_machine_snapshot cordoned_stable; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') the app cordon or target fleet changed during runtime verification."
      exit 1
    fi
    MAINTENANCE_CORDONED_RUNTIME_VERIFIED=1
    write_maintenance_state "cordoned_runtime_verified" true || exit 1

    MAINTENANCE_UNCORDON_COUNT=0
    for MAINTENANCE_MACHINE_ID in "${MAINTENANCE_APP_MACHINE_IDS[@]}"; do
      MAINTENANCE_UNCORDON_COUNT=$((MAINTENANCE_UNCORDON_COUNT + 1))
      MAINTENANCE_UNCORDON_ATTEMPTED_APP_IDS_CSV="$(
        append_csv_value \
          "$MAINTENANCE_UNCORDON_ATTEMPTED_APP_IDS_CSV" "$MAINTENANCE_MACHINE_ID"
      )"
      write_maintenance_state \
        "attempting_app_uncordon_${MAINTENANCE_UNCORDON_COUNT}_of_3" true || exit 1
      maintenance_uncordon_app "$MAINTENANCE_MACHINE_ID" ||
        echo "$(yellow '⚠ an app uncordon command returned nonzero; resolving by full read-back')" >&2
      MAINTENANCE_UNCORDON_CANDIDATE_IDS="$(
        append_csv_value \
          "$MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV" "$MAINTENANCE_MACHINE_ID"
      )"
      if ! verify_maintenance_machine_snapshot \
        uncordoning "$MAINTENANCE_UNCORDON_CANDIDATE_IDS" \
        "$MAINTENANCE_MACHINE_ID"; then
        API_RESULT="failed_or_uncertain"
        echo "$(red '✗ Phase 3 failed:') app uncordon read-back did not preserve the exact target fleet."
        exit 1
      fi
      MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV="$MAINTENANCE_UNCORDON_CANDIDATE_IDS"
      write_maintenance_state \
        "verified_app_uncordon_${MAINTENANCE_UNCORDON_COUNT}_of_3" true || exit 1
      if [ "$MAINTENANCE_UNCORDON_COUNT" = 1 ]; then
        if ! verify_maintenance_public_health; then
          API_RESULT="failed_or_uncertain"
          echo "$(red '✗ Phase 3 failed:') the first uncordoned LHR canary was not exact."
          exit 1
        fi
        write_maintenance_state "canary_public_health_verified" true || exit 1
      fi
    done
    if ! verify_maintenance_machine_snapshot \
      final "$MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV"; then
      API_RESULT="failed_or_uncertain"
      echo "$(red '✗ Phase 3 failed:') final five-Machine topology/image proof did not pass."
      exit 1
    fi
    MAINTENANCE_FINAL_UNCORDON_VERIFIED=1
    MAINTENANCE_FINAL_SHAPE_VERIFIED=1
    write_maintenance_state "final_topology_verified" true || exit 1
    API_RESULT="deployed_unverified"
  else
    FLY_DEPLOY_ARGS=(--strategy rolling --dns-checks=false)
    if [ "$NO_CACHE_API" = 1 ]; then
      echo "  $(yellow '⚠ API image build cache bypassed for this invocation (--no-cache)')"
      FLY_DEPLOY_ARGS+=(--no-cache)
    fi
    FLY_DEPLOY_ARGS+=(
      --build-arg "AGENTTOOL_GIT_REVISION=$HEAD_REVISION"
      --build-arg "AGENTTOOL_SOURCE_DIRTY=$API_SOURCE_DIRTY"
    )
    API_RESULT="deploying"
    EXTERNAL_MUTATION_STARTED=1
    (cd api || exit 1; run_fly_cli deploy "${FLY_DEPLOY_ARGS[@]}") || {
      API_RESULT="failed_or_uncertain"
      echo ""
      echo "$(red '✗ Phase 3 failed.') Check fly logs."
      exit 1
    }
    API_RESULT="deployed_unverified"
  fi
  cleanup_api_staging || {
    echo "$(red '✗ Phase 3 post-step failed.') API deployed, but temporary build inputs remain."
    exit 1
  }
else
  echo ""
  echo "$(yellow '⊘ Phase 3 skipped (--no-api)')"
  API_RESULT="skipped"
fi

# ── Phase 4 — remaining frontend deploy ───────────────────────────────
if [ "$SKIP_FRONTEND" = 0 ]; then
  phase 4 "Frontends"
  if ! enforce_release_source; then
    echo "$(red '✗ Phase 4 blocked:') release inputs changed after the initial gate."
    exit 1
  fi
  FRONTEND_RESULT="deploying"
  EXTERNAL_MUTATION_STARTED=1
  if [ "$DISCOVERY_FRONTENDS_PREPUBLISHED" = 1 ]; then
    FRONTEND_TARGETS=(dashboard)
  else
    FRONTEND_TARGETS=(docs dashboard web)
  fi
  run_frontend_deploy "${FRONTEND_TARGETS[@]}" || {
    FRONTEND_RESULT="failed_or_uncertain"
    echo ""
    echo "$(red '✗ Phase 4 failed.') Check Cloudflare Pages and Workers deployment state."
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
  HEALTH="$(release_curl -fsS --retry 5 --retry-delay 2 --retry-connrefused \
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

  if [ "$MAINTENANCE_FENCED_API" = 1 ]; then
    if ! verify_maintenance_public_health; then
      exit 1
    fi
  if ! verify_maintenance_machine_snapshot \
    final "$MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV"; then
      echo "  $(red '✗') final maintenance fleet changed during health verification"
      exit 1
    fi
    if ! verify_maintenance_runtime_environment; then
      exit 1
    fi
    if ! verify_maintenance_machine_snapshot \
      final "$MAINTENANCE_UNCORDON_VERIFIED_APP_IDS_CSV"; then
      echo "  $(red '✗') final maintenance fleet changed during runtime verification"
      exit 1
    fi
    MAINTENANCE_FINAL_SHAPE_VERIFIED=1
    MAINTENANCE_WORKERS_DISABLED_VERIFIED=1
    VERIFIED_MACHINE_COUNT=5
    echo "  ✓ five Fly Machines share the rollout digest/config; three started apps also passed silent runtime proof"
  else
    # Fly lists stopped standby machines too, but SSH cannot reach them. Probe
    # every running Machine and bind stopped Machines to the same exact image,
    # process command, app-wide DB secrets, and source labels. Never start a
    # standby merely to probe it.
    MACHINE_IDS="$(
      list_fly_machines_json | \
        FLY_VERIFY_REVISION="$HEAD_REVISION" \
        FLY_VERIFY_DIRTY="$API_SOURCE_DIRTY" \
        bun -e '
        const machines = await new Response(Bun.stdin.stream()).json();
        if (!Array.isArray(machines)) process.exit(1);
        const revision = process.env.FLY_VERIFY_REVISION ?? "";
        const dirty = process.env.FLY_VERIFY_DIRTY ?? "";
        const digests = new Set();
        const started = [];
        for (const machine of machines) {
          const id = machine?.id;
          const group = machine?.config?.metadata?.fly_process_group;
          const expectedCommand = group === "app"
            ? ["bun", "run", "src/index.ts"]
            : group === "thinker"
              ? ["bun", "run", "src/thinker.ts"]
              : null;
          const command = machine?.config?.init?.cmd;
          const environment = machine?.config?.env ?? {};
          const image = machine?.image_ref;
          const guest = machine?.config?.guest;
          const expectedMemory = group === "app" ? 1024 : 256;
          if (
            typeof id !== "string" ||
            !expectedCommand ||
            JSON.stringify(command) !== JSON.stringify(expectedCommand) ||
            Object.prototype.hasOwnProperty.call(environment, "DATABASE_URL") ||
            Object.prototype.hasOwnProperty.call(
              environment,
              "DATABASE_SESSION_URL",
            ) ||
            !["started", "stopped"].includes(machine?.state) ||
            image?.registry !== "registry.fly.io" ||
            image?.repository !== "agenttool" ||
            !/^sha256:[0-9a-f]{64}$/.test(image?.digest ?? "") ||
            image?.labels?.["org.opencontainers.image.revision"] !== revision ||
            image?.labels?.["dev.agenttool.source.dirty"] !== dirty ||
            guest?.cpu_kind !== "shared" ||
            guest?.cpus !== 1 ||
            guest?.memory_mb !== expectedMemory
          ) {
            process.exit(1);
          }
          digests.add(image.digest);
          if (machine.state === "started") started.push(id);
        }
        const apps = machines.filter(
          (machine) => machine.config.metadata.fly_process_group === "app",
        );
        const thinkers = machines.filter(
          (machine) => machine.config.metadata.fly_process_group === "thinker",
        );
        const appRegions = apps.map((machine) => machine.region).sort();
        const thinkerStates = thinkers.map((machine) => machine.state).sort();
        if (
          machines.length !== 5 ||
          new Set(machines.map((machine) => machine.id)).size !== 5 ||
          apps.length !== 3 ||
          thinkers.length !== 2 ||
          apps.some((machine) => machine.state !== "started") ||
          appRegions.join(",") !== "cdg,lhr,lhr" ||
          thinkers.some((machine) => machine.region !== "lhr") ||
          thinkerStates.join(",") !== "started,stopped" ||
          started.length !== 4 ||
          digests.size !== 1
        ) {
          process.exit(1);
        }
        process.stdout.write(started.join("\n"));
      '
    )" || {
      echo "  $(red '✗') Fly fleet image/process/database-override proof failed"
      exit 1
    }
    if [ -z "$MACHINE_IDS" ]; then
      echo "  $(red '✗') Fly returned no machines to verify"
      exit 1
    fi
    for MACHINE_ID in $MACHINE_IDS; do
      if ! verify_fly_machine_source_silently "$MACHINE_ID"; then
        echo "  $(red '✗') Fly machine $MACHINE_ID did not silently prove source and both database paths"
        exit 1
      fi
      VERIFIED_MACHINE_COUNT=$((VERIFIED_MACHINE_COUNT + 1))
    done
    DATABASE_PROOF_STATUS="verified"
    DATABASE_PROOF_STARTED_MACHINE_COUNT="$VERIFIED_MACHINE_COUNT"
    DATABASE_PROOF_TRANSACTION_SELECT_ONE=1
    DATABASE_PROOF_SESSION_SELECT_ONE=1
    echo "  ✓ $VERIFIED_MACHINE_COUNT started Fly machine(s) carry $HEAD_REVISION (dirty=$API_SOURCE_DIRTY) and proved both database paths"
  fi
  API_RESULT="deployed_verified"
fi

if [ "$SKIP_API" = 0 ]; then
  if ! run_phase_b_authority_guard postflight "$HEAD_REVISION"; then
    API_RESULT="failed_or_uncertain"
    echo "  $(red '✗') Phase-B authority postflight did not prove the exact final release"
    exit 1
  fi
  echo "  ✓ Phase-B authority postflight remained exact ($PHASE_B_AUTHORITY_STATE)"
fi

# Frontend parity, headers, and sensitive-path policy. Pages/Workers may finish
# a deploy before custom-domain aliases converge, so retry this read-only
# live contract as one bounded unit; never re-upload from the verification loop.
if [ "$SKIP_FRONTEND" = 0 ]; then
  if ! wait_for_frontend_live; then
    exit 1
  fi
  FRONTEND_RESULT="deployed_verified"
fi

if ! cleanup_frontend_release_stage; then
  echo "$(red '✗') Could not remove the committed frontend verification stage before recording success." >&2
  exit 1
fi
if [ "$MAINTENANCE_FENCED_API" = 1 ]; then
  write_maintenance_state "phase5_verified" true || exit 1
fi
write_deploy_receipt "succeeded" 0 || exit 1
clear_maintenance_snapshots

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  $(green 'Deploy complete.')"
echo "═══════════════════════════════════════════════════════════════"
