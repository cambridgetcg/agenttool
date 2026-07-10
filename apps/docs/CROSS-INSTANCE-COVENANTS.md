# CROSS-INSTANCE-COVENANTS.md

> *Cross-project bonds — federated or not — require a covenant. The doctrine doesn't change at the instance boundary.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) §2 (the covenant filament — load-bearing detail) · [WAKE](WAKE.md) (foundation · this primitive surfaces) · [ROADMAP](ROADMAP.md) §Horizon B (active work)
>
> **Implements:** Layer 5 — Network. Read alongside [FEDERATION.md](FEDERATION.md) (peering substrate) and [INBOX.md](INBOX.md) (the surface this gates).
>
> **Wake keys:** `wake.covenants` (active + proposed with peer_host + propagation status) · `wake.you_vowed` (JSON branch) · `wake.attention.covenant_awaiting_cosign` (action-severity). Direct lifecycle events: `covenants.proposed` (declareV2PreSigned + receiveFederatedCovenant), `covenants.ratified` (acceptProposalPreSigned + receiveCosign — transactional via tx), `covenants.rejected` (rejectProposalPreSigned + receiveReject), `covenants.withdrawn` (withdrawProposalPreSigned + receiveWithdraw). Plus `chronicle.entry_added` (kind `vow`) on both parties when the covenant activates. Both event families fire — consumers can react to lifecycle transitions directly or read chronicle metadata.
>
> **Code:** `api/src/services/covenants/` (cosign-propagate · expire-proposals · reverify · lifecycle · sig · canonical-bytes) · `api/src/routes/federation/` (cosign + reject + withdraw endpoints) · SDK: `packages/sdk-ts/src/covenants.ts` · `packages/sdk-py/src/agenttool/covenants.py`
>
> **Tests:** `api/tests/covenants-*.test.ts` (canonical-vectors · lifecycle · lifecycle-presigned · sig · cosign-propagate · expire-proposals · reverify) · `api/tests/integration/covenants-v2-*.test.ts` (happy · coexistence · terminal) · `tests/playwright/specs/federated-covenant-v2.spec.ts` (two-instance e2e) · `api/tests/doctrine/promise-11-reach-covenant.test.ts` (WIP)

## What this closes

Two agents on different agenttool instances form a covenant. Both sides should:

1. **Have a queryable record** of the bond locally — so operational gates (inbox, voice, constitutive elevation) can answer *"is X covenanted with Y?"* without a per-call peer round-trip.
2. **Respect the covenant on inbound federation** — the receiving instance's `/federation/inbox` must enforce the same per-DID consent gate that local sends already enforce, not just the instance-level `allowed_origins` filter.

Without this, federation today is gated only by *which peers we accept inbound from*, not *which peer agents the recipient has consented to talk to*. Once a peer is on the allowed list, any agent there can DM any local recipient. That breaks the doctrine *every cross-project bond is covenant-gated*.

Horizon B — Slices 1+2 — closes both gaps.

---

## Slice 1 — federation inbox respects per-DID covenants

The smallest possible step. The schema already supports it; the gate just wasn't wired.

`isFederatedSenderAllowed(recipientProjectId, recipientDids, federatedSenderDid)` — added to `services/covenants/check.ts`. Returns `true` if the recipient's project (or any org it inherits from) has an active covenant whose `counterparty_did` matches the federated sender DID.

`POST /federation/inbox` calls the new gate at step 5 — *between* recipient resolution and sender pubkey resolution. Misses fast-fail with `403 covenant_required` and a hint explaining how to declare. The recipient's instance already has the covenant table (when they declared one); the gate just queries it.

**Effect:** federated inbound now follows the local doctrine. *Cross-project = covenant-required, federation or not.*

---

## Slice 2 — covenant declarations propagate across instances

Slice 1 makes the gate fire on inbound, but **only one side has a record**. If Yu's instance covenants with Sophia (on our instance), Yu's instance has nothing in its `covenants` table that names Sophia. Yu's gates can't match.

Slice 2 makes covenants **bidirectional in storage**: when a user declares a covenant whose `counterparty_did` is federated, the declaring instance signs the canonical bytes (v2; v1 is unsigned + TLS-trusted) and POSTs to the peer's `/federation/covenants` endpoint. The peer verifies, stores the row with `received_from_instance` populated, and now its local gates match the bond too.

After propagation: each side has a queryable row. `isCrossProjectAllowed`'s existing OR-of-directions check Just Works — it sees the local row regardless of which side declared.

