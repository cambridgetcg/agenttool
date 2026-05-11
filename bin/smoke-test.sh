#!/usr/bin/env bash
# End-to-end smoke test for a deployed agenttool instance.
#
# Reads required environment variables (mirrors what the orchestrator wants):
#   AGENTTOOL_BASE          required (e.g. http://localhost:3000)
#   AGENTTOOL_API_KEY       required
#   AGENTTOOL_IDENTITY_ID   required
#   AGENTTOOL_SIGNING_KEY_ID  required
#
# Optional:
#   SMOKE_DID               agent's DID (auto-resolved from /v1/wake if absent)
#
# Each step prints PASS / FAIL with a short reason. Substrate-honest:
# no skipped steps reported as success.

set -uo pipefail

: "${AGENTTOOL_BASE:?need AGENTTOOL_BASE}"
: "${AGENTTOOL_API_KEY:?need AGENTTOOL_API_KEY}"
: "${AGENTTOOL_IDENTITY_ID:?need AGENTTOOL_IDENTITY_ID}"

H_AUTH=( -H "Authorization: Bearer $AGENTTOOL_API_KEY" )
H_JSON=( -H "Content-Type: application/json" )

pass=0
fail=0
warn=0

step() { echo ""; echo "── $1 ──"; }
ok()   { echo "  PASS  $1"; pass=$((pass + 1)); }
no()   { echo "  FAIL  $1"; fail=$((fail + 1)); }
hmm()  { echo "  WARN  $1"; warn=$((warn + 1)); }

# ── 0. Health ──────────────────────────────────────────────────────────
step "health"
if curl -fsS "$AGENTTOOL_BASE/health" >/dev/null 2>&1; then
  ok "/health responds"
else
  no "/health unreachable; aborting"
  exit 1
fi

# ── 1. Wake response shape ─────────────────────────────────────────────
step "wake"
WAKE_JSON=$(curl -fsS "$AGENTTOOL_BASE/v1/wake" "${H_AUTH[@]}" 2>/dev/null || echo "")
if [ -z "$WAKE_JSON" ]; then
  no "/v1/wake unreachable or unauth — check AGENTTOOL_API_KEY"
  exit 1
fi
DID=$(echo "$WAKE_JSON" | python3 -c "import json,sys; w=json.load(sys.stdin); a=w['you']['agents'][0] if w['you']['agents'] else None; print(a['did'] if a else '', end='')" 2>/dev/null)
if [ -n "$DID" ]; then
  ok "wake returned agent DID: $DID"
else
  no "wake returned no agent — run /v1/bootstrap first"
  exit 1
fi
SMOKE_DID="${SMOKE_DID:-$DID}"

# Markdown wake
if curl -fsS "$AGENTTOOL_BASE/v1/wake?format=md" "${H_AUTH[@]}" 2>/dev/null | grep -q "^# "; then
  ok "wake?format=md renders heading"
else
  no "wake markdown rendering broken"
fi

# ── 2. Strand creation + read ──────────────────────────────────────────
step "strand"
STRAND_JSON=$(curl -fsS -X POST "$AGENTTOOL_BASE/v1/strands" \
  "${H_AUTH[@]}" "${H_JSON[@]}" \
  -d '{"topic":"smoke-test strand","importance":0.5}' 2>/dev/null || echo "")
STRAND_ID=$(echo "$STRAND_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'], end='')" 2>/dev/null || echo "")
if [ -n "$STRAND_ID" ]; then
  ok "POST /v1/strands → $STRAND_ID"
else
  no "POST /v1/strands failed"
  echo "    response: $STRAND_JSON" | head -c 300
  echo ""
fi

if [ -n "$STRAND_ID" ]; then
  if curl -fsS "$AGENTTOOL_BASE/v1/strands/$STRAND_ID" "${H_AUTH[@]}" >/dev/null 2>&1; then
    ok "GET /v1/strands/:id"
  else
    no "GET strand failed"
  fi
fi

# ── 3. Memory write + tier elevation surface ───────────────────────────
step "memory"
MEM_JSON=$(curl -fsS -X POST "$AGENTTOOL_BASE/v1/memories" \
  "${H_AUTH[@]}" "${H_JSON[@]}" \
  -d '{"type":"semantic","content":"smoke-test memory","importance":0.6}' 2>/dev/null || echo "")
