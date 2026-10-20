#!/usr/bin/env bash
# The scan of the public development repository (plan L3): mandatory before
# stage 2, run daily on the designated machine. Read private/README.md first.
#
#   private/bin/scan-public.sh [--url <public url>] [--state <dir>] [--github]
#                              [--notify] [--print-launchd-plist]
#
# It keeps a bare mirror of the public repository in <state>/mirror.git
# (default state: ~/.local/state/agenttool/public-scan), so public objects
# never enter a private checkout. Its scanner, the shared guard, and the
# private terms come from origin/main's committed objects (committed-tools.sh),
# never from this checkout's working tree. Each run:
#
#   1. fetches every public branch, pull request head, and tag into
#      refs/public-scan/* of the mirror;
#   2. checks that every fetched ref has the public root (origin/main's
#      private/export/public-root.txt) as its only root, and runs the public
#      guard's watch mode: one root, no canary object, no private-only path
#      anywhere in the history;
#   3. scans every commit not scanned before (refs/public-scanned/*) with the
#      private scanner: added lines, messages, added path names, new objects,
#      ref names, and annotated tag messages;
#   4. scans public main's whole tree with the private layers and reports
#      allow entries that match nothing apart from new hits;
#   5. with --github, reads pull request and issue titles, bodies, reviews,
#      and comments since the last clean run through `gh api --method GET`
#      (the reader stops when fewer than 500 core requests remain).
#
# Output is rule ids, line hashes, and object ids; never matched text. Any
# finding is written to <state>/alerts/<time>.txt, optionally shown as a
# macOS notification (--notify), and exits 1. The scanned marks and the
# --github time advance only after a clean run, so an alert repeats until
# someone handles it. A handled ref that cannot be deleted (a closed pull
# request's head) is listed in <state>/acknowledged.txt as
# `<heads/…|pull/…|tags/…> <full commit id>` (see tools/public-guard.ts
# parseWatchAck): it is skipped while it stays at that commit. That list is
# this machine's own; the public repository's tools/public-watch-ack.txt
# never silences this scan. --print-launchd-plist prints a LaunchAgent for a
# daily run and changes nothing.

