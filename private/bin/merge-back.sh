#!/usr/bin/env bash
# One merge-back cycle: merge the public development repository's main into
# this private repository's main. Read private/README.md first.
#
#   private/bin/merge-back.sh [--push] [--gitleaks <gitleaks 8.30.1>]
#
# Run it only in the dedicated merge clone: the one checkout with a `public`
# remote, whose push URL is file:///dev/null/public-is-fetch-only, which
# fetches no tags, and which carries `git config agenttool.mergeClone true`.
# Never in a working checkout that other sessions use.
#
# Without --push it runs every check and the private gate, then stops and
# says what it would push. With --push it pushes main and public-sync in one
# atomic, fast-forward-only push, and only when every check passed.
#
# The merge base comes from `git merge-base origin/main public/main`, never
# from commit messages; on the first cycle it is the public root.
#
# Exit status: 0 merged (or up to date), 2 a precondition failed, 3 the
# incoming scan found something, 4 this repository drifted on a shared path,
# 5 the merge conflicted, 6 an invariant broke after the merge, 7 the private
# gate failed, 8 the push was rejected (origin moved; run it again).
#
# AGENTTOOL_MERGE_BACK_GATE replaces the private gate command (default
# `bin/preflight.sh private`); the tests set it.

main() {
  set -euo pipefail
  local push=0 gitleaks=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --push) push=1 ;;
      --gitleaks) shift; gitleaks="${1:?--gitleaks needs a binary}" ;;
      *) fail 2 "usage: private/bin/merge-back.sh [--push] [--gitleaks <binary>]" ;;
    esac
    shift
  done

  local root
  root="$(git rev-parse --show-toplevel)"
  cd "$root"
  [ "$(git config --get agenttool.mergeClone || true)" = true ] || fail 2 "run this only in the dedicated merge clone (git config agenttool.mergeClone true)"
  git remote get-url public >/dev/null 2>&1 || fail 2 "the merge clone has no public remote"
  [ "$(git config --get remote.public.pushurl || true)" = "file:///dev/null/public-is-fetch-only" ] || fail 2 "the public remote must not be pushable (pushurl file:///dev/null/public-is-fetch-only)"
  [ "$(git config --get remote.public.tagOpt || true)" = "--no-tags" ] || fail 2 "the public remote must fetch no tags (remote.public.tagOpt --no-tags)"
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail 2 "the merge clone has uncommitted or untracked files"

  git fetch --quiet --no-tags origin main public-sync || fail 2 "cannot fetch origin main and public-sync (public-sync exists after the adoption merge)"
  git fetch --quiet --no-tags public main || fail 2 "cannot fetch public main"
  local p0 pub base sync
  p0="$(git show origin/main:private/export/public-root.txt 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$p0" =~ ^[0-9a-f]{40}$ ]] || fail 2 "origin/main has no private/export/public-root.txt (the adoption merge records it)"
  pub="$(git rev-parse --verify public/main^{commit})"
  sync="$(git rev-parse --verify origin/public-sync^{commit})"
  [ "$(git rev-list --max-parents=0 "$pub")" = "$p0" ] || fail 2 "public main does not have the public root as its only root"
  git merge-base --is-ancestor "$sync" "$pub" || fail 2 "public main does not descend from the last merged public tip (was it rewritten?)"
  git merge-base --is-ancestor "$sync" origin/main || fail 2 "origin/main does not contain public-sync"
  base="$(git merge-base origin/main "$pub")" || fail 2 "origin/main and public main share no history (adoption merge missing)"
  [ "$base" = "$sync" ] || fail 2 "the merge base ${base:0:12} is not public-sync ${sync:0:12}; reconcile public-sync first"
  [ "$(git rev-list --max-parents=0 "$base")" = "$p0" ] || fail 2 "the merge base is not a public commit"
  if [ "$base" = "$pub" ]; then
    echo "merge-back: up to date (public ${pub:0:12})"
    return 0
  fi

  # Incoming: the private scan over everything public main added, and the
  # public guard over its tree.
  local scan_status=0
  bun private/bin/relational-scan.ts --repo . --diff --messages --names --objects -- "$base..$pub" || scan_status=$?
  [ "$scan_status" = 0 ] || fail 3 "the incoming scan refused ${base:0:12}..${pub:0:12} (status $scan_status); do not merge; open an incident"
  local guard_args=(--tree --rev "$pub")
  [ -z "$gitleaks" ] || guard_args+=(--gitleaks "$gitleaks")
  bun tools/public-guard.ts "${guard_args[@]}" || fail 3 "the public guard refused public main ${pub:0:12}"

  # Drift: since the base, this repository changed (added, deleted, or edited)
  # no shared path except to exactly the public bytes.
  bun private/bin/shared-scope.ts drift --repo . --base "$base" --public "$pub" --private origin/main ||
    fail 4 "drift: revert each added/changed/deleted shared path here and make the change in the public repository; for a collision, move the private file under private/; then run again"

  local before branch
  before="$(git rev-parse origin/main)"
  branch="merge-back/${pub:0:12}"
  git switch --quiet --force-create "$branch" origin/main
  if ! git merge --quiet --no-ff --no-edit -m "Merge public main ${pub:0:12}" "$pub"; then
    git merge --abort || true
    fail 5 "the merge conflicted; nothing was pushed (see the conflict policy in private/README.md)"
  fi
  [ -z "$(git diff --no-renames --name-only --diff-filter=DMT "$pub" HEAD)" ] || fail 6 "a public path is missing or differs after the merge"
  bun private/bin/shared-scope.ts merged --repo . --base "$base" --public "$pub" --private "$before" --rev HEAD || fail 6 "the merge broke an invariant"
  git merge-base --is-ancestor "$pub" HEAD || fail 6 "the merge does not contain public main"
  git merge-base --is-ancestor "$before" HEAD || fail 6 "the merge does not contain origin/main"

  local gate="${AGENTTOOL_MERGE_BACK_GATE:-bin/preflight.sh private}"
  bash -c "$gate" || fail 7 "the private gate failed; fix private-only paths on $branch, or the shared code in the public repository"

  local merged
  merged="$(git rev-parse HEAD)"
  if [ "$push" != 1 ]; then
    echo "merge-back: checks passed; would push ${merged:0:12} to main and ${pub:0:12} to public-sync (rerun with --push)"
    return 0
  fi
  git push --quiet --atomic origin "$merged:refs/heads/main" "$pub:refs/heads/public-sync" ||
    fail 8 "the push was rejected (origin moved?); nothing changed; run merge-back again"
  echo "merge-back: merged public ${pub:0:12} (base ${base:0:12}) into main ${merged:0:12}"
}

fail() {
  local status="$1"
  shift
  printf 'merge-back: %s\n' "$*" >&2
  exit "$status"
}

# The whole body is a function, so bash has parsed it before a branch switch
# can change this file on disk.
main "$@"
exit $?
