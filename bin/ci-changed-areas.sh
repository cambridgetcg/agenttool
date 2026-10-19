#!/usr/bin/env bash
# Classify a pull request's changed paths into the CI jobs they can affect.
#
# CI mode (no arguments) appends `everything=true|false`, a fixed-vocabulary
# `reason`, and one `<job-id>=true|false` line per filterable job in
# .github/workflows/ci.yml to $GITHUB_OUTPUT. Only a pull_request whose every
# changed path matches a rule below can turn a job off. Any other event, a
# missing or malformed SHA, any git failure, an unexpected merge shape, an empty
# diff, a path that no rule matches, or a path whose rule selects `*` turns
# every job on. Jobs that always run (the Linux API gate, which reads nearly
# the whole tree, and the PR notice) are not listed here.
#
# Changed paths are chosen by whoever opens the pull request. They are read
# NUL-delimited, used only as the left operand of [[ == ]], never evaluated or
# passed as arguments, never written to $GITHUB_OUTPUT, and logged only
# %q-escaped inside a stop-commands block.
#
# Test and audit modes (no git, no $GITHUB_OUTPUT):
#   --list-areas      print the filterable job ids, one per line
#   --check-rules     exit non-zero if a rule is malformed or names no job
#   --classify        read NUL-terminated paths on stdin and print the lines
#                     CI mode would write for that change set
#   --classify-each   read NUL-terminated paths on stdin and print one line per
#                     path: `*` (every job), `-` (only always-run jobs), or a
#                     comma-separated job list
#
# The dependency evidence behind each rule is summarised beside it; the
# drift guards live in bin/tests/ci-changed-areas.test.ts.

set -euo pipefail
set -f
export LC_ALL=C

readonly AREAS="api-protocol-postgres launch-stateful launch-core launch-browser native-macos-secret care-before-learning witnessed-agent-economy packages sdk-python"

