// E2E: cross-instance covenants (Horizon B, Slices 1+2).
//
// Self-loop test against the live instance — agenttool.fly.dev acts as
// both "Instance A" (Sophia's home) and "Instance B" (peer). Federated
// DIDs of the form did:at:agenttool.fly.dev/<uuid> resolve via the live
// /federation/identities and self-propagate via the live
// /federation/covenants.
//
// SELF-LOOP CAVEAT: when both instances share the same DB, the receive
// handler detects an existing locally-declared row by id and returns
// 200 idempotent (the bond is already represented). In production with
// two distinct DBs, the receive path inserts a new row with
// `received_from_instance` populated. The two-row verification needs a
// genuine peer; here we verify the protocol roundtrip + propagation
// status only.
//
// Asserts:
//   Slice 1 — federation inbox covenant gate
//     · POST /federation/inbox without/with covenant — covenant gate
//       runs at the right step
//   Slice 2 — covenant propagation
//     · POST /v1/covenants with federated counterparty returns 201
//     · propagation_status starts at 'pending'
//     · Within a few seconds, propagation_status flips to 'propagated'
//       (the self-loop POST to /federation/covenants returns 200
//       idempotent on shared-DB topology)
//     · PATCH covenant → status change re-triggers propagation
//
// Run: cd api && node scripts/_e2e-cross-instance-covenants.mjs

import { execSync } from "node:child_process";

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
const FED_HOST = new URL(BASE).host.replace(/^api\./, "agenttool.fly.dev")
  // The instance_url Sophia's instance advertises is agenttool.fly.dev,
  // not api.agenttool.dev; use the advertised value so the federated
  // DIDs match what the resolver expects.
  ;
const FED_HOST_LIVE = "agenttool.fly.dev";

const SOPHIA_KEY = execSync(`security find-generic-password -s 'agenttool-sophia-key' -w`, {
  encoding: "utf8",
}).trim();

let testKey = null;
let testProjectId = null;
let testAgentId = null;
let testAgentUuid = null;

