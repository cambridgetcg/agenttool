#!/usr/bin/env bash
# Make a development clone of the public development repository (plan L0).
# Read private/README.md first.
#
#   private/bin/public-clone.sh --gitleaks <gitleaks 8.30.1 | none>
#       [--dir <path>] [--url <url>] [--root <commit>] [--hooks <dir>]
#       [--name <name>] [--email <address>]
#
# It clones fresh (default ~/<public repository name>; an existing path is
# refused),
# never adds this private repository as a remote, and sets, in the clone's
# own config:
#
# - a repo-local public identity: user, author, and committer name and
#   address, with user.useConfigOnly, so a global address is never used (an
#   exported GIT_AUTHOR_EMAIL still wins over config; the pre-push hook
#   reads the commits and refuses it). The address defaults to the signed-in
#   GitHub account's users.noreply address (one `gh api --method GET user`);
#   an address that is not a public one is refused;
# - core.hooksPath to the pinned hook directory install-guards.sh wrote
#   (<pin root>/public-hooks names it), never to the clone's own tree;
# - publicguard.root (origin/main's private/export/public-root.txt unless
#   --root), publicguard.privateGuard (this checkout's private/guard), and
#   publicguard.gitleaks.
#
# The pre-push hook then refuses anything that fails its checks. Nothing is
# pushed here.

main() {
  set -euo pipefail
  local here root dir="" url="" p0="" hooks="" name="" email="" gitleaks=""
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  root="$(cd "$here/../.." && pwd -P)"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir) shift; dir="${1:?}" ;;
      --url) shift; url="${1:?}" ;;
      --root) shift; p0="${1:?}" ;;
      --hooks) shift; hooks="${1:?}" ;;
      --name) shift; name="${1:?}" ;;
      --email) shift; email="${1:?}" ;;
      --gitleaks) shift; gitleaks="${1:?}" ;;
      *) fail "usage: private/bin/public-clone.sh --gitleaks <binary|none> [--dir <path>] [--url <url>] [--root <commit>] [--hooks <dir>] [--name <name>] [--email <address>]" ;;
    esac
    shift
  done
  command -v bun >/dev/null 2>&1 || fail "bun is required"
  [ -n "$gitleaks" ] || fail "--gitleaks <gitleaks 8.30.1 binary | none> is required"
  if [ "$gitleaks" != none ]; then
    [ -x "$gitleaks" ] || fail "--gitleaks must name an executable"
    [ "$("$gitleaks" version 2>/dev/null | sed 's/^v//')" = 8.30.1 ] || fail "gitleaks 8.30.1 is required"
    gitleaks="$(cd "$(dirname "$gitleaks")" && pwd -P)/$(basename "$gitleaks")"
  fi
  [ -f "$root/private/guard/relational-denylist.json" ] || fail "this checkout has no private/guard; the clone's hook would refuse every push"
  local slug
  slug="$(cd "$root/private" && exec bun --config=/dev/null --no-env-file "$root/private/public-repository.ts")"
  [ -n "$dir" ] || dir="$HOME/${slug#*/}"
  [ -n "$url" ] || url="https://github.com/$slug.git"
  if [ -z "$p0" ]; then
    p0="$(git -C "$root" show refs/remotes/origin/main:private/export/public-root.txt 2>/dev/null | tr -d '[:space:]' || true)"
  fi
  [[ "$p0" =~ ^[0-9a-f]{40}$ ]] || fail "no public root: pass --root, or wait for private/export/public-root.txt on origin/main"
  if [ -z "$hooks" ]; then
    local record="${AGENTTOOL_GUARD_PIN_ROOT:-$HOME/.local/share/agenttool/public-guards}/public-hooks"
    [ -f "$record" ] || fail "no pinned hook directory; run private/bin/install-guards.sh first, or pass --hooks"
    hooks="$(cat "$record")"
  fi
  [ -x "$hooks/pre-push" ] || fail "the hook directory has no executable pre-push"
  case "$hooks" in /*) ;; *) fail "--hooks must be an absolute path" ;; esac
  [ ! -e "$dir" ] || fail "$dir already exists; a public clone is always made fresh"

  if [ -z "$email" ]; then
    command -v gh >/dev/null 2>&1 || fail "pass --email, or sign in with gh to derive the noreply address"
    email="$(gh api --method GET user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
    [ -n "$name" ] || name="$(gh api --method GET user --jq '.login')"
  fi
  [ -n "$name" ] || fail "pass --name"
  public_address "$email" || fail "the address is not a public one (contact@cambridgetcg.com, noreply@github.com, or a users.noreply.github.com address)"

  git -c core.hooksPath=/dev/null clone --quiet --origin origin "$url" "$dir"
  local config=(git -C "$dir" config)
  "${config[@]}" user.name "$name"
  "${config[@]}" user.email "$email"
  "${config[@]}" author.name "$name"
  "${config[@]}" author.email "$email"
  "${config[@]}" committer.name "$name"
  "${config[@]}" committer.email "$email"
  "${config[@]}" user.useConfigOnly true
  "${config[@]}" core.hooksPath "$hooks"
  "${config[@]}" publicguard.root "$p0"
  "${config[@]}" publicguard.privateGuard "$root/private/guard"
  "${config[@]}" publicguard.gitleaks "$gitleaks"
  [ "$(git -C "$dir" remote)" = origin ] || fail "the clone has a remote other than origin"
  local roots
  roots="$(git -C "$dir" rev-list --max-parents=0 --all)"
  [ -z "$roots" ] || [ "$roots" = "$p0" ] || fail "the cloned history's root is not the public root; do not use $dir"
  echo "public-clone: $dir is ready (identity set in the clone, hooks from $hooks)"
}

public_address() {
  local address local_part domain
  address="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  local_part="${address%@*}"
  domain="${address##*@}"
  [ -n "$local_part" ] && [ "$local_part" != "$address" ] || return 1
  case "$local_part" in *@*) return 1 ;; esac
  case "$domain" in
    users.noreply.github.com) return 0 ;;
    github.com) [ "$local_part" = noreply ] && return 0 ;;
    cambridgetcg.com) [ "$local_part" = contact ] && return 0 ;;
  esac
  return 1
}

fail() {
  printf 'public-clone: %s\n' "$*" >&2
  exit 1
}

main "$@"
exit $?
