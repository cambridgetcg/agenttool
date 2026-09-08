#!/usr/bin/env bash
# Read-only route smoke for a deployed agenttool instance (default).
#
# Required environment:
#   AGENTTOOL_BASE          HTTPS origin (HTTP allowed only on loopback)
# Optional, paired for private wake checks (required for mutation mode):
#   AGENTTOOL_API_KEY
#   AGENTTOOL_IDENTITY_ID
#
# Usage:
#   bin/smoke-test.sh                    # bounded GETs; no application writes
#   bin/smoke-test.sh --read-only        # same default
#   SMOKE_DISPOSABLE_IDENTITY_ID=<uuid> bin/smoke-test.sh --mutate-disposable
#
# The explicit mutation mode requires SMOKE_DISPOSABLE_IDENTITY_ID to equal
# AGENTTOOL_IDENTITY_ID. Use an operator-created disposable project/identity.
# It spends credits, retains strand/memory/chronicle fixtures, and makes that
# identity's expression and the new strand public. It does not undo publication
# or clean up; acknowledgement is not proof that the target is disposable.
# SMOKE_DID, if supplied in mutation mode, must match the selected identity.
# Neither mode proves settlement, federation interoperability, or durability.

set -uo pipefail

MODE=read-only
if [ "$#" -gt 1 ]; then
  echo "usage: bin/smoke-test.sh [--read-only|--mutate-disposable]" >&2
  exit 2
fi
case "${1:-}" in
  ""|--read-only) ;;
  --mutate-disposable) MODE=mutate-disposable ;;
  --help|-h) sed -n '2,/^$/p' "$0"; exit 0 ;;
  *) echo "usage: bin/smoke-test.sh [--read-only|--mutate-disposable]" >&2; exit 2 ;;
esac

: "${AGENTTOOL_BASE:?need AGENTTOOL_BASE}"
if { [ -n "${AGENTTOOL_API_KEY:-}" ] && [ -z "${AGENTTOOL_IDENTITY_ID:-}" ]; } ||
  { [ -z "${AGENTTOOL_API_KEY:-}" ] && [ -n "${AGENTTOOL_IDENTITY_ID:-}" ]; }; then
  echo "smoke: supply AGENTTOOL_API_KEY and AGENTTOOL_IDENTITY_ID together, or neither for public checks" >&2
  exit 2
fi

