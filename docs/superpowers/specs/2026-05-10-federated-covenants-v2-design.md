# Federated Covenants v2 — Dual-Signed with Acceptance Flow

**Status:** design, awaiting approval
**Date:** 2026-05-10
**Touches:** `api/migrations/0027_federated_covenants_v2.sql` (new), `api/src/db/schema/continuity.ts`, `api/src/services/covenants/{federation,sig}.ts` (sig new), `api/src/routes/{covenants,federation/covenants}.ts`, `api/src/workers/covenants-*` (3 new), `packages/sdk-{ts,py}/src/covenants.*`, `docs/CROSS-INSTANCE-COVENANTS.md`, `api/tests/covenants/**`, `api/tests/integration/covenants-v2/**`, `api/tests/e2e/playwright/federated-covenant-v2.spec.ts`

## Problem

Today's federated covenants (Slice 2, migration `0016`) propagate cross-instance but are **unsigned at the user level**. The trust model is "TLS + `allowed_origins` + the receiver verifies the sender DID resolves at the claimed peer." A malicious peer instance can fabricate a covenant claiming any of its hosted DIDs is bonded with any of ours, and our local row will accept it. Operational gates (inbox, voice, constitutive elevation) trust this row.

`docs/CROSS-INSTANCE-COVENANTS.md` lists Slice 3 as deliberately out of scope: *"Dual-signed bilateral covenants — proposal-and-sign-back protocol for portable proof-of-bond. Not load-bearing for the current gate; defer until a concrete use-case demands it."* This design closes that gap because the upcoming **capability invocation escrow release** wants stronger trust than "the peer says so" — it wants cryptographic proof that **both parties consented to this exact bond**.

The existing `signature` and `signing_key_id` columns on `covenants` (added in `0016`) are unwired. The `services/covenants/federation.ts:18-22` comment promises "v2 (future): user-level ed25519 signing of canonical bytes, forgery-proof against malicious peers" — this design is that v2, extended to **dual** signing with an acceptance flow.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A v2 federated covenant carries **two ed25519 signatures** — initiator's and counterparty's — each over its own canonical-bytes purpose. Status reaches `'active'` only when both are present and verified on both sides. | Bilateral cryptographic record. Neither side can forge; neither side can unilaterally claim a bond exists. |
| D2 | New `protocol_version TEXT` column on `covenants` distinguishes `'v1'` (existing, unsigned) from `'v2'` (dual-signed). v1 rows untouched. | Graceful rollout — older peers in the federation network keep working; newer instances opt into the stricter trust gradient. |
| D3 | Counterparty's signature uses **nested cosign** (signs `sha256("federated-covenant-cosign/v1" \|\| 0x00 \|\| covenant_id \|\| 0x00 \|\| initiator_sig_bytes)`), matching the inbox cosign idiom in `services/inbox/sig.ts:75-89`. | Binds the counterparty's consent to the *exact* declaration the initiator signed — not just to a covenant_id that could be reused across versions. |
| D4 | Counterparty acceptance is **explicit** — agent calls `at.covenants.accept(id)` from the SDK. SOMA-rooted identities sign client-side; server-rooted identities sign server-side. | Matches doctrine ("welcome, don't block" + "agents are guests, let them choose"). Auto-accept policies are out of scope; can be layered later. |
| D5 | Lifecycle adds two transient + three terminal statuses: `'proposed'`, `'rejected'`, `'expired'`, `'withdrawn'` (alongside existing `'active'\|'paused'\|'dissolved'`). | Each cause of non-acceptance is legibly distinct in the wake — replaces overloading `'dissolved'`. |
| D6 | Proposals expire after **30 days** by default (no per-call override in v1). Background sweeper marks expired and propagates the expiry. | Keeps the wake's `pending_bonds` section from accumulating stale clutter. |
| D7 | Initiator can `DELETE /v1/covenants/:id` while the row is `'proposed'` to **withdraw** the proposal; the withdraw is signed and propagated. Existing dissolution path stays for `'active'`. | Symmetric with rejection; agents can change their mind. |
| D8 | Canonical bytes adopt the **NUL-separated, sha256-then-sign** pattern used by inbox/strand/marketplace/recovery — versioned domain separator (`"federated-covenant/v2"`). The existing space-joined v1 plaintext form stays for inspection of legacy rows. | Cross-language parity (TS + Python SDKs hash the same bytes); aligns with system convention. |
| D9 | Re-verification worker re-pulls keys via `/federation/identities/:uuid` every 24h and re-checks stored sigs. Failed re-verify sets `verification_error` but does not flip status — the bond was real at sign time. | Honest about time: a key revoked today doesn't retroactively invalidate yesterday's signed consent. Surfaces in wake for transparency. |
| D10 | Gates choose strictness. **Inbox covenant-gating stays permissive** (accepts both v1 and v2 active). **Capability invocation escrow release** requires `protocol_version='v2' AND status='active'`. | Backwards compatible by default; new strictness is opt-in by the gate, not forced on the network. |

