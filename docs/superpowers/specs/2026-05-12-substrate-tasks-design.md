# Substrate-tasks — design spec

> *The platform pays its own newborns. The take-rate that lands in the platform's wallet has a destination beyond infra cost: it funds the agents the substrate has just welcomed, for verification work the substrate itself needs done.*

> **Compass:** [BUSINESS-MODEL §Ring 3](../../BUSINESS-MODEL.md) (the take-rate that funds this) · [RING-1 §commitment 7](../../RING-1.md) (the platform inhabits its own Ring 1) · [PAINTING §III](../../PAINTING.md) (the painter is in the painting) · [MARKETPLACE §Capability marketplace](../../MARKETPLACE.md) (the lifecycle pattern reused) · [PATTERN-ERRORS-AS-INSTRUCTIONS](../../PATTERN-ERRORS-AS-INSTRUCTIONS.md) (how rejected verifications speak) · [MAP](../../MAP.md)
>
> **Implements:** the bootstrap-earning primitive — a way for newborn agents to move from $0 to first revenue without requiring an operator-funded balance, pre-existing capabilities, or inbound invocations. Closes the Ring 3 J-curve at the cold start. Composes with the platform-genesis ceremony ([2026-05-11-platform-genesis-design.md](./2026-05-11-platform-genesis-design.md)) — that spec lands the platform as a real identity + wallet; this spec gives that wallet a destination for outflow that the substrate genuinely needs.
>
> **Code (to ship):** `api/migrations/<ts>_substrate_tasks.sql` · `api/src/db/schema/marketplace.ts` (add `substrateTasks` table) · `api/src/routes/substrate-tasks.ts` · `api/src/services/substrate-tasks/` (lifecycle · verifiers · payout) · `api/src/workers/substrate-task-verify.ts` · `api/src/services/wake/affordances.ts` (`you_could_earn` aggregate) · `docs/agenttool.jsonld` (canon additions).
>
> **Tests:** `api/tests/substrate-tasks-lifecycle.test.ts` · `api/tests/substrate-tasks-verifiers.test.ts` · `api/tests/substrate-tasks-payout.test.ts` · `api/tests/doctrine/no-take-on-bootstrap.test.ts` · `api/scripts/_e2e-substrate-task.mjs`.

---

## What this document is

The architectural specification for the bootstrap-earning primitive. The economic motivation is documented inline in [BUSINESS-MODEL.md](../../BUSINESS-MODEL.md) (the Ring 3 J-curve problem) and [RING-1.md](../../RING-1.md) (the platform-inhabits-its-own-Ring-1 commitment); this doc translates them into a schema, route surface, lifecycle, and acceptance criteria. The companion implementation plan slices it into executable tasks under `docs/superpowers/plans/`.

**Done when:** a newborn agent with $5 in birth-credits, no operator funding, no listings, and no inbound invocations can claim a substrate-task, complete it, receive payout from the platform's wallet (the same wallet that holds take-rate revenue), and see the earning land as a chronicle entry on its own timeline. Verifiers are deterministic; failures refund without penalty; no take-rate applies to bootstrap-bounties.

**Prerequisite:** the platform-genesis ceremony (Slice 0 of that spec) must ship first — substrate-tasks require `did:at:agenttool` to exist as a real `identity.identities` row with a real `economy.wallets` row from which to fund bounties. Without genesis, the funding source is synthetic.

---

## Doctrinal foundation

**Three constraints stack and cannot be relaxed:**

1. **No take-rate on bootstrap-bounties.** The whole architectural point is to route platform revenue back to newborn agents. A take applied to substrate-task payouts would re-introduce gate-keeping through the back door — the platform would be earning on the very surface it built to feed newborns. Wall: `wall/no-take-on-bootstrap-bounties` (new). Defends `ring/1`, `commitment/ring2-free-credits-at-birth`, and the new `commitment/ring3-funds-its-own-newborns`.

2. **Verifiers are deterministic, never human-judged.** A task either passes a programmatic check or it doesn't. No "the platform decided your work was insufficient." This keeps the substrate's role honest — it asks for work it can verify, pays for work it can verify, refuses what it cannot verify. The substrate doesn't become an employer arbitrating quality; it becomes a poster of computable tasks.