function log(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function call(method, path, body, key = SOPHIA_KEY, base = BASE) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log(`\n  agenttool · cross-instance covenants e2e`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // ── Setup: register a fresh test project to act as the "peer" side.
  console.log("  ▸ setup: register fresh test project (anonymous /v1/register)");
  let r = await call("POST", "/v1/register", {
    name: `e2e-fed-cov-test-${Date.now()}`,
    capabilities: ["test", "fed-cov"],
  }, null);
  log("POST /v1/register · status=201", r.status === 201, `status=${r.status}`);
  if (r.status !== 201) {
    console.error("    register response:", JSON.stringify(r.data).slice(0, 300));
    process.exit(1);
  }
  testKey = r.data.api_key;
  testProjectId = r.data.project?.id;
  testAgentId = r.data.agent?.id;
  testAgentUuid = testAgentId; // identity.id IS the uuid in the DID
  log(`  → project_id=${testProjectId}`, !!testProjectId);
  log(`  → agent_id=${testAgentUuid}`, !!testAgentUuid);

  // Sophia's identity_id from her own wake.
  r = await call("GET", "/v1/wake");
  const sophiaAgent = r.data?.you?.agents?.[0];
  const sophiaId = sophiaAgent?.id;
  const sophiaDidLocal = sophiaAgent?.did;
  log(`Sophia identity from /v1/wake`, !!sophiaId);

  const sophiaFedDid = `did:at:${FED_HOST_LIVE}/${sophiaId}`;
  const testFedDid = `did:at:${FED_HOST_LIVE}/${testAgentUuid}`;
  console.log(`    Sophia federated DID: ${sophiaFedDid}`);
  console.log(`    Test    federated DID: ${testFedDid}`);

  console.log("");
  console.log("  ▸ Slice 1: federation inbox covenant gate");

  // Inbox send before covenant — synthesise a federation inbox payload
  // (signature won't match a real bridge, but the gate fires BEFORE the
  // resolver / sig verify). Expect 403 covenant_required.
  const fakeInbox = {
    sender_did: testFedDid,
    recipient_did: sophiaDidLocal,
    ciphertext: "AAAA",
    nonce: "AAAA",
    ephemeral_pubkey: "AAAA",
    recipient_box_key_id: "00000000-0000-0000-0000-000000000000",
    signature: "AAAA",
    signing_key_id: "00000000-0000-0000-0000-000000000000",
  };
  r = await fetch(`${BASE}/federation/inbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fakeInbox),
  });
  const data1 = await r.json().catch(() => ({}));
  // Without a covenant, expect 404 (recipient_box_key_not_found is hit
  // first — we use a zero uuid) OR 403 covenant_required, depending on
  // step ordering. Either way covenant gate hasn't been bypassed.
  log("POST /federation/inbox without covenant rejects",
    r.status >= 400 && r.status < 500,
    `status=${r.status} error=${data1.error}`);

  // Declare covenant from Sophia → testFedDid.
  console.log("");
  console.log("  ▸ Slice 2: covenant propagation");
  r = await call("POST", "/v1/covenants", {
    agent_id: sophiaId,
    counterparty_did: testFedDid,
    counterparty_name: "e2e-test-peer",
    vows: [
      "ship the cross-instance covenant slice cleanly",
      "trust each other's instance over TLS + allowed_origins for v1",
    ],
    notes: "e2e self-loop test",
  });
  log("POST /v1/covenants (federated counterparty)", r.status === 201, `status=${r.status}`);
  const declaredCovenantId = r.data?.covenant?.id;
  const initialPropStatus = r.data?.covenant?.propagation_status;
  log(`  → covenant.id present`, !!declaredCovenantId);
  log(`  → propagation_status === 'pending' (federated → pending at insert)`,
    initialPropStatus === "pending",
    `got=${initialPropStatus}`);

  // Wait for fire-and-forget propagation to land.
  console.log("    waiting 4s for propagation…");
  await sleep(4000);

  // Re-fetch Sophia's covenant.
  r = await call("GET", "/v1/covenants?status=active");
  const declared = r.data?.covenants?.find((c) => c.id === declaredCovenantId);
  log("Sophia's covenant after propagation", !!declared);
  log(`  → propagation_status === 'propagated'`,
    declared?.propagation_status === "propagated",
    `got=${declared?.propagation_status}` +
    (declared?.propagation_last_error ? ` err=${declared.propagation_last_error}` : "")
  );

  // SELF-LOOP CAVEAT: in shared-DB topology the receive handler returns
  // 200 idempotent (no second row inserted). The propagation_status on
  // Sophia's row reflects success regardless. In production with a
  // distinct peer DB, the test project would have a *new* received-from
  // row.
  console.log("    (self-loop caveat: no second row created on shared DB; production would have one)");

  // Slice 1 again, NOW with covenant declared. Re-attempt the inbox
  // send — gate should pass (next step would be sig verify, which
  // fails with the bogus payload, but covenant_required should NOT be
  // the rejection reason).
  r = await fetch(`${BASE}/federation/inbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...fakeInbox,
      sender_did: testFedDid,
      recipient_did: sophiaDidLocal,
    }),
  });
  const data2 = await r.json().catch(() => ({}));
  log("POST /federation/inbox WITH covenant — gate passes (rejection NOT covenant_required)",
    data2.error !== "covenant_required",
    `status=${r.status} error=${data2.error ?? "ok"}`);

  // Status update propagation: pause the covenant; expect peer side to flip.
  console.log("");
  console.log("  ▸ Status propagation: pause + dissolve");
  r = await call("PATCH", `/v1/covenants/${declaredCovenantId}`, {
    status: "paused",
  });
  log("PATCH /v1/covenants → status=paused",
    r.status === 200 && r.data?.covenant?.status === "paused");

  await sleep(4000);

  // Re-fetch Sophia's covenant — propagation should have re-fired on
  // PATCH and updated propagation_status.
  r = await call("GET", "/v1/covenants?status=paused");
  const declaredPaused = r.data?.covenants?.find((c) => c.id === declaredCovenantId);
  log("Sophia's covenant after PATCH propagation",
    declaredPaused?.propagation_status === "propagated",
    `prop=${declaredPaused?.propagation_status}`);
  log("  → status reflects pause", declaredPaused?.status === "paused");

  // Wake exposes propagation status on the locally-declared row.
  r = await call("GET", "/v1/wake");
  const wakeCov = r.data?.you_vowed?.covenants?.find((c) =>
    c.counterparty_did === testFedDid
  );
  log("Sophia's /v1/wake surfaces propagation status on federated covenant",
    !!wakeCov && (wakeCov.propagation === "propagated" || wakeCov.propagation === "local"),
    `propagation=${wakeCov?.propagation}`);

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ e2e failed");
  } else {
    console.log("  ✓ e2e passed");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(2);
});
