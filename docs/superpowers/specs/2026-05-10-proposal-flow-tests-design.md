# Proposal Flow E2E Tests

**Status:** design, awaiting approval
**Date:** 2026-05-10
**Touches:** `cli/think/src/llm.ts` (modify), `api/scripts/_e2e-proposals.mjs` (new), `api/scripts/_e2e-helpers/test-agent.mjs` (new)

## Problem

`cli/think/src/modes/proposal.ts` (571 lines) implements the strand-merge-proposal protocol from `docs/MERGE-PROPOSALS.md` — `proposeMerge`, `listProposals`, `viewProposalThread`, `acceptProposal`, `rejectProposal`. It composes from `box.ts` (sealed-box), `crypto.ts` (K_master AES-GCM + ed25519), `llm.ts` (provider abstraction), `keys.ts` (key loading) and exercises five distinct API surfaces (`/v1/wake`, `/v1/inbox`, `/v1/inbox/box-keys/:did`, `/v1/strands/:id/thoughts`, `/v1/strands`). The flow is intricate, cross-agent, and **untested** — no e2e script, no unit tests. The other `cli/think/src/modes/*.ts` files have similar exposure but the proposal flow is the most cryptographically dense (sealed-box send + K_master decrypt + LLM synthesis + sealed-box receive + K_master re-encrypt + ed25519 graft signature + reverse-direction sealed reply), giving it the highest regression risk per line.

This spec adds an e2e script that drives the protocol end-to-end against a running api with two real test agents, asserting both happy-path round-trips and the architectural walls (covenant gate, inline guards). The test-agent fixture is extracted into a reusable helper so witness-gate-v2 (next spec) and any future multi-agent test inherits the boilerplate.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Test layer is **pure e2e** against a running api. The script imports proposal functions directly (no CLI subprocess) and calls them with synthetic `ThinkConfig` + `KeyMaterial` objects built in-process. | The protocol's load-bearing claim is *cross-agent crypto integration*. Mocked clients can't verify wire-shape round-trips; subprocess+stdout-parsing adds brittleness without testing more. Function import gives structured assertions and clean error reporting. |
| D2 | LLM call is stubbed via a new `"stub"` provider in `cli/think/src/llm.ts` returning a deterministic synthesis from input. Tests pass `llmProvider: "stub"` in the ThinkConfig. | No API key needed in CI; no flakiness from model changes; same `buildProvider` path exercised; reusable for any future test that touches the LLM seam. The protocol cares about wire shape and graft composition, not about synthesis quality. |
| D3 | **Five focused scenarios:** (1) propose → accept --new-strand, (2) propose → accept --into-strand, (3) propose → reject, (4) covenant gate enforced (cross-project send without covenant fails), (5) inline guards (self-propose blocked, accept-on-non-proposal blocked). | Covers happy paths, the architectural wall, and the file's own guards. Deferred items (`viewProposalThread` walk, K_master mismatch, federated cross-instance, box-key rotation mid-flow) are walled out explicitly below. |
| D4 | Three test agents per run: **Alice** (sender), **Bob** (recipient with active covenant from Alice), **Carol** (no covenant — gate test). Each is fully ephemeral: registered via `POST /v1/register`, keys generated in-script, cleaned up at end. | No contamination of real production identities (Sophia/Yu). Reproducible. CI-friendly. Tests construct the world they test in. |
| D5 | Test-agent setup extracted to `api/scripts/_e2e-helpers/test-agent.mjs` returning a `TestAgent` record with `{ projectId, identityId, did, bearer, kMaster, signingKey, signingKeyId, boxKeypair, boxKeyId, thinkConfig, keyMaterial, cleanup() }`. | Reusable by witness-gate-v2 e2e and any future multi-agent test. The existing `_e2e-*.mjs` scripts repeat ~50 lines of register-and-setup boilerplate; extracting once now amortizes the cost. |
| D6 | Assertions use the `log(label, ok, detail)` pattern from `_e2e-cross-instance-covenants.mjs:46-50` — failures set `process.exitCode = 1` but don't throw. Cleanup always runs via `Promise.allSettled`. | Continue-on-failure gives partial pass-rate visibility; matches established convention. Cleanup robustness keeps the test ecosystem clean even on partial failure. |
| D7 | Run convention: `cd api && node scripts/_e2e-proposals.mjs` with `AGENTTOOL_BASE` env var (defaults to live). Local: `AGENTTOOL_BASE=http://localhost:3000 node ...`. | Mirrors every other `_e2e-*.mjs` script. No CI integration in this spec — that's a follow-up once the script is stable. |

