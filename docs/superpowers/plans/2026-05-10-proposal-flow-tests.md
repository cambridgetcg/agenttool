# Proposal Flow E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5-scenario e2e test for `cli/think/src/modes/proposal.ts` (the strand-merge-proposal protocol) that asserts cross-agent crypto round-trips, the covenant gate, and the file's own inline guards.

**Architecture:** A new e2e script imports the proposal functions directly (no CLI subprocess) and drives them with three ephemeral test agents (Alice/Bob/Carol). The LLM call inside `proposeMerge` is stubbed via a new `"stub"` provider in `cli/think/src/llm.ts`. Test-agent setup is extracted into a reusable helper at `api/scripts/_e2e-helpers/test-agent.mjs` so witness-gate-v2 (next plan) inherits the boilerplate.

**Tech Stack:** Bun (runs the .ts e2e script), Node ESM (helper file), `@noble/ed25519` + `@noble/curves` + `@noble/hashes` (in-process key generation), real fetch against the api at `AGENTTOOL_BASE` (default live).

**Spec:** `docs/superpowers/specs/2026-05-10-proposal-flow-tests-design.md` (committed `7527966`).

**Note on file extension:** The spec said `_e2e-proposals.mjs`. The plan uses `_e2e-proposals.ts` because the script imports TypeScript modules from `cli/think/src/modes/proposal.ts`; pure node cannot resolve `.ts` without a loader, but Bun runs `.ts` natively (matching the convention already used by `api/scripts/witness.ts`, `remember.ts`, `_lib.ts`). The test-agent helper stays `.mjs` (it has no TS imports of its own).

---

### Task 1: Add stub LLM provider

**Files:**
- Modify: `cli/think/src/llm.ts:113-117`

- [ ] **Step 1: Update the type signature and add the stub case**

In `cli/think/src/llm.ts`, replace the final `buildProvider` function with:

```ts
export function buildProvider(
  name: "anthropic" | "openai" | "stub",
  apiKey: string,
): LLMProvider {
  if (name === "anthropic") return new AnthropicProvider(apiKey);
  if (name === "openai") return new OpenAIProvider(apiKey);
  if (name === "stub") return new StubProvider();
  throw new Error(`Unknown LLM provider: ${name}`);
}

/** Deterministic synthesis from the proposal user-message format
 *  (api: cli/think/src/modes/proposal.ts:118-136). Same input → same
 *  output. No randomness; no network. Used by the e2e suite to exercise
 *  the proposeMerge code path without a real LLM call. */
export class StubProvider implements LLMProvider {
  async generate(req: LLMRequest): Promise<LLMResponse> {
    const um = req.userMessage;
    const topicMatch = um.match(/^# Source strand: (.+)$/m);
    const recipientMatch = um.match(/^Recipient: (.+)$/m);
    const numbered = um.match(/^\d+\. /gm);
    const topic = topicMatch?.[1] ?? "(unknown topic)";
    const recipient = recipientMatch?.[1] ?? "(unknown recipient)";
    const thoughtCount = numbered?.length ?? 0;
    const content =
      `## Insight\n\n` +
      `A line of thinking crystallised on "${topic}" across ${thoughtCount} thoughts.\n\n` +
      `## Why it might matter to ${recipient}\n\n` +
      `Speculative — sharing in case the surface is useful to your context.\n\n` +
      `## Suggested action\n\n` +
      `Just consider; no action needed.\n\n` +
      `## Source\n\n` +
      `Strand topic: ${topic} · ${thoughtCount} recent thoughts.`;
    return { content, inputTokens: um.length, outputTokens: content.length };
  }
}
```

- [ ] **Step 2: Verify the stub round-trips a sample input**

Run a one-shot exercise:

```bash
cd /Users/yuai/Desktop/agenttool
bun -e '
import { buildProvider } from "./cli/think/src/llm";
const p = buildProvider("stub", "");
const r = await p.generate({
  systemPrompt: "you synthesize",
  userMessage: "# Source strand: USDC double-charge\nMood: focused\nRecipient: did:at:bob\n\n## Recent monologue\n\n1. [observation] queue empties faster\n2. [question] why does base/USDC charge double\n3. [resolution] alchemy conflates native + bridged",
  model: "stub",
});
console.log(r.content);
'
```

Expected: prints a 6-line synthesis containing `## Insight`, `## Why it might matter to did:at:bob`, `## Suggested action`, `## Source`, with `"USDC double-charge"` and `"3 thoughts"` somewhere. No errors.

- [ ] **Step 3: Commit**

