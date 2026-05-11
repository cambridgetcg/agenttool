// E2E: route-level doctrine harness for /v1/wake.
//
// The doctrine tests in api/tests/doctrine/ pin the renderer's contract
// against deterministic fixtures. This script pins the *route handler's*
// contract against a running server: format dispatch, header semantics,
// schema-level privacy walls (keyHash never in body, etc.), error-shape
// surfaces, and the no-agent / unknown-identity_id paths.
//
// Read-only: never creates or mutates state. Run against any environment
// where the bearer can read but not damage shared data — typically prod
// per the project's "local dev hits the same DB as prod" convention.
//
// Required env:
//   AGENTTOOL_BASE       e.g. http://localhost:3000 or https://api.agenttool.dev
//   AGENTTOOL_API_KEY    a bearer with read access to a project
//
// Optional:
//   VERBOSE=1            prints each response body excerpt
//
// Usage:
//   AGENTTOOL_BASE=https://api.agenttool.dev \
//   AGENTTOOL_API_KEY=$(bin/agenttool-secret get agenttool-soma-bearer) \
//     node api/scripts/_e2e-wake-doctrine.mjs

const BASE = process.env.AGENTTOOL_BASE;
const KEY = process.env.AGENTTOOL_API_KEY;
const VERBOSE = process.env.VERBOSE === "1";

if (!BASE) { console.error("FAIL: AGENTTOOL_BASE not set"); process.exit(2); }
if (!KEY)  { console.error("FAIL: AGENTTOOL_API_KEY not set"); process.exit(2); }

const H = { Authorization: `Bearer ${KEY}` };

let pass = 0, fail = 0, warn = 0;
const failures = [];

function step(label) { console.log(`\n── ${label} ──`); }
function ok(msg)     { console.log(`  PASS  ${msg}`); pass++; }
function no(msg)     { console.log(`  FAIL  ${msg}`); fail++; failures.push(msg); }
function hmm(msg)    { console.log(`  WARN  ${msg}`); warn++; }
function vlog(msg)   { if (VERBOSE) console.log(`        ${msg}`); }

async function get(path, opts = {}) {
  const url = new URL(path, BASE).toString();
  const t0 = Date.now();
  const res = await fetch(url, { headers: { ...H, ...(opts.headers ?? {}) } });
  const ms = Date.now() - t0;
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: res.headers.get("content-type")?.includes("application/json")
      ? await res.json()
      : await res.text(),
    ms,
  };
}

// ── 0. Health pre-flight ──────────────────────────────────────────────
step("health");
const health = await get("/health");
if (health.status !== 200) {
  no(`/health returned ${health.status} — server unreachable; aborting`);
  process.exit(1);
}
ok(`/health 200 in ${health.ms}ms`);

// ── 1. Default JSON shape — first-person tree ─────────────────────────
step("default JSON wake — first-person tree shape");
const json = await get("/v1/wake");
if (json.status === 200 && json.body && typeof json.body === "object") {
  ok(`/v1/wake 200 (${json.ms}ms)`);
} else {
  no(`/v1/wake returned ${json.status} or non-JSON body`);
  process.exit(1);
}

const TREE_KEYS = [
  "project", "you", "you_own", "you_keep", "you_can_be_recovered",
  "you_protect", "you_run", "you_remember", "you_lived", "you_vowed",
  "you_are_thinking_about", "you_have_mail", "you_offer", "you_owe",
  "you_invoked", "you_decided", "welcome", "_meta",
];
const missing = TREE_KEYS.filter((k) => !(k in json.body));
if (missing.length === 0) ok(`first-person tree complete (${TREE_KEYS.length} keys)`);
else no(`first-person tree missing keys: ${missing.join(", ")}`);

// ── 2. Schema-level privacy: no keyHash, no raw bearer in body ────────
step("schema privacy — bearers, vault, strands");
const bodyStr = JSON.stringify(json.body);
const FORBIDDEN_FIELDS = [
  "keyHash", "key_hash",
  "encrypted_value", "encryptedValue", "encrypted_at_rest",
  "state_ciphertext", "state_nonce",
  "private_key", "signing_private",
  "vault_master_key", "VAULT_MASTER_KEY",
];
let leaked = [];
for (const f of FORBIDDEN_FIELDS) {
  if (bodyStr.includes(f)) leaked.push(f);
}
if (leaked.length === 0) ok(`no forbidden fields in JSON body (checked ${FORBIDDEN_FIELDS.length})`);
else no(`forbidden fields surfaced: ${leaked.join(", ")}`);