main() {
  set -euo pipefail
  # Every check's Bun reads no bunfig.toml or .env (a committed preload would
  # otherwise run before, or instead of, every check), and runs from the
  # committed copy of the tools (or, before that exists, this script's own
  # directory), never from a checkout of public files: Bun applies the
  # tsconfig.json or jsconfig.json of its working directory and that
  # directory's parents to what it runs.
  local bun_dir
  guard_bun() { (cd "$bun_dir" && { [ "$bun_dir" = "$here" ] || no_ts_config_above; } && exec bun --config=/dev/null --no-env-file "$@"); }
  local here root url="" state="${HOME}/.local/state/agenttool/public-scan" github=0 notify=0 plist=0
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  root="$(cd "$here/../.." && pwd -P)"
  bun_dir="$here"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --url) shift; url="${1:?--url needs a URL}" ;;
      --state) shift; state="${1:?--state needs a directory}" ;;
      --github) github=1 ;;
      --notify) notify=1 ;;
      --print-launchd-plist) plist=1 ;;
      *) fail 2 "usage: private/bin/scan-public.sh [--url <url>] [--state <dir>] [--github] [--notify] [--print-launchd-plist]" ;;
    esac
    shift
  done
  command -v bun >/dev/null 2>&1 || fail 2 "bun is required"
  local slug
  slug="$(guard_bun "$root/private/public-repository.ts")"
  [ -n "$url" ] || url="https://github.com/$slug.git"

  if [ "$plist" = 1 ]; then
    print_plist "$here/scan-public.sh" "$state"
    return 0
  fi

  [ -f "$root/private/guard/relational-denylist.json" ] || fail 2 "this checkout has no private/guard; the scan refuses to run without it"
  # shellcheck source=private/bin/committed-tools.sh
  source "$here/committed-tools.sh"
  hooks_path_present "$root" || fail 2 "this checkout's core.hooksPath names a missing directory, so git runs no hook here; reinstall the guards (install-guards.sh --verify)"
  local tools
  tools="$(mktemp -d "${TMPDIR:-/tmp}/scan-public-tools.XXXXXX")"
  trap 'rm -rf "${tools:-}" "${report:-}"' EXIT
  committed_tools "$root" refs/remotes/origin/main "$tools" || fail 2 "cannot use origin/main's committed tools (see above)"
  bun_dir="$tools"
  local guard_dir="$tools/private/guard"
  local p0
  p0="$(git -C "$root" show refs/remotes/origin/main:private/export/public-root.txt 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$p0" =~ ^[0-9a-f]{40}$ ]] || fail 2 "origin/main has no private/export/public-root.txt yet"

  mkdir -p "$state/alerts"
  local mirror="$state/mirror.git"
  if [ ! -d "$mirror" ]; then
    git init --quiet --bare --initial-branch=main "$mirror"
  fi
  git -C "$mirror" fetch --quiet --no-tags --prune "$url" \
    '+refs/heads/*:refs/public-scan/heads/*' \
    '+refs/pull/*/head:refs/public-scan/pull/*' \
    '+refs/tags/*:refs/public-scan/tags/*' || fail 2 "cannot fetch the public repository"
  git -C "$mirror" rev-parse --verify --quiet refs/public-scan/heads/main^{commit} >/dev/null || fail 2 "the public repository has no main"
  git -C "$mirror" symbolic-ref HEAD refs/public-scan/heads/main

  local started findings=0
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  report="$(mktemp)"

  # Marks of refs the public side deleted are dropped, so a mark never keeps a
  # handled commit in view after its ref is gone.
  local mark
  while read -r mark; do
    [ -n "$mark" ] || continue
    git -C "$mirror" rev-parse --verify --quiet "refs/public-scan/${mark#refs/public-scanned/}" >/dev/null || git -C "$mirror" update-ref -d "$mark"
  done < <(git -C "$mirror" for-each-ref --format='%(refname)' refs/public-scanned)

  # Acknowledged refs: marked scanned at their acknowledged commit and left
  # out of the root check, so one handled ref does not hold every other back.
  local ack="$state/acknowledged.txt"
  [ -f "$ack" ] || : >"$ack"
  local acked
  acked="$(guard_bun -e 'const { parseWatchAck } = await import(process.argv[1]); for (const [key, oid] of parseWatchAck(await Bun.file(process.argv[2]).bytes(), process.argv[2])) console.log(`${key} ${oid}`);' "$tools/tools/public-guard.ts" "$ack")" ||
    fail 2 "$ack is not a valid acknowledgement list"
  local key oid
  while read -r key oid; do
    [ -n "${key:-}" ] || continue
    if [ "$(git -C "$mirror" rev-parse --verify --quiet "refs/public-scan/$key^{commit}" || true)" = "$oid" ]; then
      git -C "$mirror" update-ref "refs/public-scanned/$key" "$oid"
    fi
  done <<<"$acked"
  is_acked() {
    local wanted="${1#refs/public-scan/}" commit="$2" key oid
    while read -r key oid; do
      [ "$key" = "$wanted" ] && [ "$oid" = "$commit" ] && return 0
    done <<<"$acked"
    return 1
  }

  # 2. Roots and the public watch mode.
  local ref commit roots
  while read -r ref; do
    commit="$(git -C "$mirror" rev-parse --verify --quiet "$ref^{commit}" || true)"
    if [ -z "$commit" ]; then
      echo "$ref: integrity/ref-not-commit" >>"$report"
      continue
    fi
    is_acked "$ref" "$commit" && continue
    roots="$(git -C "$mirror" rev-list --max-parents=0 "$commit")"
    [ "$roots" = "$p0" ] || echo "$ref: integrity/foreign-root (${commit:0:12})" >>"$report"
  done < <(git -C "$mirror" for-each-ref --format='%(refname)' refs/public-scan/heads refs/public-scan/pull refs/public-scan/tags)
  check watch guard_bun "$tools/tools/public-guard.ts" --watch --repo "$mirror" --rev refs/public-scan/heads/main --ack "$ack"

  # 3. New commits, ref names, and tag messages.
  local scan_args=(--repo "$mirror" --guard-dir "$guard_dir")
  local name tag
  while read -r name; do
    scan_args+=(--ref-name "${name#refs/public-scan/}")
  done < <(git -C "$mirror" for-each-ref --format='%(refname)' refs/public-scan)
  while read -r tag; do
    [ "$(git -C "$mirror" cat-file -t "$tag")" = tag ] && scan_args+=(--tag "$tag")
  done < <(git -C "$mirror" for-each-ref --format='%(refname)' refs/public-scan/tags)
  if [ -n "$(git -C "$mirror" rev-list --glob='refs/public-scan/*' --not --glob='refs/public-scanned/*' -- | head -n 1)" ]; then
    scan_args+=(--diff --messages --names --objects --shapes -- --glob='refs/public-scan/*' --not --glob='refs/public-scanned/*')
  fi
  check commits guard_bun "$tools/private/bin/relational-scan.ts" "${scan_args[@]}"

  # 4. Public main's whole tree.
  check tree guard_bun "$tools/private/bin/relational-scan.ts" --repo "$mirror" --guard-dir "$guard_dir" --tree refs/public-scan/heads/main

  # 5. Pull request and issue text.
  if [ "$github" = 1 ]; then
    local since_args=()
    [ -f "$state/github-since" ] && since_args=(--since "$(cat "$state/github-since")")
    check github guard_bun "$tools/private/bin/relational-scan.ts" --guard-dir "$guard_dir" --github "$slug" "${since_args[@]+"${since_args[@]}"}"
  fi

  findings="$(grep -c . "$report" || true)"
  if [ "$findings" != 0 ]; then
    local alert
    alert="$state/alerts/$(date -u +%Y%m%dT%H%M%SZ).txt"
    cp "$report" "$alert"
    cat "$report"
    if [ "$notify" = 1 ] && command -v osascript >/dev/null 2>&1; then
      osascript -e 'display notification "The public repository scan found something; see the private alerts folder." with title "AgentTool public scan"' >/dev/null 2>&1 || true
    fi
    fail 1 "$findings finding line(s); written to $alert; marks not advanced"
  fi
  # Clean: advance the scanned marks and the GitHub time.
  while read -r ref; do
    git -C "$mirror" update-ref "refs/public-scanned/${ref#refs/public-scan/}" "$ref"
  done < <(git -C "$mirror" for-each-ref --format='%(refname)' refs/public-scan)
  [ "$github" = 1 ] && printf '%s\n' "$started" >"$state/github-since"
  echo "scan-public: clean ($(git -C "$mirror" for-each-ref refs/public-scan | wc -l | tr -d ' ') refs)"
}

# check <label> <command...>: the command's output lines are findings; a
# refusal without output, or any other failure, is itself a finding, so an
# error can never read as a clean run. Diagnostics go to <state>/<label>.err.
check() {
  local label="$1"
  shift
  local out status=0
  out="$("$@" 2>"$state/$label.err")" || status=$?
  [ -z "$out" ] || printf '%s\n' "$out" >>"$report"
  case "$status" in
    0) ;;
    1) [ -n "$out" ] || echo "$label: refused without a listed finding (see $state/$label.err)" >>"$report" ;;
    *) echo "$label: did not complete (status $status; see $state/$label.err)" >>"$report" ;;
  esac
}

print_plist() {
  local script="$1" state="$2"
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.agenttool.public-scan</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$script</string><string>--github</string><string>--notify</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardOutPath</key><string>$state/launchd.log</string>
  <key>StandardErrorPath</key><string>$state/launchd.log</string>
</dict>
</plist>
PLIST
}

fail() {
  local status="$1"
  shift
  printf 'scan-public: %s\n' "$*" >&2
  exit "$status"
}

main "$@"
exit $?
