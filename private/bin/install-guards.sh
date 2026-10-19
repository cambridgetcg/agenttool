#!/usr/bin/env bash
# Install the leak guards' git hooks from a pinned copy (plan L1, critic
# finding B1). Read private/README.md first. It changes git config in the
# checkouts it is given, so run it only with the owner's go.
#
#   private/bin/install-guards.sh [--rev <commit>] [--pin-root <dir>]
#       [--private <checkout>]... [--public <clone>]... [--dry-run]
#       [--accept-blocked-worktrees]
#   private/bin/install-guards.sh --verify [--pin-root <dir>]
#
# A hooks path relative to each worktree fails open: a worktree on a branch
# from before the hooks existed has no hook directory, and git then runs no
# hook at all. In a public clone, a path into its own tree would run
# whatever the latest merged change put there. So this script copies the
# hooks and every file they run out of one reviewed commit's objects (default
# origin/main of this checkout; never the working tree) into
# <pin root>/<commit>/ (default pin root ~/.local/share/agenttool/public-guards),
# makes the copy read-only, and points core.hooksPath at it:
#
#   --private <checkout>  core.hooksPath = <pin>/private/githooks
#                         (the repository config, shared by its worktrees)
#   --public <clone>      core.hooksPath = <pin>/tools/githooks
#
# Each checkout's previous core.hooksPath is recorded first in
# <pin root>/backups/<time>.tsv. Every install is verified by running the
# installed pre-push the way git would and requiring a refusal: a private
# checkout must refuse a push to the public repository's URL, and a public
# clone must refuse a push of an object it does not have. --dry-run prints
# the plan and changes nothing. <pin root>/public-hooks records the public
# hook directory for public-clone.sh.
#
# The commit's shared guard files must match its own reviewed record
# (private/guard/reviewed-shared.json); an unreviewed public change to them is
# never pinned. A pinned directory is never removed by this script: git runs
# no hook at all when core.hooksPath names a missing directory, so --verify
# re-reads every recorded checkout and fails when its hooks path is gone or
# its hook no longer refuses. merge-back.sh, public-export.ts, and
# scan-public.sh refuse to run in a checkout whose hooks path is missing.
#
# A --private install changes the repository config that every worktree of
# that repository shares. A worktree whose HEAD predates the private namespace
# (no private/guard) would then refuse every commit until it is rebased, so
# such worktrees are listed and the install stops unless
# --accept-blocked-worktrees says their owners know.

PINNED_FILES=(
  bin/project-public.ts
  private/bin/relational-scan.ts
  private/bin/reviewed-shared.ts
  private/bin/shared-scope.ts
  private/githooks/pre-commit
  private/githooks/pre-push
  private/guard/reviewed-shared.json
  private/public-repository.ts
  tools/githooks/pre-push
  tools/leak-canaries.txt
  tools/public-guard.ts
  tools/workflow-lint.ts
)