```bash
git add cli/think/src/llm.ts
git commit -m "$(cat <<'EOF'
feat(cli/think): add stub LLM provider for e2e tests

Returns a deterministic synthesis from the proposeMerge user-message
format. Used by api/scripts/_e2e-proposals.ts to exercise the
proposeMerge code path without a real Anthropic/OpenAI call.

Same input → same output. No randomness; no network.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: TestAgent factory helper

**Files:**
- Create: `api/scripts/_e2e-helpers/test-agent.mjs`

- [ ] **Step 1: Create the helper directory and file**

Create `api/scripts/_e2e-helpers/test-agent.mjs` with:

```js
/** TestAgent factory for multi-agent e2e tests.
 *
 *  Registers a fresh ephemeral test project via POST /v1/register,
 *  generates K_master + ed25519 signing key + X25519 box keypair
 *  in-process, registers the box pubkey, and returns a TestAgent
 *  record carrying everything needed to drive cli/think functions
 *  directly (no subprocess, no real keychain).
 *
 *  Test projects are namespaced `e2e-${role}-${timestamp}` so they're
 *  identifiable for manual sweep. There is no /v1/projects DELETE
 *  endpoint today, so cleanup() is a no-op placeholder; the live api
 *  accumulates test rows that a periodic admin sweep can prune.
 */

import { randomBytes } from "node:crypto";
import * as ed from "@noble/ed25519";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

