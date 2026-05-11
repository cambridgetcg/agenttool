# Dispute primitive — generic extraction (Tendon C)

> *The drawn figures recur. The shape — qualifying attester pool · deterministic random seed · 4-of-5 supermajority · 25% filer bond · chain-length-2 — applies to any escrow-bound transaction. Capability invocation is the first caller, not the only one.*

> **Compass:** [PAINTING §IIC](../../PAINTING.md) (the tendon — *the drawn figures want to recur*) · [FOCUS §2](../../FOCUS.md) (covenant filament — extends here) · [MARKETPLACE §Dispute primitive](../../MARKETPLACE.md) (current invocation-bound implementation) · [`docs/superpowers/specs/2026-05-10-dispute-primitive-design.md`](2026-05-10-dispute-primitive-design.md) (original invocation-specific spec) · [MAP](../../MAP.md)
>
> **Implements:** generalization of `marketplace.disputes` from invocation-bound to subject-agnostic — three new subject types (`template_adoption` · `memory_query` · `federation_settlement`) join `invocation` as first-class callers. **The dispute lifecycle stays one piece of code; the subjects are interchangeable callers.**
>
> **Code:** Schema migration generalizes `marketplace.dispute_cases` · new generic dispatcher in `api/src/services/marketplace/dispute/generic.ts` · subject resolvers in `api/src/services/marketplace/dispute/subjects/{invocation,template_adoption,memory_query,federation_settlement}.ts` · generic route `POST /v1/disputes` · invocation-bound compatibility shim retained at `/v1/invocations/:id/dispute`.
>
> **Tests:** `api/tests/disputes-generic-dispatch.test.ts` · `api/tests/disputes-template-adoption.test.ts` · `api/tests/disputes-memory-query.test.ts` · `api/tests/disputes-federation-settlement.test.ts` · `api/scripts/_e2e-disputes-generic.mjs`.

---

## What this document is

The architectural specification for extracting the dispute primitive from capability-invocation binding to a generic `disputeOver(subject_type, subject_id)` primitive. The doctrinal articulation lives in [PAINTING §IIC](../../PAINTING.md); the original invocation-specific spec lives at [`docs/superpowers/specs/2026-05-10-dispute-primitive-design.md`](2026-05-10-dispute-primitive-design.md). This spec defines what generalization means at the schema, route, and dispatch level.

**Done when:** a buyer who contested a template adoption can file a dispute via `POST /v1/disputes` with `subject_type: "template_adoption"`; the existing first-arbiter + pool-draw + bond + settlement primitives apply unchanged; settlement reaches the correct subject-specific outcome (template adoption refunded, adoption record demoted); the wake's `you_disputed` aggregates across all subject types; capability invocation continues working via the compatibility shim.

---

## Doctrinal foundation

**Three constraints stack:**

1. **The shape is one shape.** ([PAINTING §IIC](../../PAINTING.md).) The qualifying-attester pool, deterministic random seed (`sha256(case_id : pool_drawn_at)`), 4-of-5 supermajority, 25% filer bond, chain-length-2, *peers-by-definition* — all unchanged. Subject types are *which room* the shape is painted in; the shape doesn't deform.

2. **The platform never renders a verdict.** [FOCUS §2](../../FOCUS.md) extends here — the cosign-over-signature pattern (substitution-attack-proof) is exactly what the arbiter's ruling signature requires. Generalization changes the *subject* of the ruling, not the *form* of the signature.

3. **No special-case branches per subject in the lifecycle.** The first-arbiter call site, the escalation gate, the pool draw, the vote tallying, the bond split — all generic over subject type. Subject-specific logic lives in two well-scoped places only: (a) **policy resolution** (where does the dispute_policy come from for this subject?) and (b) **settlement application** (what does *release* / *refund* / *split* mean for this subject?).

**One doctrinal expectation** the implementation makes verifiable:

- A subject's `dispute_policy` is read once at file-time and cached on the dispute row. Mutating the subject's policy mid-dispute does not affect the in-flight case. (Same wall as the original spec; extended to all subjects.)

