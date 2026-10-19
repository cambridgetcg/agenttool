#!/usr/bin/env bash
# On a push to main, report whether a pull-request run of this same workflow
# already passed on the exact tree being pushed, on top of the exact commit
# main pointed to before the push, while main's own run there had passed.
#
# Appends `proven=true|false` and `proof-run=<run id or empty>` to
# $GITHUB_OUTPUT. `proven=true` requires all of:
#   - a push to refs/heads/main with a valid pushed commit and a valid
#     `before` commit (CI_PUSH_BEFORE_SHA, from github.event.before);
#   - an unexpired artifact named ci-tested-tree-<tree>-on-<before>, from this
#     repository rather than a fork. A pull-request run that targets main
#     uploads it from its Changed areas job, naming the tree of GitHub's test
#     merge and that merge's first parent. So the run classified and tested
#     exactly the change from `before` to these bytes, this ci.yml included;
#   - no run behind such an artifact that completed red, and at least one
#     whose workflow file is .github/workflows/ci.yml, whose event is
#     pull_request, whose head repository is this one, and whose latest
#     attempt completed with conclusion success;
#   - the newest push run of ci.yml for `before` on main completed with
#     conclusion success. Jobs a pull request skips keep main's state, so main
#     must have been green there. A proven push concludes success, so one
#     green full run carries forward; a red, cancelled, missing or unfinished
#     one makes the next push run everything.
# Any other answer, any API or git failure, or a missing token reports
# `proven=false`, and the workflow then runs every job.
#
# `reason` (logged and written to the step summary, not to $GITHUB_OUTPUT) is
# one of: unchecked, not-a-main-push, bad-repository, bad-sha, bad-before,
# no-token, git-failure, artifact-lookup-failed, no-recorded-run,
# before-lookup-failed, before-run-not-green, run-lookup-failed,
# recorded-run-red, recorded-run-not-green, green-pull-request-run.
#
# Needs GH_TOKEN (actions: read), CI_PUSH_BEFORE_SHA, GITHUB_EVENT_NAME,
# GITHUB_REF, GITHUB_REPOSITORY, GITHUB_SHA, and GITHUB_OUTPUT. Makes at most
# 2 + MAX_CANDIDATES read-only REST calls, all GET.

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
# A new branch or a forced push has no usable previous commit.
before_sha=${CI_PUSH_BEFORE_SHA:-}
if [[ ! $before_sha =~ ^[0-9a-f]{40}$ || $before_sha =~ ^0+$ || $before_sha == "$GITHUB_SHA" ]]; then
  reason=bad-before
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
readonly artifact_name="ci-tested-tree-$tree-on-$before_sha"

# Only this repository's own, unexpired uploads with exactly this name count.
# The name is fixed text plus 80 hex digits, so it is safe inside the jq
# strings below, as is `before`.
if ! candidates=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/artifacts" \
  -f "name=$artifact_name" -f per_page=100 \
  --jq ".artifacts[] | select(.name == \"$artifact_name\" and .expired == false and .workflow_run.repository_id == .workflow_run.head_repository_id) | .workflow_run.id" \
  2>/dev/null); then
  reason=artifact-lookup-failed
  exit 0
fi
if [[ -z $candidates ]]; then
  reason=no-recorded-run
  exit 0
fi

# main's newest push run of ci.yml for `before` must have passed.
if ! before_run=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs" \
  -f "head_sha=$before_sha" -f event=push -f branch=main -f per_page=10 \
  --jq "[.workflow_runs[] | select(.head_sha == \"$before_sha\" and .event == \"push\" and .head_branch == \"main\")][0] | [.path, .status, .conclusion] | map(tostring) | join(\" \")" \
  2>/dev/null); then
  reason=before-lookup-failed
  exit 0
fi
if [[ $before_run != "$WORKFLOW_PATH completed success" ]]; then
  reason=before-run-not-green
  exit 0
fi

# Every run that recorded this tree on this parent tested the same bytes for
# the same change, so one that completed red outweighs any green one.
reason=no-recorded-run
green_run=""
count=0
for run_id in $candidates; do
  [[ $run_id =~ ^[0-9]{1,20}$ ]] || continue
  count=$((count + 1))
  ((count <= MAX_CANDIDATES)) || break
  if ! verdict=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" \
    --jq '[.path, .event, .status, .conclusion, (.repository.full_name == .head_repository.full_name)] | map(tostring) | join(" ")' \
    2>/dev/null); then
    [[ -n $green_run ]] || reason=run-lookup-failed
    continue
  fi
  case $verdict in
    "$WORKFLOW_PATH pull_request completed success true")
      [[ -n $green_run ]] || green_run=$run_id
      ;;
    "$WORKFLOW_PATH pull_request completed failure true" | \
      "$WORKFLOW_PATH pull_request completed timed_out true" | \
      "$WORKFLOW_PATH pull_request completed startup_failure true")
      reason=recorded-run-red
      exit 0
      ;;
    *)
      [[ -n $green_run ]] || reason=recorded-run-not-green
      ;;
  esac
done
if [[ -n $green_run ]]; then
  proven=true
  proof_run=$green_run
  reason=green-pull-request-run
fi