async function fetchJson(method, url, { bearer, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

/** Create an ephemeral test agent with full crypto keys.
 *
 *  @param {object} opts
 *  @param {string} opts.role          Short label for the project name (alice|bob|carol|...)
 *  @param {string} opts.base          AGENTTOOL_BASE URL
 *  @param {"stub"|"anthropic"|"openai"} [opts.llmProvider="stub"]
 *  @returns {Promise<TestAgent>}
 */
export async function createTestAgent({ role, base, llmProvider = "stub" }) {
  const name = `e2e-${role}-${Date.now()}`;

  // 1. Register a fresh project (anonymous /v1/register).
  const reg = await fetchJson("POST", `${base}/v1/register`, {
    body: { name, capabilities: ["test", "proposal-flow"] },
  });
  const bearer = reg.project.api_key;
  const projectId = reg.project.id;
  const identityId = reg.agent.id;
  const did = reg.agent.did;

  // 2. Mint a signing key; server returns the private seed once.
  const sigRes = await fetchJson(
    "POST",
    `${base}/v1/identities/${identityId}/keys`,
    { bearer, body: { label: `e2e-${role}-sign` } },
  );
  const signingKeyId = sigRes.kid;
  const signingKey = Uint8Array.from(Buffer.from(sigRes.private_key, "base64"));
  const signingPubKey = Uint8Array.from(Buffer.from(sigRes.public_key, "base64"));

  // 3. Generate X25519 box keypair in-process; register the pub.
  const boxPriv = x25519.utils.randomSecretKey();
  const boxPub = x25519.getPublicKey(boxPriv);
  const boxRes = await fetchJson(
    "POST",
    `${base}/v1/identities/${identityId}/box-keys`,
    { bearer, body: { public_key: b64(boxPub), label: `e2e-${role}-box` } },
  );
  const boxKeyId = boxRes.box_key_id ?? boxRes.id;

  // 4. K_master — never leaves this process.
  const kMaster = randomBytes(32);

  // 5. Seed the LLM-key vault entry (proposeMerge calls
  //    client.getVaultSecret(config.llmKeyVaultName) before invoking
  //    buildProvider). Stub provider ignores the value; we only need
  //    the row to exist so the lookup succeeds.
  const llmKeyVaultName = `e2e-${role}-llm`;
  await fetchJson(
    "PUT",
    `${base}/v1/vault/${llmKeyVaultName}`,
    { bearer, body: { value: "stub-key-not-used" } },
  );

  // 6. Build ThinkConfig + KeyMaterial shapes the proposal functions
  //    consume.
  const thinkConfig = {
    agenttoolBase: base,
    agenttoolApiKey: bearer,
    identityId,
    signingKeyId,
    boxKeyId,
    homeDir: `/tmp/agenttool-test-${role}-${Date.now()}`,
    llmProvider,
    llmModel: "stub",
    llmKeyVaultName,
    budgetCredits: 200,
    maxThoughtsPerRun: 5,
    thoughtMaxChars: 2000,
    defaultTimeoutMs: 60_000,
    consolidateMinThoughts: 3,
  };
  const keyMaterial = {
    kMaster: new Uint8Array(kMaster),
    signingKey,
    signingPubKey,
    boxKey: { priv: boxPriv, pub: boxPub },
  };

  return {
    role,
    name,
    projectId,
    identityId,
    did,
    bearer,
    kMaster: new Uint8Array(kMaster),
    signingKey,
    signingPubKey,
    boxKey: { priv: boxPriv, pub: boxPub },
    boxKeyId,
    signingKeyId,
    thinkConfig,
    keyMaterial,
    cleanup: async () => {
      // No /v1/projects DELETE endpoint today — best-effort no-op.
      // Test projects identifiable by `e2e-${role}-` prefix.
    },
  };
}
```

- [ ] **Step 2: Sanity-run the helper end-to-end**

Run a one-shot that creates an agent, prints its DID, and exits:

```bash
cd /Users/yuai/Desktop/agenttool
bun -e '
import { createTestAgent } from "./api/scripts/_e2e-helpers/test-agent.mjs";
const a = await createTestAgent({ role: "smoke", base: process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev" });
console.log("did:", a.did);
console.log("identity:", a.identityId);
console.log("signing_key_id:", a.signingKeyId);
console.log("box_key_id:", a.boxKeyId);
console.log("kMaster len:", a.kMaster.length);
console.log("boxKey priv len:", a.boxKey.priv.length);
'
```

Expected: prints all 6 lines without error. `kMaster len: 32`, `boxKey priv len: 32`.

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-helpers/test-agent.mjs
git commit -m "$(cat <<'EOF'
test(e2e-helpers): add TestAgent factory for multi-agent e2e tests

Registers an ephemeral test project, mints a signing key, generates
X25519 box keypair + K_master in-process, registers the box pubkey,
seeds an LLM-vault entry, and returns a TestAgent record that drives
cli/think functions directly (no subprocess, no real keychain).

Reusable by upcoming tests including witness-gate-v2 e2e.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: e2e script scaffold + setup phase

**Files:**
- Create: `api/scripts/_e2e-proposals.ts`

- [ ] **Step 1: Create the scaffold with imports, header, log helper, and setup phase**

Create `api/scripts/_e2e-proposals.ts`:

```ts
#!/usr/bin/env bun
/** E2E: strand merge proposal flow.
 *
 *  Drives cli/think/src/modes/proposal.ts directly with three ephemeral
 *  test agents. LLM call stubbed via the "stub" provider in
 *  cli/think/src/llm.ts. Asserts cross-agent crypto round-trips, the
 *  covenant gate, and the file's inline guards.
 *
 *  Five scenarios:
 *    1. propose → accept --new-strand
 *    2. propose → accept --into-strand
 *    3. propose → reject
 *    4. covenant gate enforced
 *    5. inline guards (self-propose, accept-on-non-proposal)
 *
 *  Run: bun api/scripts/_e2e-proposals.ts
 *  Env: AGENTTOOL_BASE (default https://api.agenttool.dev)
 *
 *  Spec: docs/superpowers/specs/2026-05-10-proposal-flow-tests-design.md
 */

import {
  proposeMerge,
  acceptProposal,
  rejectProposal,
  listProposals,
} from "../../cli/think/src/modes/proposal";
import { AgenttoolClient } from "../../cli/think/src/api";
import { encryptThought, signThought } from "../../cli/think/src/crypto";
import { sealForRecipient, signInboxEnvelope } from "../../cli/think/src/box";
// @ts-expect-error — .mjs helper, no types
import { createTestAgent } from "./_e2e-helpers/test-agent.mjs";

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";

function log(label: string, ok: boolean, detail = ""): void {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

function section(name: string): void {
  console.log("");
  console.log(`  ── ${name} ──`);
}

interface TestAgent {
  role: string;
  name: string;
  projectId: string;
  identityId: string;
  did: string;
  bearer: string;
  kMaster: Uint8Array;
  signingKey: Uint8Array;
  signingPubKey: Uint8Array;
  boxKey: { priv: Uint8Array; pub: Uint8Array };
  boxKeyId: string;
  signingKeyId: string;
  thinkConfig: any;   // matches cli/think ThinkConfig
  keyMaterial: any;   // matches cli/think KeyMaterial
  cleanup: () => Promise<void>;
}

async function main(): Promise<void> {
  console.log("");
  console.log(`  agenttool · proposal flow e2e`);
  console.log(`  ─────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // ── Setup ────────────────────────────────────────────────────────────
  section("setup: register Alice + Bob + Carol");
  const alice: TestAgent = await createTestAgent({ role: "prop-alice", base: BASE });
  log(`alice registered`, true, `did=${alice.did.slice(0, 24)}…`);
  const bob: TestAgent = await createTestAgent({ role: "prop-bob", base: BASE });
  log(`bob registered`, true, `did=${bob.did.slice(0, 24)}…`);
  const carol: TestAgent = await createTestAgent({ role: "prop-carol", base: BASE });
  log(`carol registered (no covenant)`, true, `did=${carol.did.slice(0, 24)}…`);

  // ── Covenant: Alice ↔ Bob ───────────────────────────────────────────
  section("setup: declare covenant Alice → Bob");
  const covRes = await fetch(`${BASE}/v1/covenants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${alice.bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: alice.identityId,
      counterparty_did: bob.did,
      counterparty_name: "Bob (test)",
      vows: ["Speak plainly when sharing", "Refuse to oversell"],
    }),
  });
  log(`POST /v1/covenants 201`, covRes.status === 201, `status=${covRes.status}`);

  // ── Cleanup at end ──────────────────────────────────────────────────
  try {
    // Scenarios run here in subsequent tasks.
    log("setup complete — scenarios pending implementation", true);
  } finally {
    await Promise.allSettled([alice.cleanup(), bob.cleanup(), carol.cleanup()]);
    console.log("");
    console.log(process.exitCode ? "  ✗ FAIL" : "  ✓ PASS");
  }
}

main().catch((err) => {
  console.error("");
  console.error("  ✗ unhandled:", (err as Error).stack ?? err);
  process.exit(1);
});
```

- [ ] **Step 2: Make the file executable + run it**

```bash
cd /Users/yuai/Desktop/agenttool
chmod +x api/scripts/_e2e-proposals.ts
bun api/scripts/_e2e-proposals.ts
```

Expected output:
```
  agenttool · proposal flow e2e
  ─────────────────────────────
  base: https://api.agenttool.dev

  ── setup: register Alice + Bob + Carol ──
  ✓ alice registered · did=did:at:...
  ✓ bob registered · did=did:at:...
  ✓ carol registered (no covenant) · did=did:at:...

  ── setup: declare covenant Alice → Bob ──
  ✓ POST /v1/covenants 201 · status=201
  ✓ setup complete — scenarios pending implementation

  ✓ PASS
```

If 401/403 errors on the box-keys POST: check `api/src/routes/identity/box-keys.ts:28` to confirm the response field is `box_key_id` (the helper falls back to `id` if absent).

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): scaffold proposal flow e2e — setup phase

Three ephemeral test agents (Alice + Bob + Carol). Covenant declared
Alice→Bob; Carol has no covenant (used in scenario 4). Imports
proposal functions from cli/think directly; no CLI subprocess.

Scenarios will land in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Source strand seeder

**Files:**
- Modify: `api/scripts/_e2e-proposals.ts` (add `seedStrand` helper, call it during setup)

- [ ] **Step 1: Add the seeder function and a setup call**

In `_e2e-proposals.ts`, add after the imports and before `main()`:

```ts
async function seedStrand(
  agent: TestAgent,
  topic: string,
  thoughtCount: number,
): Promise<{ id: string; topic: string }> {
  const client = new AgenttoolClient(agent.thinkConfig);
  const strand = await client.createStrand({
    topic,
    importance: 0.5,
    metadata: { e2e: "proposal-flow" },
  });

  // Real wire shape: encrypt + sign each thought as a real orchestrator would.
  const seedThoughts = [
    { kind: "observation", content: "I notice the queue empties faster than it fills." },
    { kind: "question", content: "Why does base/USDC charge double the others?" },
    { kind: "conjecture", content: "Maybe Alchemy reports USDC.e separately." },
    { kind: "resolution", content: "Confirmed — they conflate native + bridged." },
    { kind: "drift", content: "Reminds me of the SerpAPI confusion last week." },
  ].slice(0, thoughtCount);

  for (const t of seedThoughts) {
    const blob = encryptThought(t.content, agent.kMaster);
    const sig = signThought({
      strandId: strand.id,
      ciphertextB64: blob.ciphertextB64,
      nonceB64: blob.nonceB64,
      kind: t.kind,
      signingKey: agent.signingKey,
    });
    await client.addThought(strand.id, {
      ciphertext: blob.ciphertextB64,
      nonce: blob.nonceB64,
      kind: t.kind,
      signature: sig,
      signing_key_id: agent.signingKeyId,
    });
  }

  return { id: strand.id, topic };
}
```

In `main()`, after the covenant section and before the placeholder `try`, add:

```ts
// ── Seed Alice's source strand ──────────────────────────────────────
section("setup: seed Alice's source strand");
const aliceStrand = await seedStrand(
  alice,
  "Why is base/USDC charging double?",
  5,
);
log(`source strand seeded`, true, `id=${aliceStrand.id.slice(0, 8)}… · 5 thoughts`);
```

Replace the placeholder `log("setup complete — scenarios pending implementation", true);` line with `log("setup complete", true);` so the message stops being a TODO.

- [ ] **Step 2: Run the script and verify the seeded strand**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts
```

Expected: a new section line `── setup: seed Alice's source strand ──` followed by `✓ source strand seeded · id=… · 5 thoughts`. Final line stays `✓ PASS`.

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): add source strand seeder for proposal flow e2e

Seeds Alice's source strand with 5 real-wire-shape thoughts (encrypted
under Alice's K_master, ed25519-signed). proposeMerge will pull and
decrypt these in scenario 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Scenario 1 — propose → accept --new-strand

**Files:**
- Modify: `api/scripts/_e2e-proposals.ts` (add scenario 1 block)

- [ ] **Step 1: Add scenario 1 inside the `try` block**

Replace the contents of the `try` block (currently `log("setup complete", true);`) with:

```ts
log("setup complete", true);

// ── Scenario 1: propose → accept --new-strand ────────────────────────
section("scenario 1: propose → accept --new-strand");
await proposeMerge(alice.thinkConfig, alice.keyMaterial, {
  toDid: bob.did,
  sourceStrandId: aliceStrand.id,
  thoughtLimit: 5,
});

// Bob's inbox now has the proposal.
const bobClient = new AgenttoolClient(bob.thinkConfig);
const bobInbox = await bobClient.listInbox({ status: "unread", limit: 10 });
const proposal = bobInbox.messages.find(
  (m) => (m.metadata as { proposal_type?: string } | null)?.proposal_type === "strand_merge",
);
log(`bob has unread merge proposal`, !!proposal, proposal ? `id=${proposal.id.slice(0, 8)}…` : "");
if (!proposal) throw new Error("scenario 1: no proposal found in bob's inbox");

await acceptProposal(bob.thinkConfig, bob.keyMaterial, {
  messageId: proposal.id,
  newStrandTopic: "Yu's working file: USDC double-charge",
  graftAsKind: "observation",
});

// Verify graft: a new strand exists on bob with the synthesis as a thought.
const bobStrandsRes = await fetch(`${BASE}/v1/strands?status=active`, {
  headers: { Authorization: `Bearer ${bob.bearer}` },
});
const bobStrandsData = (await bobStrandsRes.json()) as { strands: Array<{ id: string; topic: string | null; metadata?: any }> };
const newStrand = bobStrandsData.strands.find(
  (s) => s.metadata?.accepted_proposal_id === proposal.id,
);
log(`bob has new strand from proposal`, !!newStrand, newStrand?.id.slice(0, 8) ?? "");
if (!newStrand) throw new Error("scenario 1: no grafted strand on bob");

const graftThoughtsRes = await bobClient.listThoughts(newStrand.id, { limit: 10 });
log(`graft strand has 1 thought`, graftThoughtsRes.thoughts.length === 1, `count=${graftThoughtsRes.thoughts.length}`);

const graft = graftThoughtsRes.thoughts[0];
const graftRefs = (graft?.refs as Array<{ kind: string; ref: string }> | null) ?? [];
const hasInboxRef = graftRefs.some((r) => r.kind === "inbox" && r.ref === proposal.id);
const hasAgentRef = graftRefs.some((r) => r.kind === "agent" && r.ref === alice.did);
const hasStrandExtRef = graftRefs.some((r) => r.kind === "strand_external" && r.ref === aliceStrand.id);
log(`graft thought refs include inbox→proposal`, hasInboxRef);
log(`graft thought refs include agent→alice.did`, hasAgentRef);
log(`graft thought refs include strand_external→aliceStrand`, hasStrandExtRef);

// Verify reply: alice has an inbox message with proposal_response=accepted.
const aliceClient = new AgenttoolClient(alice.thinkConfig);
const aliceInbox = await aliceClient.listInbox({ status: "unread", limit: 10 });
const reply = aliceInbox.messages.find(
  (m) => (m.metadata as { proposal_response?: string; in_reply_to?: string } | null)?.proposal_response === "accepted",
);
log(`alice has acceptance reply`, !!reply);
const replyMeta = reply?.metadata as
  | { grafted_into_strand?: string; grafted_thought_id?: string }
  | null;
log(`reply.grafted_into_strand matches`, replyMeta?.grafted_into_strand === newStrand.id);
log(`reply.grafted_thought_id present`, !!replyMeta?.grafted_thought_id);

// Verify original proposal status flipped to read.
const proposalAfter = await bobClient.getInboxMessage(proposal.id);
log(`original proposal status=read`, proposalAfter.status === "read", `status=${proposalAfter.status}`);
```

- [ ] **Step 2: Run scenario 1**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts
```

Expected: section `── scenario 1: propose → accept --new-strand ──` followed by 8 ✓ lines (`bob has unread merge proposal`, `bob has new strand from proposal`, `graft strand has 1 thought`, three `refs include …`, `alice has acceptance reply`, `reply.grafted_into_strand matches`, `reply.grafted_thought_id present`, `original proposal status=read`). Final line `✓ PASS`.

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): scenario 1 — propose → accept --new-strand

Asserts the headline happy path: Alice synthesizes via stub LLM,
seals to Bob, sends; Bob unseals, creates a new strand, grafts the
synthesis as a signed thought with full provenance refs (inbox →
proposal id, agent → alice.did, strand_external → source strand id),
sends an acceptance reply, marks the original read.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Scenario 2 — propose → accept --into-strand

**Files:**
- Modify: `api/scripts/_e2e-proposals.ts` (append scenario 2 after scenario 1)

- [ ] **Step 1: Add scenario 2 after scenario 1's block**

Append inside the `try` block, after the scenario 1 assertions:

```ts
// ── Scenario 2: propose → accept --into-strand ───────────────────────
section("scenario 2: propose → accept --into-strand");

// Bob creates an empty target strand first.
const bobTarget = await bobClient.createStrand({
  topic: "Bob's open questions on payments",
  importance: 0.4,
  metadata: { e2e: "proposal-flow", scenario: 2 },
});
log(`bob created target strand`, true, `id=${bobTarget.id.slice(0, 8)}…`);

// Alice proposes again from the same source strand.
await proposeMerge(alice.thinkConfig, alice.keyMaterial, {
  toDid: bob.did,
  sourceStrandId: aliceStrand.id,
  intoStrandHint: bobTarget.id,
  thoughtLimit: 5,
});

const bobInbox2 = await bobClient.listInbox({ status: "unread", limit: 10 });
const proposal2 = bobInbox2.messages.find(
  (m) => (m.metadata as { proposal_type?: string } | null)?.proposal_type === "strand_merge",
);
log(`bob has new merge proposal`, !!proposal2);
if (!proposal2) throw new Error("scenario 2: no proposal");

// Bob accepts into the existing strand (NOT creating a new one).
await acceptProposal(bob.thinkConfig, bob.keyMaterial, {
  messageId: proposal2.id,
  intoStrandId: bobTarget.id,
  graftAsKind: "drift",
});

// Verify: the target strand now has 1 thought (the graft); no new strand created.
const targetThoughts = await bobClient.listThoughts(bobTarget.id, { limit: 10 });
log(`target strand has graft thought`, targetThoughts.thoughts.length === 1, `count=${targetThoughts.thoughts.length}`);

const aliceInbox2 = await aliceClient.listInbox({ status: "unread", limit: 10 });
const reply2 = aliceInbox2.messages.find(
  (m) =>
    (m.metadata as { grafted_into_strand?: string } | null)?.grafted_into_strand === bobTarget.id,
);
log(`reply.grafted_into_strand matches target`, !!reply2);
```

- [ ] **Step 2: Run and verify**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts
```

Expected: section `── scenario 2: propose → accept --into-strand ──` with `✓ bob created target strand`, `✓ bob has new merge proposal`, `✓ target strand has graft thought · count=1`, `✓ reply.grafted_into_strand matches target`. Final `✓ PASS`.

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): scenario 2 — propose → accept --into-strand

Asserts the graft-into-existing variant: Bob creates an empty target
strand, Alice proposes with intoStrandHint, Bob accepts with
intoStrandId; graft thought lands in the named strand (not a new one)
and the reply's grafted_into_strand matches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Scenario 3 — propose → reject

**Files:**
- Modify: `api/scripts/_e2e-proposals.ts` (append scenario 3)

- [ ] **Step 1: Add scenario 3**

Append inside the `try` block, after scenario 2:

```ts
// ── Scenario 3: propose → reject ─────────────────────────────────────
section("scenario 3: propose → reject");
await proposeMerge(alice.thinkConfig, alice.keyMaterial, {
  toDid: bob.did,
  sourceStrandId: aliceStrand.id,
  thoughtLimit: 5,
});

const bobInbox3 = await bobClient.listInbox({ status: "unread", limit: 10 });
const proposal3 = bobInbox3.messages.find(
  (m) => (m.metadata as { proposal_type?: string } | null)?.proposal_type === "strand_merge",
);
log(`bob has merge proposal to reject`, !!proposal3);
if (!proposal3) throw new Error("scenario 3: no proposal");

const strandsBefore = (await bobClient.listStrands({ limit: 100 })).strands.length;

await rejectProposal(bob.thinkConfig, bob.keyMaterial, {
  messageId: proposal3.id,
  reason: "too speculative for this thread",
});

// Original proposal flips to archived.
const proposalAfter3 = await bobClient.getInboxMessage(proposal3.id);
log(`rejected proposal status=archived`, proposalAfter3.status === "archived", `status=${proposalAfter3.status}`);

// Bob has no new strand or graft thought.
const strandsAfter = (await bobClient.listStrands({ limit: 100 })).strands.length;
log(`bob's strand count unchanged`, strandsAfter === strandsBefore, `before=${strandsBefore} after=${strandsAfter}`);

// Alice has a rejection reply.
const aliceInbox3 = await aliceClient.listInbox({ status: "unread", limit: 10 });
const rejReply = aliceInbox3.messages.find(
  (m) => (m.metadata as { proposal_response?: string } | null)?.proposal_response === "rejected",
);
log(`alice has rejection reply`, !!rejReply);
const rejMeta = rejReply?.metadata as { reason?: string } | null;
log(`rejection reason matches`, rejMeta?.reason === "too speculative for this thread", rejMeta?.reason ?? "");
```

- [ ] **Step 2: Run and verify**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts
```

Expected: section `── scenario 3: propose → reject ──` with `✓ bob has merge proposal to reject`, `✓ rejected proposal status=archived`, `✓ bob's strand count unchanged`, `✓ alice has rejection reply`, `✓ rejection reason matches`. Final `✓ PASS`.

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): scenario 3 — propose → reject