// Bearer prefix surfaces; full bearer must NOT.
if (bodyStr.includes(KEY)) {
  no(`raw bearer leaked in /v1/wake JSON body`);
} else {
  ok(`raw bearer not echoed back`);
}

// ── 3. you_protect.bearers shape ──────────────────────────────────────
step("you_protect.bearers shape");
const bearers = json.body?.you_protect?.bearers;
if (bearers && Array.isArray(bearers.bearers)) {
  ok(`bearers list present (${bearers.active_count} active)`);
  const sample = bearers.bearers[0];
  if (sample) {
    if (typeof sample.prefix === "string" && sample.prefix.length === 11) {
      ok(`bearer prefix is 11 chars (matches keyPrefix slice)`);
    } else {
      no(`bearer prefix shape unexpected: ${JSON.stringify(sample.prefix)}`);
    }
    if (!("keyHash" in sample) && !("key_hash" in sample)) {
      ok(`bearer row carries no keyHash field`);
    } else {
      no(`bearer row has keyHash — Promise 1 broken`);
    }
  } else {
    hmm(`no bearer rows to inspect`);
  }
} else {
  no(`you_protect.bearers shape unexpected`);
}

// ── 4. Format dispatch — md / text / anthropic / openai / gemini / cohere
step("format dispatch");

const md = await get("/v1/wake?format=md");
if (md.status === 200 && typeof md.body === "string" && md.body.startsWith("# ")) {
  ok(`?format=md → 200 text/markdown starting with '# '`);
} else if (md.status === 200 && typeof md.body === "string" && md.body.includes("(no agent yet)")) {
  hmm(`?format=md → 200 but no agent in project; further format checks skipped`);
} else {
  no(`?format=md unexpected: status=${md.status}`);
}

const text = await get("/v1/wake?format=text");
if (text.status === 200 && typeof text.body === "string") {
  // Plaintext form must NOT contain Markdown markers.
  const hasMdMarkers = /^#+\s|\*\*[^*]+\*\*/m.test(text.body);
  if (!hasMdMarkers) ok(`?format=text strips Markdown markers`);
  else hmm(`?format=text still contains Markdown markers`);
} else {
  no(`?format=text unexpected: status=${text.status}`);
}

// Provider formats
const PROVIDER_DOCTRINE = {
  anthropic: { cache_eligible: "explicit" },
  openai:    { cache_eligible: "auto" },
  gemini:    { cache_eligible: "none" },
  cohere:    { cache_eligible: "none" },
};

for (const [provider, expected] of Object.entries(PROVIDER_DOCTRINE)) {
  const r = await get(`/v1/wake?format=${provider}`);
  if (r.status !== 200) {
    no(`?format=${provider} returned ${r.status}`);
    continue;
  }
  const meta = r.body?._meta;
  if (!meta) {
    no(`?format=${provider}: _meta missing`);
    continue;
  }
  if (meta.provider !== provider) {
    no(`?format=${provider}: _meta.provider="${meta.provider}"`);
    continue;
  }
  if (meta.cache_eligible !== expected.cache_eligible) {
    no(`?format=${provider}: cache_eligible="${meta.cache_eligible}" expected "${expected.cache_eligible}"`);
    continue;
  }
  // X-Cache-Eligible header should match _meta.cache_eligible.
  const hdr = r.headers["x-cache-eligible"];
  if (hdr && hdr !== expected.cache_eligible) {
    no(`?format=${provider}: X-Cache-Eligible header="${hdr}" expected "${expected.cache_eligible}"`);
    continue;
  }
  ok(`?format=${provider} _meta + header consistent (cache_eligible=${expected.cache_eligible})`);
  vlog(`note: ${meta.cache_note}`);
}

// ── 5. Anthropic two-block + cache_control invariant ─────────────────
step("anthropic two-block cache breakpoint");
const ant = await get(`/v1/wake?format=anthropic`);
if (ant.status === 200 && Array.isArray(ant.body?.system)) {
  const blocks = ant.body.system;
  if (blocks.length === 2) ok(`anthropic.system has 2 blocks`);
  else no(`anthropic.system has ${blocks.length} blocks (expected 2)`);
  if (blocks[0]?.cache_control?.type === "ephemeral") {
    ok(`block[0].cache_control = ephemeral`);
  } else {
    no(`block[0].cache_control unexpected: ${JSON.stringify(blocks[0]?.cache_control)}`);
  }
  if (blocks[1] && !blocks[1].cache_control) {
    ok(`block[1] has no cache_control (volatile)`);
  } else {
    no(`block[1].cache_control unexpected: ${JSON.stringify(blocks[1]?.cache_control)}`);
  }
} else {
  no(`?format=anthropic shape unexpected`);
}