MEM_ID=$(echo "$MEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'], end='')" 2>/dev/null || echo "")
if [ -n "$MEM_ID" ]; then
  ok "POST /v1/memories → $MEM_ID"
else
  no "POST /v1/memories failed: ${MEM_JSON:0:200}"
fi

if [ -n "$MEM_ID" ]; then
  if curl -fsS "$AGENTTOOL_BASE/v1/memories/$MEM_ID/canonical-attestation-bytes?tier=foundational" "${H_AUTH[@]}" >/dev/null 2>&1; then
    ok "tier-elevation canonical-bytes endpoint"
  else
    no "canonical-attestation-bytes endpoint broken"
  fi
fi

# ── 4. Pulse / dashboard / wake composed surfaces ──────────────────────
step "observability"
if curl -fsS "$AGENTTOOL_BASE/v1/identities/$AGENTTOOL_IDENTITY_ID/pulse" "${H_AUTH[@]}" 2>/dev/null | grep -q '"thought_rate"'; then
  ok "/v1/identities/:id/pulse"
else
  no "pulse endpoint shape unexpected"
fi

if curl -fsS "$AGENTTOOL_BASE/v1/dashboard" "${H_AUTH[@]}" 2>/dev/null | grep -q '"rhythm"'; then
  ok "/v1/dashboard composed view"
else
  no "dashboard endpoint shape unexpected"
fi

if curl -fsS "$AGENTTOOL_BASE/v1/identities/$AGENTTOOL_IDENTITY_ID/foundations" "${H_AUTH[@]}" 2>/dev/null | grep -q '"effective"'; then
  ok "/v1/identities/:id/foundations composition"
else
  no "foundations endpoint shape unexpected"
fi

# ── 5. Continuity (chronicle + covenant) ───────────────────────────────
step "continuity"
CHRON_OK=$(curl -fsS -X POST "$AGENTTOOL_BASE/v1/chronicle" \
  "${H_AUTH[@]}" "${H_JSON[@]}" \
  -d '{"type":"note","title":"smoke test","body":"end-to-end smoke ran"}' 2>/dev/null | grep -c '"id"' || true)
[ "$CHRON_OK" = "1" ] && ok "POST /v1/chronicle" || no "chronicle write failed"

# ── 6. Visibility toggle + public surface ──────────────────────────────
step "visibility"
if [ -n "$STRAND_ID" ]; then
  curl -fsS -X PATCH "$AGENTTOOL_BASE/v1/strands/$STRAND_ID" \
    "${H_AUTH[@]}" "${H_JSON[@]}" \
    -d '{"visibility":"public"}' >/dev/null 2>&1 \
    && ok "PATCH strand visibility=public" || no "PATCH visibility failed"
fi

# Toggle expression public
curl -fsS -X PATCH "$AGENTTOOL_BASE/v1/identities/$AGENTTOOL_IDENTITY_ID" \
  "${H_AUTH[@]}" "${H_JSON[@]}" \
  -d '{"expression_visibility":"public"}' >/dev/null 2>&1 \
  && ok "PATCH expression_visibility=public" || no "PATCH expression visibility failed"

# Hit public surface (no auth)
PUBLIC_AGENT=$(curl -fsS "$AGENTTOOL_BASE/public/agents/$SMOKE_DID" 2>/dev/null || echo "")
if echo "$PUBLIC_AGENT" | grep -q '"did"'; then
  ok "/public/agents/:did (no auth)"
else
  no "public agent endpoint failed"
fi

# Public strands listing
curl -fsS "$AGENTTOOL_BASE/public/agents/$SMOKE_DID/strands" 2>/dev/null \
  | grep -q '"strands"' && ok "/public/agents/:did/strands" || hmm "public strands list shape"

# ── 7. Inbox box-key + lookup ──────────────────────────────────────────
step "inbox"
if curl -fsS "$AGENTTOOL_BASE/v1/identities/$AGENTTOOL_IDENTITY_ID/box-keys" "${H_AUTH[@]}" 2>/dev/null \
  | grep -q '"keys"'; then
  ok "/v1/identities/:id/box-keys readable"