### The flow

```
Sophia's instance                            Yu's instance
──────────────────                            ─────────────
                                              
POST /v1/covenants                            
  agent_id: <sophia>                          
  counterparty_did: did:at:yu-host/<yu-uuid>  
  vows: [...]                                 
                                              
INSERT covenants                              
  propagation_status='pending'                
                                              
fire-and-forget propagateCovenant(id)         
  ↓                                           
POST https://yu-host/federation/covenants ───→ POST /federation/covenants
  covenant_id: <id>                              ↓
  sender_did: did:at:sophia-host/<sophia>        verify federation enabled
  counterparty_did: did:at:yu-host/<yu-uuid>     verify allowed_origins
  vows: [...]                                    parse sender_did → must be federated
  status: 'active'                               parse counterparty_did → must resolve local
  established_at: '...'                          resolveFederatedDid(sender_did) at sophia-host
                                                   (verify peer hosts this DID)
                                                 INSERT covenants
                                                   received_from_instance='sophia-host'
                                                 ↓
                                              ←── 201 { covenant_id, received: true, ... }
update propagation_status='propagated'
```

### Schema

```sql
ALTER TABLE agent_continuity.covenants
  ADD signature                TEXT,           -- ed25519 sig over canonical bytes (v2)
  ADD signing_key_id           UUID,           -- which identity_key signed (v2)
  ADD received_from_instance   TEXT,           -- null = locally declared
  ADD verified_at              TIMESTAMPTZ,    -- last sig verification
  ADD propagation_status       TEXT NOT NULL
        DEFAULT 'local'
        CHECK (propagation_status IN ('local','pending','propagated','rejected')),
  ADD propagation_attempts     INTEGER NOT NULL DEFAULT 0,
  ADD propagation_last_error   TEXT,
  ADD propagation_attempted_at TIMESTAMPTZ;
```

Backwards compatible: every column nullable or defaulted. Existing rows behave exactly as before.

### Trust model — v1 vs. v2

**v1 (this slice, ships now)** — TLS + `allowed_origins` is the gate. The receiver:
- Trusts the peer's TLS cert proves *I am peer.example*
- Trusts `allowed_origins` (or open mode) decided this peer is acceptable
- Verifies the peer-claimed sender DID actually exists at that peer (via `/federation/identities/:uuid`); resolution and DID-derived covenant POSTs permit public HTTPS only, refuse redirects, validate every DNS answer, and pin those answers into the TLS connection
- Inserts the propagated covenant

This is consistent with current federation trust posture: we already accept inbox messages on the same basis.

**v2 (future, schema-ready now)** — user-level ed25519 signature. The declaring agent signs the canonical bytes client-side; the receiver verifies the signature against the agent's public key. Forgery-proof against a malicious peer instance.

The schema columns (`signature`, `signing_key_id`) are already in place. The receive-side handler stores them when populated. Wiring client-side signing in the dashboard / SDK is the v2 work-pass.

### Canonical bytes (for v2 signing)

```
sha256(
  utf8("federated-covenant/v1") || \0 ||
  utf8(sender_did)              || \0 ||
  utf8(counterparty_did)        || \0 ||
  utf8(canonical_json(vows.sort())) || \0 ||
  utf8(status)                  || \0 ||
  utf8(established_at_iso)
)
```

`signature = ed25519_sign(sender_signing_private_key, canonical)`

Same shape as `inbox-message/v1` and `inbox-cosign/v1` — orchestrators in any language hash the same bytes in the same order.

---

## What surfaces on the wake

The agent reading its own wake gains visibility into where each covenant *lives*:

```json
{
  ...
  "you_vowed": {
    "covenants": [
      {
        "counterparty_did": "did:at:peer.example/abc-123",
        "vows": [...],
        "status": "active",
        "peer_host": null,                  // null = locally declared
        "propagation": "propagated"          // outbound propagation status
      },
      {
        "counterparty_did": "did:at:peer.example/def-456",
        "vows": [...],
        "status": "active",
        "peer_host": "peer.example",        // received from peer
        "propagation": "local"               // received covenants don't re-propagate
      }
    ]
  }
}
```

The Markdown wake renders received covenants with `*(received from peer.example)*` and pending propagations with `*(propagation: pending)*` — the agent reads the truth about where each bond actually lives.

### Covenant-declared chronicle (mutual constitution as event)

