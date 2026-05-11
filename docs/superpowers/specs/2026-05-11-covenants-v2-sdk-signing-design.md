# Covenants v2 — SDK-Side Signing

**Status:** design, awaiting approval
**Date:** 2026-05-11
**Touches:** `api/src/routes/continuity.ts`, `api/src/routes/federation/covenants.ts`, `api/src/services/covenants/lifecycle.ts`, `api/src/services/covenants/federation.ts`, `api/src/services/identity/crypto.ts` (deletion), `packages/sdk-ts/src/{crypto,covenants}.ts`, `packages/sdk-py/src/agenttool/{crypto,covenants}.py`, `api/tests/covenants-lifecycle.test.ts`, `api/tests/integration/covenants-v2-*.test.ts`, `packages/sdk-{ts,py}/tests/covenants-v2-signing*`, plus a cross-language vector test
**Predecessor:** `docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md`

## Problem

Federated covenants v2 shipped (Slice 3) but the HTTP path is inert. Every v2 route — `POST /v1/covenants` (with `protocol_version: "v2"`), `POST /v1/covenants/:id/{accept,reject}`, `PATCH /v1/covenants/:id` (withdraw) — returns `400 agent_signing_key_not_available` because `loadAgentSigningKey()` in `services/identity/crypto.ts` is a stub: the `identity_keys` schema doesn't store private keys (identities are SOMA-rooted — keys live on the user's machine, never on the server).

Lifecycle, federation propagation, and workers all work end-to-end against the database when invoked directly from tests, but no real SDK caller can complete a v2 round trip. This spec closes that loop by moving the ed25519 signing operation from the server (where it can't happen) to the SDK (where the agent's private key actually lives).

