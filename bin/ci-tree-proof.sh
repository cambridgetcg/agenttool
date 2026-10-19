#!/usr/bin/env bash
# On a push to main, report whether a pull-request run of this same workflow
# already passed on the exact tree being pushed.
#
# Appends `proven=true|false` and `proof-run=<run id or empty>` to
# $GITHUB_OUTPUT. `proven=true` requires all of: a push to refs/heads/main, a
# valid pushed commit, an unexpired artifact named ci-tested-tree-<tree>
# (uploaded by the pull-request run's Changed areas job) from this repository
# rather than a fork, and a run behind it whose workflow file is
# .github/workflows/ci.yml, whose event is pull_request, whose head repository
# is this one, and whose latest attempt completed with conclusion success.
# Equal trees mean that run tested these exact bytes, this ci.yml included.
# Any other answer, any API or git failure, or a missing token reports
# `proven=false`, and the workflow then runs every job.
#
# `reason` (logged and written to the step summary, not to $GITHUB_OUTPUT) is
# one of: unchecked, not-a-main-push, bad-repository, bad-sha, no-token,
# git-failure, artifact-lookup-failed, no-recorded-run, run-lookup-failed,
# recorded-run-not-green, green-pull-request-run.
#
# Needs GH_TOKEN (actions: read), GITHUB_EVENT_NAME, GITHUB_REF,
# GITHUB_REPOSITORY, GITHUB_SHA, and GITHUB_OUTPUT. Makes at most
# 1 + MAX_CANDIDATES read-only REST calls, all GET.

set -euo pipefail
set -f
export LC_ALL=C

readonly WORKFLOW_PATH=.github/workflows/ci.yml
readonly MAX_CANDIDATES=20

proven=false
proof_run=""
reason=unchecked

finish() {
  printf 'proven=%s\nproof-run=%s\n' "$proven" "$proof_run" >>"$GITHUB_OUTPUT"
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '### Tree proof\n\n| proven | run | reason |\n| --- | --- | --- |\n| %s | %s | %s |\n' \
      "$proven" "${proof_run:--}" "$reason" >>"$GITHUB_STEP_SUMMARY"
  fi
  printf 'proven=%s proof-run=%s reason=%s\n' "$proven" "${proof_run:--}" "$reason"
}

if [[ -z ${GITHUB_OUTPUT:-} ]]; then
  echo "ci-tree-proof: GITHUB_OUTPUT is not set" >&2
  exit 2
fi
trap finish EXIT

if [[ ${GITHUB_EVENT_NAME:-} != push || ${GITHUB_REF:-} != refs/heads/main ]]; then
  reason=not-a-main-push
  exit 0
fi
if [[ ! ${GITHUB_REPOSITORY:-} =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  reason=bad-repository
  exit 0
fi
if [[ ! ${GITHUB_SHA:-} =~ ^[0-9a-f]{40}$ ]]; then
  reason=bad-sha
  exit 0
fi
if [[ -z ${GH_TOKEN:-} ]]; then
  reason=no-token
  exit 0
fi
if ! tree=$(git rev-parse --verify --quiet "${GITHUB_SHA}^{tree}" 2>/dev/null) ||
  [[ ! $tree =~ ^[0-9a-f]{40}$ ]]; then
  reason=git-failure
  exit 0
fi
readonly artifact_name="ci-tested-tree-$tree"

# Only this repository's own, unexpired uploads with exactly this name count.
# The name is 15 fixed characters plus 40 hex digits, so it is safe inside the
# jq string.
if ! candidates=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/artifacts" \
  -f "name=$artifact_name" -f per_page=100 \
  --jq ".artifacts[] | select(.name == \"$artifact_name\" and .expired == false and .workflow_run.repository_id == .workflow_run.head_repository_id) | .workflow_run.id" \
  2>/dev/null); then
  reason=artifact-lookup-failed
  exit 0
fi

reason=no-recorded-run
count=0
for run_id in $candidates; do
  [[ $run_id =~ ^[0-9]{1,20}$ ]] || continue
  count=$((count + 1))
  ((count <= MAX_CANDIDATES)) || break
  if ! verdict=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" \
    --jq '[.path, .event, .status, .conclusion, (.repository.full_name == .head_repository.full_name)] | map(tostring) | join(" ")' \
    2>/dev/null); then
    reason=run-lookup-failed
    continue
  fi
  if [[ $verdict == "$WORKFLOW_PATH pull_request completed success true" ]]; then
    proven=true
    proof_run=$run_id
    reason=green-pull-request-run
    exit 0
  fi
  reason=recorded-run-not-green
done