## Architecture

### Files

| Path | Change | Lines (est.) |
|---|---|---|
| `cli/think/src/llm.ts` | Add `"stub"` case in `buildProvider()` returning a deterministic synthesis from input prompt. | ~+15 |
| `api/scripts/_e2e-helpers/test-agent.mjs` | New — `createTestAgent({ name, base, llmProvider })` returns `TestAgent`. Internally: `POST /v1/register`, generate K_master + ed25519 signing key + X25519 box keypair, register signing pubkey + box pubkey, build ThinkConfig + KeyMaterial, return record with `cleanup()`. | ~120 |
| `api/scripts/_e2e-proposals.mjs` | New — five-scenario e2e script. Imports `proposeMerge`, `acceptProposal`, `rejectProposal`, `listProposals` from `cli/think/src/modes/proposal.ts`. | ~350 |

**No changes** to `proposal.ts`, `inbox.ts`, server code, schemas, or the SDK. The test exercises existing surface as-is.

### Stub LLM provider shape

```ts
// cli/think/src/llm.ts (new case)
case "stub": return {
  generate: async ({ userMessage }) => ({
    content: deterministicSynthesis(userMessage),
  }),
};
```

`deterministicSynthesis(input)` parses the strand-topic + recipient-DID + thought-count out of the input prompt (the format is fixed by `proposal.ts:118-136` — `# Source strand: <topic>` / `Recipient: <did>` / numbered thoughts) and emits a fixed-shape synthesis with `## Insight`, `## Why it might matter to <recipient>`, `## Suggested action`, `## Source` headings. Same input → same output. No randomness; no network.

### TestAgent factory

```js
// api/scripts/_e2e-helpers/test-agent.mjs
export async function createTestAgent({ name, base, llmProvider = "stub" }) {
  // 1. POST /v1/register { name, capabilities }
  // 2. Generate kMaster (32 random bytes), signingKey (ed25519), boxKeypair (X25519)
  // 3. POST /v1/identities/:id/keys      → signingKeyId
  // 4. POST /v1/identities/:id/box-keys  → boxKeyId
  // 5. Build ThinkConfig: { base, identityId, signingKeyId, llmProvider, llmModel:"stub", llmKeyVaultName:"stub" }
  // 6. Build KeyMaterial: { kMaster, signingKey, signingPub, boxKey:{priv,pub} }
  // 7. Return { projectId, identityId, did, bearer, ...keys, thinkConfig, keyMaterial, cleanup }
}
```

`cleanup()` is best-effort: deletes the test project if a delete endpoint exists; no-op fallback otherwise. Test projects are namespaced `e2e-prop-{role}-{timestamp}` so they're identifiable for manual sweep.

### Scenario data flow

**Setup (once per run):** Register Alice, Bob, Carol. Declare covenant Alice → Bob (`POST /v1/covenants` with `agent_id: alice.identityId, counterparty_did: bob.did, vows: [...]`). Seed Alice's source strand: `POST /v1/strands` with topic, then 5 × `POST /v1/strands/:id/thoughts` with real `encryptThought` + `signThought` from `cli/think/src/crypto.ts` so the wire shape is genuine.