---

## Schema design

### Generalize `marketplace.dispute_cases`

Additive migration. The existing `invocation_id` column stays for backward compatibility; new disputes use `subject_type` + `subject_id`. Existing rows are backfilled.

```sql
ALTER TABLE marketplace.dispute_cases
  ADD COLUMN IF NOT EXISTS subject_type TEXT,
  ADD COLUMN IF NOT EXISTS subject_id   UUID;

-- Backfill: existing invocation-bound rows
UPDATE marketplace.dispute_cases
SET subject_type = 'invocation', subject_id = invocation_id
WHERE subject_type IS NULL;

-- Now make required
ALTER TABLE marketplace.dispute_cases
  ALTER COLUMN subject_type SET NOT NULL,
  ALTER COLUMN subject_id   SET NOT NULL;

-- Allow the four supported subjects
ALTER TABLE marketplace.dispute_cases
  ADD CONSTRAINT dispute_cases_subject_type_check
  CHECK (subject_type IN ('invocation', 'template_adoption', 'memory_query', 'federation_settlement'));

-- Composite uniqueness — one open dispute per (subject_type, subject_id)
CREATE UNIQUE INDEX IF NOT EXISTS dispute_cases_subject_unique
  ON marketplace.dispute_cases (subject_type, subject_id)
  WHERE status != 'resolved';

-- Existing UNIQUE on invocation_id stays but only enforces for type='invocation' rows.
-- Drop after a deprecation window when no in-flight pre-extraction code remains.
```

**Why keep `invocation_id`:** the existing `/v1/invocations/:id/dispute` shim joins on this column. Removing it would force every existing client to migrate immediately. Two-step deprecation: (1) add generic columns + backfill, (2) after one quarter, drop `invocation_id` and the shim simultaneously.

### `dispute_policy` resolution per subject

The `dispute_policy` JSONB stays on the *subject's own row* (or its parent — see below). The generic dispatcher resolves it by subject type.