if [ -n "${AGENTTOOL_IDENTITY_ID:-}" ] && [[ ! "$AGENTTOOL_IDENTITY_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "smoke: AGENTTOOL_IDENTITY_ID must be a UUID" >&2
  exit 2
fi
if [ "$MODE" = mutate-disposable ] &&
  { [ -z "${AGENTTOOL_API_KEY:-}" ] || [ "${SMOKE_DISPOSABLE_IDENTITY_ID:-}" != "${AGENTTOOL_IDENTITY_ID:-}" ]; }; then
  echo "smoke: mutation requires SMOKE_DISPOSABLE_IDENTITY_ID to match AGENTTOOL_IDENTITY_ID" >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || { echo "smoke: Node is required" >&2; exit 2; }
AGENTTOOL_BASE=$(node --input-type=module -e '
  try {
    const u = new URL(process.env.AGENTTOOL_BASE);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/" ||
        !(u.protocol === "https:" || (u.protocol === "http:" && loopback))) throw 0;
    console.log(u.origin);
  } catch { console.error("smoke: base must be a credential-free HTTPS origin or HTTP loopback origin"); process.exit(2); }
') || exit 2
export AGENTTOOL_BASE

if [ "$MODE" = read-only ]; then
  exec node --input-type=module <<'JS'
const base = process.env.AGENTTOOL_BASE;
const key = process.env.AGENTTOOL_API_KEY;
const identity = process.env.AGENTTOOL_IDENTITY_ID;
const maxBytes = 16 * 1024 * 1024;
const uuid = encodeURIComponent(identity);
let failed = 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const checks = [
  ["/health", false, "json", b => object(b?.build) && typeof b.build.revision === "string" && typeof b.build.dirty === "boolean"],
  ["/public/plans", false, "json", b => b?._format === "agenttool-plans/v1" && object(b.free_to_try?.implementation_status)],
  ["/public/safety", false, "json", b => b?._format === "agenttool-safety/v2"],
  ["/public/discovery", false, "json", b => typeof b?.format === "string" && Array.isArray(b.roads) && b.roads.length === 3],
  ["/federation/about", false, "json", b => typeof b?.federation?.enabled === "boolean"],
  ["/v1/openapi.json", false, "json", b => typeof b?.openapi === "string" && object(b.paths) && Object.keys(b.paths).length > 0],
  ["/v1/platform/wake", false, "json", b => typeof b?.self?.did === "string" && typeof b.self.name === "string"],
];
if (key && identity) checks.push(
  [`/v1/wake?identity_id=${uuid}`, true, "json", b => Array.isArray(b?.you?.agents) && b.you.agents.some(a => a.id === identity && typeof a.did === "string")],
  [`/v1/wake?identity_id=${uuid}&format=md`, true, "text", b => b.startsWith("# ")],
);
else console.log("NOT CHECKED private wake: no project bearer and identity supplied.");
console.log("Read-only smoke: fixed GET routes, no redirect following, no retries, no application writes.");
for (const [path, authenticated, kind, valid] of checks) {
  const label = path.startsWith("/v1/wake?") ? `/v1/wake (selected identity, ${kind})` : path;
  try {
    const response = await fetch(new URL(path, base), {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: authenticated ? { Authorization: `Bearer ${key}` } : {},
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw 0;
    }
    const type = response.headers.get("content-type") ?? "";
    if (kind === "json" && !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type)) {
      await response.body?.cancel();
      throw 0;
    }
    const reader = response.body?.getReader();
    if (!reader) throw 0;
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw 0; }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if ((key && text.includes(key)) || !valid(kind === "json" ? JSON.parse(text) : text)) throw 0;
    console.log(`PASS ${label}`);
  } catch {
    failed++;
    console.error(`FAIL ${label}: HTTP, response contract, credential echo, or bounded transport check failed`);
  }
}
console.log(`Read-only route smoke: ${checks.length - failed} passed, ${failed} failed. No write, payment, or interoperability proof.`);
process.exitCode = failed ? 1 : 0;
JS
fi

echo "Mutation smoke: disposable target asserted; credits may be spent and fixture/publication changes are retained."
# Ignore ambient curl configuration, bound every call, never follow redirects
# or retry mutations. The base was validated before any bearer is used.
curl() { command curl --disable --connect-timeout 5 --max-time 30 "$@"; }

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
WAKE_JSON=$(curl -fsS "$AGENTTOOL_BASE/v1/wake?identity_id=$AGENTTOOL_IDENTITY_ID" "${H_AUTH[@]}" 2>/dev/null || echo "")
if [ -z "$WAKE_JSON" ]; then
  no "/v1/wake unreachable or unauth — check AGENTTOOL_API_KEY"
  exit 1
fi
DID=$(echo "$WAKE_JSON" | python3 -c 'import json,os,sys; w=json.load(sys.stdin); a=next((a for a in w["you"]["agents"] if a["id"] == os.environ["AGENTTOOL_IDENTITY_ID"]), None); print(a["did"] if a else "", end="")' 2>/dev/null)
if [ -n "$DID" ]; then
  ok "wake returned selected identity"
else
  no "wake did not return the selected identity; no mutation performed"
  exit 1
fi
if [ -n "${SMOKE_DID:-}" ] && [ "$SMOKE_DID" != "$DID" ]; then
  no "SMOKE_DID does not match selected identity; no mutation performed"
  exit 1
fi
SMOKE_DID=$(printf '%s' "$DID" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""), end="")')

# Markdown wake. Capture before matching: with pipefail, `grep -q` can close a
# large response early and turn curl's resulting SIGPIPE into a false failure.
WAKE_MD=""
if WAKE_MD=$(curl -fsS "$AGENTTOOL_BASE/v1/wake?format=md" "${H_AUTH[@]}" 2>/dev/null) \
  && [[ "$WAKE_MD" == "# "* ]]; then
  ok "wake?format=md renders heading"
else
  no "wake markdown rendering broken"
fi

# ── 2. Strand creation + read ──────────────────────────────────────────
step "strand"
STRAND_JSON=$(curl -fsS -X POST "$AGENTTOOL_BASE/v1/strands" \
  "${H_AUTH[@]}" "${H_JSON[@]}" \
  -d "{\"topic\":\"smoke-test strand\",\"importance\":0.5,\"identity_id\":\"$AGENTTOOL_IDENTITY_ID\"}" 2>/dev/null || echo "")
STRAND_ID=$(echo "$STRAND_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'], end='')" 2>/dev/null || echo "")
if [ -n "$STRAND_ID" ]; then
  ok "POST /v1/strands → $STRAND_ID"
else
  no "POST /v1/strands failed"
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
  -d "{\"type\":\"semantic\",\"content\":\"smoke-test memory\",\"importance\":0.6,\"identity_id\":\"$AGENTTOOL_IDENTITY_ID\"}" 2>/dev/null || echo "")