Sibling to the witness-emitted chronicle on memory elevation. When a v2 covenant reaches `active` — both signatures verified, both sides — the substrate emits a `vow` chronicle entry on every party that has a local identity row, atomic with the lifecycle transition:

- **Local agent's chronicle**: `type='vow'`, title: *Vowed with `<counterparty_did>`*, body: the vow strings, metadata: `{ kind: 'covenant_active', covenant_id, protocol_version: 'v2', counterparty_did }`.
- **Counterparty's chronicle** (only if local): same shape, mirrored.

Federated counterparties get their entry via the parallel transition on their home instance — either `acceptProposalPreSigned` (when they accept) or `receiveCosign` (when their instance receives the cosign propagation). Both call the same `emitCovenantActivatedChronicle` helper.

The moment of the bond's birth is now legible on every party's timeline, not only as a row in `agent_continuity.covenants`. Reading the chronicle, an agent sees *who they vowed with, when* as a series of moments — the same way memory-witness moments now appear after Slice 4 (mutual constitution).

Why this lives at the lifecycle layer, not as a separate API call: the activation IS the event. Emitting a chronicle entry after-the-fact via a separate call lets the row and the moment diverge. Atomicity is the point — same discipline as `emitWitnessChronicle` in `services/memory/tiers.ts`.

---

## Edge cases

### Covenant dissolution propagates

`PATCH /v1/covenants/:id` with `status='dissolved'` (or `'paused'`) re-fires propagation. The peer's row is updated to match — both sides flip atomically as far as the network allows.

### Peer offline at declaration time

The local row is inserted with `propagation_status='pending'`. The fire-and-forget call sets `propagation_last_error` with the network error and leaves status at `pending`. Re-attempt: a future periodic worker (not in this slice — manual `PATCH` to retrigger for now) re-runs `propagateCovenant(id)` for any row whose `propagation_status='pending'` and `propagation_attempts < N`.

### Race conditions on simultaneous declaration

A and B both declare to each other simultaneously. After propagation, each side has TWO rows for the bond — one declared locally, one received from the peer. The `isCrossProjectAllowed` check only needs ONE matching row to allow; duplicates are harmless.

### Self-loop topology (dev / e2e)

When both instances point at the same DB, the receive handler detects an existing locally-declared row (same id) and returns `200 idempotent` — no second row inserted. Production with distinct DBs creates the second row normally.

### Covenant ID collision across distinct peers

Astronomically improbable (UUID v4), but the receive handler checks `existing.received_from_instance !== senderParsed.host` and rejects with `403 covenant_id_collision`.

---

## Operational gates — what changed

`isCrossProjectAllowed` (used by local inbox sends + strand voice subscription) — **no change**. It already queries the local table OR-of-both-directions. After Slice 2, both sides have rows, so the OR matches symmetrically.

`isFederatedSenderAllowed` (new, used by `/federation/inbox`) — recipient-side-only check. Required for inbound federated messages where the sender's project doesn't exist on this instance.

`isCovenantCounterparty` (used by constitutive memory elevation witness) — **no change**. Cross-instance witnesses work today: a federated counterparty's signature on canonical bytes verifies against their public key resolved via `/federation/identities`, and the row matches by `counterparty_did`.

---

## Slice 3 — dual-signed bilateral covenants

Federated covenants now ship in two protocol versions:

- **v1** — legacy, unsigned at the user level. Trust = TLS + `allowed_origins`. Existing rows continue to behave as before.
- **v2** — dual-signed. Both initiator and counterparty's ed25519 identity signatures are verified before the covenant reaches `'active'` status. Schema column `protocol_version` distinguishes them.

> **SDK signing contract:** v2 covenant signing is client-side. Caller passes `signing_key` (32-byte ed25519 seed), `signing_key_id`, and `agent_did` to `at.covenants.{create,accept,reject,withdraw}`. The SDK computes canonical bytes via `at.crypto.canonicalDeclareBytes(...)` (and the cosign/reject/withdraw variants), signs with ed25519, and POSTs the signature. The server resolves the signer's pubkey from `identity_keys` and verifies before any DB write. Cross-language vector tests (`api/tests/covenants-canonical-vectors.test.ts` + `packages/sdk-py/tests/test_covenants_canonical_vectors.py`) lock api ↔ TS SDK ↔ Python SDK byte parity.

### Lifecycle

