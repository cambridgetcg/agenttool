#!/usr/bin/env bash
# One merge-back cycle: merge the public development repository's main into
# this private repository's main. Read private/README.md first.
#
#   private/bin/merge-back.sh [--push] [--gitleaks <gitleaks 8.30.1>]
#                             [--resume] [--accept-guard-change <public sha>]
#                             [--unsandboxed-gate]
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
# Every scan, the shared scope, the public guard, and the private terms run
# from a copy of origin/main's committed files, read with `git cat-file` into
# a temporary directory, never from this clone's working tree: after a merge
# the working tree holds the public side's tools/, and a case-insensitive
# file system could hold public bytes at a private path. The copy's shared
# guard files must match their reviewed record (private/bin/reviewed-shared.ts).
#
# A public range that touches a guard-sensitive path (the shared guard,
# hooks, workflow lint, canary list, .gitattributes, or .github/) stops with
# exit 9 and lists the paths. After reading those changes the owner reruns
# with --accept-guard-change <that public main sha>; the merge branch then
# gets one more commit that records the new digests in
# private/guard/reviewed-shared.json.
#
# --resume carries a fix for private-only paths (conflict policy: a private
# gate failure, a modify/delete on private overlay code). After a stop, commit
# the fix on the merge-back/<sha> branch (the merge commit followed only by
# non-merge commits) and rerun with --resume: every check runs again on that
# branch's tip, which must still hold the public tip exactly in shared paths,
# and that tip is what is gated and pushed. Without --resume an existing
# merge branch that carries such commits is never discarded silently.
#
# The private gate runs code that came from the public side, so it runs
# without credentials in its environment and, on macOS, inside sandbox-exec:
# no network but localhost, no writes under the home directory but this
# clone's working tree (never its git directory), no reads of credential
# stores; npm gets a scratch cache outside the home directory, removed after
# the gate. Where no sandbox is available it refuses unless --unsandboxed-gate
# is passed deliberately; that mode trusts the public code with this account.
# After the gate, HEAD, the merge branch, and this clone's git config must be
# unchanged, and a working tree the gate changed is restored before stopping,
# so nothing the gate wrote reaches the push or the next run.
#
# Exit status: 0 merged (or up to date), 2 a precondition failed, 3 the
# incoming scan found something, 4 this repository drifted on a shared path,
# 5 the merge conflicted (including a path that differs only in case), 6 an
# invariant broke after the merge, 7 the private gate failed, 8 the push was
# rejected (origin moved; run it again), 9 the public range changes the
# guard tooling and needs --accept-guard-change.
#
# AGENTTOOL_MERGE_BACK_GATE replaces the private gate command (default
# `bin/preflight.sh private`); the tests set it, and a run that uses it says
# so.

# shellcheck source=private/bin/committed-tools.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/committed-tools.sh"

