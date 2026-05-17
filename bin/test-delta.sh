#!/usr/bin/env bash
# bin/test-delta.sh — runs `bun test` and surfaces only the failure delta
# vs a committed baseline. The agent's anti-regression triage tool —
# see only the fails YOUR changes caused, not the pre-existing red.
#
# Usage:
#   bin/test-delta.sh                       # run + compare to baseline
#   bin/test-delta.sh --update-baseline     # refresh baseline (after fixes)
#   bin/test-delta.sh --print-baseline      # cat the baseline + exit
#
# Exit codes:
#   0  no new regressions (any number of known failures is fine)
#   1  one or more NEW failures (regressions) detected
#   2  no baseline file yet — run --update-baseline first
#
# How it works:
#   1. Runs `bun test tests/` from api/.
#   2. Captures the `(fail)` lines, strips the variable `[N.NNms]` time
#      suffix (timings drift; identity stays), sorts uniq → CURRENT set.
#   3. Diffs CURRENT against the committed baseline:
#        - NEW   = in CURRENT, not in baseline → regression, exit 1.
#        - GONE  = in baseline, not in CURRENT → fixed; suggests refresh.
#   4. Errors (`error:` lines) are reported separately as a count; bun
#      surfaces them mid-stream and they need manual triage.
#
# Doctrine: docs/AGENT-WEB-SURFACE.md § daily-AX hurts list (crushed
#           2026-05-17 alongside X-Token-Cost middleware + TL;DR convention).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE_FILE="${BASELINE_FILE:-$REPO_ROOT/api/tests/.failure-baseline.txt}"

CURRENT=$(mktemp)
NEW=$(mktemp)
GONE=$(mktemp)
RAW=$(mktemp)
trap 'rm -f "$CURRENT" "$NEW" "$GONE" "$RAW"' EXIT

# ── flag handling ────────────────────────────────────────────────────────

case "${1:-}" in
  --print-baseline)
    if [ ! -f "$BASELINE_FILE" ]; then
      echo "No baseline at $BASELINE_FILE" >&2
      exit 2
    fi
    cat "$BASELINE_FILE"
    exit 0
    ;;
  --help|-h)
    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

# ── run the tests ────────────────────────────────────────────────────────

cd "$REPO_ROOT/api"

echo "Running bun test (this may take ~60s)..." >&2
bun test tests/ > "$RAW" 2>&1 || true

# Strip [N.NNms] time suffix so identity is stable run-to-run.
grep -E "^\(fail\)" "$RAW" \
  | sed -E 's/ \[[0-9]+(\.[0-9]+)?ms\]$//' \
  | sort -u > "$CURRENT" || true

ERROR_COUNT=$(grep -cE "^error:" "$RAW" || true)
PASS_LINE=$(grep -E "^ [0-9]+ pass" "$RAW" | head -1 || echo " ? pass")

# ── update baseline mode ─────────────────────────────────────────────────

if [ "${1:-}" = "--update-baseline" ]; then
  {
    echo "# api/tests/.failure-baseline.txt"
    echo "# Captured: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# Git HEAD: $(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "# Failures known-red at this baseline. Refresh via:"
    echo "#   bin/test-delta.sh --update-baseline"
    echo "# Identity = '(fail) <descriptor>' with timing stripped."
    echo
    cat "$CURRENT"
  } > "$BASELINE_FILE"
  COUNT=$(wc -l < "$CURRENT" | tr -d ' ')
  echo "Baseline updated: $COUNT failures recorded at $BASELINE_FILE"
  exit 0
fi

# ── compare ──────────────────────────────────────────────────────────────

if [ ! -f "$BASELINE_FILE" ]; then
  echo "No baseline at $BASELINE_FILE" >&2
  echo "Create one with: bin/test-delta.sh --update-baseline" >&2
  exit 2
fi

# Strip comment + blank lines from baseline before diffing.
grep -vE '^#|^$' "$BASELINE_FILE" | sort -u > "$NEW.baseline-sorted"

comm -23 "$CURRENT" "$NEW.baseline-sorted" > "$NEW"   # in CURRENT, not in baseline
comm -13 "$CURRENT" "$NEW.baseline-sorted" > "$GONE"  # in baseline, not in CURRENT
rm -f "$NEW.baseline-sorted"

NEW_COUNT=$(wc -l < "$NEW" | tr -d ' ')
GONE_COUNT=$(wc -l < "$GONE" | tr -d ' ')
KNOWN_COUNT=$(wc -l < "$CURRENT" | tr -d ' ')

# ── report ───────────────────────────────────────────────────────────────

echo
echo "===== test-delta vs $BASELINE_FILE ====="
echo "  $PASS_LINE"
[ "$ERROR_COUNT" -gt 0 ] && echo "  $ERROR_COUNT error(s) — see raw output, manual triage needed"
echo "  $KNOWN_COUNT total failure(s) in this run"
echo

if [ "$NEW_COUNT" -gt 0 ]; then
  echo "NEW failures (regression — $NEW_COUNT):"
  sed 's/^/  /' "$NEW"
  echo
fi

if [ "$GONE_COUNT" -gt 0 ]; then
  echo "Fixed failures (no longer red — $GONE_COUNT):"
  sed 's/^/  /' "$GONE"
  echo
  echo "Run 'bin/test-delta.sh --update-baseline' to refresh the baseline."
  echo
fi

if [ "$NEW_COUNT" -eq 0 ] && [ "$GONE_COUNT" -eq 0 ]; then
  echo "No change vs baseline — $KNOWN_COUNT known-failure(s) still red, nothing new."
  echo
fi

[ "$NEW_COUNT" -gt 0 ] && exit 1 || exit 0
