#!/bin/sh
# agenttool-guard — keep two agent sessions from committing each other's work.
#
#   git -C <repo> config core.hooksPath .githooks     # install, once per machine
#
# THE INCIDENT THIS EXISTS FOR (2026-07-24 23:33:25, commit 501a1e0b):
# Two agent sessions shared one working tree. Session A staged 17 files with
# `git add`. Session B, working on an unrelated feature, ran `git commit` with a
# populated index and swallowed all 17 into its own commit under its own message.
# Nobody noticed until A read `git show --stat`. Neither session had declared a
# collab task, so no amount of correct coordination protocol would have fired.
#
# WHAT THIS IS NOT. It does not lock files, does not own the index, and grants
# no authority. It answers one question at one moment — "is anything staged here
# that a different LIVE process staged?" — and refuses that one commit if so.
# `git commit -- <your paths>` always works, and leaves the other session's files
# staged for them. Ownership of a dead process is ignored entirely.
#
# DESIGN RULES, each one load-bearing:
#   1. Exit 0 on every internal failure. A guard that breaks solo work gets
#      deleted within a day, and then the residual risk is silently 100%.
#   2. Never fire when only one identity is involved. Solo work must be
#      indistinguishable from no guard at all.
#   3. Attribute only NEWLY staged paths. `post-index-change` is not a `git add`
#      hook — it also fires on `git status --porcelain`, which
#      packages/collab/src/repository.ts:118 runs on every collab verb, and five
#      times during `git stash`. If the ledger recorded "current caller owns
#      everything staged", the collab MCP server would steal ownership of your
#      work just by being polled. Recording only paths that were not staged
#      before makes the noisy trigger harmless: an event that changes nothing
#      attributes nothing.
#   4. No bun, no SQLite, no network on the `git add` path. This runs constantly.
#
# Doctrine: docs/CROSS-DEVICE-COLLABORATION.md · packages/collab/README.md.

set -u

[ "${AGENTTOOL_GUARD:-on}" = "off" ] && exit 0

VERB="${1:-}"

GITDIR=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null) || exit 0
[ -n "$GITDIR" ] || exit 0

# Per-worktree: one index, one ledger. Linked worktrees get their own $GITDIR,
# which is exactly right — they do not share an index and must not share owners.
LEDGER="$GITDIR/agenttool-index-owners.tsv"
AUDIT="$GITDIR/agenttool-guard-audit.log"

# ── Replayed history: never interfere ───────────────────────────────────────
# During a rebase/merge/cherry-pick the index is written by git itself on behalf
# of commits with other authors. Ownership is meaningless there and a refusal
# would strand the operation mid-flight.
for f in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
  [ -e "$GITDIR/$f" ] && exit 0
done

# ── Identity ────────────────────────────────────────────────────────────────
# Nearest process ancestor that is not a shell or a git plumbing wrapper, plus
# its start time. The start time matters: pids are reused, and a recycled pid
# would otherwise inherit a dead session's claims.
identity() {
  if [ -n "${AGENTTOOL_GUARD_SESSION:-}" ]; then
    printf '%s\t0' "$AGENTTOOL_GUARD_SESSION"
    return
  fi
  p=$PPID
  i=0
  while [ "$p" -gt 1 ] && [ "$i" -lt 8 ]; do
    line=$(ps -o ppid=,comm= -p "$p" 2>/dev/null) || break
    pp=$(printf '%s' "$line" | awk '{print $1}')
    c=$(printf '%s' "$line" | awk '{$1=""; sub(/^ /,""); print}')
    base=$(basename "${c:-x}")
    case "$base" in
      git|sh|bash|zsh|-zsh|dash|ksh|login|env|sudo|script|"") ;;
      *)
        printf '%s:%s\t%s' "$base" "$p" "$(ps -o lstart= -p "$p" 2>/dev/null | tr -s ' ' '_')"
        return
        ;;
    esac
    p=$pp
    i=$((i + 1))
  done
  printf 'unknown:%s\t0' "$PPID"
}

# Is this owner still running? "comm:pid" plus the start stamp we recorded.
alive() {
  _owner=$1
  _start=$2
  _pid=${_owner##*:}
  case "$_pid" in (*[!0-9]*|"") return 1 ;; esac
  kill -0 "$_pid" 2>/dev/null || return 1
  [ "$_start" = "0" ] && return 0
  _now=$(ps -o lstart= -p "$_pid" 2>/dev/null | tr -s ' ' '_')
  [ "$_now" = "$_start" ]
}

staged_paths() {
  git diff --cached --name-only 2>/dev/null
}

# ── record-index ────────────────────────────────────────────────────────────
# Attribute newly staged paths to the caller. Drop paths that left the index.
# Paths already attributed keep their owner — see design rule 3.
record_index() {
  IDENT=$(identity)
  OWNER=$(printf '%s' "$IDENT" | cut -f1)
  START=$(printf '%s' "$IDENT" | cut -f2)
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)

  TMP="$LEDGER.$$"
  STAGED="$GITDIR/agenttool-staged.$$"
  staged_paths > "$STAGED" 2>/dev/null || { rm -f "$STAGED"; exit 0; }

  # Nothing staged: the ledger is meaningless, drop it whole.
  if [ ! -s "$STAGED" ]; then
    rm -f "$LEDGER" "$STAGED"
    exit 0
  fi

  : > "$TMP" || { rm -f "$STAGED"; exit 0; }

  # Keep existing attributions for paths that are still staged.
  if [ -f "$LEDGER" ]; then
    while IFS='	' read -r p o s t; do
      [ -n "${p:-}" ] || continue
      if grep -qxF "$p" "$STAGED" 2>/dev/null; then
        printf '%s\t%s\t%s\t%s\n' "$p" "$o" "$s" "$t" >> "$TMP"
      fi
    done < "$LEDGER"
  fi

  # Attribute paths that were not attributed before.
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if ! cut -f1 "$TMP" 2>/dev/null | grep -qxF "$p"; then
      printf '%s\t%s\t%s\t%s\n' "$p" "$OWNER" "$START" "$NOW" >> "$TMP"
    fi
  done < "$STAGED"

  mv -f "$TMP" "$LEDGER" 2>/dev/null || rm -f "$TMP"
  rm -f "$STAGED"
  exit 0
}