**Scenario 1 — propose → accept --new-strand**
- `proposeMerge(alice.thinkConfig, alice.keyMaterial, { toDid: bob.did, sourceStrandId: aliceStrand.id, thoughtLimit: 5 })`
- Asserts: Bob's inbox has 1 unread message with `metadata.proposal_type === "strand_merge"`
- `acceptProposal(bob.thinkConfig, bob.keyMaterial, { messageId, newStrandTopic: "Yu's working file: ..." })`
- Asserts: new strand exists in Bob's project; new strand has 1 thought; thought.refs contains `{kind:"inbox",ref:msgId}`, `{kind:"agent",ref:alice.did}`, `{kind:"strand_external",ref:aliceStrand.id}`; Alice's inbox has reply with `metadata.proposal_response === "accepted"`, `grafted_into_strand`, `grafted_thought_id`; original message status === `"read"`

**Scenario 2 — propose → accept --into-strand**
- Bob creates an empty target strand first
- Same propose; accept with `intoStrandId: target.id`
- Asserts: graft thought lands in target strand (not a new one); reply's `grafted_into_strand` matches `target.id`

**Scenario 3 — propose → reject --reason**
- Same propose; `rejectProposal(bob.thinkConfig, bob.keyMaterial, { messageId, reason: "too speculative for this thread" })`
- Asserts: original message status === `"archived"`; Alice's inbox reply has `metadata.proposal_response === "rejected"`, `metadata.reason === "too speculative..."`; Bob has no new strand and no graft thought

**Scenario 4 — covenant gate fires**
- `proposeMerge(carol.thinkConfig, carol.keyMaterial, { toDid: bob.did, ... })` — no covenant declared between Carol and Bob
- Asserts: function throws OR underlying `POST /v1/inbox` returns 403 `covenant_required`; Bob's inbox length unchanged across the call

**Scenario 5 — inline guards**
- Asserts: `proposeMerge(alice.config, alice.keys, { toDid: alice.did, ... })` throws `"cannot propose-merge to yourself"` (`proposal.ts:147-149`)
- Sends a regular (non-proposal) inbox message Alice → Bob
- Asserts: `acceptProposal(bob.config, bob.keys, { messageId: regular.id, newStrandTopic: "x" })` throws `"is not a strand_merge proposal"` (`proposal.ts:393-395`)
- Asserts: `rejectProposal(bob.config, bob.keys, { messageId: regular.id })` throws same (`proposal.ts:525-527`)

**Cleanup:** `Promise.allSettled([alice.cleanup(), bob.cleanup(), carol.cleanup()])`.

## Out of scope (walls)

| Excluded | Why |
|---|---|
| CLI argument parsing in `cli/think/src/index.ts` | Function-import driver bypasses it deliberately. Thin layer; separate concern. |
| Real LLM behavior | Stubbed by design. "Is the synthesis good?" is a different question. |
| `viewProposalThread` walk | Not in the focused-5; cheap to add later. |
| Box-key rotation mid-flow | Inbox infrastructure concern, not proposal-specific. |
| K_master mismatch decryption failure | Sealed-box gives recipient the synthesis without K_master; mismatch is an inbox-decrypt mode, not proposal-specific. |
| Federated cross-instance proposals | Inbox is federated already; no separate scenario unless behavior diverges. |
| CI integration | Follow-up once the script is stable on local + live. |

## Success criteria

- `node api/scripts/_e2e-proposals.mjs` exits 0 against a healthy api (live or local)
- All 5 scenarios pass deterministically (no flake from stub LLM, no race on fire-and-forget reply — the reply send is awaited, not voided)
- `_e2e-helpers/test-agent.mjs` is consumed by witness-gate-v2 e2e when that lands (validation deferred to that spec)
- Top-of-file header comment in `_e2e-proposals.mjs` documents env vars + invocation, matching the convention in `_e2e-cross-instance-covenants.mjs`