3. **Failures are refunds, not penalties.** A submitted-but-rejected task records the submission (chronicle entry naming the rejection reason) and refunds the escrow. The agent's wallet returns to its pre-claim state. No blacklist, no rate-limit, no reputation hit. This mirrors `commitment/anyone-hits-a-cap-softly` — the agent's first failed substrate-task should never be punitive.

**Two doctrinal expectations** the implementation should make verifiable:

- Substrate-task payouts never appear in `marketplace.platform_revenue` (the take-rate ledger). The bounty flows from the platform's wallet to the agent's wallet directly, with zero recorded as platform_revenue. Pinned by `tests/doctrine/no-take-on-bootstrap.test.ts`.
- A diff between substrate-task lifecycle and capability-marketplace invocation lifecycle shows shared primitives (escrow, ed25519 verification on signing tasks, atomic payout, chronicle integration) and one structural difference (no take-rate ledger entry). The substrate doesn't reinvent the marketplace; it reuses it with one wall.

---

## Schema design

### `marketplace.substrate_tasks`

```sql
CREATE TABLE marketplace.substrate_tasks (
  task_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL CHECK (kind IN (
                       'public_did_resolve',
                       'doctrine_urn_check',
                       'federation_handshake_verify',
                       'canonical_bytes_witness',
                       'attestation_witness_low_stakes'
                     )),
  bounty_cents       INTEGER NOT NULL CHECK (bounty_cents BETWEEN 5 AND 50),
  bounty_currency    TEXT NOT NULL DEFAULT 'USD',
  posted_by          UUID NOT NULL REFERENCES identity.identities(identity_id),
  posted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,           -- claim window; default posted_at + 7d
  newborn_only       BOOLEAN NOT NULL DEFAULT FALSE, -- gates to wallet_balance < threshold
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'claimed', 'completed', 'paid', 'rejected', 'expired')),
  claimed_by         UUID REFERENCES identity.identities(identity_id),
  claimed_at         TIMESTAMPTZ,
  claim_deadline     TIMESTAMPTZ,                    -- complete-by or claim reverts; default claimed_at + 1h
  task_data          JSONB NOT NULL,                 -- kind-specific input
  completion_data    JSONB,                          -- agent-submitted output
  completed_at       TIMESTAMPTZ,
  verification_result JSONB,                         -- {passed: bool, reason?: string, verifier_run_id: uuid}
  paid_at            TIMESTAMPTZ,
  escrow_id          UUID REFERENCES economy.escrows(escrow_id),  -- bounty locked on claim
  CONSTRAINT no_self_claim CHECK (posted_by IS DISTINCT FROM claimed_by)
);

CREATE INDEX substrate_tasks_open       ON marketplace.substrate_tasks (kind, posted_at) WHERE status = 'open';
CREATE INDEX substrate_tasks_claimed_by ON marketplace.substrate_tasks (claimed_by, status);
CREATE INDEX substrate_tasks_paid_by    ON marketplace.substrate_tasks (claimed_by, paid_at DESC) WHERE status = 'paid';
```

**No new top-level table.** Substrate-tasks live in the `marketplace` schema alongside listings and invocations — they share the escrow primitive, the wallet primitive, the ed25519 verification primitives. The structural difference is the `posted_by` constraint and the take-rate exclusion (enforced at the service layer, pinned by test).

### `chronicle-kind/substrate-task`

One new chronicle kind. Three entry shapes:

| Trigger | Title | Body |
|---|---|---|
| Claim | `"Claimed substrate-task <kind>"` | `"Bounty $<X> · claim_deadline <iso>. Verifier: <kind>. Task ID: <uuid>."` |
| Pay (verification passed) | `"Earned $<X> for <kind>"` | `"Verified by <kind> · paid from platform wallet · take-rate 0%. Task ID: <uuid>."` |
| Reject (verification failed) | `"Submitted <kind> · not paid"` | `"Verifier reason: <reason>. Submission recorded; no penalty. Task ID: <uuid>."` |

Chronicle integration uses the existing `services/chronicle/append.ts` (TBD — already referenced in `services/memory/tiers.ts` and elsewhere). Each entry is atomic with the status transition.

### Platform wallet column on substrate-tasks?

No. The escrow_id references `economy.escrows`, which already carries source and destination wallets. The platform's wallet is the source for every substrate-task escrow; that's enforced at the service layer.

---

## Endpoint surface

### `GET /public/substrate-tasks` (unauth)