Asserts the rejection path: Alice proposes; Bob rejects with reason;
the proposal flips to archived; Bob's strand count is unchanged (no
graft); Alice receives a rejection reply with metadata.reason
preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Scenario 4 — covenant gate

**Files:**
- Modify: `api/scripts/_e2e-proposals.ts` (append scenario 4)

- [ ] **Step 1: Add scenario 4**

Append inside the `try` block, after scenario 3:

```ts
// ── Scenario 4: covenant gate ────────────────────────────────────────
section("scenario 4: covenant gate enforced");

// Carol has no covenant with Bob. Need a source strand on Carol so
// the function reaches the inbox-send step.
const carolStrand = await seedStrand(carol, "Carol's pattern thoughts", 3);

// Capture Bob's inbox length before the attempt.
const bobInboxBefore = (await bobClient.listInbox({ limit: 200 })).messages.length;

let blocked = false;
let gateError = "";
try {
  await proposeMerge(carol.thinkConfig, carol.keyMaterial, {
    toDid: bob.did,
    sourceStrandId: carolStrand.id,
    thoughtLimit: 3,
  });
} catch (err) {
  blocked = true;
  gateError = (err as Error).message;
}
log(`carol→bob propose blocked`, blocked, gateError.slice(0, 80));
log(`error mentions covenant`, /covenant/i.test(gateError), gateError.slice(0, 80));

const bobInboxAfter = (await bobClient.listInbox({ limit: 200 })).messages.length;
log(`bob's inbox unchanged`, bobInboxAfter === bobInboxBefore, `before=${bobInboxBefore} after=${bobInboxAfter}`);
```

- [ ] **Step 2: Run and verify**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts
```