main() {
  set -euo pipefail
  local push=0 gitleaks="" resume=0 accept="" unsandboxed=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --push) push=1 ;;
      --gitleaks) shift; gitleaks="${1:?--gitleaks needs a binary}" ;;
      --resume) resume=1 ;;
      --accept-guard-change) shift; accept="${1:?--accept-guard-change needs the public main sha}" ;;
      --unsandboxed-gate) unsandboxed=1 ;;
      *) fail 2 "usage: private/bin/merge-back.sh [--push] [--gitleaks <binary>] [--resume] [--accept-guard-change <sha>] [--unsandboxed-gate]" ;;
    esac
    shift
  done

  local root
  root="$(git rev-parse --show-toplevel)"
  cd "$root"
  root="$(pwd -P)"
  [ "$(git config --get agenttool.mergeClone || true)" = true ] || fail 2 "run this only in the dedicated merge clone (git config agenttool.mergeClone true)"
  git remote get-url public >/dev/null 2>&1 || fail 2 "the merge clone has no public remote"
  [ "$(git config --get remote.public.pushurl || true)" = "file:///dev/null/public-is-fetch-only" ] || fail 2 "the public remote must not be pushable (pushurl file:///dev/null/public-is-fetch-only)"
  [ "$(git config --get remote.public.tagOpt || true)" = "--no-tags" ] || fail 2 "the public remote must fetch no tags (remote.public.tagOpt --no-tags)"
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail 2 "the merge clone has uncommitted or untracked files"
  hooks_path_present . || fail 2 "core.hooksPath names a missing directory, so git would run no hook; reinstall the guards (install-guards.sh --verify)"

  git fetch --quiet --no-tags origin main public-sync || fail 2 "cannot fetch origin main and public-sync (public-sync exists after the adoption merge)"
  git fetch --quiet --no-tags public main || fail 2 "cannot fetch public main"

  # The tools, the guard, and the private terms: origin/main's committed bytes.
  local tools
  tools="$(mktemp -d "${TMPDIR:-/tmp}/merge-back-tools.XXXXXX")"
  trap 'rm -rf "${tools:-}"' EXIT
  committed_tools . origin/main "$tools" || fail 2 "cannot use origin/main's committed tools (see above); nothing runs until that is resolved"
  # Every check's Bun reads no bunfig.toml or .env (a committed preload would
  # otherwise run before, or instead of, every check), and runs from that copy
  # with --repo, never from this clone: Bun applies the tsconfig.json or
  # jsconfig.json of its working directory and that directory's parents to
  # what it runs, and this clone's working tree holds public files.
  guard_bun() { (cd "$tools" && exec bun --config=/dev/null --no-env-file "$@"); }
  local scope="$tools/private/bin/shared-scope.ts" scanner="$tools/private/bin/relational-scan.ts" reviewed="$tools/private/bin/reviewed-shared.ts"

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
  guard_bun "$scanner" --repo "$root" --guard-dir "$tools/private/guard" --diff --messages --names --objects -- "$base..$pub" || scan_status=$?
  [ "$scan_status" = 0 ] || fail 3 "the incoming scan refused ${base:0:12}..${pub:0:12} (status $scan_status); do not merge; open an incident"
  local guard_args=(--tree --repo "$root" --rev "$pub")
  [ -z "$gitleaks" ] || guard_args+=(--gitleaks "$gitleaks")
  guard_bun "$tools/tools/public-guard.ts" "${guard_args[@]}" || fail 3 "the public guard refused public main ${pub:0:12}"

  # Guard-sensitive shared paths need the owner's acceptance of this exact tip.
  local sensitive
  sensitive="$(guard_bun "$reviewed" sensitive --repo "$root" --range "$base..$pub" || true)"
  if [ -n "$sensitive" ]; then
    printf '%s\n' "$sensitive"
    case "$accept" in
      "") fail 9 "the public range changes guard-sensitive paths (listed above); read those changes, then rerun with --accept-guard-change ${pub}" ;;
      "$pub" | "${pub:0:12}") echo "merge-back: guard-sensitive changes accepted for public ${pub:0:12}" ;;
      *) fail 9 "--accept-guard-change names $accept, not public main ${pub:0:12}; read the new range first" ;;
    esac
  fi

  # Drift: since the base, this repository changed (added, deleted, or edited)
  # no shared path except to exactly the public bytes.
  guard_bun "$scope" drift --repo "$root" --base "$base" --public "$pub" --private origin/main ||
    fail 4 "drift: revert each added/changed/deleted shared path here and make the change in the public repository; for a collision, move the private file under private/; then run again"
  # A case-insensitive file system writes Private/x over private/x.
  guard_bun "$scope" casefold --repo "$root" --public "$pub" --private origin/main ||
    fail 5 "a public path differs only in case from a path here; nothing was merged (rename it in the public repository, or move the private file)"

  local before branch merge_commit=""
  before="$(git rev-parse origin/main)"
  branch="merge-back/${pub:0:12}"
  if git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then
    # The merge of this public tip on the branch's first-parent chain, if any
    # (an earlier stop may have left the branch at origin/main without one).
    local commit first second rest extra=0
    while read -r commit first second rest; do
      if [ -n "${second:-}" ] && [ "$second" = "$pub" ]; then
        merge_commit="$commit"
        break
      fi
    done < <(git rev-list --first-parent --parents -n 500 "$branch")
    [ -z "$merge_commit" ] || extra="$(git rev-list --count "$merge_commit..$branch")"
    if [ "$resume" = 0 ] && [ "$extra" != 0 ]; then
      fail 2 "$branch carries $extra commit(s) after its merge; rerun with --resume to carry them, or delete the branch deliberately"
    fi
  elif [ "$resume" = 1 ]; then
    fail 2 "--resume needs an existing $branch"
  fi
  if [ "$resume" = 1 ]; then
    [ -n "$merge_commit" ] || fail 2 "$branch holds no merge of public ${pub:0:12}"
    [ "$(git rev-parse "$merge_commit^1")" = "$before" ] || fail 2 "$branch was merged onto ${before:0:12}'s predecessor; origin/main moved, so rerun without --resume and redo the fix"
    [ -z "$(git rev-list --merges "$merge_commit..$branch")" ] || fail 2 "$branch carries a merge after its merge commit"
    git switch --quiet "$branch"
  else
    git switch --quiet --force-create "$branch" origin/main
    if ! git merge --quiet --no-ff --no-edit -m "Merge public main ${pub:0:12}" "$pub"; then
      git merge --abort || true
      fail 5 "the merge conflicted; nothing was pushed (see the conflict policy in private/README.md)"
    fi
    merge_commit="$(git rev-parse HEAD)"
  fi
  # The merge itself: it holds the public tip and changed nothing private.
  [ -z "$(git diff --no-renames --name-only --diff-filter=DMT "$pub" "$merge_commit")" ] || fail 6 "a public path is missing or differs after the merge"
  guard_bun "$scope" merged --repo "$root" --base "$base" --public "$pub" --private "$before" --rev "$merge_commit" || fail 6 "the merge broke an invariant"
  git merge-base --is-ancestor "$pub" "$merge_commit" || fail 6 "the merge does not contain public main"
  git merge-base --is-ancestor "$before" "$merge_commit" || fail 6 "the merge does not contain origin/main"

  if [ -n "$sensitive" ]; then
    guard_bun "$reviewed" write --root "$root" 2>/dev/null
    if [ -n "$(git status --porcelain -- private/guard/reviewed-shared.json)" ]; then
      git add private/guard/reviewed-shared.json
      git commit --quiet -m "Accept reviewed shared guard files from public ${pub:0:12}" -- private/guard/reviewed-shared.json
    fi
  fi

  # The tip (the merge, or the merge plus fixes and the acceptance record):
  # shared paths still equal the public tip exactly.
  [ -z "$(git diff --no-renames --name-only --diff-filter=DMT "$pub" HEAD)" ] || fail 6 "a public path differs at the tip of $branch"
  guard_bun "$scope" drift --repo "$root" --public "$pub" --private HEAD || fail 6 "the tip of $branch changes a shared path; fix shared code in the public repository"
  guard_bun "$scope" casefold --repo "$root" --public "$pub" --private HEAD || fail 6 "the tip of $branch holds a path that differs only in case from a public one"
  guard_bun "$reviewed" check --root "$root" >/dev/null || fail 6 "the merged shared guard files differ from the reviewed record"

  local merged config_before
  merged="$(git rev-parse HEAD)"
  config_before="$(config_digest)"
  local gate_status=0
  run_gate "$root" "$unsandboxed" || gate_status=$?
  # The gate ran public code. Nothing it could have changed may outlive it:
  # the push below runs outside any sandbox, through this clone's config and
  # hooks, and the next run executes this clone's merge-back.sh.
  [ "$(config_digest)" = "$config_before" ] || fail 7 "the private gate changed this clone's git config; nothing was pushed (read .git/config before any rerun)"
  [ "$(git rev-parse HEAD)" = "$merged" ] || fail 7 "the private gate moved HEAD; nothing was pushed"
  [ "$(git rev-parse "refs/heads/$branch")" = "$merged" ] || fail 7 "the private gate moved $branch; nothing was pushed"
  if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
    git reset --quiet --hard "$merged"
    git clean -fdq
    fail 7 "the private gate changed tracked or untracked files (now restored to ${merged:0:12}); nothing was pushed"
  fi
  [ "$gate_status" = 0 ] || fail 7 "the private gate failed; commit a fix to private-only paths on $branch and rerun with --resume, or fix the shared code in the public repository"

  if [ "$push" != 1 ]; then
    echo "merge-back: checks passed; would push ${merged:0:12} to main and ${pub:0:12} to public-sync (rerun with --push)"
    return 0
  fi
  git push --quiet --atomic origin "$merged:refs/heads/main" "$pub:refs/heads/public-sync" ||
    fail 8 "the push was rejected (origin moved?); nothing changed; run merge-back again"
  echo "merge-back: merged public ${pub:0:12} (base ${base:0:12}) into main ${merged:0:12}"
}