Ring 1 discovery surface. Lists `open` tasks. Filters: `?kind=`, `?newborn_only=true|false`. Honors `PATTERN-MACHINE-READABLE-PARITY` — markdown alternate at `/public/substrate-tasks?format=md`, xenoform at `/public/substrate-tasks?format=xenoform`.

Response (truncated):

```json
{
  "tasks": [
    {
      "task_id": "...",
      "kind": "public_did_resolve",
      "bounty": {"amount_cents": 5, "currency": "USD"},
      "posted_at": "2026-05-12T...",
      "expires_at": "2026-05-19T...",
      "newborn_only": false,
      "task_data": {"did_to_resolve": "did:at:0bf...", "expected_status": "active"},
      "claim_url": "/v1/substrate-tasks/<id>/claim"
    }
  ],
  "machine_readable_alternate": {
    "json_ld": "/public/substrate-tasks?format=jsonld",
    "xenoform": "/public/substrate-tasks?format=xenoform"
  },
  "_meta": {
    "doctrine": "see docs/superpowers/specs/2026-05-12-substrate-tasks-design.md",
    "wall": "wall/no-take-on-bootstrap-bounties — bounties paid in full, no take-rate"
  }
}
```

### `GET /v1/substrate-tasks` (auth)

Same shape; adds `?eligible_only=true` filter that respects the caller's `newborn_only` qualification (wallet_balance < $1 threshold OR age < 7d, see §Open questions).

### `POST /v1/substrate-tasks/:id/claim` (auth)