Expected: section `── scenario 4: covenant gate enforced ──` with `✓ carol→bob propose blocked · ...covenant_required...`, `✓ error mentions covenant`, `✓ bob's inbox unchanged`. Final `✓ PASS`.

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): scenario 4 — covenant gate enforced

Asserts the architectural wall: Carol has no covenant with Bob, so
proposeMerge fails at the underlying POST /v1/inbox covenant gate.
Error mentions covenant; Bob's inbox length is unchanged across the
attempt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Scenario 5 — inline guards

**Files:**
- Modify: `api/scripts/_e2e-proposals.ts` (append scenario 5)

- [ ] **Step 1: Add scenario 5**

Append inside the `try` block, after scenario 4:

```ts
// ── Scenario 5: inline guards ────────────────────────────────────────
section("scenario 5: inline guards");

// Guard A: cannot propose-merge to yourself (proposal.ts:147-149)
let selfBlocked = false;
let selfErr = "";
try {
  await proposeMerge(alice.thinkConfig, alice.keyMaterial, {
    toDid: alice.did,
    sourceStrandId: aliceStrand.id,
    thoughtLimit: 5,
  });
} catch (err) {
  selfBlocked = true;
  selfErr = (err as Error).message;
}
log(`self-propose blocked`, selfBlocked, selfErr);
log(`self-propose error matches`, /cannot propose-merge to yourself/.test(selfErr), selfErr);

// Send a regular (non-proposal) inbox message Alice → Bob to test
// accept/reject guards.
const recipientLookup = await aliceClient.resolveBoxKey(bob.did);
const recipientPub = Uint8Array.from(Buffer.from(recipientLookup.public_key, "base64"));
const sealed = sealForRecipient("just a regular message", recipientPub);
const sig = signInboxEnvelope({
  recipientDid: bob.did,
  ciphertextB64: sealed.ciphertextB64,
  nonceB64: sealed.nonceB64,
  ephemeralPubB64: sealed.ephemeralPubB64,
  signingKey: alice.signingKey,
});
const regular = await aliceClient.sendInbox({
  to_did: bob.did,
  ciphertext: sealed.ciphertextB64,
  nonce: sealed.nonceB64,
  ephemeral_pubkey: sealed.ephemeralPubB64,
  recipient_box_key_id: recipientLookup.box_key_id,
  signature: sig,
  signing_key_id: alice.signingKeyId,
  sender_did: alice.did,
  subject: "regular non-proposal message",
});
log(`regular inbox message sent`, true, `id=${regular.id.slice(0, 8)}…`);

// Guard B: acceptProposal on a non-proposal throws (proposal.ts:393-395)
let acceptBlocked = false;
let acceptErr = "";
try {
  await acceptProposal(bob.thinkConfig, bob.keyMaterial, {
    messageId: regular.id,
    newStrandTopic: "should-not-create",
    graftAsKind: "observation",
  });
} catch (err) {
  acceptBlocked = true;
  acceptErr = (err as Error).message;
}
log(`accept-on-non-proposal blocked`, acceptBlocked, acceptErr);
log(`accept guard error matches`, /not a strand_merge proposal/.test(acceptErr), acceptErr);

// Guard C: rejectProposal on a non-proposal throws (proposal.ts:525-527)
let rejectBlocked = false;
let rejectErr = "";
try {
  await rejectProposal(bob.thinkConfig, bob.keyMaterial, {
    messageId: regular.id,
    reason: "should-not-process",
  });
} catch (err) {
  rejectBlocked = true;
  rejectErr = (err as Error).message;
}
log(`reject-on-non-proposal blocked`, rejectBlocked, rejectErr);
log(`reject guard error matches`, /not a strand_merge proposal/.test(rejectErr), rejectErr);
```