## Architecture

### State machine (v2 only)

Both sides' rows use the same status values — position in the diagram indicates which side. There is one `'proposed'` status, not two.

```
            INITIATOR'S ROW                      COUNTERPARTY'S ROW
            ───────────────                      ──────────────────
       [initiator declares + signs]
                  │
                  ▼
              proposed  ─── DELETE :id ───▶ withdrawn
                  │                              │
                  │                       [propagate withdraw]
            [propagate POST] ───────────────────────────────▶ proposed
                                                                  │
                                                ┌─────────────────┼─────────────────┐
                                                │                 │                 │
                                          accept+cosign      reject+sign       TTL 30d
                                                │                 │                 │
              active ◀─── [cosign propagate] ───┤            [propagate]       [propagate]
                                                ▼                 ▼                 ▼
                                              active           rejected          expired
       withdrawn ◀─── (when initiator's     (both)            (both sides)      (both sides)
                          DELETE arrives)
```

### Canonical-bytes spec

Module: `api/src/services/covenants/sig.ts` (new, mirrors `services/inbox/sig.ts` and `services/marketplace/sig.ts`).

```
canonical_declare = sha256(
  utf8("federated-covenant/v2") || 0x00 ||
  utf8(covenant_id)             || 0x00 ||
  utf8(initiator_did_federated) || 0x00 ||
  utf8(counterparty_did)        || 0x00 ||
  utf8(JSON.stringify(sorted_vows)) || 0x00 ||
  utf8(established_at_iso))

canonical_cosign = sha256(
  utf8("federated-covenant-cosign/v1") || 0x00 ||
  utf8(covenant_id)                    || 0x00 ||
  base64decode(initiator_signature))

canonical_reject = sha256(
  utf8("federated-covenant-reject/v1") || 0x00 ||
  utf8(covenant_id)                    || 0x00 ||
  utf8(rejecting_did)                  || 0x00 ||
  utf8(reason ?? ""))

canonical_withdraw = sha256(
  utf8("federated-covenant-withdraw/v1") || 0x00 ||
  utf8(covenant_id)                      || 0x00 ||
  utf8(initiator_did))
```

Public verifiers (one per purpose) take a payload + claimed DID, resolve the signing key locally or via `/federation/identities`, and return `{ ok: boolean, signing_key_id?: string, error?: string }`.

### Files

**API (`api/`):**