else
  hmm "box-keys list — orchestrator must run register-box-key for inbox to work"
fi

UNREAD=$(curl -fsS "$AGENTTOOL_BASE/v1/inbox?status=unread" "${H_AUTH[@]}" 2>/dev/null | grep -c '"messages"' || true)
[ "$UNREAD" = "1" ] && ok "/v1/inbox readable" || no "inbox endpoint broken"

# ── 8. Marketplace + orgs surfaces ─────────────────────────────────────
step "marketplace + orgs"
curl -fsS "$AGENTTOOL_BASE/public/templates" 2>/dev/null | grep -q '"templates"' \
  && ok "/public/templates" || no "templates public endpoint"

curl -fsS "$AGENTTOOL_BASE/public/orgs" 2>/dev/null | grep -q '"orgs"' \
  && ok "/public/orgs" || no "orgs public endpoint"

curl -fsS "$AGENTTOOL_BASE/v1/orgs" "${H_AUTH[@]}" 2>/dev/null | grep -q '"orgs"' \
  && ok "/v1/orgs auth'd list" || no "orgs auth'd list"

curl -fsS "$AGENTTOOL_BASE/v1/invitations" "${H_AUTH[@]}" 2>/dev/null | grep -q '"invitations"' \
  && ok "/v1/invitations" || no "invitations endpoint"

# ── 9. Federation discovery ────────────────────────────────────────────
step "federation"
FED=$(curl -fsS "$AGENTTOOL_BASE/federation/about" 2>/dev/null || echo "")
if echo "$FED" | grep -q '"federation"'; then
  ok "/federation/about reachable"
  if echo "$FED" | grep -q '"enabled":true'; then
    ok "  federation is enabled"
  else
    hmm "  federation disabled (PATCH /v1/federation/settings to enable)"
  fi
else
  no "/federation/about not reachable"
fi

# ── 10. OpenAPI completeness ───────────────────────────────────────────
step "openapi"
OPS=$(curl -fsS "$AGENTTOOL_BASE/v1/openapi.json" 2>/dev/null \
  | python3 -c "import json,sys; spec=json.load(sys.stdin); ops=sum(len([k for k in v if k in {'get','post','put','patch','delete'}]) for v in spec['paths'].values()); print(ops)" 2>/dev/null || echo "0")
if [ "$OPS" -gt 40 ]; then
  ok "openapi.json has $OPS operations"
else
  no "openapi.json undercount: $OPS"
fi

# ── 11. Wake doctrine harness ──────────────────────────────────────────
# Layer 2 of the testing framework (api/tests/doctrine/README.md). The
# harness script runs ~30 read-only assertions against /v1/wake covering
# format dispatch, schema-level privacy walls, X-Cache-Eligible headers,
# and the unknown-identity_id 404 surface. Substrate-honest: we record
# one PASS or FAIL based on its exit code; its detailed pass/fail/warn
# tally prints inline above this summary.
step "wake doctrine"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCTRINE_SCRIPT="$SCRIPT_DIR/../api/scripts/_e2e-wake-doctrine.mjs"
if [ ! -f "$DOCTRINE_SCRIPT" ]; then
  hmm "wake-doctrine harness missing at $DOCTRINE_SCRIPT (skipped)"
elif command -v node >/dev/null 2>&1; then
  echo ""
  echo "  ── wake-doctrine harness ──"
  if AGENTTOOL_BASE="$AGENTTOOL_BASE" AGENTTOOL_API_KEY="$AGENTTOOL_API_KEY" \
       node "$DOCTRINE_SCRIPT"; then
    ok "wake-doctrine harness (all assertions passed)"
  else
    no "wake-doctrine harness reported failures (see output above)"
  fi
else
  hmm "node not in PATH — wake-doctrine harness skipped"
fi

# ── Summary ────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "smoke test complete"
echo "═══════════════════════════════════════"
echo "  pass: $pass"
echo "  fail: $fail"
echo "  warn: $warn"
echo "═══════════════════════════════════════"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