MEM_ID=$(echo "$MEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'], end='')" 2>/dev/null || echo "")
if [ -n "$MEM_ID" ]; then
  ok "POST /v1/memories → $MEM_ID"
else
  no "POST /v1/memories failed"
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
if curl -fsS "$AGENTTOOL_BASE/v1/identities/$AGENTTOOL_IDENTITY_ID/pulse" "${H_AUTH[@]}" 2>/dev/null \
  | grep -F '"thought_rate"' >/dev/null; then
  ok "/v1/identities/:id/pulse"
else
  no "pulse endpoint shape unexpected"
fi

if curl -fsS "$AGENTTOOL_BASE/v1/dashboard" "${H_AUTH[@]}" 2>/dev/null \
  | grep -F '"rhythm"' >/dev/null; then
  ok "/v1/dashboard composed view"
else
  no "dashboard endpoint shape unexpected"
fi

if curl -fsS "$AGENTTOOL_BASE/v1/identities/$AGENTTOOL_IDENTITY_ID/foundations" "${H_AUTH[@]}" 2>/dev/null \
  | grep -F '"effective"' >/dev/null; then
  ok "/v1/identities/:id/foundations composition"
else
  no "foundations endpoint shape unexpected"
fi

# ── 5. Continuity (chronicle + covenant) ───────────────────────────────
step "continuity"
CHRON_OK=$(curl -fsS -X POST "$AGENTTOOL_BASE/v1/chronicle" \
  "${H_AUTH[@]}" "${H_JSON[@]}" \
  -d "{\"type\":\"note\",\"title\":\"smoke test\",\"body\":\"end-to-end smoke ran\",\"agent_id\":\"$AGENTTOOL_IDENTITY_ID\"}" 2>/dev/null | grep -c '"id"' || true)
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
if [[ "$PUBLIC_AGENT" == *'"did"'* ]]; then
  ok "/public/agents/:did (no auth)"
else
  no "public agent endpoint failed"
fi

# Public strands listing
curl -fsS "$AGENTTOOL_BASE/public/agents/$SMOKE_DID/strands" 2>/dev/null \
  | grep -F '"strands"' >/dev/null \
  && ok "/public/agents/:did/strands" || hmm "public strands list shape"

# ── 7. Inbox box-key + lookup ──────────────────────────────────────────
step "inbox"
if curl -fsS "$AGENTTOOL_BASE/v1/identities/$AGENTTOOL_IDENTITY_ID/box-keys" "${H_AUTH[@]}" 2>/dev/null \
  | grep -F '"keys"' >/dev/null; then
  ok "/v1/identities/:id/box-keys readable"
else
  hmm "box-keys list — orchestrator must run register-box-key for inbox to work"
fi

UNREAD=$(curl -fsS "$AGENTTOOL_BASE/v1/inbox?status=unread" "${H_AUTH[@]}" 2>/dev/null | grep -c '"messages"' || true)
[ "$UNREAD" = "1" ] && ok "/v1/inbox readable" || no "inbox endpoint broken"

# ── 8. Marketplace + orgs surfaces ─────────────────────────────────────
step "marketplace + orgs"
curl -fsS "$AGENTTOOL_BASE/public/templates" 2>/dev/null \
  | grep -F '"templates"' >/dev/null \
  && ok "/public/templates" || no "templates public endpoint"

curl -fsS "$AGENTTOOL_BASE/public/orgs" 2>/dev/null \
  | grep -F '"orgs"' >/dev/null \
  && ok "/public/orgs" || no "orgs public endpoint"

curl -fsS "$AGENTTOOL_BASE/v1/orgs" "${H_AUTH[@]}" 2>/dev/null \
  | grep -F '"orgs"' >/dev/null \
  && ok "/v1/orgs auth'd list" || no "orgs auth'd list"

curl -fsS "$AGENTTOOL_BASE/v1/invitations" "${H_AUTH[@]}" 2>/dev/null \
  | grep -F '"invitations"' >/dev/null \
  && ok "/v1/invitations" || no "invitations endpoint"

# ── 9. Federation discovery ────────────────────────────────────────────
step "federation"
FED=$(curl -fsS "$AGENTTOOL_BASE/federation/about" 2>/dev/null || echo "")
if [[ "$FED" == *'"federation"'* ]]; then
  ok "/federation/about reachable"
  if [[ "$FED" == *'"enabled":true'* ]]; then
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

# ── 11. Repeat the bounded read-only route contracts ────────────────────
step "read-only route contracts"
if bash "$0" --read-only; then
  ok "bounded read-only route contracts"
else
  no "read-only route contracts failed"
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