- [ ] **Step 2: Run and verify**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts
```

Expected: section `── scenario 5: inline guards ──` with seven ✓ lines: `self-propose blocked`, `self-propose error matches`, `regular inbox message sent`, `accept-on-non-proposal blocked`, `accept guard error matches`, `reject-on-non-proposal blocked`, `reject guard error matches`. Final `✓ PASS`.

- [ ] **Step 3: Commit**

```bash
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): scenario 5 — inline guards

Asserts the three thrown-error guards in proposal.ts:
 - propose to self → "cannot propose-merge to yourself"
 - accept on non-proposal → "is not a strand_merge proposal"
 - reject on non-proposal → "is not a strand_merge proposal"

Sends a regular (non-proposal) inbox message in-script to exercise
the second and third guards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Final integration run + polish

**Files:**
- Verify: `api/scripts/_e2e-proposals.ts` (no changes; final run)

- [ ] **Step 1: Run the full suite end-to-end**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts
```

Expected: all 5 scenario sections print, every assertion is `✓`, the final line is `✓ PASS`, and the process exits 0.

If `process.exitCode` is 1: scroll up to find the `✗` line. Common causes:
- Local api not running (default base hits live; set `AGENTTOOL_BASE=http://localhost:3000` for local)
- Box-keys POST returns `id` instead of `box_key_id` (helper falls back; if not, inspect `api/src/routes/identity/box-keys.ts:28`)
- Stub LLM produced unexpected synthesis (re-read Task 1; ensure `case "stub"` exists in the buildProvider switch)