# The private gate, without credentials and, where possible, in a sandbox.
run_gate() {
  local root="$1" unsandboxed="$2"
  local gate="${AGENTTOOL_MERGE_BACK_GATE:-bin/preflight.sh private}"
  if [ -n "${AGENTTOOL_MERGE_BACK_GATE:-}" ]; then
    printf 'merge-back: WARNING: AGENTTOOL_MERGE_BACK_GATE replaces the private gate with: %s\n' "$gate" >&2
  fi
  # Package checks run `npm pack`, which writes npm's cache. The account's
  # cache is under the home directory, which the sandbox keeps unwritable, so
  # the gate gets a scratch cache of its own, removed afterwards; without a
  # sandbox the public code still never writes the account's cache.
  local npm_cache status=0
  npm_cache="$(mktemp -d "${TMPDIR:-/tmp}/merge-back-npm.XXXXXX")" ||
    { printf 'merge-back: cannot create a scratch npm cache for the gate\n' >&2; return 1; }
  local env_args=(env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u NPM_TOKEN -u NODE_AUTH_TOKEN
    -u SSH_AUTH_SOCK -u GIT_ASKPASS -u SSH_ASKPASS -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN
    -u FLY_API_TOKEN -u HF_TOKEN -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OLLAMA_API_KEY
    GH_CONFIG_DIR=/nonexistent GIT_TERMINAL_PROMPT=0 npm_config_cache="$npm_cache")
  if [ "$unsandboxed" = 1 ]; then
    printf 'merge-back: WARNING: --unsandboxed-gate: the private gate runs public code with this account'"'"'s network and files\n' >&2
    "${env_args[@]}" bash -c "$gate" || status=$?
    rm -rf "$npm_cache"
    return "$status"
  fi
  if ! command -v sandbox-exec >/dev/null 2>&1; then
    rm -rf "$npm_cache"
    printf 'merge-back: no sandbox-exec here; pass --unsandboxed-gate deliberately to run the gate without one\n' >&2
    return 1
  fi
  local home profile git_dir common_dir
  home="$(cd "$HOME" && pwd -P)"
  git_dir="$(git rev-parse --path-format=absolute --absolute-git-dir)"
  common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
  profile="$(gate_profile "$root" "$home" "$git_dir" "$common_dir")"
  "${env_args[@]}" sandbox-exec -p "$profile" bash -c "$gate" || status=$?
  rm -rf "$npm_cache"
  return "$status"
}