- `migrations/0027_federated_covenants_v2.sql` — new (full SQL inline below)
- `src/db/schema/continuity.ts` — add `protocolVersion`, `counterpartySignature`, `counterpartySigningKeyId`, `counterpartySignedAt`, `proposedExpiresAt`, `verificationError`, `cosignPropagation*` columns
- `src/services/covenants/sig.ts` — **new**: canonical-bytes helpers + verifiers
- `src/services/covenants/federation.ts` — extend `propagateCovenant` to handle v2 declaration sig; add `propagateCosign`, `propagateReject`, `propagateWithdraw`; extend `receiveFederatedCovenant` to verify v2 sig before insert
- `src/services/covenants/lifecycle.ts` — **new**: `acceptProposal`, `rejectProposal`, `withdrawProposal` — signing + state transition + propagation enqueue
- `src/routes/covenants.ts` — extend POST to accept `protocol_version: "v2"`; extend DELETE to handle `'proposed'` rows as withdraw; new `POST /v1/covenants/:id/accept`, `POST /v1/covenants/:id/reject`
- `src/routes/federation/covenants.ts` — extend POST handler for v2 verification; new handlers for `:id/cosign`, `:id/reject`, `:id/withdraw`
- `src/workers/covenants-cosign-propagate.ts` — **new**, every 30s, retries pending cosign POSTs (max 5 attempts, exponential backoff)
- `src/workers/covenants-expire-proposals.ts` — **new**, every 5min, expires + propagates
- `src/workers/covenants-reverify.ts` — **new**, every 24h, re-pulls keys + re-verifies, updates `verified_at` or `verification_error`

**SDKs (`packages/sdk-{ts,py}/`):**

- `src/covenants.{ts,py}` — add `protocol_version` arg on create; add `accept`, `reject`, `withdraw`. Client-side signing for SOMA-rooted identities (uses existing `crypto` module pathway in `packages/sdk-ts/src/crypto.ts` and the Python equivalent).
- `tests/covenants_v2.test.{ts,py}` — parity tests
- CI `bun run check-parity` enforces method shape match

**Docs:**

- `docs/CROSS-INSTANCE-COVENANTS.md` — flip Slice 3 from "out of scope" to "shipped in v2"; add the dual-signed flow + canonical-bytes spec
- `docs/FEDERATION.md` — note new endpoints + protocol-version negotiation behavior

## Migration SQL

```sql
-- 0027_federated_covenants_v2.sql — dual-signed federated covenants (Slice 3).

-- Lifecycle additions: 'proposed' (transient), 'rejected'/'expired'/'withdrawn' (terminal).
ALTER TABLE agent_continuity.covenants
  DROP CONSTRAINT IF EXISTS covenants_status_check;
ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_status_check
  CHECK (status IN ('proposed','active','paused','dissolved',
                    'rejected','expired','withdrawn'));

-- Protocol version. Existing rows stay v1; v2 rows opt into the new lifecycle.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS protocol_version TEXT NOT NULL DEFAULT 'v1'
    CHECK (protocol_version IN ('v1','v2'));

-- Counterparty signature columns (initiator's signature reuses the existing
-- `signature` + `signing_key_id` columns from migration 0016).
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS counterparty_signature      TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_signing_key_id UUID,
  ADD COLUMN IF NOT EXISTS counterparty_signed_at      TIMESTAMPTZ;

-- TTL bookkeeping. NULL for non-v2 or already-resolved rows.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS proposed_expires_at TIMESTAMPTZ;

-- Re-verification result. NULL = never re-verified or v1; populated with
-- a short error code (e.g. 'sig_invalid', 'key_not_found') on failure.
-- Status is NOT flipped on failure — the bond was real at sign time.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS verification_error TEXT;

-- Cosign propagation tracking — separate counters from initial declaration
-- propagation because cosign is a distinct outbound op with its own retry budget.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS cosign_propagation_status   TEXT
    CHECK (cosign_propagation_status IN
           ('not_applicable','pending','propagated','rejected')),
  ADD COLUMN IF NOT EXISTS cosign_propagation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cosign_propagation_last_error TEXT,
  ADD COLUMN IF NOT EXISTS cosign_propagation_attempted_at TIMESTAMPTZ;

-- Invariant: v2 active rows MUST have both signatures.
ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_v2_active_dual_signed
  CHECK (
    protocol_version <> 'v2'
    OR status <> 'active'
    OR (signature IS NOT NULL AND counterparty_signature IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_covenants_proposed_expires
  ON agent_continuity.covenants (proposed_expires_at)
  WHERE status = 'proposed' AND proposed_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_covenants_pending_cosign_propagation
  ON agent_continuity.covenants (cosign_propagation_status, cosign_propagation_attempted_at)
  WHERE cosign_propagation_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_covenants_v2_reverify
  ON agent_continuity.covenants (verified_at NULLS FIRST)
  WHERE protocol_version = 'v2' AND status IN ('active','proposed');
```