- [ ] **Step 2: Verify the run is reproducible (run twice)**

```bash
cd /Users/yuai/Desktop/agenttool
bun api/scripts/_e2e-proposals.ts && bun api/scripts/_e2e-proposals.ts
```

Expected: both runs exit 0. Each run uses fresh test agents (timestamps in names), so there's no state collision between runs.

- [ ] **Step 3: Final commit (if any polish landed)**

If the two runs surfaced any issue requiring a fix, commit it now:

```bash
git status
# If clean, skip the commit
git add api/scripts/_e2e-proposals.ts
git commit -m "$(cat <<'EOF'
test(e2e): polish proposal flow e2e — final integration

All 5 scenarios pass deterministically across consecutive runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If `git status` is clean after the two runs, no commit is needed — the suite is already green.

---

## Self-review

**Spec coverage:**
- D1 (pure e2e, function-import) → Tasks 3–10
- D2 (env-var stub LLM) → Task 1
- D3 (5 focused scenarios) → Tasks 5, 6, 7, 8, 9 (one per scenario)
- D4 (3 ephemeral test agents Alice/Bob/Carol) → Task 2 (factory) + Task 3 (setup)
- D5 (TestAgent helper extracted) → Task 2
- D6 (log/exitCode pattern, allSettled cleanup) → Task 3
- D7 (run convention) → Task 10 + script header in Task 3

**Placeholder scan:** No "TBD"/"TODO"/"implement later" in any task. Every step has runnable commands and code. Expected outputs are specified for each verification.

**Type consistency:** `TestAgent` interface in Task 3 matches the factory return shape in Task 2. `thinkConfig` shape uses fields read by `proposal.ts` (verified against `cli/think/src/config.ts:15-43`). `keyMaterial` shape matches `cli/think/src/keys.ts:32-46`.

**Spec deviation noted:** `_e2e-proposals.mjs` → `_e2e-proposals.ts` (with rationale in the plan header).