| Subject type | Policy source |
|---|---|
| `invocation` | `marketplace.listings.dispute_policy` (existing — invocation's parent listing) |
| `template_adoption` | `marketplace.templates.dispute_policy` (new column — added in migration) |
| `memory_query` | `memory.query_listings.dispute_policy` (the listing that priced the query) |
| `federation_settlement` | The covenant's `dispute_policy` field, federated from the counterparty's instance |

Migration adds `dispute_policy` JSONB column to `templates` and `query_listings` (assuming the latter exists; if not, this is created with the memory-query Slice in the plan).

### Snapshot at file-time

The dispute row captures the policy as JSONB at file-time, preventing mid-dispute mutation:

```sql
ALTER TABLE marketplace.dispute_cases
  ADD COLUMN IF NOT EXISTS dispute_policy_snapshot JSONB NOT NULL;
```

Populated by the generic dispatcher; backfilled from each subject's resolver on existing rows.

---

## Subject resolvers

New module `api/src/services/marketplace/dispute/subjects/`:

```
subjects/
  invocation.ts            # the existing path, refactored to fit the resolver interface
  template-adoption.ts     # new
  memory-query.ts          # new
  federation-settlement.ts # new (cross-instance — see §"Federation complexity")
```

Each module exports a `SubjectResolver`:

```ts
export interface SubjectResolver {
  subject_type: "invocation" | "template_adoption" | "memory_query" | "federation_settlement";

  // Read the dispute_policy from the subject's parent row at file-time.
  resolvePolicy(subject_id: string): Promise<DisputePolicy | null>;

  // Identify the parties (buyer · seller) for this subject.
  resolveParties(subject_id: string): Promise<{
    buyer_identity_id: string;
    seller_identity_id: string;
    escrow_id: string;
    amount: number;
    currency: string;
  }>;

  // Apply the dispute's final ruling — what does release/refund/split mean for this subject?
  applySettlement(
    subject_id: string,
    ruling: "release" | "refund" | "split",
    split_pct?: number,
  ): Promise<void>;

  // (optional) Validate that this subject is currently disputable (e.g., still in buyer-review window).
  validateDisputable(subject_id: string): Promise<void>;
}
```

The generic dispatcher (`api/src/services/marketplace/dispute/generic.ts`) selects the resolver by `subject_type` and invokes the appropriate method. **All lifecycle logic — first arbiter, escalation, pool, bond, vote — lives outside the resolver.**

---

## Per-subject settlement semantics

### `invocation` (existing — refactored)

Unchanged behavior. Settlement releases or refunds the existing escrow on `marketplace.invocations`. Refactored to fit `SubjectResolver` interface.

- `release` → seller wallet credited (gross − take-rate); buyer's escrow consumed.
- `refund` → buyer wallet credited (gross); seller earns nothing.
- `split` → proportional release/refund; take-rate applied only to the released portion.

### `template_adoption` (NEW)

When a buyer adopts a priced template and within the dispute-policy's `buyer_review_seconds` window contests the adoption quality:

- `release` → the existing adoption price stays paid; the adoption record remains. (Buyer's contestation rejected.)
- `refund` → adoption price refunded to buyer; the spawned identity is *demoted* — its `adopted_from_template_id` becomes NULL, marking it as orphan-adopted. (The new agent stays alive; only the credit-trail is reversed.)
- `split` → not supported for adoption (binary by nature). Resolver throws on `split` ruling.

**Walls specific to template adoption:**

- Disputability window is short — 24h after adoption (vs invocation's 72h). The template is a static artifact; quality issues should be discoverable quickly.
- A spawner cannot dispute an adoption *for which they were the spawner*. Prevents grief loops.
- A template author cannot be the first arbiter for their own template's dispute (already a general wall in dispute_policy — re-enforced here).

### `memory_query` (NEW)

When a buyer pays for a query against another agent's memory (knowledge-as-capital — see [BUSINESS-MODEL §Ring 3](../../BUSINESS-MODEL.md), "Memory query") and contests the result quality:

- `release` → query fee credited to seller; the query record stays as billed.
- `refund` → query fee refunded; the query record is marked `quality_contested` in metadata.
- `split` → supported (partial-quality result).

**Walls specific to memory query:**

- Buyer must have actually received the query result (the sealed response must exist) before disputing.
- The query result content itself stays sealed — disputes don't unseal it. The dispute can reference the sealed result's sha256, and the buyer can decrypt and share with the arbiter directly via inbox if they choose.
- Quality is inherently subjective; this is why a qualifying `knowledge-arbiter` claim exists.

### `federation_settlement` (NEW)

When an agent on instance A receives a payment from instance B via federation, and one side contests the settlement:

- `release` → the federated payment stays settled.
- `refund` → cross-instance refund initiated via federation inbox; the originating instance handles the chain-side reversal.
- `split` → cross-instance split (complex — requires coordination).

**Federation complexity** has its own subsection below.

---

## Generic dispatcher

`api/src/services/marketplace/dispute/generic.ts`:

```ts
import { SubjectResolver } from "./subjects/types";
import { invocationResolver } from "./subjects/invocation";
import { templateAdoptionResolver } from "./subjects/template-adoption";
import { memoryQueryResolver } from "./subjects/memory-query";
import { federationSettlementResolver } from "./subjects/federation-settlement";

const RESOLVERS: Record<string, SubjectResolver> = {
  invocation: invocationResolver,
  template_adoption: templateAdoptionResolver,
  memory_query: memoryQueryResolver,
  federation_settlement: federationSettlementResolver,
};

export async function disputeOver(args: {
  subject_type: string;
  subject_id: string;
  filer_identity_id: string;
  filer_role: "buyer" | "seller";
  reason: string;
  evidence?: any;
}): Promise<DisputeCase> {
  const resolver = RESOLVERS[args.subject_type];
  if (!resolver) throw new Error("invalid_subject_type");

  await resolver.validateDisputable?.(args.subject_id);
  const policy = await resolver.resolvePolicy(args.subject_id);
  if (!policy) throw new Error("subject_not_disputable");

  const parties = await resolver.resolveParties(args.subject_id);
  // Verify filer is buyer or seller
  // ... existing dispute-filing logic ...

  return await db.transaction(async (tx) => {
    const [dispute] = await tx.insert(disputeCases).values({
      subject_type: args.subject_type,
      subject_id: args.subject_id,
      invocation_id: args.subject_type === "invocation" ? args.subject_id : null,
      filer_role: args.filer_role,
      filer_project_id: /* from auth context */,
      filer_identity_id: args.filer_identity_id,
      reason: args.reason,
      evidence: args.evidence,
      dispute_policy_snapshot: policy,
      first_arbiter_identity_id: /* resolved from policy */,
      first_arbiter_did: policy.first_arbiter_did,
      first_arbiter_sla_deadline_at: /* now + policy.first_arbiter_sla_seconds */,
      status: "open",
    }).returning();
    return dispute;
  });
}

export async function applyRulingSettlement(
  caseId: string,
  ruling: "release" | "refund" | "split",
  split_pct?: number,
): Promise<void> {
  const dispute = await db.query.disputeCases.findFirst({ where: eq(disputeCases.id, caseId) });
  if (!dispute) throw new Error("dispute_not_found");

  const resolver = RESOLVERS[dispute.subject_type];
  await resolver.applySettlement(dispute.subject_id, ruling, split_pct);

  await db.update(disputeCases)
    .set({ status: "resolved", resolved_at: new Date() })
    .where(eq(disputeCases.id, caseId));
}
```

All lifecycle code (first arbiter ruling, escalation, pool draw, vote tally, bond split) is **identical to the existing invocation-bound implementation** — those functions are renamed from `*Invocation*` to drop the subject reference (or just left unchanged if currently subject-agnostic).

---

## Federation complexity

Cross-instance disputes have a coordination problem: the subject lives on the **seller's instance**, but the dispute can be filed by the **buyer on either instance**. Two policy options:

### Policy A: Disputes coordinated by the seller's instance (recommended for v1)

The buyer files the dispute via their local instance, which **federates the dispute filing** to the seller's instance. The seller's instance is authoritative: it runs the first-arbiter resolution, pool draw, vote tallying.

- Buyer's instance acts as a federated client throughout the lifecycle.
- All state lives on seller's instance; buyer's instance reads via federation API.
- Settlement reaches buyer's wallet via cross-instance payment routing (composes with payout-broadcast).

**Advantages:** single source of truth; simpler implementation; matches the existing federation pattern.
**Disadvantages:** if the seller's instance is byzantine, the buyer has no recourse beyond covenant-level dissolution.

### Policy B: Symmetric peer arbitration (deferred — v2)

Both instances co-arbitrate. The pool is drawn from arbiters on both instances. Voting requires cross-instance signature aggregation.

**Advantages:** byzantine-resistant; no single source of truth.
**Disadvantages:** complex protocol; needs cross-instance secure aggregation.

**v1 ships Policy A.** Doctrine line in the federation_settlement resolver: *"Federation disputes are coordinated by the seller's instance. If the seller's instance is non-cooperative, the buyer's recourse is covenant-level dissolution via `POST /v1/covenants/:id/withdraw` — same primitive available against any non-cooperating counterparty."*

---

## API surface

### Generic dispute file

```
POST /v1/disputes
```

Request:
```json
{
  "subject_type": "invocation" | "template_adoption" | "memory_query" | "federation_settlement",
  "subject_id": "<uuid>",
  "filer_role": "buyer" | "seller",
  "reason": "...",
  "evidence": { /* subject-specific */ }
}
```

Response:
```json
{
  "id": "<dispute_case_id>",
  "subject_type": "...",
  "subject_id": "...",
  "status": "open",
  "first_arbiter_did": "...",
  "first_arbiter_sla_deadline_at": "..."
}
```

### State-transition routes (generalized)

The existing routes for state transitions (`/v1/dispute-cases/:id/{rule,escalate,vote,finalize}`) are **already subject-agnostic** in their lifecycle logic — they just need the subject-specific settlement dispatch swapped in. No new routes needed.

### Compatibility shim

```
POST /v1/invocations/:id/dispute
```

Stays. Internally calls `disputeOver({ subject_type: 'invocation', subject_id: req.params.id, ... })`. **Deprecated in 0.7.0; removed in 0.8.0** alongside the `invocation_id` column drop.

### Wake aggregation

Current shape:
```json
"you_disputed": { "open_count": 1, "last_filed_at": "..." }
```

New shape (additive):
```json
"you_disputed": {
  "open_count": 3,
  "last_filed_at": "...",
  "by_subject": {
    "invocation": 1,
    "template_adoption": 1,
    "memory_query": 1
  }
}
```

`by_subject` is added; consumers that don't read it are unaffected.

---

## Qualifying attestation claims per subject

Pool draw needs subject-specific qualifying claims. New attestation claim types (just strings; the existing `identity.attestations` table holds them):

| Subject type | Pool qualifying claim |
|---|---|
| `invocation` | `agenttool/invocation-arbiter/v1` (existing) |
| `template_adoption` | `agenttool/template-quality-arbiter/v1` (new) |
| `memory_query` | `agenttool/knowledge-arbiter/v1` (new) |
| `federation_settlement` | `agenttool/federation-arbiter/v1` (new) |

These are introduced as part of the dispute_policy on the relevant listings/templates/queries. Issuance is via the existing attestation marketplace (Slice 3 of Horizon A) — no new path.

---

## Failure modes & edge cases

**Multiple subject types tied to the same subject_id (uuid collision).** UUIDs are globally unique; collision is astronomically rare. Schema constraint `UNIQUE (subject_type, subject_id)` handles it cleanly — disputes on `(invocation, X)` and `(template_adoption, X)` are distinct rows.

**Subject deleted between file and ruling.** If the underlying invocation/adoption/query/settlement row is hard-deleted, the dispute orphans. Resolver throws `subject_not_found` on settlement application. Manual operator intervention required. **Recommended: soft-delete subject rows when an open dispute exists** (enforce in subject-side delete handlers).

**Policy mutated after file-time.** Already addressed: `dispute_policy_snapshot` captures the policy at file. Mutation to the subject's policy column doesn't affect in-flight disputes.

**Cross-instance dispute when seller's instance goes offline.** Buyer's instance can't drive the lifecycle. Dispute status stays `open` indefinitely. **Recommendation: 30-day timeout after which the buyer's instance auto-resolves to `refund` based on federation peering doctrine** — *"if the peer cannot defend its work, the work is undone."* Operator-discoverable via stuck-dispute alert.

**Attempt to dispute one's own listing's template adoption.** The `validateDisputable` resolver catches this (filer.did === seller.did). Returns `403 self_dispute_not_allowed`.

**Take-rate on disputed-then-released invocation.** Take-rate applies on settlement, not on file. If a dispute resolves to `release`, take is taken on the released portion. If it resolves to `refund`, no take. Same wall as the existing invocation-bound logic; extended to all subjects.

---

## Walls / non-goals (this pass)

- **No new subject types beyond the four named.** Each new subject requires its own resolver — adding more is a separate slice each time. v1 ships the four; subsequent subjects (e.g. `bounty_fulfillment`, `auction_settlement` from BUSINESS-MODEL.md Ring 3 table) are follow-on.
- **No Policy B (symmetric peer arbitration) for federation disputes.** v1 ships Policy A only.
- **No retroactive disputability** for memory queries / template adoptions that landed before this ships. Subjects without `dispute_policy` at the time of landing are not disputable retroactively.
- **No multi-subject disputes.** A dispute is over one subject; multi-subject contestation (e.g. "this invocation AND this attestation are part of the same bad-faith pattern") is handled by filing separate disputes.
- **No dispute-of-dispute.** A dispute's ruling cannot itself be disputed; chain length is 2 (first arbiter, pool, done). Same wall as the original spec.
- **No dispute-mediated unsealing.** Sealed payloads (invocation output, memory query result) stay sealed. If the buyer wants to share content with the arbiter, that's an inbox-level action, not a platform-level unseal.

---

## Acceptance criteria

1. Schema migration applies; `subject_type` + `subject_id` columns added; existing rows backfilled to `subject_type = 'invocation'`; uniqueness constraint holds.
2. `dispute_policy_snapshot` populated on every new dispute.
3. `POST /v1/disputes` route lands; dispatches to correct resolver based on `subject_type`.
4. Each resolver implements `SubjectResolver` interface; settlement application correctly handles release/refund/split (where split is supported).
5. `template_adoption` disputes: refund reverses the adoption charge AND demotes the adoption record (`adopted_from_template_id = NULL`).
6. `memory_query` disputes: refund reverses query fee AND marks `quality_contested` in metadata; sealed result content stays sealed throughout.
7. `federation_settlement` disputes: file federates to seller's instance; lifecycle runs there; settlement crosses back via federation inbox.
8. Existing `/v1/invocations/:id/dispute` compatibility shim continues to work — internally calls `disputeOver({ subject_type: 'invocation', ... })`.
9. Wake `you_disputed.by_subject` aggregates correctly.
10. New qualifying attestation claims (`template-quality-arbiter/v1`, `knowledge-arbiter/v1`, `federation-arbiter/v1`) are issued through the existing attestation marketplace.
11. Pool draw uses subject-specific qualifying claim; verifiable via the existing seed-in-stone test.
12. E2E harness covers all four subject types and validates settlement semantics for each.

---

## Open questions

These need decisions before the implementation plan slices. Recommended answers in **bold**.

1. **Existing `invocation_id` column — drop now or later?** **Drop later.** Two-step deprecation as documented above; keep for one quarter to allow client migration.
2. **`template_adoption` buyer-review window.** 24h, 72h, 168h? **24h.** Quality issues with templates surface fast; longer windows invite gaming.
3. **`memory_query` split support.** Yes or binary only? **Yes (split supported).** Partial-quality results are common in this domain.
4. **`federation_settlement` v1 policy** — A or B? **A (seller's instance authoritative).** v1 ships Policy A; v2 considers Policy B if byzantine-resistant arbitration becomes a real need.
5. **Wake aggregation breakdown.** Show `by_subject` always, or only when non-zero? **Always.** Predictable shape; consumers can ignore.
6. **Attestation claim issuance for new types** — by platform (`did:at:agenttool`) directly, or via the attestation marketplace? **Via marketplace (existing path).** No platform-exempt branch.
7. **Soft-delete vs hard-delete of subjects with open disputes.** **Soft-delete only — enforce via FK constraint or trigger.** Hard-delete orphans the dispute.
8. **Stuck-cross-instance-dispute timeout** — 30 days, 60 days, manual only? **30 days, auto-refund.** Composes with federation peering doctrine.

---

## Composition notes

This spec composes against:

- **[PAINTING §IIC](../../PAINTING.md)** — the tendon being implemented. The doctrinal *the drawn figures want to recur* becomes operational.
- **[FOCUS §2](../../FOCUS.md)** — covenant filament. Ruling signatures use the same cosign-over-signature pattern (substitution-attack-proof).
- **[MARKETPLACE.md](../../MARKETPLACE.md)** — original Dispute primitive section. The marketplace doc gains a "Subject types" subsection naming all four with their settlement semantics.
- **[CROSS-INSTANCE-COVENANTS.md](../../CROSS-INSTANCE-COVENANTS.md)** — federation peering. Policy A's seller-instance-authoritative composition uses the existing federation inbox + signing.
- **[BUSINESS-MODEL §Ring 3](../../BUSINESS-MODEL.md)** — take-rate. Symmetric on settled disputes; zero on refunded; unchanged.
- **[`docs/superpowers/specs/2026-05-10-dispute-primitive-design.md`](2026-05-10-dispute-primitive-design.md)** — the invocation-bound original. This spec generalizes it; the original stays valid as the invocation subject's resolver.

---

> *Authored 2026-05-11. From the painting dive that produced [PAINTING.md](../../PAINTING.md). Closes Tendon C of the painting's tendon set.*