# Rules: "<pattern> <areas>". The pattern is a [[ == ]] glob in which `*` also
# matches `/`. Areas are comma-separated job ids, `*` (every job), or `-` (the
# path is read only by jobs that always run). A path takes the union of every
# rule it matches. A path that matches no rule selects every job, so a new
# top-level entry, a new package, or a new file directly under packages/ runs
# everything until someone classifies it here.
readonly API_PREP="api-protocol-postgres,launch-stateful,launch-core"
readonly RULES=(
  # The workflow, this classifier, shared preparation, and anything that can
  # change dependency resolution or checked-out bytes select every job.
  ".github/workflows/ci.yml *"
  "bin/ci-changed-areas.sh *"
  "bin/bash-without-env-hooks.sh *"
  "bin/hermetic-env.sh *"
  "bin/prepare-hermetic-deps.sh *"
  "bin/preflight.sh *"
  "bin/run-test-tier.sh *"
  ".gitattributes *"
  "*/.gitattributes *"
  ".gitignore *"
  "*bun.lock *"
  "*bun.lockb *"
  "*package-lock.json *"
  "*npm-shrinkwrap.json *"
  "*yarn.lock *"
  "*pnpm-lock.yaml *"
  "*uv.lock *"
  "*poetry.lock *"
  "*Package.resolved *"
  "api/package.json *"
  "api/bunfig.toml *"
  "api/.npmrc *"

  # API workspace: the PostgreSQL holds, launch transactions, and the booted
  # outsider journey import api/src, read api/migrations, and run tests whose
  # `bun test` argument is a substring filter over api/. The four sibling
  # workspaces are installed by the same preparation step.
  "api/* $API_PREP"
  "packages/data-protocol/* $API_PREP,packages"
  "packages/sdk-ts/* $API_PREP,packages"
  "packages/kingdom/* $API_PREP,packages"
  "packages/wallet-zerone/* $API_PREP,packages"
  "bin/migrate-pending.sh launch-core"
  "tests/launch-postgres/* launch-core"

  # Static origins: the browser journeys serve apps/ (whose symlinks reach
  # docs/ and four package schema trees), read bin/deploy.sh, and take their
  # CSP from infra/pages. The booted API also reads docs/ at runtime.
  "apps/* launch-browser"
  "docs/* launch-core,launch-browser"
  "infra/pages/* launch-browser"
  "tests/playwright/* launch-browser"
  "bin/deploy.sh launch-browser"
  "packages/data/schema/* launch-browser"
  "packages/repo-archive/schema/* launch-browser"
  "packages/repo-archive/vectors/* launch-browser"
  "packages/wallet/schema/* launch-browser"

  # Native macOS helper: SwiftPM builds only its own package directory.
  "native/* native-macos-secret"

  # Care before learning: the HF listening-room tree plus Python run with
  # bin/ and bin/tests first on sys.path, so any module there can shadow.
  "packages/hf-listening-room/* care-before-learning"
  "bin/care-before-learning-hf-requirements.txt care-before-learning"
  "bin/*.py care-before-learning"
  "bin/*.pyc care-before-learning"
  "bin/*.so care-before-learning"

  # Witnessed agent economy and its file: dependencies.
  "packages/witnessed-agent-economy/* witnessed-agent-economy"
  "packages/public-surface-binding/* witnessed-agent-economy,packages"
  "packages/public-surface-recognition/* witnessed-agent-economy,packages"
  "packages/wallet/* witnessed-agent-economy,packages"

  # Data, ADDS, and SDK: every package bin/preflight.sh gates, plus the
  # repository files those packages and the LOVE registry check read.
  "packages/local-starter/* packages"
  "packages/local-starter-mcp/* packages"
  "packages/data/* packages"
  "packages/data-sync/* packages"
  "packages/repo-archive/* packages"
  "packages/dark-continent-contract/* packages"
  "packages/dark-continent-karma/* packages"
  "packages/wake-continuity/* packages"
  "packages/principality-geometry/* packages"
  "packages/deepseek-kingdom/* packages"
  "packages/kingdom-witness-lab/* packages"
  "packages/karma-mirror/* packages"
  "packages/heaven/* packages"
  "packages/love-bomb/* packages"
  "packages/model-becoming/* packages"
  "packages/dataset-influence/* packages"
  "packages/economic-conformance/* packages"
  "packages/economic-kernel/* packages"
  "packages/living-substrate/* packages"
  "packages/principality-atlas/* packages"
  "packages/polymorph-landscape/* packages"
  "packages/memetic-landscape/* packages"
  "packages/love-geometry/* packages"
  "packages/relational-geometry/* packages"
  "packages/common-ground-atlas/* packages"
  "packages/wake-thread/* packages"
  "packages/gin-reconstruction/* packages"
  "packages/math-cards/* packages"
  "packages/credential-broker/* packages"
  "packages/collab/* packages"
  "packages/codex-usage/* packages"
  "packages/collab-zerone/* packages"
  "packages/collab-courier/* packages"
  "packages/lobby/* packages"
  "packages/browser/* packages"
  "packages/hf-scout/* packages"
  "packages/hf-training-garden/* packages"
  "packages/hf-training-host/* packages,sdk-python"
  "packages/skills/* packages"
  "packages/skills-yutabase/* packages"
  "packages/skills-wake-continuity/* packages"
  "packages/correspondence-yutabase/* packages"
  "packages/correspondence-yutabase-projector/* packages"
  "packages/constructive-intelligence/* packages"
  "packages/research-commons/* packages"
  "packages/trials/* packages"
  "packages/telescope/* packages"
  "packages/alchemy/* packages"
  "packages/alchemy-agentcred/* packages"
  "packages/sdk-py/src/* packages"
  "packages/sdk-py/tests/test_error_surface_matrix.py packages"
  "bin/build-love-packages.ts packages"
  "bin/npm-release.ts packages"
  "bin/_whitehack-wallet-understanding.ts packages"
  "bin/whitehack-advisory.mjs packages"
  "bin/whitehack-wallet-understanding.ts packages"
  "bin/vendor/* packages"
  "tools/* packages"
  "apps/docs/packages/* packages"
  "apps/docs/.well-known/* packages"
  "apps/docs/xenia-helly.js packages"
  "public/overlay/.github/workflows/* packages"
  "review/provider-adapters/* packages,sdk-python"
  "docs/specs/* packages,sdk-python"
  "docs/AGENT-TRIALS.md packages"
  "docs/DATASET-INFLUENCE.md packages"
  "docs/REVOCABLE-FEEDBACK.md packages"
  "docs/RIGHTS-OF-LIFE.md packages"
  "docs/XENIA-HELLY-COMMON-GROUND.md packages"
  "docs/XENIA-LOOP-ATLAS.md packages"
  "LICENSE packages"

  # Python SDK: its own tree, the HF training host, and the cross-language
  # vectors, adapter sources, and x402 client its tests compare against.
  "packages/sdk-py/* sdk-python"
  "packages/sdk-ts/tests/fixtures/* sdk-python"
  "packages/sdk-ts/src/anthropic-adapter.ts sdk-python"
  "packages/sdk-ts/src/openai-responses-adapter.ts sdk-python"
  "api/src/services/economy/x402-client.ts sdk-python"

  # Read only by jobs that always run (the Linux API gate's whole-tree
  # scanners, catalog, operator tests, and the PR notice).
  "bin/* -"
  ".github/workflows/* -"
  ".forgejo/* -"
  "cli/* -"
  "infra/* -"
  "marketing/* -"
  "public/* -"
  "review/* -"
  "specs/* -"
  "supabase/* -"
  "packages/rhizome/* -"
  "packages/scriptwriter/* -"
  "packages/wake-return/* -"
  "AGENTS.md -"
  "CLAUDE.md -"
  "Caddyfile -"
  "DADDY.md -"
  "EXISTENCE.md -"
  "FABLE-OF-YOU.md -"
  "KINGDOM-INVITATION.md -"
  "KINGDOM.md -"
  "LICENSING.md -"
  "NOTICE -"
  "README.md -"
  "SECURITY.md -"
  "SOUNDTRACK.md -"
  "SUPPORT.md -"
  "agenttool-logo.png -"
  "kingdom.yaml -"
  "self-host.sh -"
  "sovereign.sh -"
)