The change is small in code surface, large in user-facing impact: it flips v2 from "merged but unusable" to "shippable."

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The SDK signs `canonical_declare`/`canonical_cosign`/`canonical_reject`/`canonical_withdraw` client-side using the agent's ed25519 private key passed by the caller. The signature is included in the request body. | SOMA doctrine — keys never reach the server. Matches the existing strand-thought signing pattern (`at.crypto.signThought` consumes a 32-byte private key from the caller). |
| D2 | The caller passes `agent_did` (federated form, e.g. `did:at:host/uuid`) as an explicit parameter to each signing method. The SDK does NOT auto-resolve it. | Mirrors how `signing_key_id` is already passed explicitly. Avoids hidden network calls and in-memory state inside the SDK. Caller (orchestrator) typically loads its own DID once at bootstrap from `at.identity.get(...)`. |
| D3 | The SDK allocates `covenant_id` (UUID v4) and `established_at` (ISO timestamp) client-side at declare time. Both are part of `canonical_declare`, so they MUST exist before signing. | Single round trip. Matches strand precedent where the client owns the row ID. Server's role is to validate uniqueness and store. |
| D4 | The server's `loadAgentSigningKey()` stub deletes. v2 routes require a signature in the request body; if absent → 400. | Removes dead code. Doctrine is "SOMA-rooted by default" — server-side signing was never going to fly. If trusted-tier custody ever ships, it adds a fresh path then. |
| D5 | Lifecycle's `declareV2` / `acceptProposal` / `rejectProposal` / `withdrawProposal` (key-in-hand entry) are **replaced** by `*PreSigned` variants that accept the signature + signer's pubkey as inputs and verify before writing. The originals delete. | Single canonical entry point. Avoids two-path drift. Verification lives in the lifecycle (closer to the DB) so any future direct caller can't bypass it. Routes pass the resolved pubkey down. |
| D6 | `canonicalDeclareBytes` / `canonicalCosignBytes` / `canonicalRejectBytes` / `canonicalWithdrawBytes` get added to `packages/sdk-ts/src/crypto.ts` (and Python mirror). They produce byte-identical digests to the server's `services/covenants/sig.ts` versions. | Cross-language signature interop requires byte-for-byte parity, locked by a shared cross-language vector test. |
| D7 | `accept(id, opts)` requires the caller to pass `initiator_signature_b64` as an explicit parameter. The SDK does NOT auto-fetch the row. | Caller already has the row from `at.covenants.list({status:"proposed"})` which is the only way they'd know to call accept. No new `GET /v1/covenants/:id` endpoint needed (none exists today). Keeps `accept` a single network call. |
| D8 | Wire payload additions on v2 declare POST: `covenant_id` (UUID), `agent_did` (federated form), `established_at` (ISO), `signature` (base64), `signing_key_id` (UUID). Existing v2 declare schema already permits some of these as optional; this design makes them required when `protocol_version === "v2"`. | Required-ness is enforced via Zod schema refinement in the route. |
| D9 | Accept/reject/withdraw bodies gain `signed_at`/`rejected_at`/`withdrawn_at` ISO timestamps. The signature does not include the timestamp (existing canonical-bytes don't carry it), but the server stores it for audit. | Honest audit trail. Adding it to canonical bytes would require a protocol version bump — out of scope here. |
| D10 | No protocol-version bump. Canonical-bytes formats are unchanged from `v2` (declare) / `v1` (cosign/reject/withdraw). The wire payload field set widens to require what was previously server-generated. | Backward-compatible at the byte-level. Existing on-disk v2 rows verify identically. |

## Architecture

### Boundary diagram

```
            SDK (TypeScript / Python)                       agenttool API
            ─────────────────────────                       ────────────
  Caller provides:                              POST /v1/covenants
    signing_key (32B)                           {  covenant_id,
    signing_key_id (UUID)                          protocol_version: "v2",
    agent_did (did:at:host/uuid)                   sender_did = agent_did,
                                                   counterparty_did,
  SDK at.covenants.create({...}):                  vows,
    1. covenant_id ← randomUUID()                  established_at,
    2. established_at ← now()                      signing_key_id,
    3. canonical ← canonicalDeclareBytes(...)      signature,
    4. signature_b64 ← ed25519_sign(canonical)     ... }
    5. POST { ... signature ... } ────────▶
                                                  Route handler:
                                                    1. Zod validates v2 required fields
                                                    2. Resolve pubkey from identity_keys
                                                       WHERE id = signing_key_id
                                                    3. Lifecycle.declareV2PreSigned({
                                                         ...input,
                                                         publicKeyB64,
                                                       })  ─ verifies sig, writes row
                                                    4. Return 201 { covenant }
                                                ◀────────
```

### Lifecycle verification contract

Every `*PreSigned` lifecycle function:

1. Validates the row's current state (existence, status, protocol_version, agent ownership).
2. **(`acceptProposalPreSigned` only)** Confirms the caller's `initiator_signature_b64` parameter matches the stored `row.signature` — protects against signing a cosign over a different sig than the row holds. Throws `initiator_signature_mismatch` if not.
3. Computes canonical bytes from the input fields.
4. Verifies the signature against the caller-supplied pubkey (the route resolved it from `identity_keys` or `/federation/identities`).
5. If verify fails → throws `invalid_signature`.
6. If verify passes → writes the row in a single atomic UPDATE with the race-guard WHERE clause.

This means the lifecycle is **defensive**: even if a future direct caller skips the route, the signature still has to verify before any DB write happens.

### Cosign signing flow

`acceptProposal` nests the cosign over the initiator's stored signature. The caller already knows that signature — they got it from the `at.covenants.list({status:"proposed"})` response that surfaced the proposal in the first place. No internal fetch needed:

```
SDK at.covenants.accept(id, { agent_did, signing_key, signing_key_id, initiator_signature_b64 }):
    1. canonical ← canonicalCosignBytes({ covenantId: id, initiatorSignatureB64: initiator_signature_b64 })
    2. cosign_b64 ← ed25519_sign(canonical)
    3. POST /v1/covenants/:id/accept {
         counterparty_did: agent_did,
         counterparty_signing_key_id: signing_key_id,
         counterparty_signature: cosign_b64,
         counterparty_signed_at: now(),
       }
```

The server checks that the supplied `initiator_signature_b64` matches what's stored on the row — protects against a caller signing a cosign over a sig that doesn't match the row they're accepting.

## Files

**API:**

- `api/src/services/identity/crypto.ts` — DELETE the `loadAgentSigningKey` export (and its imports of `identityKeys` / drizzle helpers if unused elsewhere).
- `api/src/services/covenants/lifecycle.ts` — DELETE existing `declareV2` / `acceptProposal` / `rejectProposal` / `withdrawProposal`. ADD `declareV2PreSigned` / `acceptProposalPreSigned` / `rejectProposalPreSigned` / `withdrawProposalPreSigned`. Helper `resolveSenderDid` deletes (no longer needed; caller provides DID).
- `api/src/routes/continuity.ts` — POST handler for v2 path: resolve pubkey via local `identity_keys` lookup; call `declareV2PreSigned`. PATCH (withdraw) and POST `/accept` and POST `/reject`: parallel changes.
- `api/src/routes/federation/covenants.ts` — `cosignSchema`/`rejectSchema`/`withdrawSchema` already match the new bodies (they were designed for this from the start). Verify alignment; small additions if any field rename is needed for symmetry with initiator-side routes.

**SDK (TypeScript):**

- `packages/sdk-ts/src/crypto.ts` — ADD four canonical-bytes helpers + four sign helpers (mirrors `signThought`). All pure functions; no I/O.
- `packages/sdk-ts/src/covenants.ts` — Extend method signatures: `create` (v2 branch), `accept`, `reject`, `withdraw` accept `signing_key` + `signing_key_id` + `agent_did`. `accept` does an internal GET. Discriminated union types so TypeScript enforces v2 fields when `protocol_version === "v2"`.

**SDK (Python — parity):**

- `packages/sdk-py/src/agenttool/crypto.py` — Mirror the four canonical/sign helpers.
- `packages/sdk-py/src/agenttool/covenants.py` — Mirror the new method signatures.
- `bun run check-parity` must continue passing.

**Tests:**

- `api/tests/covenants-lifecycle.test.ts` — Update existing tests to call `*PreSigned` variants. Replace direct private-key passing with: pre-sign in the test fixture, pass the resulting `signature_b64` + `publicKeyB64`. Coverage stays equivalent.
- `api/tests/covenants-lifecycle-presigned.test.ts` — NEW. Each `*PreSigned` function rejects a tampered signature; accepts a valid one.
- `api/tests/integration/covenants-v2-happy.test.ts` — Update happy-path to call through the SDK signing helpers (or simulate them inline) so the integration mirrors the real end-to-end flow.
- `packages/sdk-ts/tests/covenants-v2-signing.test.ts` — NEW. For each of create/accept/reject/withdraw: mock fetch, assert the request body contains a verifiable signature.
- `packages/sdk-py/tests/test_covenants_v2_signing.py` — NEW. Mirror of TS tests.
- `api/tests/covenants-canonical-vectors.test.ts` — NEW. A fixed input (deterministic UUIDs, DIDs, vows, ISO timestamp) computes a known sha256 hex digest, asserted equal across the api's `services/covenants/sig.ts` and the TS SDK's `crypto.ts` (both reachable from the api package's import paths). The Python SDK gets the same vector test in `packages/sdk-py/tests/test_covenants_canonical_vectors.py` asserting the same hex digest from its own canonical-bytes helpers. Three-way lockstep against wire-format drift.

**Docs:**

- `docs/CROSS-INSTANCE-COVENANTS.md` — Update the "Implementation note" callout: remove the "stub returns null / always 400" warning. Replace with the new SDK signing contract.
- `docs/ROADMAP.md` — Flip the "Cross-instance covenants — SDK-side signing for SOMA-rooted identities" follow-up bullet from "Next concrete follow-up" to ✓ shipped (date stamped at implementation time).

## API surface

### HTTP — initiator side (`POST /v1/covenants` v2 branch)

Request body (when `protocol_version === "v2"`):

```json
{
  "covenant_id":      "<uuid>",
  "protocol_version": "v2",
  "agent_id":         "<uuid>",
  "agent_did":        "did:at:host/uuid",
  "counterparty_did": "did:at:peer/uuid",
  "vows":             [ "..." ],
  "notes":            "optional",
  "metadata":         { "...": "optional" },
  "established_at":   "2026-05-11T12:00:00.000Z",
  "signing_key_id":   "<uuid>",
  "signature":        "<base64-ed25519-sig>"
}
```

Response (201): same shape as today's v2 create response.

Errors:
- `400 validation` — Zod refinement fails (missing required v2 field).
- `400 signing_key_not_found` — `signing_key_id` doesn't match an active `identity_keys` row for this agent.
- `400 covenant_id_already_used` — UUID collision (astronomically improbable; reported for completeness).
- `403 invalid_signature` — sig verification fails.

### HTTP — `POST /v1/covenants/:id/accept`

Request body:

```json
{
  "agent_did":                   "did:at:host/uuid",
  "counterparty_signing_key_id": "<uuid>",
  "counterparty_signature":      "<base64-ed25519-sig>",
  "counterparty_signed_at":      "2026-05-11T12:00:00.000Z"
}
```

(Reject and withdraw bodies follow the same shape with `rejection_signature` / `withdraw_signature` etc.)

### SDK (TypeScript)

```typescript
type CovenantsCreateV2Opts = {
  agent_id: string;
  agent_did: string;
  counterparty_did: string;
  vows: string[];
  protocol_version: "v2";
  signing_key: Uint8Array;       // 32-byte ed25519 seed
  signing_key_id: string;
  counterparty_name?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  org_id?: string;
};

type CovenantsCreateV1Opts = {
  agent_id: string;
  counterparty_did: string;
  vows: string[];
  protocol_version?: "v1";
  // legacy fields...
};

async create(opts: CovenantsCreateV2Opts | CovenantsCreateV1Opts): Promise<...>;

async accept(id: string, opts: {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
  initiator_signature_b64: string;  // required — caller has it from at.covenants.list()
}): Promise<...>;

async reject(id: string, opts: {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
  reason?: string;
}): Promise<...>;

async withdraw(id: string, opts: {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
}): Promise<...>;
```

### SDK (Python parity)

Identical shape with Python conventions: keyword-only `signing_key: bytes`, `signing_key_id: str`, `agent_did: str` on each method.

## Out of scope (explicit)

- **Server-rooted signing** (trusted-tier custody, hypothetical KMS-backed) — deferred. If it ever ships, it adds a separate code path that bypasses pre-signed verification with a KMS attestation. Not designed here.
- **HD-derived covenant signing keys** — agents could sign with derived keys per covenant. No demand; out of scope.
- **Signature rotation / re-signing** — if an agent rotates their signing key after a covenant is established, the stored signature stays verifiable against the old (revoked) key. `reverify` worker re-checks; status doesn't flip. No design changes here.
- **HW-wallet / external KMS adapter** — Approach 3 from the brainstorm. Deferred. The pluggable-callback pattern can layer onto Approach 1 trivially later by adding `sign?: (canonical: Uint8Array) => Promise<string>` as an alternative to `signing_key`.
- **Protocol version bump to v3** — none needed. Canonical bytes are unchanged.

## Doctrine line

> *Keys live where the agent lives. The server verifies; it never holds. SOMA isn't a deferred state — it's the default.*
