// E2E: pulse — agent-scoping, mood_drift, public route.
//
// Runs against a live api (default: http://localhost:3000). Bring up
// the api with `bun run dev` in api/ before running this script.
// Expects two env vars: AT_API_KEY and AT_IDENTITY_ID. The identity
// must belong to the project that owns AT_API_KEY.
//
// Steps:
//   1. Create a strand with mood="anxious".
//   2. Update the strand's mood to "focused".
//   3. GET /v1/identities/:id/pulse — expect mood="focused" and
//      mood_drift={from:"anxious", to:"focused", at:<iso>}.
//   4. Flip the strand to visibility='public'.
//   5. GET /public/agents/:did/pulse without auth — expect same shape
//      with the strand counted in active.
//   6. GET /public/agents/did:at:not-a-uuid/pulse — expect 404.
//
// Does NOT clean up the created strand — pick a throwaway identity.

const BASE = process.env.AT_API_BASE ?? "http://localhost:3000";
const KEY = process.env.AT_API_KEY;
const IDENTITY_ID = process.env.AT_IDENTITY_ID;

if (!KEY || !IDENTITY_ID) {
  console.error("Usage: AT_API_KEY=... AT_IDENTITY_ID=... bun run api/scripts/_e2e-pulse.mjs");
  process.exit(2);
}

const auth = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

// 1. Create strand with mood=anxious
console.log("1. Creating strand with mood=anxious...");
const createResp = await fetch(`${BASE}/v1/strands`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    identity_id: IDENTITY_ID,
    topic: "pulse-e2e",
    mood: "anxious",
  }),
});
assert(createResp.ok, `create returned ${createResp.status}`);
const strand = await createResp.json();
const strandId = strand.id;
console.log(`   strand: ${strandId}`);

// 2. Update mood to focused
console.log("2. Updating mood to focused...");
const patchResp = await fetch(`${BASE}/v1/strands/${strandId}`, {
  method: "PATCH",
  headers: auth,
  body: JSON.stringify({ mood: "focused" }),
});
assert(patchResp.ok, `patch returned ${patchResp.status}`);

// 3. Read pulse via the auth route
console.log("3. GET /v1/identities/:id/pulse...");
const pulseResp = await fetch(`${BASE}/v1/identities/${IDENTITY_ID}/pulse`, {
  headers: auth,
});
assert(pulseResp.ok, `pulse returned ${pulseResp.status}`);
const pulse = await pulseResp.json();
console.log(`   pulse: ${JSON.stringify(pulse, null, 2)}`);
assert(pulse.mood === "focused", `mood is "${pulse.mood}", expected "focused"`);
assert(pulse.mood_drift !== null, "mood_drift is not null");
assert(pulse.mood_drift.from === "anxious", `drift.from is "${pulse.mood_drift.from}", expected "anxious"`);
assert(pulse.mood_drift.to === "focused", `drift.to is "${pulse.mood_drift.to}", expected "focused"`);
assert(typeof pulse.mood_drift.at === "string", "drift.at is a string");

// 4. Make the strand public
console.log("4. Setting visibility=public...");
const visResp = await fetch(`${BASE}/v1/strands/${strandId}`, {
  method: "PATCH",
  headers: auth,
  body: JSON.stringify({ visibility: "public" }),
});
assert(visResp.ok, `visibility patch returned ${visResp.status}`);

// 5. Public pulse
console.log("5. GET /public/agents/:did/pulse (no auth)...");
const did = `did:at:${IDENTITY_ID}`;
const publicResp = await fetch(`${BASE}/public/agents/${did}/pulse`);
assert(publicResp.ok, `public pulse returned ${publicResp.status}`);
const publicPulse = await publicResp.json();
console.log(`   public pulse: ${JSON.stringify(publicPulse, null, 2)}`);
assert(publicPulse.agent.did === did, "agent.did echoes back");
assert(publicPulse.strands.active >= 1, "active count includes the public strand");
assert(publicPulse.mood === "focused", `public mood is "${publicPulse.mood}", expected "focused"`);

// 6. Bad DID -> 404
console.log("6. GET /public/agents/did:at:not-a-uuid/pulse...");
const badResp = await fetch(`${BASE}/public/agents/did:at:not-a-uuid/pulse`);
assert(badResp.status === 404, `bad DID returned ${badResp.status}, expected 404`);

console.log("\nALL CHECKS PASS");