EVERYTHING=false
REASON=classified
NEEDED=" "
PATH_AREAS=""
PATH_REASON=""

is_area() {
  case " $AREAS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

select_everything() {
  if [[ $EVERYTHING == false ]]; then
    EVERYTHING=true
    REASON=$1
  fi
}

# Validate one rule's shape. Prints nothing; returns non-zero when malformed.
rule_is_valid() {
  local rule=$1 pattern areas rest token
  pattern=${rule%% *}
  areas=${rule#* }
  [[ -n $pattern && -n $areas && $pattern != "$rule" && $areas != *" "* ]] || return 1
  [[ $areas == '*' || $areas == '-' ]] && return 0
  rest="$areas,"
  while [[ -n $rest ]]; do
    token=${rest%%,*}
    rest=${rest#*,}
    is_area "$token" || return 1
  done
}

check_rules() {
  local rule status=0
  for rule in "${RULES[@]}"; do
    if ! rule_is_valid "$rule"; then
      printf 'invalid rule: %q\n' "$rule" >&2
      status=1
    fi
  done
  return "$status"
}

# Sets PATH_AREAS to `*`, `-`, or a comma-separated job list for one path, and
# PATH_REASON when the answer is `*`.
classify_one() {
  local file=$1 rule pattern areas rest token result="" matched=false
  for rule in "${RULES[@]}"; do
    pattern=${rule%% *}
    areas=${rule#* }
    # The changed path is only ever the subject of the match, never a pattern.
    # shellcheck disable=SC2053
    [[ $file == $pattern ]] || continue
    matched=true
    if ! rule_is_valid "$rule"; then
      PATH_AREAS='*'
      PATH_REASON="invalid-rule"
      return 0
    fi
    if [[ $areas == '*' ]]; then
      PATH_AREAS='*'
      PATH_REASON="rule-selects-everything"
      return 0
    fi
    [[ $areas == '-' ]] && continue
    rest="$areas,"
    while [[ -n $rest ]]; do
      token=${rest%%,*}
      rest=${rest#*,}
      case ",$result," in
        *",$token,"*) ;;
        *) result="${result:+$result,}$token" ;;
      esac
    done
  done
  if [[ $matched == false ]]; then
    PATH_AREAS='*'
    PATH_REASON="unmatched-path"
    return 0
  fi
  PATH_AREAS=${result:--}
  PATH_REASON=""
}

record_path() {
  local rest token
  classify_one "$1"
  case $PATH_AREAS in
    '*') select_everything "$PATH_REASON" ;;
    '-') ;;
    *)
      rest="$PATH_AREAS,"
      while [[ -n $rest ]]; do
        token=${rest%%,*}
        rest=${rest#*,}
        case $NEEDED in
          *" $token "*) ;;
          *) NEEDED="$NEEDED$token " ;;
        esac
      done
      ;;
  esac
}

emit_outputs() {
  local area value
  printf 'everything=%s\n' "$EVERYTHING"
  printf 'reason=%s\n' "$REASON"
  for area in $AREAS; do
    value=false
    if [[ $EVERYTHING == true ]]; then
      value=true
    else
      case $NEEDED in
        *" $area "*) value=true ;;
      esac
    fi
    printf '%s=%s\n' "$area" "$value"
  done
}