# sandbox-exec profile (later rules win): loopback only; no writes under the
# home directory except this clone's working tree, and none to its git
# directories (config, refs, index, info, shallow, packs, alternates), so
# neither the push that follows nor a later run can pick up anything the gate
# wrote there. Tests may add loose objects (a `git add` into a scratch index
# does), so objects/ itself stays writable; a loose object is named by its
# hash, a receiving repository rehashes what is pushed, and the export's
# identity proof rehashes what it writes. No reads of credential stores, the
# keychain, or the pinned hooks.
gate_profile() {
  local root="$1" home="$2" git_dir="$3" common_dir="$4"
  cat <<PROFILE
(version 1)
(allow default)
(deny network-outbound (remote ip "*:*"))
(allow network-outbound (remote ip "localhost:*"))
(deny file-write* (subpath "$home"))
(allow file-write* (subpath "$root"))
(deny file-write* (subpath "$git_dir") (subpath "$common_dir"))
(allow file-write* (subpath "$common_dir/objects"))
(deny file-write* (subpath "$common_dir/objects/info") (subpath "$common_dir/objects/pack"))
(deny file-read* (subpath "$home/.ssh") (subpath "$home/.config/gh") (subpath "$home/.aws") (subpath "$home/Library/Keychains")
  (subpath "$home/.codex") (subpath "$home/.local/share/agenttool") (literal "$home/.git-credentials") (literal "$home/.netrc") (literal "$home/.npmrc"))
(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd"))
PROFILE
}

# A digest of this clone's own git config (and the worktree's, if any).
config_digest() {
  local file
  for file in "$(git rev-parse --git-path config)" "$(git rev-parse --git-path config.worktree)"; do
    [ ! -f "$file" ] || shasum -a 256 "$file"
  done | shasum -a 256
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