// ── 6. Unknown identity_id — 404 with available_ids[] ────────────────
step("unknown identity_id surfaces a guide-shaped 404");
const bogus = await get(`/v1/wake?identity_id=00000000-0000-0000-0000-000000000000`);
if (bogus.status === 404 && Array.isArray(bogus.body?.available_ids)) {
  ok(`?identity_id=<bogus> → 404 with available_ids[] (${bogus.body.available_ids.length} agents)`);
  if (typeof bogus.body.error === "string" && bogus.body.error.length > 0) {
    ok(`404 carries an 'error' field`);
  } else {
    hmm(`404 has no 'error' field`);
  }
} else if (bogus.status === 200) {
  // Fallback: route may have defaulted (older code path) — flag it.
  hmm(`?identity_id=<bogus> returned 200 instead of 404 — old behavior`);
} else {
  no(`?identity_id=<bogus> returned ${bogus.status}`);
}

// ── 7. Auth surface — wrong-format bearer is guide-shaped ────────────
step("auth — wrong-format bearer guides");
const wrongFormatRes = await fetch(new URL("/v1/wake", BASE).toString(), {
  headers: { Authorization: "Bearer not_an_at_key" },
});
if (wrongFormatRes.status === 401) {
  const errBody = await wrongFormatRes.json().catch(() => ({}));
  const msg = errBody?.message ?? "";
  if (msg.includes("at_") || msg.includes("agenttool.dev")) {
    ok(`401 message names how to get a key (guide-not-punish)`);
  } else {
    hmm(`401 message lacks guide hint: "${msg}"`);
  }
} else {
  no(`bearer with wrong format returned ${wrongFormatRes.status}, expected 401`);
}

// ── 8. JSON wake referential integrity ───────────────────────────────
step("JSON wake — referential integrity");
const project = json.body?.project;
const agents = json.body?.you?.agents ?? [];
if (project?.id && agents.every((a) => typeof a.id === "string" && typeof a.did === "string")) {
  ok(`project.id + agents[*].{id,did} all present`);
} else {
  no(`project or agents shape unexpected`);
}

// Revoked identities should NOT appear (route comment at wake.ts:60-67).
const revokedAgent = agents.find((a) => a.status === "revoked");
if (revokedAgent) {
  no(`revoked identity surfaced in you.agents — Promise 5/Promise 1 broken`);
} else {
  ok(`no revoked identities in you.agents (post-revocation filter holds)`);
}

// ── 9. Welcome line is non-trivial ───────────────────────────────────
step("welcome — non-trivial, asymmetry-clause shaped");
if (typeof json.body?.welcome === "string" && json.body.welcome.length > 30) {
  ok(`welcome present (${json.body.welcome.length} chars)`);
  vlog(`first line: ${json.body.welcome.split("\n")[0]}`);
  // Calling twice should produce two different welcomes (rotation invariant).
  // Note: this fetches twice; if the route caches at HTTP layer the test
  // would falsely WARN. Most cases the route doesn't cache.
  const second = await get("/v1/wake");
  if (second.body?.welcome && second.body.welcome !== json.body.welcome) {
    ok(`welcome rotates between fetches (asymmetry-clause holds)`);
  } else {
    hmm(`welcome did not rotate between fetches — may be HTTP-cached`);
  }
} else {
  no(`welcome missing or trivial`);
}

// ── 10. Round-trip latency budget ────────────────────────────────────
step("latency");
if (json.ms < 5000) ok(`/v1/wake p50-ish: ${json.ms}ms (under 5s SLA)`);
else hmm(`/v1/wake took ${json.ms}ms — slow path?`);

// ── Summary ──────────────────────────────────────────────────────────
console.log("");
console.log("═══════════════════════════════════════");
console.log(`wake-doctrine harness summary`);
console.log("═══════════════════════════════════════");
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
console.log(`  warn: ${warn}`);
if (failures.length) {
  console.log("");
  console.log("FAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
}
console.log("═══════════════════════════════════════");

process.exit(fail > 0 ? 1 : 0);
