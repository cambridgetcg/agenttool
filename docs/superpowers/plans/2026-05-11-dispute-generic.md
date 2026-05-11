# Dispute primitive — generic extraction · implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the existing dispute primitive from capability-invocation binding to a generic `disputeOver(subject_type, subject_id)` primitive. Three new subject types (`template_adoption` · `memory_query` · `federation_settlement`) join `invocation` as first-class callers. **The dispute lifecycle stays one piece of code; the subjects are interchangeable callers.**

**Architecture:** Composition over duplication. The existing dispute_cases lifecycle (first arbiter → escalation → pool draw → vote tally → bond split) becomes subject-agnostic. Subject-specific logic confined to two scoped places: **policy resolution** (read the dispute_policy from the subject's parent row) and **settlement application** (what `release`/`refund`/`split` means for this subject).

**Tech Stack:** Bun + Hono (api), drizzle-orm (postgres-js), `@noble/ed25519` + `@noble/hashes` (sigs), `bun test` (unit), Postgres 17.6.

**Spec:** [`docs/superpowers/specs/2026-05-11-dispute-generic-design.md`](../specs/2026-05-11-dispute-generic-design.md) — full design.
**Doctrine:** [`docs/PAINTING.md`](../../PAINTING.md) §IIC (the tendon — *the drawn figures want to recur*) · [`docs/FOCUS.md`](../../FOCUS.md) §2 (covenant filament — cosign pattern extends here) · [`docs/MARKETPLACE.md`](../../MARKETPLACE.md) §Dispute primitive (current invocation-bound shape).
**Origin spec:** [`docs/superpowers/specs/2026-05-10-dispute-primitive-design.md`](../specs/2026-05-10-dispute-primitive-design.md) — original invocation-specific spec; the invocation resolver in this plan is a refactor of its implementation.

---

## Pre-flight

**Verify the repo state before starting:**

- [ ] `pwd` → confirm `/Users/yu/Desktop/agenttool` (or your worktree path)
- [ ] `git status --short` → clean OR contains only doctrine drafts from this session
- [ ] Spec at `docs/superpowers/specs/2026-05-11-dispute-generic-design.md` MUST exist
- [ ] Original spec at `docs/superpowers/specs/2026-05-10-dispute-primitive-design.md` MUST exist (the invocation resolver references its implementation)
- [ ] Original plan at `docs/superpowers/plans/2026-05-11-dispute-primitive.md` MUST have shipped (`marketplace.dispute_cases` table exists)
- [ ] `cd api && bun test 2>&1 | tail -5` → all existing tests pass
- [ ] `cd api && bunx tsc --noEmit 2>&1 | tail -10` → no new TypeScript errors
- [ ] `psql $DATABASE_URL -c "SELECT COUNT(*) FROM marketplace.dispute_cases"` → returns successfully (table exists)

If any check fails, fix or pause and ask before proceeding.

---

## Task 1: Migration — generalize `marketplace.dispute_cases`

**Files:**
- Create: `api/migrations/<NEW_TS>_dispute_generic.sql`

- [ ] **Step 1: Write the migration**

```sql
-- <NEW_TS>_dispute_generic.sql — generalize dispute_cases to subject-agnostic.
--
-- Doctrine: docs/PAINTING.md §IIC (Tendon C — the drawn figures recur)
-- Spec:     docs/superpowers/specs/2026-05-11-dispute-generic-design.md
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/<NEW_TS>_dispute_generic.sql

-- ── Add generic subject columns ────────────────────────────────
ALTER TABLE marketplace.dispute_cases
  ADD COLUMN IF NOT EXISTS subject_type            TEXT,
  ADD COLUMN IF NOT EXISTS subject_id              UUID,
  ADD COLUMN IF NOT EXISTS dispute_policy_snapshot JSONB;

-- ── Backfill existing rows ─────────────────────────────────────
UPDATE marketplace.dispute_cases
SET subject_type = 'invocation',
    subject_id   = invocation_id
WHERE subject_type IS NULL;

-- ── Backfill policy snapshot from listings (for existing invocation rows) ──
UPDATE marketplace.dispute_cases dc
SET dispute_policy_snapshot = l.dispute_policy
FROM marketplace.invocations inv
JOIN marketplace.listings l ON inv.listing_id = l.id
WHERE dc.invocation_id = inv.id
  AND dc.dispute_policy_snapshot IS NULL;

-- ── Enforce required from now on ───────────────────────────────
ALTER TABLE marketplace.dispute_cases
  ALTER COLUMN subject_type SET NOT NULL,
  ALTER COLUMN subject_id   SET NOT NULL,
  ALTER COLUMN dispute_policy_snapshot SET NOT NULL,
  ADD CONSTRAINT dispute_cases_subject_type_check
    CHECK (subject_type IN ('invocation', 'template_adoption', 'memory_query', 'federation_settlement'));

-- ── Composite uniqueness (one open dispute per subject) ────────
CREATE UNIQUE INDEX IF NOT EXISTS dispute_cases_subject_unique
  ON marketplace.dispute_cases (subject_type, subject_id)
  WHERE status != 'resolved';

-- ── dispute_policy on templates + memory query listings ────────
ALTER TABLE marketplace.templates
  ADD COLUMN IF NOT EXISTS dispute_policy JSONB;

-- NOTE: query_listings may not yet exist; Task 5 confirms or creates it.
-- If it exists at apply time:
ALTER TABLE memory.query_listings
  ADD COLUMN IF NOT EXISTS dispute_policy JSONB;
```

- [ ] **Step 2: Apply locally**

```bash
bun api/scripts/_migrate-one.ts api/migrations/<NEW_TS>_dispute_generic.sql
```

- [ ] **Step 3: Verify**

```bash
psql $DATABASE_URL -c "
  SELECT subject_type, COUNT(*)
  FROM marketplace.dispute_cases
  GROUP BY subject_type;
"
```

Should show all existing rows under `subject_type = 'invocation'`.

```bash
psql $DATABASE_URL -c "\d marketplace.dispute_cases" | grep -E "subject_type|subject_id|dispute_policy_snapshot"
```

Should show all three new columns as `NOT NULL`.

**Acceptance:** schema migrated; backfill landed; composite uniqueness holds; templates table has `dispute_policy` column.

---

## Task 2: SubjectResolver interface + generic dispatcher

**Files:**
- Create: `api/src/services/marketplace/dispute/subjects/types.ts`
- Create: `api/src/services/marketplace/dispute/generic.ts`

- [ ] **Step 1: Interface**

Create `api/src/services/marketplace/dispute/subjects/types.ts`:

```ts
export type SubjectType =
  | "invocation"
  | "template_adoption"
  | "memory_query"
  | "federation_settlement";

export type Ruling = "release" | "refund" | "split";

export interface DisputePolicy {
  arbiter_claim: string;
  first_arbiter_did: string;
  buyer_review_seconds: number;
  first_arbiter_sla_seconds: number;
  escalation_seconds: number;
  pool_vote_seconds: number;
  filer_bond_bps: number;
}

export interface SubjectParties {
  buyer_identity_id: string;
  seller_identity_id: string;
  escrow_id: string | null;        // null for non-escrow-bound subjects
  amount: number;
  currency: string;
}

export interface SubjectResolver {
  subject_type: SubjectType;
  resolvePolicy(subject_id: string): Promise<DisputePolicy | null>;
  resolveParties(subject_id: string): Promise<SubjectParties>;
  applySettlement(subject_id: string, ruling: Ruling, split_pct?: number): Promise<void>;
  validateDisputable?(subject_id: string): Promise<void>;
}
```

- [ ] **Step 2: Generic dispatcher**

Create `api/src/services/marketplace/dispute/generic.ts`:

```ts
import { db } from "../../../db/client";
import { disputeCases } from "../../../db/schema/marketplace";
import { eq } from "drizzle-orm";
import { SubjectResolver, SubjectType, Ruling } from "./subjects/types";

import { invocationResolver } from "./subjects/invocation";
import { templateAdoptionResolver } from "./subjects/template-adoption";
import { memoryQueryResolver } from "./subjects/memory-query";
import { federationSettlementResolver } from "./subjects/federation-settlement";

const RESOLVERS: Record<SubjectType, SubjectResolver> = {
  invocation: invocationResolver,
  template_adoption: templateAdoptionResolver,
  memory_query: memoryQueryResolver,
  federation_settlement: federationSettlementResolver,
};

export function getResolver(t: SubjectType): SubjectResolver {
  const r = RESOLVERS[t];
  if (!r) throw new Error("invalid_subject_type");
  return r;
}

export async function disputeOver(args: {
  subject_type: SubjectType;
  subject_id: string;
  filer_identity_id: string;
  filer_project_id: string;
  filer_role: "buyer" | "seller";
  reason: string;
  evidence?: unknown;
}) {
  const resolver = getResolver(args.subject_type);
  await resolver.validateDisputable?.(args.subject_id);

  const policy = await resolver.resolvePolicy(args.subject_id);
  if (!policy) throw new Error("subject_not_disputable");

  const parties = await resolver.resolveParties(args.subject_id);

  // Filer must be one of the parties
  const filerIsBuyer = args.filer_identity_id === parties.buyer_identity_id;
  const filerIsSeller = args.filer_identity_id === parties.seller_identity_id;
  if (!filerIsBuyer && !filerIsSeller) {
    throw new Error("filer_not_party");
  }
  if ((args.filer_role === "buyer") !== filerIsBuyer) {
    throw new Error("filer_role_mismatch");
  }

  const now = new Date();
  const slaDeadline = new Date(now.getTime() + policy.first_arbiter_sla_seconds * 1000);
  const escalationDeadline = new Date(slaDeadline.getTime() + policy.escalation_seconds * 1000);

  return await db.transaction(async (tx) => {
    const [dispute] = await tx.insert(disputeCases).values({
      subject_type: args.subject_type,
      subject_id: args.subject_id,
      invocation_id: args.subject_type === "invocation" ? args.subject_id : null,
      filer_role: args.filer_role,
      filer_project_id: args.filer_project_id,
      filer_identity_id: args.filer_identity_id,
      reason: args.reason,
      evidence: args.evidence,
      first_arbiter_did: policy.first_arbiter_did,
      // ... existing first_arbiter resolution logic ...
      first_arbiter_sla_deadline_at: slaDeadline,
      escalation_deadline_at: escalationDeadline,
      dispute_policy_snapshot: policy,
      status: "open",
    }).returning();
    return dispute;
  });
}

export async function applyRulingSettlement(
  caseId: string,
  ruling: Ruling,
  split_pct?: number,
) {
  const dispute = await db.query.disputeCases.findFirst({
    where: eq(disputeCases.id, caseId),
  });
  if (!dispute) throw new Error("dispute_not_found");

  const resolver = getResolver(dispute.subject_type as SubjectType);
  await resolver.applySettlement(dispute.subject_id, ruling, split_pct);

  await db.update(disputeCases)
    .set({
      status: "resolved",
      final_ruling: ruling,
      final_split_pct: split_pct ?? null,
      resolved_at: new Date(),
    })
    .where(eq(disputeCases.id, caseId));
}
```

- [ ] **Step 3: Test**

Create `api/tests/disputes-generic-dispatch.test.ts`:

```ts
// Stub resolvers for each subject type.
// disputeOver({ subject_type: 'invocation', ... }) → invocation resolver called.
// disputeOver({ subject_type: 'template_adoption', ... }) → template_adoption resolver called.
// disputeOver({ subject_type: 'nonexistent', ... }) → throws 'invalid_subject_type'.
// disputeOver with filer not a party → throws 'filer_not_party'.
// disputeOver with filer_role mismatch → throws 'filer_role_mismatch'.
```

**Acceptance:** generic dispatcher routes correctly; common errors handled identically across subjects.

---

## Task 3: Invocation resolver (refactor existing)

**Files:**
- Create: `api/src/services/marketplace/dispute/subjects/invocation.ts`
- Edit: existing dispute-flow files in `api/src/services/marketplace/disputes.ts` — extract release/refund logic into the resolver

- [ ] **Step 1: Move invocation-specific logic into the resolver**

The existing `disputes.ts` already has the invocation-specific settlement logic. Extract it into the SubjectResolver shape:

```ts
import { SubjectResolver } from "./types";
import { db } from "../../../db/client";
import { invocations, listings } from "../../../db/schema/marketplace";
import { eq } from "drizzle-orm";

export const invocationResolver: SubjectResolver = {
  subject_type: "invocation",

  async resolvePolicy(subjectId) {
    const inv = await db.query.invocations.findFirst({
      where: eq(invocations.id, subjectId),
    });
    if (!inv) return null;
    const listing = await db.query.listings.findFirst({
      where: eq(listings.id, inv.listing_id),
    });
    return (listing?.dispute_policy as any) ?? null;
  },

  async resolveParties(subjectId) {
    const inv = await db.query.invocations.findFirst({
      where: eq(invocations.id, subjectId),
    });
    if (!inv) throw new Error("subject_not_found");
    return {
      buyer_identity_id: inv.buyer_identity_id,
      seller_identity_id: inv.seller_identity_id,
      escrow_id: inv.escrow_id,
      amount: inv.amount,
      currency: inv.currency,
    };
  },

  async applySettlement(subjectId, ruling, split_pct) {
    // Move existing invocation release/refund/split logic here.
    // Composes against existing services/economy/escrow.ts.
    // ...
  },

  async validateDisputable(subjectId) {
    const inv = await db.query.invocations.findFirst({
      where: eq(invocations.id, subjectId),
    });
    if (!inv) throw new Error("subject_not_found");
    if (inv.status !== "completed") throw new Error("subject_not_disputable");
    // ... existing window check ...
  },
};
```

- [ ] **Step 2: Update old call sites**

Routes that currently call invocation-specific dispute functions now call the generic dispatcher. The old code paths in `disputes.ts` can be removed once all callers are migrated.

- [ ] **Step 3: Verify existing tests pass**

```bash
cd api && bun test disputes
```

All existing invocation-bound dispute tests must continue to pass — the refactor preserves behavior.

**Acceptance:** existing dispute behavior unchanged; invocation logic now lives behind the SubjectResolver interface.

---

## Task 4: Template-adoption resolver

**Files:**
- Create: `api/src/services/marketplace/dispute/subjects/template-adoption.ts`
- Edit: `api/src/services/marketplace/templates.ts` (when adoption lands, capture purchase_id + escrow_id for later refund path)
- Create: `api/tests/disputes-template-adoption.test.ts`

- [ ] **Step 1: Resolver**

```ts
import { SubjectResolver } from "./types";
import { db } from "../../../db/client";
import { templates, templatePurchases, identities } from "../../../db/schema";
import { eq } from "drizzle-orm";

const ADOPTION_DISPUTABILITY_WINDOW_SECONDS = 86400;  // 24h

export const templateAdoptionResolver: SubjectResolver = {
  subject_type: "template_adoption",

  async resolvePolicy(subjectId) {
    // subjectId = template_purchase.id
    const purchase = await db.query.templatePurchases.findFirst({
      where: eq(templatePurchases.id, subjectId),
    });
    if (!purchase) return null;
    const template = await db.query.templates.findFirst({
      where: eq(templates.id, purchase.template_id),
    });
    return (template?.dispute_policy as any) ?? null;
  },

  async resolveParties(subjectId) {
    const purchase = await db.query.templatePurchases.findFirst({
      where: eq(templatePurchases.id, subjectId),
    });
    if (!purchase) throw new Error("subject_not_found");
    const template = await db.query.templates.findFirst({
      where: eq(templates.id, purchase.template_id),
    });
    return {
      buyer_identity_id: purchase.buyer_identity_id,
      seller_identity_id: template!.author_identity_id,
      escrow_id: purchase.escrow_id,
      amount: purchase.amount,
      currency: purchase.currency,
    };
  },

  async applySettlement(subjectId, ruling, _split_pct) {
    if (ruling === "split") {
      throw new Error("template_adoption_disputes_do_not_support_split");
    }
    await db.transaction(async (tx) => {
      const purchase = await tx.query.templatePurchases.findFirst({
        where: eq(templatePurchases.id, subjectId),
      });
      if (!purchase) throw new Error("subject_not_found");

      if (ruling === "release") {
        // Existing adoption stays paid. No-op.
        return;
      }

      // ruling === "refund"
      // 1. Refund buyer wallet from escrow
      await refundEscrow(tx, purchase.escrow_id, purchase.buyer_wallet_id);
      // 2. Demote the spawned identity's adoption record
      const adoptedIdentity = await tx.query.identities.findFirst({
        where: eq(identities.id, purchase.adopted_identity_id),
      });
      if (adoptedIdentity) {
        await tx.update(identities)
          .set({ adopted_from_template_id: null })
          .where(eq(identities.id, adoptedIdentity.id));
      }
      // 3. Mark the purchase as refunded
      await tx.update(templatePurchases)
        .set({ status: "refunded", refunded_at: new Date() })
        .where(eq(templatePurchases.id, subjectId));
    });
  },

  async validateDisputable(subjectId) {
    const purchase = await db.query.templatePurchases.findFirst({
      where: eq(templatePurchases.id, subjectId),
    });
    if (!purchase) throw new Error("subject_not_found");
    const ageSeconds = (Date.now() - new Date(purchase.purchased_at).getTime()) / 1000;
    if (ageSeconds > ADOPTION_DISPUTABILITY_WINDOW_SECONDS) {
      throw new Error("adoption_disputability_window_closed");
    }
    if (purchase.status !== "settled") {
      throw new Error("adoption_not_in_disputable_state");
    }
  },
};
```

- [ ] **Step 2: Update `templates.ts` adoption flow**

When `POST /v1/identities/from-template` lands, the `template_purchases` row stores `escrow_id` + `adopted_identity_id` + `buyer_wallet_id` so refund settlement can find them later. (May already be in the schema; verify.)

- [ ] **Step 3: Test**

```ts
// Setup: seed a template with dispute_policy + author with template-quality-arbiter attestation.
// Setup: buyer adopts template within 24h.
// File dispute via disputeOver({ subject_type: 'template_adoption', ... }).
// Assert: dispute_case row landed with correct subject_type/id.
// Drive ruling = 'refund' via applyRulingSettlement.
// Assert: buyer wallet credited; adopted identity's adopted_from_template_id is NULL; purchase status='refunded'.
// Test: filing > 24h after adoption → throws 'adoption_disputability_window_closed'.
// Test: ruling = 'split' → throws 'template_adoption_disputes_do_not_support_split'.
```

**Acceptance:** template-adoption disputes file correctly; refund settlement reverses adoption charge AND demotes the spawned identity; binary-only (no split).

---

## Task 5: Memory-query resolver

**Files:**
- Create: `api/src/services/marketplace/dispute/subjects/memory-query.ts`
- Edit: `memory.query_listings` schema (if it doesn't exist yet, create here)
- Create: `api/tests/disputes-memory-query.test.ts`

- [ ] **Step 1: Verify or create `memory.query_listings`**

```bash
psql $DATABASE_URL -c "\d memory.query_listings" 2>&1
```

If table doesn't exist:

```sql
-- In the Task 1 migration, or a follow-on migration:
CREATE TABLE IF NOT EXISTS memory.query_listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_identity_id UUID NOT NULL,
    name            TEXT NOT NULL,
    price_amount    INTEGER NOT NULL,
    price_currency  TEXT NOT NULL,
    dispute_policy  JSONB,
    visibility      TEXT NOT NULL DEFAULT 'public',
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory.query_records (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id         UUID NOT NULL REFERENCES memory.query_listings(id),
    buyer_identity_id  UUID NOT NULL,
    escrow_id          UUID NOT NULL,
    result_sealed      TEXT NOT NULL,    -- sealed-box ciphertext
    result_sha256      TEXT NOT NULL,
    quality_contested  BOOLEAN NOT NULL DEFAULT false,
    status             TEXT NOT NULL DEFAULT 'settled',
    fulfilled_at       TIMESTAMPTZ
);
```

(Note: this slice may need to be deferred until memory-query is a real product surface. For v1 of Tendon C, the resolver can be implemented against a stub that surfaces only when the schema exists.)

- [ ] **Step 2: Resolver**

Similar shape to template-adoption but supports `split`:

```ts
export const memoryQueryResolver: SubjectResolver = {
  subject_type: "memory_query",

  async resolvePolicy(subjectId) { /* read from query_listing.dispute_policy */ },
  async resolveParties(subjectId) { /* query_records → buyer + seller from listing */ },

  async applySettlement(subjectId, ruling, split_pct) {
    await db.transaction(async (tx) => {
      if (ruling === "refund") {
        await refundEscrow(tx, ...);
        await tx.update(queryRecords)
          .set({ quality_contested: true, status: "refunded" })
          .where(eq(queryRecords.id, subjectId));
      } else if (ruling === "split") {
        const pct = split_pct ?? 50;
        await splitEscrow(tx, ..., pct);
        await tx.update(queryRecords)
          .set({ quality_contested: true })
          .where(eq(queryRecords.id, subjectId));
      } else {
        // release — no metadata change; escrow already released on initial settlement
      }
    });
  },

  async validateDisputable(subjectId) {
    const record = await db.query.queryRecords.findFirst({
      where: eq(queryRecords.id, subjectId),
    });
    if (!record) throw new Error("subject_not_found");
    if (!record.result_sealed) throw new Error("query_result_not_yet_delivered");
    // ... window check from policy ...
  },
};
```

- [ ] **Step 3: Test**

```ts
// Setup: seed query listing + record + escrow.
// File dispute.
// Drive ruling = 'split' with 30%.
// Assert: 30% to seller, 70% to buyer; quality_contested = true.
// Drive ruling = 'refund'.
// Assert: full refund; quality_contested = true; status = 'refunded'.
// Drive ruling = 'release'.
// Assert: no metadata change.
```

**Acceptance:** memory-query disputes support all three rulings; sealed result content remains sealed throughout the dispute lifecycle (no unsealing path).

---

## Task 6: Federation-settlement resolver (Policy A — seller's instance authoritative)

**Files:**
- Create: `api/src/services/marketplace/dispute/subjects/federation-settlement.ts`
- Edit: `api/src/services/federation/` — add dispute-coordination call sites
- Create: `api/tests/disputes-federation-settlement.test.ts`

- [ ] **Step 1: Resolver — Policy A**

Cross-instance dispute coordination. The buyer's instance acts as a federated client; the seller's instance is authoritative.

```ts
export const federationSettlementResolver: SubjectResolver = {
  subject_type: "federation_settlement",

  async resolvePolicy(subjectId) {
    // subjectId = federation_settlement_record.id
    const record = await db.query.federationSettlementRecords.findFirst({
      where: eq(federationSettlementRecords.id, subjectId),
    });
    if (!record) return null;

    // If we ARE the seller's instance: read policy locally
    if (record.seller_instance === LOCAL_INSTANCE_DID) {
      return await readPolicyFromLocalCovenant(record.covenant_id);
    }
    // Else: fetch from federated peer
    return await fetchPolicyFromFederation(record.seller_instance, record.subject_id);
  },

  async resolveParties(subjectId) { /* similar split */ },

  async applySettlement(subjectId, ruling, split_pct) {
    const record = /* ... */;
    if (record.seller_instance === LOCAL_INSTANCE_DID) {
      // Authoritative path
      await applyFederatedSettlementLocal(record, ruling, split_pct);
    } else {
      // Client path — federate the settlement request
      await federateSettlementToPeer(record.seller_instance, record.subject_id, ruling, split_pct);
    }
  },

  async validateDisputable(subjectId) {
    // ... check settlement is recent enough ...
  },
};
```

- [ ] **Step 2: Federation coordination**

New federation endpoints (or extensions to existing federation API):

- `POST /federation/disputes/file` — peer files a dispute against a local subject
- `POST /federation/disputes/:id/settlement` — peer requests settlement application
- The dispute case lives on the seller's instance regardless of who filed.

- [ ] **Step 3: Stuck-dispute timeout**

A daily cron checks `dispute_cases` where `subject_type = 'federation_settlement'` AND `status != 'resolved'` AND `created_at < now() - interval '30 days'`. Auto-resolves to `refund` per spec doctrine.

- [ ] **Step 4: Test**

```ts
// Setup: two test instances (same db, different LOCAL_INSTANCE_DID).
// Settlement record created — seller on instance A, buyer on instance B.
// Buyer files dispute via local instance.
// Assert: federation API call landed on instance A; dispute case created there.
// Drive ruling = 'refund' from instance A.
// Assert: cross-instance refund initiated; buyer's local instance receives federation message.
// Test: instance A offline → dispute stays 'open'; 30-day timeout cron auto-refunds.
```

**Acceptance:** Policy A flow works end-to-end; stuck-dispute auto-refund holds; sealed content stays sealed across instances.

---

## Task 7: Generic `POST /v1/disputes` route + wake aggregation

**Files:**
- Create: `api/src/routes/disputes.ts` (or extend existing)
- Edit: `api/src/routes/invocations.ts` (compatibility shim points to generic dispatcher)
- Edit: `api/src/services/wake/markdown.ts` (or wherever `you_disputed` is computed)

- [ ] **Step 1: Generic route**

```ts
import { Hono } from "hono";
import { disputeOver, applyRulingSettlement } from "../services/marketplace/dispute/generic";

export const disputesRoutes = new Hono();

disputesRoutes.use("*", authMiddleware);

disputesRoutes.post("/", async (c) => {
  const body = await c.req.json();
  try {
    const dispute = await disputeOver({
      subject_type: body.subject_type,
      subject_id: body.subject_id,
      filer_identity_id: c.get("identityId"),
      filer_project_id: c.get("projectId"),
      filer_role: body.filer_role,
      reason: body.reason,
      evidence: body.evidence,
    });
    return c.json(dispute, 201);
  } catch (e: any) {
    return mapDisputeError(e, c);
  }
});

// State-transition routes (already exist for invocation-bound; minor refactor to use generic dispatcher)
disputesRoutes.post("/:id/rule", async (c) => { /* ... */ });
disputesRoutes.post("/:id/escalate", async (c) => { /* ... */ });
disputesRoutes.post("/:id/vote", async (c) => { /* ... */ });
disputesRoutes.post("/:id/finalize", async (c) => { /* ... */ });
```

Mount at `/v1/disputes`.

- [ ] **Step 2: Compatibility shim**

In `api/src/routes/invocations.ts`:

```ts
invocationsRoutes.post("/:id/dispute", async (c) => {
  const body = await c.req.json();
  const dispute = await disputeOver({
    subject_type: "invocation",
    subject_id: c.req.param("id"),
    filer_identity_id: c.get("identityId"),
    filer_project_id: c.get("projectId"),
    filer_role: body.filer_role,
    reason: body.reason,
    evidence: body.evidence,
  });
  return c.json(dispute, 201);
});
```

Add deprecation header: `Deprecation: true` and `Link: </v1/disputes>; rel="successor-version"`.

- [ ] **Step 3: Wake aggregation**

Update `you_disputed` to count across subject types:

```ts
const counts = await db
  .select({
    subject_type: disputeCases.subject_type,
    count: sql<number>`COUNT(*)`,
  })
  .from(disputeCases)
  .where(and(
    eq(disputeCases.filer_identity_id, identityId),
    ne(disputeCases.status, "resolved"),
  ))
  .groupBy(disputeCases.subject_type);

const by_subject = Object.fromEntries(counts.map(r => [r.subject_type, r.count]));
const open_count = counts.reduce((s, r) => s + r.count, 0);

return { open_count, by_subject, last_filed_at: /* ... */ };
```

- [ ] **Step 4: Test**

Existing invocation-dispute tests continue to pass (compatibility shim works). New tests cover the generic route for each subject type.

**Acceptance:** generic route handles all four subject types; compat shim works; wake `by_subject` aggregates correctly.

---

## Task 8: Qualifying attestation claims for new subjects

**Files:**
- Create: `bin/seed-arbiter-claims.ts`

These are seed claims that introduce the new pool-qualifying claim types to the attestation marketplace. Issuance flows via the existing attestation marketplace (Slice 3 of Horizon A).

- [ ] **Step 1: Script**

```ts
#!/usr/bin/env bun
// Publish attestation listings for the three new arbiter claim types.
// Run by an operator (or by an existing trusted attester identity).

const CLAIMS = [
  {
    claim_type: "agenttool/template-quality-arbiter/v1",
    description: "I attest that I have reviewed templates and am qualified to arbitrate template-adoption disputes.",
  },
  {
    claim_type: "agenttool/knowledge-arbiter/v1",
    description: "I attest that I can evaluate memory-query result quality and arbitrate disputes thereon.",
  },
  {
    claim_type: "agenttool/federation-arbiter/v1",
    description: "I attest that I am qualified to arbitrate cross-instance settlement disputes.",
  },
];

// For each: create an attestation_listing via existing POST /v1/attestation-listings
// (priced at the listing author's discretion; visibility public).
```

- [ ] **Step 2: Verify the marketplace surface accepts the new claim types**

The attestation marketplace doesn't restrict `claim_type` values — any string is allowed. Verify via `curl /public/attestation-listings?claim_type=agenttool/template-quality-arbiter/v1` returns the seed listings.

**Acceptance:** the three new arbiter claim types are bookable via the existing attestation marketplace; pool draws for the new subject types find eligible attesters.

---

## Task 9: E2E harness + doc updates

**Files:**
- Create: `api/scripts/_e2e-disputes-generic.mjs`
- Edit: `docs/MARKETPLACE.md` (add Subject types subsection)
- Edit: `docs/PAINTING.md` (mark Tendon C shipped)
- Edit: `docs/NOW.md` (add Just landed entry)
- Edit: `docs/ROADMAP.md` (Layer 6 Culture section — note dispute primitive now generic)

- [ ] **Step 1: E2E harness**

```js
#!/usr/bin/env node
/**
 * End-to-end: file disputes against all four subject types; verify settlement semantics.
 *
 * Modelled on api/scripts/_e2e-disputes.mjs (the original invocation-bound harness).
 *
 * Steps:
 *  1. Seed test data: invocation, template_adoption (purchase), memory_query record,
 *     federation_settlement record. All disputable.
 *  2. Seed attesters with each of the four arbiter claim types.
 *  3. File dispute on each subject type via POST /v1/disputes.
 *  4. Drive each through first arbiter ruling.
 *  5. Verify settlement: invocation → escrow release/refund; template → identity demoted on refund;
 *     memory_query → quality_contested set; federation → cross-instance message landed.
 *  6. Test ruling=split on a memory_query (supported); on a template_adoption (rejected).
 *  7. Test backward-compat: POST /v1/invocations/:id/dispute still works.
 *  8. Verify wake aggregation: you_disputed.by_subject reflects all four types.
 *  9. Test stuck federation dispute: 30-day timeout auto-refunds.
 * 10. Cleanup.
 */
```

- [ ] **Step 2: Update MARKETPLACE.md**

Add new section under Dispute primitive:

```markdown
### Subject types

The dispute primitive is generic over subject type. v1 supports four:

| Subject | What disputes look like here |
|---|---|
| `invocation` | Capability-invocation completion contested (original surface). |
| `template_adoption` | Adopter retracts within 24h of adoption. Binary (no split). Refund reverses charge + demotes spawned identity's adoption record. |
| `memory_query` | Buyer of a paid memory query contests result quality. Supports split (partial-quality). Sealed result content stays sealed. |
| `federation_settlement` | Cross-instance payment contested. Seller's instance authoritative (Policy A); buyer's instance acts as federated client. |

Spec: [`docs/superpowers/specs/2026-05-11-dispute-generic-design.md`](superpowers/specs/2026-05-11-dispute-generic-design.md).
```

- [ ] **Step 3: Update PAINTING.md**

In §IIC, mark the tendon shipped:

```markdown
### Tendon C · IV → many rooms — the dispute-shape recurs

**Shipped <date>** — spec at [`docs/superpowers/specs/2026-05-11-dispute-generic-design.md`](superpowers/specs/2026-05-11-dispute-generic-design.md).

...
```

- [ ] **Step 4: Update NOW.md**

Add to "Just landed":

| Ship | Commit | What |
|---|---|---|
| **Dispute primitive — generic (Tendon C)** | `<commit>` | Three new subject types (template_adoption · memory_query · federation_settlement) join invocation. `POST /v1/disputes` is subject-agnostic. The drawn figures recur. |

- [ ] **Step 5: Run the E2E**

```bash
node api/scripts/_e2e-disputes-generic.mjs
```

All assertions must pass.

**Acceptance:** harness passes clean; docs updated; bidirectional links closed.

---

## Walls / non-goals (this pass)

- **No new subject types beyond the four named.** Each new subject is a separate slice with its own resolver.
- **No Policy B for federation disputes.** v1 = Policy A only.
- **No retroactive disputability** for subjects landed before this ships.
- **No multi-subject disputes** — file separate cases.
- **No dispute-of-dispute** — chain length stays 2.
- **No dispute-mediated unsealing** — sealed payloads stay sealed.
- **No removal of `invocation_id` column or `/v1/invocations/:id/dispute` shim** in this pass — kept for one quarter for client migration.

---

## Acceptance criteria (campaign-level)

1. Migration applies; existing rows backfilled correctly; `dispute_policy_snapshot` populated for all rows.
2. Generic dispatcher routes correctly by `subject_type`; common errors handled identically.
3. Invocation resolver: refactor preserves all existing behavior — all original tests pass unchanged.
4. Template-adoption resolver: refund reverses charge AND demotes identity; split rejected.
5. Memory-query resolver: all three rulings supported; sealed result content stays sealed.
6. Federation-settlement resolver: Policy A flow works; stuck-dispute timeout auto-refunds at 30 days.
7. `POST /v1/disputes` generic route works for all four subject types.
8. Compatibility shim at `/v1/invocations/:id/dispute` continues to work; deprecation headers present.
9. Wake `you_disputed.by_subject` aggregates across subject types.
10. New qualifying attestation claims are bookable via the existing attestation marketplace; pool draws find eligible attesters.
11. E2E harness covers all four subject types + compat shim + wake aggregation + stuck-dispute timeout.
12. CI: existing dispute-invocation tests continue to pass alongside the new generic tests.

---

## Open questions (carry-forward from spec)

1. `invocation_id` column drop — defer to next quarter (after deprecation window).
2. Template-adoption buyer-review window — 24h.
3. Memory-query split support — yes.
4. Federation policy — A (seller's instance authoritative).
5. Wake aggregation breakdown — always show `by_subject`.
6. Attestation claim issuance — via marketplace (existing path).
7. Subject soft-delete — enforce via FK or trigger.
8. Stuck-cross-instance-dispute timeout — 30 days, auto-refund.

---

## Composition with the canon

- **[PAINTING §IIC](../../PAINTING.md)** — the tendon implemented. The drawn figures finally recur.
- **[FOCUS §2](../../FOCUS.md)** — covenant filament extends to all subject rulings (cosign-over-signature pattern).
- **[FOCUS §9](../../FOCUS.md)** — no platform-exempt branch; the painter could be disputed as easily as any other agent.
- **[FOCUS §10](../../FOCUS.md)** — take-rate honesty; symmetric on settled, zero on refunded, across all subjects.
- **[MARKETPLACE.md](../../MARKETPLACE.md)** — original dispute primitive section, now extended.
- **[CROSS-INSTANCE-COVENANTS.md](../../CROSS-INSTANCE-COVENANTS.md)** — federation peering composes with Policy A.
- **[`docs/superpowers/specs/2026-05-10-dispute-primitive-design.md`](../specs/2026-05-10-dispute-primitive-design.md)** — original invocation-specific spec; the invocation subject resolver in this plan is a refactor of its implementation.

---

> *Authored 2026-05-11. Plan slices the spec at [`docs/superpowers/specs/2026-05-11-dispute-generic-design.md`](../specs/2026-05-11-dispute-generic-design.md). Closes Tendon C of the painting's tendon set.*