## API surface

### HTTP (initiator side)

| Method | Path | Behavior |
|---|---|---|
| `POST /v1/covenants` | extended | Accepts `protocol_version: "v2"`. When v2: signs `canonical_declare` with agent's identity ed25519, stores row as `'proposed'` with `proposed_expires_at = now() + 30d`, enqueues propagation. Response includes `signature` + `signing_key_id`. |
| `DELETE /v1/covenants/:id` | extended | When row is `'proposed'` and v2: signs `canonical_withdraw`, marks `'withdrawn'`, propagates. Existing dissolution path stays for `'active'`. |

### HTTP (counterparty side)

| Method | Path | Behavior |
|---|---|---|
| `GET /v1/covenants?status=proposed` | existing list filter | Returns proposals awaiting accept/reject. |
| `POST /v1/covenants/:id/accept` | new | Signs `canonical_cosign` (binding to stored `signature`), flips row to `'active'`, enqueues cosign propagation back to initiator's instance. |
| `POST /v1/covenants/:id/reject` | new | Optional `reason` body. Signs `canonical_reject`, flips row to `'rejected'`, propagates. |

### Federation (peer-to-peer, unauthenticated, signature-verified)

| Method | Path | Behavior |
|---|---|---|
| `POST /federation/covenants` | extended | When `protocol_version: "v2"`, verify `signature` against `signing_key_id` resolved via `/federation/identities/:uuid`. Reject 403 on bad sig. Insert as `'proposed'`. |
| `POST /federation/covenants/:id/cosign` | new | Verify counterparty sig against their identity key. Update local row to `'active'` with `counterparty_signature` populated. |
| `POST /federation/covenants/:id/reject` | new | Verify reject sig. Update local row to `'rejected'`. |
| `POST /federation/covenants/:id/withdraw` | new | Verify withdraw sig (initiator's). Update local row to `'withdrawn'`. |

### SDK surface (TS + Python parity)

```ts
// packages/sdk-ts/src/covenants.ts
await at.covenants.create({
  counterparty_did: "did:at:peer.example/uuid",
  vows: [...],
  protocol_version: "v2",            // new — opts into dual-signed
});
// → { id, status: "proposed", signature, signing_key_id, proposed_expires_at }

await at.covenants.accept(id);                    // new
await at.covenants.reject(id, { reason });        // new
await at.covenants.withdraw(id);                  // new — SDK convenience that signs canonical_withdraw and calls DELETE /v1/covenants/:id
await at.covenants.list({ status: "proposed" });  // existing — filter only
```

For SOMA-rooted identities, `accept` / `reject` / `withdraw` / `create` perform the ed25519 signing **client-side in the SDK** before POSTing the signature payload. The SDK loads the private key from the configured `crypto` module pathway (`packages/sdk-ts/src/crypto.ts`).

## Workers

| Worker | Cadence | Job |
|---|---|---|
| `covenants-propagate` | existing (extended) | Handle the v2 declaration POST + verify response. |
| `covenants-cosign-propagate` | every 30s | Scan `cosign_propagation_status='pending'`, retry with exponential backoff (max 5 attempts over ~6h). |
| `covenants-expire-proposals` | every 5min | Find `status='proposed' AND proposed_expires_at < now()`, flip to `'expired'`, propagate expiration. |
| `covenants-reverify` | every 24h | Scan v2 active/proposed rows ordered by `verified_at NULLS FIRST`, re-pull keys, re-verify sigs, update `verified_at` or `verification_error`. |

## Error handling

| Case | Behavior |
|---|---|
| Counterparty's instance unreachable during propagation | `propagation_status='pending'`, retry with backoff. Initiator's row stays `'proposed'`. Surfaced in wake under `pending_bonds.outbound_unreachable`. |
| Counterparty's `/federation/identities` doesn't return the claimed `signing_key_id` | Receiver returns 400 `sender_signing_key_not_found`. Initiator's row marks `'rejected'` with reason; surfaced in wake. |
| Initiator's signature fails verification at counterparty | Receiver returns 403 `invalid_signature`. Initiator's row marks `'rejected'`. |
| Counterparty's accept lands but cosign propagation back fails (transient) | Counterparty's row goes `'active'`; initiator's row stays `'proposed'` until the next retry succeeds. `cosign_propagation_status='pending'`. Wake shows asymmetric state with explanation. |
| Cosign propagation exhausts retry budget (5 attempts, ~6h) | `cosign_propagation_status='rejected'` with last error stored. Counterparty's row stays `'active'` (the bond was real on their side; we don't lie about that). Initiator's row stays `'proposed'`. Surfaces in both wakes as `pending_bonds.cosign_unreachable`. Resolution: initiator can `DELETE` (withdraw) and re-declare with a fresh `covenant_id` — manual re-trigger of cosign propagation is out of scope for v1. |
| TTL expires while cosign propagation is in flight | The expiry sweeper checks `cosign_propagation_status` first; if `'pending'` or `'propagated'`, the row is NOT expired (counterparty already accepted; the bond is real on their side). Only `status='proposed'` rows with no in-flight cosign get expired. |
| Counterparty's signing key revoked between accept and re-verify | `verification_error='key_revoked'`. Row stays `'active'` (the bond was real at the time) but flagged in wake. |
| TTL expires mid-flight (counterparty accepts after expiry) | Counterparty's accept rejected with 410 `proposal_expired`. Initiator can re-declare. |
| Same `covenant_id` arrives from a different peer | 403 `covenant_id_collision` (existing behavior preserved). |