main() {
  set -euo pipefail
  local here root rev="refs/remotes/origin/main" pin_root="${AGENTTOOL_GUARD_PIN_ROOT:-$HOME/.local/share/agenttool/public-guards}" dry=0 verify=0 accept_blocked=0
  local privates=() publics=()
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  root="$(cd "$here/../.." && pwd -P)"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --rev) shift; rev="${1:?}" ;;
      --pin-root) shift; pin_root="${1:?}" ;;
      --private) shift; privates+=("${1:?}") ;;
      --public) shift; publics+=("${1:?}") ;;
      --dry-run) dry=1 ;;
      --verify) verify=1 ;;
      --accept-blocked-worktrees) accept_blocked=1 ;;
      *) fail "usage: private/bin/install-guards.sh [--rev <commit>] [--pin-root <dir>] [--private <checkout>]... [--public <clone>]... [--dry-run] [--accept-blocked-worktrees] | --verify [--pin-root <dir>]" ;;
    esac
    shift
  done
  case "$pin_root" in /*) ;; *) fail "--pin-root must be an absolute path" ;; esac
  command -v bun >/dev/null 2>&1 || fail "bun is required"
  if [ "$verify" = 1 ]; then
    verify_installs "$pin_root"
    return $?
  fi
  local commit
  commit="$(git -C "$root" rev-parse --verify --quiet "$rev^{commit}")" || fail "cannot resolve $rev"
  local path
  for path in "${PINNED_FILES[@]}"; do
    git -C "$root" cat-file -e "$commit:$path" 2>/dev/null || fail "${commit:0:12} lacks $path"
  done
  local pin="$pin_root/${commit:0:12}"

  # Worktrees that a --private install would block (C7).
  local checkout blocked=()
  for checkout in "${privates[@]+"${privates[@]}"}"; do
    local worktree
    while IFS= read -r worktree; do
      [ -d "$worktree" ] || continue
      git -C "$worktree" cat-file -e HEAD:private/guard/relational-denylist.json 2>/dev/null || blocked+=("$worktree")
    done < <(git -C "$checkout" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
  done
  if [ "${#blocked[@]}" -gt 0 ]; then
    printf 'install-guards: this worktree predates the private namespace and would refuse every commit: %s\n' "${blocked[@]}" >&2
    [ "$accept_blocked" = 1 ] || [ "$dry" = 1 ] || fail "${#blocked[@]} worktree(s) would be blocked; rebase them or tell their owners, then pass --accept-blocked-worktrees"
  fi

  if [ "$dry" = 1 ]; then
    echo "install-guards: would pin ${commit:0:12} into $pin"
    for path in "${privates[@]+"${privates[@]}"}"; do echo "install-guards: would set core.hooksPath=$pin/private/githooks in $path"; done
    for path in "${publics[@]+"${publics[@]}"}"; do echo "install-guards: would set core.hooksPath=$pin/tools/githooks in $path"; done
    return 0
  fi

  mkdir -p "$pin_root/backups"
  if [ -d "$pin" ]; then
    for path in "${PINNED_FILES[@]}"; do
      [ "$(git -C "$root" rev-parse "$commit:$path")" = "$(git hash-object "$pin/$path")" ] || fail "$pin exists and differs from ${commit:0:12}; remove it deliberately first"
    done
  else
    local staging
    staging="$(mktemp -d "$pin_root/.staging.XXXXXX")"
    for path in "${PINNED_FILES[@]}"; do
      mkdir -p "$staging/$(dirname "$path")"
      git -C "$root" cat-file blob "$commit:$path" >"$staging/$path"
      case "$path" in */githooks/*) chmod 0555 "$staging/$path" ;; *) chmod 0444 "$staging/$path" ;; esac
    done
    if ! bun --config=/dev/null --no-env-file "$staging/private/bin/reviewed-shared.ts" check --root "$staging" >/dev/null; then
      chmod -R u+w "$staging" && rm -rf "$staging"
      fail "${commit:0:12}'s shared guard files differ from its reviewed record (private/guard/reviewed-shared.json); refusing to pin unreviewed hooks"
    fi
    find "$staging" -type d -exec chmod 0555 {} +
    mv "$staging" "$pin"
  fi

  local backup slug
  backup="$pin_root/backups/$(date -u +%Y%m%dT%H%M%SZ).tsv"
  slug="$(bun --config=/dev/null --no-env-file "$pin/private/public-repository.ts")"
  local previous
  for checkout in "${privates[@]+"${privates[@]}"}"; do
    git -C "$checkout" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$checkout is not a git checkout"
    previous="$(git -C "$checkout" config --get core.hooksPath || echo '(unset)')"
    printf 'private\t%s\t%s\n' "$(cd "$checkout" && pwd -P)" "$previous" >>"$backup"
    git -C "$checkout" config core.hooksPath "$pin/private/githooks"
    if (cd "$checkout" && "$pin/private/githooks/pre-push" public "https://github.com/$slug.git" </dev/null >/dev/null 2>&1); then
      fail "$checkout: the installed pre-push did not refuse a push to the public repository"
    fi
    echo "install-guards: $checkout uses $pin/private/githooks (verified refusal)"
  done
  for checkout in "${publics[@]+"${publics[@]}"}"; do
    git -C "$checkout" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$checkout is not a git checkout"
    previous="$(git -C "$checkout" config --get core.hooksPath || echo '(unset)')"
    printf 'public\t%s\t%s\n' "$(cd "$checkout" && pwd -P)" "$previous" >>"$backup"
    git -C "$checkout" config core.hooksPath "$pin/tools/githooks"
    if (cd "$checkout" && printf 'refs/heads/main %s refs/heads/main %s\n' "$(printf 'f%.0s' {1..40})" "$(printf '0%.0s' {1..40})" |
      "$pin/tools/githooks/pre-push" origin "https://github.com/$slug.git" >/dev/null 2>&1); then
      fail "$checkout: the installed pre-push did not refuse an object the clone lacks"
    fi
    echo "install-guards: $checkout uses $pin/tools/githooks (verified refusal)"
  done
  printf '%s\n' "$pin/tools/githooks" >"$pin_root/public-hooks"
  echo "install-guards: pinned ${commit:0:12} at $pin; previous hook paths in $backup"
}

# --verify: every checkout a backup records still runs its pinned hooks. A
# hooks path that names a missing directory makes git run no hook at all.
verify_installs() {
  local pin_root="$1" problems=0 kind checkout previous current slug
  shopt -s nullglob
  local backups=("$pin_root"/backups/*.tsv)
  [ "${#backups[@]}" -gt 0 ] || fail "no install is recorded under $pin_root/backups"
  while IFS=$'\t' read -r kind checkout previous; do
    [ -n "$checkout" ] || continue
    if [ ! -d "$checkout" ]; then
      echo "install-guards: $checkout is gone (skipped)"
      continue
    fi
    current="$(git -C "$checkout" config --get core.hooksPath || true)"
    if [ -z "$current" ]; then
      echo "install-guards: $checkout has no core.hooksPath: no hook runs"
      problems=$((problems + 1))
      continue
    fi
    if [ ! -x "$current/pre-push" ]; then
      echo "install-guards: $checkout points at $current, which is missing: no hook runs"
      problems=$((problems + 1))
      continue
    fi
    slug="$(bun --config=/dev/null --no-env-file "$current/../../private/public-repository.ts" 2>/dev/null || true)"
    if [ "$kind" = private ]; then
      if [ -z "$slug" ] || (cd "$checkout" && "$current/pre-push" public "https://github.com/$slug.git" </dev/null >/dev/null 2>&1); then
        echo "install-guards: $checkout: the pre-push did not refuse a push to the public repository"
        problems=$((problems + 1))
        continue
      fi
    fi
    echo "install-guards: $checkout uses $current (present)"
  done < <(cat "${backups[@]}" | sort -u -t $'\t' -k1,2)
  [ "$problems" = 0 ] || fail "$problems checkout(s) run no guard hook; reinstall them"
  echo "install-guards: every recorded checkout runs its pinned hooks"
}

fail() {
  printf 'install-guards: %s\n' "$*" >&2
  exit 1
}

main "$@"
exit $?