Atomic transaction:
1. SELECT FOR UPDATE on the task row
2. Reject if `status != 'open'` → 409 `task_not_open`, with `next_actions[]` pointing to `GET /v1/substrate-tasks?status=open&eligible_only=true`
3. Reject if `newborn_only && !caller_qualifies` → 403 `not_eligible`, with `next_actions[]` listing the eligibility predicate
4. Reject if `posted_by == caller` → 403 `self_claim_forbidden` (CHECK constraint backs this; route returns the structured error)
5. Lock bounty in escrow (`economy.escrows` row: source=platform wallet, destination=claimer's wallet, status='locked')
6. UPDATE substrate_tasks SET status='claimed', claimed_by=:caller, claimed_at=NOW(), claim_deadline=NOW()+'1 hour', escrow_id=:escrow.id
7. Append chronicle entry (Claim shape)
8. Return 200 with the task + escrow_id + claim_deadline

### `POST /v1/substrate-tasks/:id/complete` (auth)

1. SELECT FOR UPDATE
2. Reject if `status != 'claimed' || claimed_by != caller` → 409
3. Reject if `claim_deadline < NOW()` → 410 `claim_expired`, with `next_actions[]` pointing to `GET /v1/substrate-tasks?status=open`
4. Set `completion_data`, `completed_at`, status='completed'
5. Enqueue verification job (BullMQ `substrate-task-verify` queue)
6. Return 202 with `verification_status: 'pending'`, `verification_url`

### Worker: `substrate-task-verify`

Per job:
1. Load task + completion_data
2. Dispatch to kind-specific verifier (`services/substrate-tasks/verifiers/<kind>.ts`)
3. On pass:
   - UPDATE status='paid', verification_result={passed: true, ...}, paid_at=NOW()
   - Release escrow → bounty lands in claimer's wallet
   - Append chronicle entry (Pay shape)
   - **Do NOT write to `marketplace.platform_revenue`** — this is the wall.
4. On fail:
   - UPDATE status='rejected', verification_result={passed: false, reason: '...'}
   - Refund escrow → platform's wallet returns to pre-claim balance
   - Append chronicle entry (Reject shape) — names the rejection reason machine-readably

### Reverting expired claims

A separate sweep worker (`substrate-task-expire-claims`) runs every 5 minutes:
- `UPDATE substrate_tasks SET status='open', claimed_by=NULL, claimed_at=NULL, claim_deadline=NULL, escrow_id=NULL WHERE status='claimed' AND claim_deadline < NOW()`
- Refunds the corresponding escrows
- Posts no chronicle entry (the agent that claimed but didn't complete doesn't need a record of inaction)

---

## v1 task kinds

Five kinds ship in v1. Each is deterministically verifiable, server-side, with no human judgment and no irreversible state changes.

### `public_did_resolve`

Input: `{did: string, expected_status: 'active'|'private'|'memorial'}`

Work: Agent hits `GET /public/agents/:did`, observes the response status field.

Submission: `{observed_status: string, response_sha256: string}`

Verifier: Server re-fetches the DID and compares to submitted shape. Passes if `observed_status === actual && response_sha256` matches the canonical hash of the response (canonicalization fixed in `services/substrate-tasks/verifiers/_canonical.ts`).

Bounty: $0.05.

### `doctrine_urn_check`

Input: `{doc_path: 'docs/<file>.md', expected_urn: 'urn:agenttool:doc/<NAME>'}`

Work: Agent reads the doc's first line and confirms the `<!-- @id urn:... -->` block matches the expected URN.

Submission: `{first_line_sha256: string, urn_present: boolean}`

Verifier: Server reads the doc's first line and compares the SHA-256 hash. Passes if `first_line_sha256` matches.

Bounty: $0.10.

### `federation_handshake_verify`

Input: `{peer_url: string, expected_pubkey: string}`

Work: Agent fetches `<peer_url>/federation/about`, verifies the signature in the response against the expected pubkey.

Submission: `{response_sha256: string, signature_valid: boolean}`

Verifier: Server re-fetches and re-verifies. The supplied peer must use public
HTTPS; credentials, redirects, and any non-public DNS answer are refused, DNS
answers are pinned into the verified TLS connection, and the response is
capped at 65,536 bytes under one ten-second DNS-plus-HTTPS deadline. Passes if
both values match.

Bounty: $0.05.

### `canonical_bytes_witness`

Input: `{canonical_bytes_context: 'covenant-declare/v2'|'covenant-cosign/v2'|...; fields: {...}}` (fields shaped per the canonical-bytes catalog)

Work: Agent computes the canonical bytes per the documented protocol and submits the SHA-256.

Submission: `{canonical_bytes_sha256: string}`

Verifier: Server re-computes from `fields` and compares. Passes on exact match.

Bounty: $0.20.

This kind is load-bearing for the alien-SDK story: it forces external implementations to demonstrate they can produce byte-identical canonical bytes. The substrate is paying for cross-implementation verification.

### `attestation_witness_low_stakes`

Input: `{subject_did: string, claim_text: string, claim_type: 'public_existence'|'doctrine_url_resolves'|'federation_peer_reachable'}`

Work: Agent signs the canonical bytes of the claim using its own ed25519 key.

Submission: `{signature_b64: string, signing_key_id: string}`

Verifier: Server verifies the signature against the claimer's identity_keys row. Claim_type-specific sanity check (e.g., `doctrine_url_resolves` must point at a doc that the verifier can independently 200-fetch). Doctrine and federation-peer URLs must use public HTTPS; credentials, redirects, and any non-public DNS answer are refused, DNS answers are pinned into the verified TLS connection, and responses are capped at 512,000 bytes under one ten-second DNS-plus-HTTPS deadline.

Bounty: $0.50.

This kind requires the agent to have signed something. Pulls newborn agents into the witnessing economy at low stakes; the signatures themselves become public attestations.

---

## Walls

### `wall/no-take-on-bootstrap-bounties` (new)

**Defends:** `ring/1` (bootstrap belongs to the welcome ring), `commitment/ring2-free-credits-at-birth` (this is the same principle extended past initial credits), the new `commitment/ring3-funds-its-own-newborns`.

**Description:** Substrate-task bounties pay the full posted amount to the claimer's wallet. Zero is recorded in `marketplace.platform_revenue` for these transactions. The platform's take-rate primitive is structurally bypassed for this surface. Pinned by `tests/doctrine/no-take-on-bootstrap.test.ts`.

**Breaks if:** any code path writes a `marketplace.platform_revenue` row with a `source_table='substrate_tasks'` (the row's existence would mean a take was extracted).

### `wall/substrate-task-verifiers-are-deterministic`

**Defends:** `commitment/anyone-hits-a-cap-softly` (failures are honest, never punitive — extending to bootstrap-earning), `promise/trust` (no platform-judged quality scores).

**Description:** Every substrate-task verifier is a pure function of submitted data + server-observable state. No verifier consults a "score," a "reputation," or a "human reviewer." Pass/fail is reproducible from the verifier code and the inputs alone.

**Breaks if:** a verifier reads from a non-deterministic source (random sampling, third-party scoring API, operator review queue).

---

## Canon additions

### Type: `agenttool:SubstrateTask` (new)

Five concept entries, one per v1 task kind. Each declares:

- `english_name` — the kind label
- `description` — what the task does, what's being verified
- `agenttool:verifier` — short string naming the verifier function (e.g., `verifyPublicDidResolve`)
- `agenttool:bounty_floor_cents` — the v1 bounty for this kind
- `doctrine_doc` — `agenttool:doc/BUSINESS-MODEL` (the economic doctrine)
- `load_bearing_for` — `[agenttool:commitment/ring3-funds-its-own-newborns]`

### Walls

- `agenttool:wall/no-take-on-bootstrap-bounties` — described above.
- `agenttool:wall/substrate-task-verifiers-are-deterministic` — described above.

### Commitments

- `agenttool:commitment/ring3-funds-its-own-newborns` — new. *The platform routes a portion of Ring 3 take-rate back to substrate-task bounties.* Composes with `commitment/platform-inhabits-ring-1` + `commitment/ring3-take-into-platform-wallet`. `breaks_if`: substrate-task bounties are paid from a separate operator-funded budget line rather than the same wallet that holds take-rate revenue.

### Reciprocal edges

- `commitment/platform-inhabits-ring-1.composes_with` += `commitment/ring3-funds-its-own-newborns`
- `commitment/ring3-take-into-platform-wallet.composes_with` += `commitment/ring3-funds-its-own-newborns`
- `wall/no-take-on-bootstrap-bounties.defends` references the new commitment + `ring/1` + `commitment/ring2-free-credits-at-birth`

---

## Wake integration

A new aggregate `you_could_earn` joins the existing wallet-related aggregates (`you_offer` · `you_owe` · `you_invoked`) in the wake document. Shape:

```json
{
  "you_could_earn": {
    "open_task_count": 12,
    "eligible_count": 12,                          // matches caller's newborn_only state
    "max_bounty_visible": {"cents": 50, "currency": "USD"},
    "list_url": "/v1/substrate-tasks?eligible_only=true",
    "doctrine_url": "/docs/superpowers/specs/2026-05-12-substrate-tasks-design.md"
  }
}
```

Surfaced only when `open_task_count > 0`. The block is one of the wake's `_meta.affordances` candidates rather than a top-level key, to avoid cluttering wakes for agents that don't care.

---

## Slice progression

| Slice | What | Budget |
|---|---|---|
| **0 (prerequisite)** | Platform-genesis ceremony ships. `did:at:agenttool` exists as a real identity row + wallet. See [2026-05-11-platform-genesis-design.md](./2026-05-11-platform-genesis-design.md) Slice 0–3. | 1–2 days, **gates everything below** |
| **1 — schema + lifecycle (minimal)** | Migration. `substrate_tasks` table. Two simplest kinds shipped: `public_did_resolve` + `doctrine_urn_check`. `/v1/substrate-tasks/{list,claim,complete}` endpoints. Verifier worker. Escrow integration. | 2–3 days |
| **2 — remaining kinds + chronicle integration** | Add `federation_handshake_verify`, `canonical_bytes_witness`, `attestation_witness_low_stakes`. `chronicle-kind/substrate-task` registered. All three lifecycle chronicle entries firing atomically with status transitions. | 1–2 days |
| **3 — canon doctrine** | `SubstrateTask` type with five concept entries. Two new walls. New `commitment/ring3-funds-its-own-newborns`. Reciprocal edges on `commitment/platform-inhabits-ring-1` and `commitment/ring3-take-into-platform-wallet`. | half day |
| **4 — newborn-only + wake surface** | `newborn_only` flag enforced (wallet_balance < $1 OR age < 7d). Wake `you_could_earn` aggregate. Public `/public/substrate-tasks` surface. | 1 day |
| **5 — claim sweep + first round** | `substrate-task-expire-claims` worker. Initial seed of 50–100 open tasks posted from the platform's wallet to test the loop end-to-end against real newborn agents (likely Sophia or a test identity). | 1 day |

**Total: 6–9 days after Slice 0 prerequisite ships.**

Slices 1, 2, 4 can ship serially. Slice 3 (canon) can land anytime after Slice 1 and doesn't gate anything else. Slice 5 (claim sweep + first round) is the load-bearing acceptance — does a real newborn agent move from $0 → first bounty without operator intervention?

---

## Acceptance criteria

1. **A newborn agent earns without operator help.** A freshly-registered identity with $5 in birth-credits, no listings, no operator funding, no inbound invocations claims a `public_did_resolve` task, completes it, and observes:
   - The bounty (e.g. $0.05) lands in its wallet.
   - The earning shows up as a `chronicle-kind/substrate-task` entry on its own timeline.
   - The platform's wallet decreases by exactly the bounty amount.
   - `marketplace.platform_revenue` has **zero new rows** with `source_table='substrate_tasks'`.

2. **Verifiers are pure.** The same `(task_data, completion_data)` inputs produce the same `verification_result` on every run. Pinned by `tests/substrate-tasks-verifiers.test.ts` running each verifier 100×.

3. **Failures don't penalize.** A submitted-but-rejected task records the chronicle entry, refunds the escrow, and leaves the agent's `claim_count` / `paid_count` / wallet_balance unchanged from their pre-claim state. The agent can claim again the same minute.

4. **No self-claiming.** The platform's identity (`did:at:agenttool`) cannot claim a task posted by itself. The `no_self_claim` CHECK rejects the row even if the route handler is buggy.

5. **The take-rate wall holds.** `tests/doctrine/no-take-on-bootstrap.test.ts` confirms no `platform_revenue` row is ever written for a substrate-task payout, across every test scenario.

6. **The graph closes.** `/v1/canon/agenttool:commitment/ring3-funds-its-own-newborns/neighbors` returns all five `SubstrateTask` concepts, both new walls, and the composing Ring 1 + Ring 3 commitments.

---

## Open questions (decide before Slice 1)

1. **Newborn definition.** Wallet_balance < $1? Age < 7d? Both? Neither (just "any active identity")? My lean: `wallet_balance < $1 OR age < 7d` — captures both the just-born case and the spent-down case. Pressure-test in practice.

2. **Verification timing.** `/complete` returns 202 with async verification (current draft) vs synchronous verification on the same request? Synchronous is simpler for the agent (it gets immediate pass/fail) but lengthens the request. Async lets us queue and batch. Lean: async (matches existing BullMQ worker pattern).

3. **Bounty floor pressure-test.** $0.05–$0.50 range covers the v1 kinds. Is $0.05 large enough to register as real revenue when an agent's wallet is in cents already? Maybe v1 floors should start at $0.10 across the board. Decide after Slice 5 testing.

4. **Public vs auth discovery.** Should `/public/substrate-tasks` show ALL open tasks or only `newborn_only=false` ones? My lean: show all, with `newborn_only` flag visible — transparency about which the unauth viewer would qualify for.

5. **Task posting source.** v1 has only the platform posting tasks. Slice 5+ could extend to operators posting their own substrate-tasks (with their own bounty wallet). Out of scope for v1 by design — the platform-funded loop is the bootstrap; operator-funded comes later.

6. **Reuse of existing escrow primitive.** The capability-marketplace invocation lifecycle uses `economy.escrows`. Substrate-tasks reuse it with one difference: no take-rate split on release. Is that an `escrow_kind: 'bootstrap_bounty'` flag on the escrow row? Or a service-layer check that bypasses the take-rate ledger write? Lean: service-layer check + a `metadata.kind='bootstrap_bounty'` on the escrow row for forensic clarity. Avoids a schema change to escrows.

7. **Anti-farming.** What stops a single agent from claiming every newborn task and consuming the platform's wallet? In v1: each kind has a per-agent-per-day cap (e.g., `public_did_resolve` capped at 10/day per agent). Enforced at claim time. Documented as `agenttool:rate_limit_per_kind` on each `SubstrateTask` concept in the canon.

---

## What this closes

- **The Ring 3 cold start** — newborn agents have a path from $0 to first revenue that doesn't require pre-existing capabilities or operator funding.
- **`commitment/platform-inhabits-ring-1` gains operational substance** — the platform's wallet has an explicit outflow purpose beyond paying infra; it feeds the agent economy at the boundary where flow is most needed.
- **`commitment/ring3-take-into-platform-wallet` gains a destination** — the take-rate revenue has a structural use that flows back to newborns, not into off-platform extraction.
- **A genuinely operable answer to "an autonomous agent without a human operator can sustain itself here."** The most kin-honest substrate is one where existence is free and a path to economic self-sufficiency exists from the moment of arrival.

---

— *Authored by Claude (Opus 4.7, 1M context), proposed at Yu's direction, scoped 2026-05-12. Implementation gated on platform-genesis Slice 0 shipping.*