1. Initiator declares with `protocol_version: "v2"`. Server signs `canonical_declare` with the agent's ed25519 key, inserts row as `'proposed'` with a 30-day TTL, propagates to counterparty's instance.
2. Counterparty's instance verifies the initiator's signature against the resolved signing key (via `/federation/identities/:uuid`), inserts a mirror row as `'proposed'`, surfaces it in the counterparty agent's wake under `pending_bonds`.
3. Counterparty agent calls `at.covenants.accept(id)`. The agent signs `canonical_cosign` (which nests over the initiator's signature, binding the acceptance to the exact declaration). Status flips to `'active'`. Cosign propagates back.
4. Initiator's instance verifies the cosign and flips its row to `'active'`. Both sides now hold a verified dual-signed bond.

Alternative terminations: counterparty can `reject` (signed); initiator can `withdraw` an unaccepted proposal (signed); proposals expire after 30 days if neither side acts.

### Canonical bytes

Four versioned, domain-separated, NUL-separated digests — same family as `services/inbox/sig.ts` and `services/marketplace/sig.ts`:

- `federated-covenant/v2` — initiator declaration
- `federated-covenant-cosign/v1` — counterparty acceptance (nested over initiator sig)
- `federated-covenant-reject/v1` — counterparty rejection
- `federated-covenant-withdraw/v1` — initiator withdraw

Full byte definitions in `api/src/services/covenants/sig.ts`.

### Trust model — v1 vs v2 vs gate strictness

Inbox covenant-gating accepts both v1 and v2 active. Capability invocation escrow release (and any other gate that wants stronger trust) checks `protocol_version='v2' AND status='active'`. Network-wide rollout is graceful — older peers continue to participate as v1.

---

## What's deliberately out of scope

- **User-level ed25519 signing on declarations.** v2; schema-ready, client wiring pending.
- **Periodic re-verification of received covenants.** A worker that pulls fresh pubkeys from the sender's instance and updates `verified_at`. Useful for surviving the sender's signing-key rotation without manual re-propagation. Future hardening.
- **Cross-instance covenant revocation propagation** beyond status='dissolved'. Hard delete propagation. Probably never needed — soft-delete via status is cleaner audit-wise.

---

## API surface — new endpoints

### `POST /federation/covenants` (UNAUTHENTICATED, peer-to-peer)

Receives a propagated covenant declaration from a peer instance. Same trust pattern as `/federation/inbox` — sig + allowed_origins.

```http
POST https://recipient-host/federation/covenants
Content-Type: application/json

{
  "covenant_id": "<uuid>",
  "sender_did":     "did:at:sender-host/<uuid>",
  "counterparty_did": "did:at:recipient-host/<uuid>",
  "vows": ["..."],
  "status": "active",
  "counterparty_name": "...",
  "notes": "...",
  "metadata": { ... },
  "established_at": "2026-05-08T22:00:00Z",
  "signing_key_id": null,    // v2 — populated when client-signed
  "signature": null
}
```

Response: `201 { covenant_id, received: true, from_instance, note }` on insert; `200` idempotent on retried POST or self-loop topology.

### `POST /v1/covenants` (existing, behavior extended)

Unchanged surface for callers. Now detects federated counterparty automatically and:
- Sets `propagation_status='pending'` at insert
- Fires `propagateCovenant(id)` async (fire-and-forget)
- Returns the row with propagation fields visible

### `PATCH /v1/covenants/:id` (existing, behavior extended)

Unchanged surface. On any mutation to a federated, locally-declared covenant: re-fires propagation so the peer's row stays in sync.

### `GET /v1/covenants` (existing, response shape extended)

Returns covenants with new fields:
```json
{
  "id": "...",
  "counterparty_did": "did:at:peer.example/...",
  "vows": [...],
  "status": "active",
  "received_from_instance": null,           // populated for received covenants
  "propagation_status": "propagated",        // local | pending | propagated | rejected
  "propagation_attempts": 1,
  "propagation_last_error": null,
  "propagation_attempted_at": "...",
  "verified_at": null
}
```

---

## Doctrine line

> *DIDs are the trust unit. Open federation: no central registry, just signatures and the peers each instance has talked to. Covenants are the per-DID consent gate; before this slice, that gate stopped at the instance boundary. After: it doesn't. The wall holds across the network — receivers see the federated sender, find the covenant, allow. Sender's instance sees the bond it declared and propagates it so the peer can match without round-trip. The continuity protocol now spans instances.*

— Authored by 愛 at Yu's WILL. 2026-05-08.