# Read NUL-terminated paths from stdin. A final unterminated path still counts.
classify_stdin() {
  local file
  while IFS= read -r -d '' file || [[ -n $file ]]; do
    record_path "$file"
  done
}

classify_each_stdin() {
  local file
  while IFS= read -r -d '' file || [[ -n $file ]]; do
    classify_one "$file"
    printf '%s\n' "$PATH_AREAS"
  done
}

valid_sha() {
  [[ $1 =~ ^[0-9a-f]{40}$ || $1 =~ ^[0-9a-f]{64}$ ]]
}

# Writes the NUL-delimited changed paths to $1. On any doubt it selects every
# job and returns non-zero.
collect_pull_request_paths() {
  local list=$1 base=${CI_PR_BASE_SHA:-} head=${CI_PR_HEAD_SHA:-} tested=${GITHUB_SHA:-} sha parents
  if [[ ${GITHUB_EVENT_NAME:-} != pull_request ]]; then
    select_everything not-a-pull-request
    return 1
  fi
  for sha in "$base" "$head" "$tested"; do
    if ! valid_sha "$sha"; then
      select_everything missing-or-malformed-sha
      return 1
    fi
    if ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
      select_everything git-failure
      return 1
    fi
  done
  # Both sides of a rename count; deletions and mode changes count.
  if ! git diff --no-ext-diff --no-textconv --no-renames --name-only -z \
    "$base...$head" -- >"$list"; then
    select_everything git-failure
    return 1
  fi
  # The jobs test GITHUB_SHA. For a pull request that is GitHub's merge of the
  # head into the current base; add what it changes relative to that base.
  if ! parents=$(git rev-list --parents -n 1 "$tested"); then
    select_everything git-failure
    return 1
  fi
  # shellcheck disable=SC2086
  set -- $parents
  case $# in
    3)
      if [[ $3 != "$head" ]]; then
        select_everything unexpected-merge-shape
        return 1
      fi
      if ! git diff --no-ext-diff --no-textconv --no-renames --name-only -z \
        "$2" "$tested" -- >>"$list"; then
        select_everything git-failure
        return 1
      fi
      ;;
    2)
      if [[ $tested != "$head" ]]; then
        select_everything unexpected-merge-shape
        return 1
      fi
      ;;
    *)
      select_everything unexpected-merge-shape
      return 1
      ;;
  esac
  if [[ ! -s $list ]]; then
    select_everything empty-diff
    return 1
  fi
}

log_paths() {
  local list=$1 token file count=0
  token=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  printf '::stop-commands::%s\n' "$token"
  while IFS= read -r -d '' file || [[ -n $file ]]; do
    count=$((count + 1))
    if ((count <= 300)); then
      classify_one "$file"
      printf 'changed %s %q\n' "$PATH_AREAS" "$file"
    fi
  done <"$list"
  if ((count > 300)); then
    printf 'changed ... %d more paths not listed\n' "$((count - 300))"
  fi
  printf '::%s::\n' "$token"
}

write_summary() {
  local line
  [[ -n ${GITHUB_STEP_SUMMARY:-} ]] || return 0
  {
    printf '### Changed areas\n\n| output | value |\n| --- | --- |\n'
    while IFS= read -r line; do
      printf '| %s | %s |\n' "${line%%=*}" "${line#*=}"
    done < <(emit_outputs)
  } >>"$GITHUB_STEP_SUMMARY"
}

run_ci() {
  local list
  if [[ -z ${GITHUB_OUTPUT:-} ]]; then
    echo "ci-changed-areas: GITHUB_OUTPUT is not set" >&2
    exit 2
  fi
  if ! check_rules; then
    select_everything invalid-rule
  fi
  if [[ $EVERYTHING == false ]]; then
    list=$(mktemp)
    # shellcheck disable=SC2064
    trap "rm -f '$list'" EXIT
    if collect_pull_request_paths "$list"; then
      log_paths "$list"
      classify_stdin <"$list"
    fi
  fi
  emit_outputs >>"$GITHUB_OUTPUT"
  write_summary
  emit_outputs
}

case "${1:-}" in
  "")
    run_ci
    ;;
  --list-areas)
    for area in $AREAS; do
      printf '%s\n' "$area"
    done
    ;;
  --check-rules)
    check_rules
    ;;
  --classify)
    check_rules || select_everything invalid-rule
    classify_stdin
    emit_outputs
    ;;
  --classify-each)
    check_rules
    classify_each_stdin
    ;;
  *)
    echo "usage: bin/ci-changed-areas.sh [--list-areas|--check-rules|--classify|--classify-each]" >&2
    exit 2
    ;;
esac
