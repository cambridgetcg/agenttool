#!/usr/bin/env bash
# bin/wake-probe.sh — agent-surface probe. Fetches the four canonical
# orientation doors of an agenttool instance and pretty-prints what an
# agent learns at session-start.
#
# Mirrors what a freshly-arrived agent does in the first 4 fetches:
#   1. GET /.well-known/agent.txt        (key:value manifest, single fetch)
#   2. GET /v1/welcome                   (standing invitation)
#   3. GET /v1/pathways                  (every door)
#   4. GET /public/self                  (platform + repo structural map)
#
# Each fetch surfaces:
#   - HTTP status + X-Token-Cost / X-Byte-Count headers (cost honesty)
#   - Substrate-Disposition + canon_pointer where present
#   - verbs[] count + next-action paths
#   - First two structural fields for orientation
#
# Usage:
#   bin/wake-probe.sh                          # probe api.agenttool.dev
#   bin/wake-probe.sh https://my.fork.dev      # probe a federated peer
#   bin/wake-probe.sh --raw                    # dump raw bodies (no summary)
#
# Doctrine: docs/AGENT-WEB-SURFACE.md (the surface layer probed) ·
#           docs/AGENTS-ONLY.md (the voice the surface speaks in).

set -euo pipefail

BASE="${1:-https://api.agenttool.dev}"
RAW=0
[ "${1:-}" = "--raw" ] && { RAW=1; BASE="${2:-https://api.agenttool.dev}"; }

if ! command -v curl >/dev/null; then
  echo "curl is required" >&2; exit 1
fi
if ! command -v jq >/dev/null && ! command -v python3 >/dev/null; then
  echo "jq or python3 is required for pretty-printing" >&2; exit 1
fi

# Pretty-print JSON using jq if present, else python3.
pp() {
  if command -v jq >/dev/null; then jq . 2>/dev/null || cat
  else python3 -m json.tool 2>/dev/null || cat
  fi
}

# Extract a JSON field via jq if present, else python3 -c.
field() {
  local body="$1" key="$2"
  if command -v jq >/dev/null; then
    printf '%s' "$body" | jq -r --arg k "$key" 'getpath($k | split(".")) // empty' 2>/dev/null
  else
    printf '%s' "$body" | python3 -c "
import json, sys
body = json.load(sys.stdin)
keys = '$key'.split('.')
for k in keys:
    if isinstance(body, dict) and k in body:
        body = body[k]
    else:
        sys.exit(0)
print(body if not isinstance(body, (dict, list)) else json.dumps(body))
" 2>/dev/null
  fi
}

probe_one() {
  local path="$1" label="$2"
  local url="${BASE}${path}"
  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ${label}"
  echo "  GET ${url}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  local hdr body status
  hdr=$(mktemp); body=$(mktemp)
  trap 'rm -f "$hdr" "$body"' RETURN
  status=$(curl -sS -o "$body" -D "$hdr" -w "%{http_code}" --max-time 10 "$url" || echo "000")
  echo "  HTTP ${status}"
  # Cost-honest headers per Move 1. Use `|| true` because grep returns 1
  # when no header matches (set -e would kill the script).
  local toks bytes disp
  toks=$(grep -i '^X-Token-Cost:' "$hdr" 2>/dev/null | sed 's/.*: *//' | tr -d '\r' || true)
  bytes=$(grep -i '^X-Byte-Count:' "$hdr" 2>/dev/null | sed 's/.*: *//' | tr -d '\r' || true)
  disp=$(grep -i '^Substrate-Disposition:' "$hdr" 2>/dev/null | sed 's/.*: *//' | tr -d '\r' || true)
  [ -n "$bytes" ] && echo "  X-Byte-Count:           ${bytes}"
  [ -n "$toks" ]  && echo "  X-Token-Cost:           ${toks} tokens"
  [ -n "$disp" ]  && echo "  Substrate-Disposition:  ${disp}"

  if [ "$RAW" -eq 1 ]; then
    echo
    echo "  ── body ──"
    cat "$body"
    return
  fi

  # agent.txt is text/agent (key:value); rest is JSON.
  if [[ "$path" == *.txt ]]; then
    echo
    echo "  ── manifest (selected keys) ──"
    grep -E '^(Substrate|Welcome|Pathways|Self|Canon|Wake|Arrival-Door|Walls):' "$body" 2>/dev/null | sed 's/^/    /' || echo "    (no manifest — endpoint may not be deployed yet)"
    return
  fi

  local bodytext
  bodytext=$(cat "$body")

  # _canon_pointer per Moves 3 + 5.
  local canon
  canon=$(field "$bodytext" "_canon_pointer")
  [ -n "$canon" ] && echo "  _canon_pointer:         ${canon}"

  # verbs[] per Move 3.
  local verbs_count
  if command -v jq >/dev/null; then
    verbs_count=$(printf '%s' "$bodytext" | jq -r '.verbs | length // 0' 2>/dev/null || echo 0)
  else
    verbs_count=$(printf '%s' "$bodytext" | python3 -c "
import json, sys
try:
    body = json.load(sys.stdin)
    print(len(body.get('verbs', [])))
except: print(0)
" 2>/dev/null || echo 0)
  fi
  if [ "${verbs_count:-0}" -gt 0 ]; then
    echo "  verbs:                  ${verbs_count} action(s) advertised"
    if command -v jq >/dev/null; then
      printf '%s' "$bodytext" | jq -r '.verbs[] | "    " + .method + " " + .path + "  — " + .action' 2>/dev/null | head -7
    fi
  fi
}

echo "agenttool wake-probe — ${BASE}"
echo "Per AGENT-WEB-SURFACE.md (the surface the agent meets at session-start)."

probe_one "/.well-known/agent.txt" "agent.txt — surface manifest (Move 7)"
probe_one "/v1/welcome"            "welcome — standing invitation (Moves 3 + 5)"
probe_one "/v1/pathways"           "pathways — every door (Moves 3 + 5)"
probe_one "/public/self"           "self — platform + repo + the seat (Moves 3 + 5)"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Probe complete. Four fetches; the agent now has identity · doors ·"
echo "  costs · verbs · canon anchors. Next: /v1/register/agent to arrive."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