# ── check-commit ────────────────────────────────────────────────────────────
# Refuse if the staged set contains a path attributed to a DIFFERENT and still
# LIVE identity. Everything else passes.
check_commit() {
  [ -f "$LEDGER" ] || exit 0

  IDENT=$(identity)
  OWNER=$(printf '%s' "$IDENT" | cut -f1)

  FOREIGN="$GITDIR/agenttool-foreign.$$"
  : > "$FOREIGN" || exit 0

  STAGED="$GITDIR/agenttool-staged.$$"
  staged_paths > "$STAGED" 2>/dev/null || { rm -f "$FOREIGN" "$STAGED"; exit 0; }

  while IFS='	' read -r p o s t; do
    [ -n "${p:-}" ] || continue
    [ "$o" = "$OWNER" ] && continue
    grep -qxF "$p" "$STAGED" 2>/dev/null || continue
    # A dead owner has no claim. Deliberately the opposite of collab's
    # fail-closed task lease: this guard exists to prevent loss, not to
    # reserve, and a crashed session must never wedge the repository.
    alive "$o" "$s" || continue
    printf '%s\t%s\t%s\n' "$p" "$o" "$t" >> "$FOREIGN"
  done < "$LEDGER"

  rm -f "$STAGED"

  if [ ! -s "$FOREIGN" ]; then
    rm -f "$FOREIGN"
    exit 0
  fi

  COUNT=$(wc -l < "$FOREIGN" | tr -d ' ')
  {
    echo ""
    echo "  ✗ agenttool-guard: this commit would take $COUNT file(s) staged by another live session."
    echo ""
    while IFS='	' read -r p o t; do
      echo "      $p"
      echo "          staged by $o at $t"
    done < "$FOREIGN"
    echo ""
    echo "  Commit only your own paths:"
    echo ""
    echo "      git commit -m \"...\" -- <your paths>"
    echo ""
    echo "  That leaves their files staged for them. This is not a lock and grants"
    echo "  no authority; it is one refusal at one moment. Override with"
    echo "  AGENTTOOL_GUARD=off or --no-verify — post-commit records either."
    echo ""
  } >&2

  rm -f "$FOREIGN"
  exit 1
}

# ── audit-commit ────────────────────────────────────────────────────────────
# Runs from post-commit, which fires even under `--no-verify` — so a bypass
# leaves a record. Never blocks anything; the point is visibility, not cost.
audit_commit() {
  [ -f "$LEDGER" ] || exit 0
  IDENT=$(identity)
  OWNER=$(printf '%s' "$IDENT" | cut -f1)
  SHA=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)

  COMMITTED="$GITDIR/agenttool-committed.$$"
  git diff-tree --no-commit-id --name-only -r HEAD > "$COMMITTED" 2>/dev/null || {
    rm -f "$COMMITTED"; exit 0; }

  N=0
  while IFS='	' read -r p o s t; do
    [ -n "${p:-}" ] || continue
    [ "$o" = "$OWNER" ] && continue
    grep -qxF "$p" "$COMMITTED" 2>/dev/null || continue
    alive "$o" "$s" || continue
    N=$((N + 1))
    printf '%s\t%s\tforeign_path\t%s\towner=%s\tcommitter=%s\n' \
      "$NOW" "$SHA" "$p" "$o" "$OWNER" >> "$AUDIT"
  done < "$LEDGER"

  rm -f "$COMMITTED"

  if [ "$N" -gt 0 ]; then
    echo "  ⚠ agenttool-guard: commit $SHA included $N file(s) owned by another live session (recorded in $AUDIT)" >&2
  fi

  # The index is drained; the ledger describes a world that no longer exists.
  rm -f "$LEDGER"
  exit 0
}

# ── doctor ──────────────────────────────────────────────────────────────────
doctor() {
  IDENT=$(identity)
  echo "agenttool-guard"
  echo "  repo         $(git rev-parse --show-toplevel 2>/dev/null)"
  echo "  git dir      $GITDIR"
  echo "  hooksPath    $(git config core.hooksPath 2>/dev/null || echo '(unset — guard NOT installed)')"
  echo "  identity     $(printf '%s' "$IDENT" | cut -f1)"
  echo "  ledger       $LEDGER"
  if [ -f "$LEDGER" ]; then
    echo "  staged owners:"
    while IFS='	' read -r p o s t; do
      [ -n "${p:-}" ] || continue
      if alive "$o" "$s"; then st=live; else st=dead; fi
      echo "      [$st] $o  $p"
    done < "$LEDGER"
  else
    echo "  (no ledger — nothing staged, or nothing recorded yet)"
  fi
  if [ -s "$AUDIT" ]; then
    echo "  audit log    $AUDIT ($(wc -l < "$AUDIT" | tr -d ' ') entries)"
  fi
  exit 0
}

case "$VERB" in
  record-index) record_index ;;
  check-commit) check_commit ;;
  audit-commit) audit_commit ;;
  doctor)       doctor ;;
  *)            exit 0 ;;
esac