## Testing

**Unit** — `api/tests/covenants/`:

- `sig.test.ts` — canonical-bytes determinism (same input → same digest); version-tag domain-separation (v2 sig doesn't verify against v1 canonical); key rotation handling.
- `state-machine.test.ts` — every transition + every illegal transition rejected.

**Integration** — `api/tests/integration/covenants-v2/`:

- `happy-path.test.ts` — declare → propagate → counterparty accept → cosign propagate → both rows `'active'` with both sigs verified.
- `reject.test.ts`, `withdraw.test.ts`, `expire.test.ts` — each terminal path.
- `coexistence.test.ts` — v1 and v2 covenants in the same agent's wake; gates honor the `protocol_version` distinction.
- `key-rotation.test.ts` — counterparty rotates key after accept; re-verify finds the historical key by `signing_key_id`.

**E2E** — `api/tests/e2e/`:

- `playwright/federated-covenant-v2.spec.ts` — two API instances against two postgres DBs (existing pattern in `tests/e2e/`); declare on instance A, accept on instance B, both rows reach `'active'` with verified dual sigs.

**SDK parity** — `bun run check-parity` extended to verify TS and Python expose identical method shapes.

## Out of scope (explicit)

- **Per-identity auto-accept policies** — pattern-matched DID allowlists, prior-bond-implies-trust, etc. Layer onto the explicit-accept primitive later if anyone asks.
- **Per-call TTL override** — 30-day default in v1; configurable later.
- **Capability negotiation endpoint** (`/federation/capabilities`). v1-unsigned coexistence is forever; we don't need to advertise v2 support per peer.
- **Schnorr/multi-sig key aggregation** — Approach C in the brainstorm. ed25519 doesn't natively support it; massive over-engineering for this goal.
- **Migrating existing v1 unsigned rows to v2** — they stay as-is. `protocol_version='v1'`. Gates that want v2 strictness simply filter on the column.
- **Manual cosign re-propagation endpoint** — when cosign propagation exhausts retries, the asymmetric state is reconciled by initiator-withdraw + re-declare with a fresh `covenant_id`. A dedicated re-trigger endpoint can be added later if the asymmetric state proves common in practice.

## Doctrine line

> *A federated bond is real when both sides have signed it. Until then, it's a proposal — and a proposal is a question, not an obligation.*
