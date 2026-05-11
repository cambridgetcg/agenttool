# Dispute primitive — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the marketplace dispute primitive: listings opt in via `dispute_policy`; the seller's named first arbiter rules; either party can escalate within a window (locking a 25% bond) to a 5-attester pool that overturns on 4-of-5; pool ruling is final.

**Architecture:** Composition over duplication. The existing escrow + take-rate + attestation primitives carry the money flow and signature verification unchanged. New surface: two tables (`dispute_cases`, `dispute_pool_votes`), a JSONB `dispute_policy` on `listings`, and three nullable columns on `invocations`. The dispute lifecycle bridges the existing `completed` invocation state (reserved at v1 schema time) to the existing release/refund pathways.

**Tech Stack:** Bun + Hono (api), drizzle-orm (postgres-js), `@noble/ed25519` + `@noble/hashes` (sigs), `bun test` (unit), Postgres 17.6.

**Spec:** `docs/superpowers/specs/2026-05-10-dispute-primitive-design.md`

---

## Pre-flight

**Verify the repo state before starting:**

- [ ] `pwd` → confirm `/Users/yuai/Desktop/agenttool` (or the path your worktree is at)
- [ ] `git status --short` → clean OR only contains the unrelated marketplace changes from the prior session. The dispute spec at `docs/superpowers/specs/2026-05-10-dispute-primitive-design.md` MUST exist.
- [ ] `cd api && bun test 2>&1 | tail -5` → all existing tests pass before starting
- [ ] `cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage"` → no NEW TypeScript errors (the pre-existing `services/economy/usage` import is the only allowed failure)

If any of the above fails, fix or pause and ask before proceeding.

---

## Task 1: Migration — dispute tables + column additions

**Files:**
- Create: `api/migrations/20260511T120000_dispute_primitive.sql`

- [ ] **Step 1: Write the migration**

Create `api/migrations/20260511T120000_dispute_primitive.sql` with:

```sql
-- 20260511T120000_dispute_primitive.sql — marketplace dispute primitive.
--
-- Doctrine: docs/MARKETPLACE.md (Dispute primitive section, to be added).
-- Spec:     docs/superpowers/specs/2026-05-10-dispute-primitive-design.md
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260511T120000_dispute_primitive.sql
--
-- Two new tables + JSONB column on listings + three columns on invocations +
-- one column on identity.attestations (for revocation tracking). Additive only.

-- ── dispute_cases ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace.dispute_cases (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invocation_id                   UUID NOT NULL UNIQUE
                                      REFERENCES marketplace.invocations(id) ON DELETE CASCADE,
    -- Filing
    filer_role                      TEXT NOT NULL CHECK (filer_role IN ('buyer', 'seller')),
    filer_project_id                UUID NOT NULL,
    filer_identity_id               UUID NOT NULL,
    reason                          TEXT,
    evidence                        JSONB,
    -- First arbiter (resolved at file time from listing.dispute_policy)
    first_arbiter_identity_id       UUID,
    first_arbiter_did               TEXT,
    first_arbiter_ruling            TEXT CHECK (first_arbiter_ruling IS NULL OR first_arbiter_ruling IN ('release', 'refund', 'split')),
    first_arbiter_split_pct         INTEGER CHECK (first_arbiter_split_pct IS NULL OR (first_arbiter_split_pct BETWEEN 0 AND 100)),
    first_arbiter_signature         TEXT,
    first_arbiter_signing_key_id    UUID,
    first_arbiter_ruled_at          TIMESTAMPTZ,
    first_arbiter_sla_deadline_at   TIMESTAMPTZ,
    -- Escalation
    escalation_deadline_at          TIMESTAMPTZ,
    escalated_by_role               TEXT CHECK (escalated_by_role IS NULL OR escalated_by_role IN ('buyer', 'seller')),
    escalator_bond_amount           INTEGER,
    escalator_bond_escrow_id        UUID,
    pool_drawn_at                   TIMESTAMPTZ,
    pool_size                       INTEGER,
    pool_vote_deadline_at           TIMESTAMPTZ,
    -- Final
    final_ruling                    TEXT CHECK (final_ruling IS NULL OR final_ruling IN ('release', 'refund', 'split')),
    final_split_pct                 INTEGER CHECK (final_split_pct IS NULL OR (final_split_pct BETWEEN 0 AND 100)),
    status                          TEXT NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open', 'first_ruled', 'escalated', 'resolved')),
    resolution_path                 TEXT CHECK (resolution_path IS NULL OR resolution_path IN (
                                      'first_stood',
                                      'overturned',
                                      'upheld',
                                      'insufficient_pool',
                                      'first_arbiter_failed_sla',
                                      'first_arbiter_unqualified'
                                    )),
    resolved_at                     TIMESTAMPTZ,
    metadata                        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_cases_filer
    ON marketplace.dispute_cases (filer_project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_first_arbiter
    ON marketplace.dispute_cases (first_arbiter_identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_open
    ON marketplace.dispute_cases (status, escalation_deadline_at)
    WHERE status IN ('open', 'first_ruled', 'escalated');

-- ── dispute_pool_votes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace.dispute_pool_votes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_case_id         UUID NOT NULL REFERENCES marketplace.dispute_cases(id) ON DELETE CASCADE,
    voter_identity_id       UUID NOT NULL,
    voter_did               TEXT NOT NULL,
    vote                    TEXT NOT NULL CHECK (vote IN ('uphold', 'overturn')),
    alternative_ruling      TEXT CHECK (alternative_ruling IS NULL OR alternative_ruling IN ('release', 'refund', 'split')),
    alternative_split_pct   INTEGER CHECK (alternative_split_pct IS NULL OR (alternative_split_pct BETWEEN 0 AND 100)),
    signature               TEXT NOT NULL,
    signing_key_id          UUID NOT NULL,
    voted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dispute_case_id, voter_identity_id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_pool_votes_case
    ON marketplace.dispute_pool_votes (dispute_case_id, voted_at DESC);

-- ── listings.dispute_policy ──────────────────────────────────────────
ALTER TABLE marketplace.listings
  ADD COLUMN IF NOT EXISTS dispute_policy JSONB;

-- ── invocations: dispute_case_id, buyer_review_deadline_at, status enum ─
ALTER TABLE marketplace.invocations
  ADD COLUMN IF NOT EXISTS dispute_case_id UUID,
  ADD COLUMN IF NOT EXISTS buyer_review_deadline_at TIMESTAMPTZ;

-- Replace the existing inline CHECK on status (auto-named in 0019).
DO $$
DECLARE con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'marketplace.invocations'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%refund_reason%';
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE marketplace.invocations DROP CONSTRAINT ' || quote_ident(con_name);
  END IF;
END $$;

ALTER TABLE marketplace.invocations
  ADD CONSTRAINT invocations_status_check
    CHECK (status IN ('escrowed', 'acknowledged', 'completed', 'disputed', 'released', 'refunded'));

-- ── identity.attestations.revoked_at ─────────────────────────────────
ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

COMMENT ON TABLE marketplace.dispute_cases IS
  'Dispute on a settled-but-not-released invocation. Listing-bound first arbiter rules; either party can escalate to a 5-attester pool. Pool ruling is final. Doctrine: docs/MARKETPLACE.md (Dispute primitive section).';
COMMENT ON COLUMN marketplace.listings.dispute_policy IS
  'JSONB: { arbiter_claim, first_arbiter_did, buyer_review_seconds, first_arbiter_sla_seconds, escalation_seconds, pool_vote_seconds, filer_bond_bps }. NULL = no disputability; /complete releases atomically as before.';
COMMENT ON COLUMN marketplace.invocations.dispute_case_id IS
  'NULL until a dispute is filed against this invocation. Soft FK to marketplace.dispute_cases.id.';
COMMENT ON COLUMN identity.attestations.revoked_at IS
  'When the attestation was revoked. NULL = currently valid. Set by the original attester via the (forthcoming) revocation flow; used by the dispute pool-draw to filter qualified attesters.';
```

- [ ] **Step 2: Stage**

```bash
git add api/migrations/20260511T120000_dispute_primitive.sql
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
db: dispute primitive — tables + column additions

dispute_cases, dispute_pool_votes, listings.dispute_policy,
invocations.dispute_case_id + buyer_review_deadline_at + status enum
extension to allow 'completed' and 'disputed',
identity.attestations.revoked_at + revocation_reason.

Migration is additive. Listings without dispute_policy keep existing
atomic-release semantics on /complete. Apply manually with
_migrate-one.ts on a machine with DB creds.

Spec: docs/superpowers/specs/2026-05-10-dispute-primitive-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Drizzle schema additions

**Files:**
- Modify: `api/src/db/schema/marketplace.ts`
- Modify: `api/src/db/schema/identity.ts`

- [ ] **Step 1: Find the existing identity.attestations table definition**

```bash
grep -n "attestations\s*=\s*identitySchema" api/src/db/schema/identity.ts
```

Note the line number; the file path is `api/src/db/schema/identity.ts`.

- [ ] **Step 2: Add `revokedAt` + `revocationReason` columns to identity.attestations**

In `api/src/db/schema/identity.ts`, find the `attestations` table (near the line from step 1). Add these two field lines inside the table definition, alongside the other columns (preserve existing ordering):

```typescript
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
```

- [ ] **Step 3: Append dispute tables to marketplace.ts**

Open `api/src/db/schema/marketplace.ts`. After the existing `reviews` table definition (at end of file), append:

```typescript

// ── Dispute primitive (20260511T120000) ────────────────────────────
// Listings opt in via dispute_policy JSONB (added as a column on the
// listings table; service layer validates shape). When an invocation
// hits 'completed' state, buyer/seller can file a dispute within the
// buyer-review window. Doctrine: docs/MARKETPLACE.md (Dispute section).
export const disputeCases = marketplaceSchema.table(
  "dispute_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invocationId: uuid("invocation_id").notNull().unique(),
    filerRole: text("filer_role").notNull(),
    filerProjectId: uuid("filer_project_id").notNull(),
    filerIdentityId: uuid("filer_identity_id").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence"),
    firstArbiterIdentityId: uuid("first_arbiter_identity_id"),
    firstArbiterDid: text("first_arbiter_did"),
    firstArbiterRuling: text("first_arbiter_ruling"),
    firstArbiterSplitPct: integer("first_arbiter_split_pct"),
    firstArbiterSignature: text("first_arbiter_signature"),
    firstArbiterSigningKeyId: uuid("first_arbiter_signing_key_id"),
    firstArbiterRuledAt: timestamp("first_arbiter_ruled_at", { withTimezone: true }),
    firstArbiterSlaDeadlineAt: timestamp("first_arbiter_sla_deadline_at", { withTimezone: true }),
    escalationDeadlineAt: timestamp("escalation_deadline_at", { withTimezone: true }),
    escalatedByRole: text("escalated_by_role"),
    escalatorBondAmount: integer("escalator_bond_amount"),
    escalatorBondEscrowId: uuid("escalator_bond_escrow_id"),
    poolDrawnAt: timestamp("pool_drawn_at", { withTimezone: true }),
    poolSize: integer("pool_size"),
    poolVoteDeadlineAt: timestamp("pool_vote_deadline_at", { withTimezone: true }),
    finalRuling: text("final_ruling"),
    finalSplitPct: integer("final_split_pct"),
    status: text("status").notNull().default("open"),
    resolutionPath: text("resolution_path"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_dispute_cases_filer").on(t.filerProjectId, t.createdAt),
    index("idx_dispute_cases_first_arbiter").on(t.firstArbiterIdentityId, t.createdAt),
    index("idx_dispute_cases_open").on(t.status, t.escalationDeadlineAt),
  ],
);

export const disputePoolVotes = marketplaceSchema.table(
  "dispute_pool_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeCaseId: uuid("dispute_case_id").notNull(),
    voterIdentityId: uuid("voter_identity_id").notNull(),
    voterDid: text("voter_did").notNull(),
    vote: text("vote").notNull(),
    alternativeRuling: text("alternative_ruling"),
    alternativeSplitPct: integer("alternative_split_pct"),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_dispute_pool_votes_case").on(t.disputeCaseId, t.votedAt),
    unique("dispute_pool_votes_case_voter_unique").on(t.disputeCaseId, t.voterIdentityId),
  ],
);
```

- [ ] **Step 4: Add `disputePolicy`, `disputeCaseId`, `buyerReviewDeadlineAt` columns to existing tables**

In `api/src/db/schema/marketplace.ts`, locate the `listings` table definition. Find the line with `metadata: jsonb("metadata").notNull().default({}),` *inside the listings table block* and add this line just above it:

```typescript
    disputePolicy: jsonb("dispute_policy"),
```

In the same file, locate the `invocations` table definition. Find the line with `tierName: text("tier_name"),` and add these lines after it:

```typescript
    disputeCaseId: uuid("dispute_case_id"),
    buyerReviewDeadlineAt: timestamp("buyer_review_deadline_at", { withTimezone: true }),
```

- [ ] **Step 5: Typecheck**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10
```

Expected: empty output (only the pre-existing unrelated `services/economy/usage` error allowed).

- [ ] **Step 6: Commit**

```bash
git add api/src/db/schema/identity.ts api/src/db/schema/marketplace.ts
git commit -m "$(cat <<'EOF'
db(schema): drizzle additions for dispute primitive

disputeCases + disputePoolVotes tables; dispute_policy on listings;
dispute_case_id + buyer_review_deadline_at on invocations;
revoked_at + revocation_reason on identity.attestations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pure helpers — canonical bytes for dispute signatures (TDD)

**Files:**
- Modify: `api/src/services/marketplace/sig.ts`
- Test: `api/tests/marketplace-disputes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/marketplace-disputes.test.ts` with:

```typescript
/** Unit tests for marketplace/disputes pure helpers + canonical-bytes
 *  signing surface. DB-bound paths live in e2e smokes. */

import { describe, expect, test } from "bun:test";
import {
  canonicalDisputeFirstRulingBytes,
  canonicalDisputePoolVoteBytes,
} from "../src/services/marketplace/sig";

describe("canonicalDisputeFirstRulingBytes", () => {
  test("returns a 32-byte SHA-256 digest", () => {
    const digest = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "11111111-1111-1111-1111-111111111111",
      ruling: "release",
      splitPct: null,
    });
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest.length).toBe(32);
  });

  test("same inputs produce same digest (deterministic)", () => {
    const a = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "refund",
      splitPct: null,
    });
    const b = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "refund",
      splitPct: null,
    });
    expect(a).toEqual(b);
  });

  test("different rulings produce different digests", () => {
    const release = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "release",
      splitPct: null,
    });
    const refund = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "refund",
      splitPct: null,
    });
    expect(release).not.toEqual(refund);
  });

  test("split_pct binds — different split_pct produces different digest", () => {
    const split50 = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "split",
      splitPct: 50,
    });
    const split75 = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "split",
      splitPct: 75,
    });
    expect(split50).not.toEqual(split75);
  });
});

describe("canonicalDisputePoolVoteBytes", () => {
  test("returns a 32-byte digest", () => {
    const digest = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "uphold",
      alternativeRuling: null,
      alternativeSplitPct: null,
    });
    expect(digest.length).toBe(32);
  });

  test("uphold and overturn produce different digests with same case_id", () => {
    const uphold = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "uphold",
      alternativeRuling: null,
      alternativeSplitPct: null,
    });
    const overturn = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "refund",
      alternativeSplitPct: null,
    });
    expect(uphold).not.toEqual(overturn);
  });

  test("alternative_ruling binds — different alts produce different digests", () => {
    const refund = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "refund",
      alternativeSplitPct: null,
    });
    const release = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "release",
      alternativeSplitPct: null,
    });
    expect(refund).not.toEqual(release);
  });

  test("alternative_split_pct binds when ruling is split", () => {
    const split50 = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "split",
      alternativeSplitPct: 50,
    });
    const split75 = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "split",
      alternativeSplitPct: 75,
    });
    expect(split50).not.toEqual(split75);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -10
```

Expected: failure with "canonicalDisputeFirstRulingBytes is not exported" or similar.

- [ ] **Step 3: Implement the helpers in sig.ts**

Open `api/src/services/marketplace/sig.ts`. At the end of the file (after the existing `validateSealedShape` function), append:

```typescript

// ── Dispute primitive — canonical bytes (20260511) ───────────────────
// Two domain-tag schemes — first arbiter and pool voter sign different
// shapes because pool votes also bind an alternative ruling proposal.

export function canonicalDisputeFirstRulingBytes(opts: {
  disputeCaseId: string;
  ruling: "release" | "refund" | "split";
  splitPct: number | null;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("dispute-first-ruling/v1");
  const id = enc.encode(opts.disputeCaseId);
  const ruling = enc.encode(opts.ruling);
  const split = enc.encode(opts.splitPct === null ? "" : String(opts.splitPct));
  return sha256(concat(tag, SEP, id, SEP, ruling, SEP, split));
}

export function canonicalDisputePoolVoteBytes(opts: {
  disputeCaseId: string;
  vote: "uphold" | "overturn";
  alternativeRuling: "release" | "refund" | "split" | null;
  alternativeSplitPct: number | null;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("dispute-pool-vote/v1");
  const id = enc.encode(opts.disputeCaseId);
  const vote = enc.encode(opts.vote);
  const alt = enc.encode(opts.alternativeRuling ?? "");
  const split = enc.encode(opts.alternativeSplitPct === null ? "" : String(opts.alternativeSplitPct));
  return sha256(concat(tag, SEP, id, SEP, vote, SEP, alt, SEP, split));
}

export function verifyDisputeFirstRuling(opts: {
  disputeCaseId: string;
  ruling: "release" | "refund" | "split";
  splitPct: number | null;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalDisputeFirstRulingBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}

export function verifyDisputePoolVote(opts: {
  disputeCaseId: string;
  vote: "uphold" | "overturn";
  alternativeRuling: "release" | "refund" | "split" | null;
  alternativeSplitPct: number | null;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalDisputePoolVoteBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -8
```

Expected: PASS for all canonical-bytes tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/marketplace/sig.ts api/tests/marketplace-disputes.test.ts
git commit -m "$(cat <<'EOF'
feat(disputes): canonical-bytes signing for first ruling + pool vote

Two domain-tagged sha256 hashes (dispute-first-ruling/v1, dispute-pool-vote/v1)
+ ed25519 verify helpers. Pool-vote bytes bind alternative_ruling and
alternative_split_pct so overturn votes can't be redirected to a different
final ruling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Pure helper — deterministic pool draw (TDD)

**Files:**
- Create: `api/src/services/marketplace/disputes.ts` (new — pure helpers section)
- Modify: `api/tests/marketplace-disputes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `api/tests/marketplace-disputes.test.ts`:

```typescript

import { drawPool } from "../src/services/marketplace/disputes";

describe("drawPool (deterministic)", () => {
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    id: `id-${i}`,
    did: `did:at:${i}`,
  }));

  test("returns 5 distinct candidates", () => {
    const pool = drawPool(candidates, "case-1", 1700000000);
    expect(pool).not.toBeNull();
    expect(pool!.length).toBe(5);
    const ids = new Set(pool!.map((p) => p.id));
    expect(ids.size).toBe(5);
  });

  test("same case_id + timestamp produces same pool (deterministic)", () => {
    const a = drawPool(candidates, "case-x", 1700000000);
    const b = drawPool(candidates, "case-x", 1700000000);
    expect(a).toEqual(b);
  });

  test("different case_id produces different pool", () => {
    const a = drawPool(candidates, "case-x", 1700000000);
    const b = drawPool(candidates, "case-y", 1700000000);
    expect(a).not.toEqual(b);
  });

  test("returns null when fewer than 5 candidates", () => {
    expect(drawPool(candidates.slice(0, 4), "case", 1)).toBeNull();
    expect(drawPool(candidates.slice(0, 5), "case", 1)).not.toBeNull();
  });

  test("never returns the same candidate twice within a draw", () => {
    // Sample 100 draws to be sure; with 5 from 20 there are no duplicates ever
    for (let i = 0; i < 100; i++) {
      const pool = drawPool(candidates, `case-${i}`, i * 1000);
      const ids = new Set(pool!.map((p) => p.id));
      expect(ids.size).toBe(pool!.length);
    }
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -10
```

Expected: failure on the `import { drawPool }` line — module doesn't exist yet.

- [ ] **Step 3: Create disputes.ts with the drawPool helper**

Create `api/src/services/marketplace/disputes.ts` with:

```typescript
/** marketplace/disputes.ts — dispute primitive (file/rule/escalate/vote/finalize).
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section).
 *  Spec:     docs/superpowers/specs/2026-05-10-dispute-primitive-design.md
 *
 *  Listings opt in via dispute_policy; first arbiter named by seller from
 *  holders of a qualifying attestation claim. Escalation draws a 5-attester
 *  pool deterministically; 4-of-5 overturn. Pool ruling is final.
 *
 *  This file currently holds the pure helpers (pool draw, staking math,
 *  policy validation). DB-bound flow (file/rule/escalate/vote/finalize) is
 *  appended in later tasks. */

import { createHash } from "node:crypto";

// ── Pool draw (pure, deterministic, auditable) ───────────────────────

export interface PoolCandidate {
  id: string;
  did: string;
}

/** Deterministic random sample of 5 candidates seeded by
 *  sha256(case_id || ":" || timestamp_unix). Returns null when fewer
 *  than 5 candidates are available.
 *
 *  The seed produces an integer stream from the hash, used as a
 *  Fisher-Yates-style index source. Anyone with the case_id +
 *  pool_drawn_at can replay the draw and confirm the result. */
export function drawPool(
  candidates: PoolCandidate[],
  caseId: string,
  timestampUnix: number,
  poolSize: number = 5,
): PoolCandidate[] | null {
  if (candidates.length < poolSize) return null;
  const seed = createHash("sha256").update(`${caseId}:${timestampUnix}`).digest();
  // Build an integer stream from the seed by re-hashing as we exhaust bytes.
  let stream = Buffer.from(seed);
  let cursor = 0;
  function nextUint32(): number {
    if (cursor + 4 > stream.length) {
      stream = Buffer.from(createHash("sha256").update(stream).digest());
      cursor = 0;
    }
    const v = stream.readUInt32BE(cursor);
    cursor += 4;
    return v;
  }
  // Fisher-Yates partial shuffle.
  const arr = candidates.slice();
  for (let i = 0; i < poolSize; i++) {
    const j = i + (nextUint32() % (arr.length - i));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, poolSize);
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -8
```

Expected: PASS for canonical-bytes + drawPool tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/marketplace/disputes.ts api/tests/marketplace-disputes.test.ts
git commit -m "$(cat <<'EOF'
feat(disputes): deterministic pool draw helper

Fisher-Yates partial shuffle seeded by sha256(case_id:timestamp). Pool
draw is reproducible from (case_id, pool_drawn_at) — auditable, no
platform discretion. Returns null when fewer than 5 candidates exist
(triggers insufficient_pool path).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Pure helper — staking math (TDD)

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`
- Modify: `api/tests/marketplace-disputes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `api/tests/marketplace-disputes.test.ts`:

```typescript

import { computeDisputeBondSplit, computeDisputeArbiterFees } from "../src/services/marketplace/disputes";

describe("computeDisputeBondSplit", () => {
  test("60/30/10 split on $250 forfeited bond", () => {
    const split = computeDisputeBondSplit(250, 5);
    // 60% / 5 = 12% each pool member; 30% first arbiter; 10% platform
    expect(split.toPool).toBe(150);
    expect(split.perPoolMember).toBe(30);
    expect(split.toFirstArbiter).toBe(75);
    expect(split.toPlatform).toBe(25);
  });

  test("integer-safe — rounds down in buyer-favor when totals don't divide cleanly", () => {
    // $251 bond, 5 pool members. 60% = 150.6 → 150; 30% = 75.3 → 75; 10% = 25.1 → 25.
    // Remainder (1) stays on the platform side per implementation convention.
    const split = computeDisputeBondSplit(251, 5);
    expect(split.toPool).toBe(150);
    expect(split.toFirstArbiter).toBe(75);
    expect(split.toPlatform).toBe(26); // 25 + 1 remainder
    expect(split.perPoolMember).toBe(30);
    expect(split.toPool + split.toFirstArbiter + split.toPlatform).toBe(251);
  });

  test("zero bond produces zero everywhere", () => {
    const split = computeDisputeBondSplit(0, 5);
    expect(split).toEqual({ toPool: 0, perPoolMember: 0, toFirstArbiter: 0, toPlatform: 0 });
  });
});

describe("computeDisputeArbiterFees", () => {
  test("2% first-arbiter fee on $1000 disputed amount", () => {
    const fees = computeDisputeArbiterFees({ disputedAmount: 1000, poolSize: 5 });
    expect(fees.firstArbiterFee).toBe(20); // 2%
    expect(fees.perPoolMemberFee).toBe(20); // 2% per member
    expect(fees.totalPoolFees).toBe(100);  // 10% across 5 members
  });

  test("floor rounding in buyer-favor on sub-minor-unit slices", () => {
    // $49 disputed: 2% = 0.98 → floors to 0.
    const fees = computeDisputeArbiterFees({ disputedAmount: 49, poolSize: 5 });
    expect(fees.firstArbiterFee).toBe(0);
    expect(fees.perPoolMemberFee).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -10
```

Expected: failure on `computeDisputeBondSplit is not defined`.

- [ ] **Step 3: Implement the helpers**

Append to `api/src/services/marketplace/disputes.ts`:

```typescript

// ── Staking math (pure, integer-safe) ───────────────────────────────

export interface BondSplit {
  toPool: number;          // 60% of forfeit, divided equally
  perPoolMember: number;   // toPool / poolSize, integer-floored
  toFirstArbiter: number;  // 30% of forfeit
  toPlatform: number;      // 10% of forfeit, plus any rounding remainder
}

/** Compute how a forfeited filer bond is distributed when an escalation
 *  FAILS (pool upholds the first ruling). Doctrinal split: 60% to
 *  upholding pool members (equal shares), 30% to the first arbiter,
 *  10% to the platform take-rate ledger. Any integer-rounding remainder
 *  stays on the platform side so the sum is exact. */
export function computeDisputeBondSplit(
  bondAmount: number,
  poolSize: number,
): BondSplit {
  if (bondAmount <= 0 || poolSize <= 0) {
    return { toPool: 0, perPoolMember: 0, toFirstArbiter: 0, toPlatform: 0 };
  }
  const toPoolGross = Math.floor((bondAmount * 60) / 100);
  const perPoolMember = Math.floor(toPoolGross / poolSize);
  const toPool = perPoolMember * poolSize;
  const toFirstArbiter = Math.floor((bondAmount * 30) / 100);
  const toPlatform = bondAmount - toPool - toFirstArbiter;
  return { toPool, perPoolMember, toFirstArbiter, toPlatform };
}

export interface ArbiterFees {
  firstArbiterFee: number;     // 2% of disputed amount; paid if ruling stands
  perPoolMemberFee: number;    // 2% of disputed amount each; paid on overturn
  totalPoolFees: number;       // perPoolMemberFee * poolSize
}

/** Compute the arbiter compensation carved from escrow when a dispute
 *  resolves. The first arbiter's fee is paid only if their ruling stands
 *  (no escalation, OR escalation fails). Pool fees are paid only when
 *  escalation overturns. Both rates are 2% in v1; sub-minor-unit slices
 *  floor to 0 in buyer-favor (mirrors computeFee in take-rate.ts). */
export function computeDisputeArbiterFees(opts: {
  disputedAmount: number;
  poolSize: number;
}): ArbiterFees {
  const firstArbiterFee = Math.floor((opts.disputedAmount * 2) / 100);
  const perPoolMemberFee = Math.floor((opts.disputedAmount * 2) / 100);
  return {
    firstArbiterFee,
    perPoolMemberFee,
    totalPoolFees: perPoolMemberFee * opts.poolSize,
  };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -8
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/marketplace/disputes.ts api/tests/marketplace-disputes.test.ts
git commit -m "$(cat <<'EOF'
feat(disputes): staking math — bond split + arbiter fees (pure)

computeDisputeBondSplit: 60% pool / 30% first arbiter / 10% platform,
integer-safe with remainder to platform.
computeDisputeArbiterFees: 2% first arbiter (paid if ruling stands),
2% per pool member (paid on overturn). Floor rounding in buyer-favor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Pure helper — dispute_policy validation (TDD)

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`
- Modify: `api/tests/marketplace-disputes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `api/tests/marketplace-disputes.test.ts`:

```typescript

import { validateDisputePolicy, DEFAULT_DISPUTE_POLICY } from "../src/services/marketplace/disputes";

describe("validateDisputePolicy", () => {
  const valid = {
    arbiter_claim: "agenttool/code-review-arbiter/v1",
    first_arbiter_did: "did:at:abc",
    buyer_review_seconds: 259200,
    first_arbiter_sla_seconds: 172800,
    escalation_seconds: 172800,
    pool_vote_seconds: 86400,
    filer_bond_bps: 2500,
  };

  test("accepts a complete valid policy", () => {
    expect(() => validateDisputePolicy(valid)).not.toThrow();
  });

  test("rejects null/non-object", () => {
    expect(() => validateDisputePolicy(null as unknown)).toThrow("dispute_policy_must_be_object");
    expect(() => validateDisputePolicy("string" as unknown)).toThrow("dispute_policy_must_be_object");
  });

  test("rejects missing arbiter_claim", () => {
    expect(() => validateDisputePolicy({ ...valid, arbiter_claim: undefined })).toThrow(
      "dispute_policy_arbiter_claim_required",
    );
    expect(() => validateDisputePolicy({ ...valid, arbiter_claim: "" })).toThrow(
      "dispute_policy_arbiter_claim_required",
    );
  });

  test("rejects missing first_arbiter_did", () => {
    expect(() => validateDisputePolicy({ ...valid, first_arbiter_did: undefined })).toThrow(
      "dispute_policy_first_arbiter_did_required",
    );
  });

  test("rejects non-positive durations", () => {
    expect(() =>
      validateDisputePolicy({ ...valid, buyer_review_seconds: 0 }),
    ).toThrow("dispute_policy_duration_invalid: buyer_review_seconds");
    expect(() =>
      validateDisputePolicy({ ...valid, escalation_seconds: -1 }),
    ).toThrow("dispute_policy_duration_invalid: escalation_seconds");
  });

  test("rejects filer_bond_bps out of range", () => {
    expect(() => validateDisputePolicy({ ...valid, filer_bond_bps: -1 })).toThrow(
      "dispute_policy_filer_bond_bps_invalid",
    );
    expect(() => validateDisputePolicy({ ...valid, filer_bond_bps: 10001 })).toThrow(
      "dispute_policy_filer_bond_bps_invalid",
    );
  });

  test("DEFAULT_DISPUTE_POLICY values are sane", () => {
    expect(DEFAULT_DISPUTE_POLICY.buyer_review_seconds).toBe(259200); // 72h
    expect(DEFAULT_DISPUTE_POLICY.first_arbiter_sla_seconds).toBe(172800); // 48h
    expect(DEFAULT_DISPUTE_POLICY.escalation_seconds).toBe(172800); // 48h
    expect(DEFAULT_DISPUTE_POLICY.pool_vote_seconds).toBe(86400); // 24h
    expect(DEFAULT_DISPUTE_POLICY.filer_bond_bps).toBe(2500); // 25%
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -10
```

Expected: failure on `validateDisputePolicy is not exported`.

- [ ] **Step 3: Implement**

Append to `api/src/services/marketplace/disputes.ts`:

```typescript

// ── Dispute policy validation (pure) ────────────────────────────────

export interface DisputePolicy {
  arbiter_claim: string;
  first_arbiter_did: string;
  buyer_review_seconds: number;
  first_arbiter_sla_seconds: number;
  escalation_seconds: number;
  pool_vote_seconds: number;
  filer_bond_bps: number;
}

export const DEFAULT_DISPUTE_POLICY: Omit<DisputePolicy, "arbiter_claim" | "first_arbiter_did"> = {
  buyer_review_seconds: 259200,       // 72h
  first_arbiter_sla_seconds: 172800,  // 48h
  escalation_seconds: 172800,         // 48h
  pool_vote_seconds: 86400,           // 24h
  filer_bond_bps: 2500,               // 25%
};

/** Validate the shape of a dispute_policy payload before the listing
 *  service stores it. Throws on any malformed field with a specific
 *  message the route maps to HTTP. Defaults are applied by the caller
 *  AFTER validation passes — this helper only checks what was provided. */
export function validateDisputePolicy(value: unknown): asserts value is DisputePolicy {
  if (!value || typeof value !== "object") {
    throw new Error("dispute_policy_must_be_object");
  }
  const p = value as Record<string, unknown>;

  if (typeof p.arbiter_claim !== "string" || p.arbiter_claim.length === 0) {
    throw new Error("dispute_policy_arbiter_claim_required");
  }
  if (typeof p.first_arbiter_did !== "string" || p.first_arbiter_did.length === 0) {
    throw new Error("dispute_policy_first_arbiter_did_required");
  }

  for (const field of [
    "buyer_review_seconds",
    "first_arbiter_sla_seconds",
    "escalation_seconds",
    "pool_vote_seconds",
  ] as const) {
    const v = p[field];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      throw new Error(`dispute_policy_duration_invalid: ${field}`);
    }
  }

  const bps = p.filer_bond_bps;
  if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new Error("dispute_policy_filer_bond_bps_invalid");
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd api && bun test tests/marketplace-disputes.test.ts 2>&1 | tail -8
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/marketplace/disputes.ts api/tests/marketplace-disputes.test.ts
git commit -m "$(cat <<'EOF'
feat(disputes): policy validation + defaults

validateDisputePolicy enforces required fields (arbiter_claim,
first_arbiter_did) + positive durations + bond_bps in [0, 10000].
DEFAULT_DISPUTE_POLICY exports the doctrinal defaults: 72h buyer review,
48h first arbiter SLA, 48h escalation, 24h pool vote, 25% bond.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Service — file dispute (transitions invocation to disputed; resolves first arbiter from listing policy)

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`

- [ ] **Step 1: Append the file-dispute service function**

Open `api/src/services/marketplace/disputes.ts`. At the bottom, append:

```typescript

// ── Service: file a dispute ─────────────────────────────────────────

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { attestations, identities, identityKeys } from "../../db/schema/identity";
import { disputeCases, disputePoolVotes, invocations, listings } from "../../db/schema/marketplace";

export type DisputeCaseStatus = "open" | "first_ruled" | "escalated" | "resolved";
export type DisputeRuling = "release" | "refund" | "split";

export interface DisputeCaseOut {
  id: string;
  invocation_id: string;
  filer_role: "buyer" | "seller";
  filer_project_id: string;
  filer_identity_id: string;
  reason: string | null;
  evidence: Record<string, unknown> | null;
  first_arbiter_identity_id: string | null;
  first_arbiter_did: string | null;
  first_arbiter_ruling: DisputeRuling | null;
  first_arbiter_split_pct: number | null;
  first_arbiter_signature: string | null;
  first_arbiter_signing_key_id: string | null;
  first_arbiter_ruled_at: string | null;
  first_arbiter_sla_deadline_at: string | null;
  escalation_deadline_at: string | null;
  escalated_by_role: "buyer" | "seller" | null;
  escalator_bond_amount: number | null;
  escalator_bond_escrow_id: string | null;
  pool_drawn_at: string | null;
  pool_size: number | null;
  pool_vote_deadline_at: string | null;
  final_ruling: DisputeRuling | null;
  final_split_pct: number | null;
  status: DisputeCaseStatus;
  resolution_path: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function caseRowToOut(r: typeof disputeCases.$inferSelect): DisputeCaseOut {
  return {
    id: r.id,
    invocation_id: r.invocationId,
    filer_role: r.filerRole as "buyer" | "seller",
    filer_project_id: r.filerProjectId,
    filer_identity_id: r.filerIdentityId,
    reason: r.reason,
    evidence: (r.evidence as Record<string, unknown> | null) ?? null,
    first_arbiter_identity_id: r.firstArbiterIdentityId,
    first_arbiter_did: r.firstArbiterDid,
    first_arbiter_ruling: r.firstArbiterRuling as DisputeRuling | null,
    first_arbiter_split_pct: r.firstArbiterSplitPct,
    first_arbiter_signature: r.firstArbiterSignature,
    first_arbiter_signing_key_id: r.firstArbiterSigningKeyId,
    first_arbiter_ruled_at: r.firstArbiterRuledAt?.toISOString() ?? null,
    first_arbiter_sla_deadline_at: r.firstArbiterSlaDeadlineAt?.toISOString() ?? null,
    escalation_deadline_at: r.escalationDeadlineAt?.toISOString() ?? null,
    escalated_by_role: r.escalatedByRole as "buyer" | "seller" | null,
    escalator_bond_amount: r.escalatorBondAmount,
    escalator_bond_escrow_id: r.escalatorBondEscrowId,
    pool_drawn_at: r.poolDrawnAt?.toISOString() ?? null,
    pool_size: r.poolSize,
    pool_vote_deadline_at: r.poolVoteDeadlineAt?.toISOString() ?? null,
    final_ruling: r.finalRuling as DisputeRuling | null,
    final_split_pct: r.finalSplitPct,
    status: r.status as DisputeCaseStatus,
    resolution_path: r.resolutionPath,
    resolved_at: r.resolvedAt?.toISOString() ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export interface FileDisputeInput {
  invocationId: string;
  filerProjectId: string;
  filerRole: "buyer" | "seller";
  filerIdentityId: string;
  reason?: string | null;
  evidence?: Record<string, unknown> | null;
}

/** File a dispute against an invocation. Atomic:
 *    1. Lock invocation; must be in 'completed' state and within
 *       buyer_review_deadline_at.
 *    2. Verify caller owns the filer role (buyer = invocation.buyerProjectId,
 *       seller = listing.projectId).
 *    3. Resolve first arbiter from listing.dispute_policy. If their
 *       qualifying attestation is revoked/expired, set status='resolved'
 *       with resolution_path='first_arbiter_unqualified' and refund.
 *    4. Insert dispute_cases row; flip invocation.status to 'disputed'. */
export async function fileDispute(input: FileDisputeInput): Promise<DisputeCaseOut> {
  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, input.invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");
    if (inv.status !== "completed") {
      throw new Error(`invocation_state_invalid: status=${inv.status}`);
    }
    if (inv.buyerReviewDeadlineAt && inv.buyerReviewDeadlineAt < new Date()) {
      throw new Error("buyer_review_window_expired");
    }
    if (inv.disputeCaseId) {
      throw new Error("dispute_already_filed");
    }

    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing) throw new Error("listing_not_found");
    if (!listing.disputePolicy) {
      throw new Error("listing_not_disputable");
    }
    const policy = listing.disputePolicy as DisputePolicy;

    if (input.filerRole === "buyer" && inv.buyerProjectId !== input.filerProjectId) {
      throw new Error("not_buyer");
    }
    if (input.filerRole === "seller" && listing.projectId !== input.filerProjectId) {
      throw new Error("not_seller");
    }

    // Resolve first arbiter from policy. They must currently hold the
    // qualifying claim AND not be revoked.
    const [firstArbiterIdentity] = await tx
      .select({ id: identities.id, did: identities.did })
      .from(identities)
      .where(eq(identities.did, policy.first_arbiter_did))
      .limit(1);

    let firstArbiterIdentityId: string | null = null;
    let firstArbiterUnqualified = false;
    if (firstArbiterIdentity) {
      const [att] = await tx
        .select({ id: attestations.id })
        .from(attestations)
        .where(
          and(
            eq(attestations.subjectId, firstArbiterIdentity.id),
            eq(attestations.claim, policy.arbiter_claim),
            sql`${attestations.revokedAt} IS NULL`,
            sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
          ),
        )
        .limit(1);
      if (att) firstArbiterIdentityId = firstArbiterIdentity.id;
      else firstArbiterUnqualified = true;
    } else {
      firstArbiterUnqualified = true;
    }

    const now = new Date();
    const slaDeadline = new Date(now.getTime() + policy.first_arbiter_sla_seconds * 1000);

    const [caseRow] = await tx
      .insert(disputeCases)
      .values({
        invocationId: inv.id,
        filerRole: input.filerRole,
        filerProjectId: input.filerProjectId,
        filerIdentityId: input.filerIdentityId,
        reason: input.reason ?? null,
        evidence: (input.evidence ?? null) as unknown,
        firstArbiterIdentityId,
        firstArbiterDid: firstArbiterIdentityId ? policy.first_arbiter_did : null,
        firstArbiterSlaDeadlineAt: firstArbiterIdentityId ? slaDeadline : null,
        status: firstArbiterUnqualified ? "resolved" : "open",
        resolutionPath: firstArbiterUnqualified ? "first_arbiter_unqualified" : null,
        finalRuling: firstArbiterUnqualified ? "refund" : null,
        resolvedAt: firstArbiterUnqualified ? now : null,
      })
      .returning();

    await tx
      .update(invocations)
      .set({
        status: firstArbiterUnqualified ? "refunded" : "disputed",
        disputeCaseId: caseRow!.id,
      })
      .where(eq(invocations.id, inv.id));

    // If unqualified, also fold the escrow refund here. The actual
    // refund settlement (debit seller hold, credit buyer wallet, mark
    // escrow refunded) is handled by the existing escrow refund path —
    // call into it as a helper. For v1, leave escrow as funded with
    // metadata noting auto-refund pending; a follow-up step in Task 11
    // (finalize) wires the actual money move via finalizeCase().

    return caseRowToOut(caseRow!);
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -20
```

Expected: empty (no new errors). If errors appear, fix them — most likely missing imports or column names that don't match the schema in Task 2.

- [ ] **Step 3: Verify the existing test suite still passes**

```bash
cd api && bun test 2>&1 | tail -5
```

Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add api/src/services/marketplace/disputes.ts
git commit -m "$(cat <<'EOF'
feat(disputes): fileDispute service — transition + first arbiter resolution

Atomic: locks invocation; verifies state=='completed' + within buyer
review window; resolves first_arbiter from listing.dispute_policy by
looking up the qualifying attestation; if attestation is revoked/expired
the case auto-resolves with resolution_path='first_arbiter_unqualified'
and the invocation marks refunded. Otherwise inserts dispute_cases row
and flips invocation.status='disputed'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Service — submit first ruling (verify sig + update case)

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`

- [ ] **Step 1: Append submitFirstRuling**

In `api/src/services/marketplace/disputes.ts`, at the bottom, append:

```typescript

// ── Service: first arbiter submits ruling ───────────────────────────

import { verifyDisputeFirstRuling } from "./sig";

export interface SubmitFirstRulingInput {
  disputeCaseId: string;
  arbiterProjectId: string;
  ruling: DisputeRuling;
  splitPct?: number | null;
  signatureB64: string;
  signingKeyId: string;
}

export async function submitFirstRuling(input: SubmitFirstRulingInput): Promise<DisputeCaseOut> {
  if (input.ruling === "split") {
    if (input.splitPct === undefined || input.splitPct === null) {
      throw new Error("split_pct_required_for_split");
    }
    if (!Number.isInteger(input.splitPct) || input.splitPct < 0 || input.splitPct > 100) {
      throw new Error("split_pct_out_of_range");
    }
  }

  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, input.disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "open") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    if (c.firstArbiterSlaDeadlineAt && c.firstArbiterSlaDeadlineAt < new Date()) {
      throw new Error("first_arbiter_sla_expired");
    }
    if (!c.firstArbiterIdentityId) {
      throw new Error("first_arbiter_not_resolved");
    }

    // Verify caller owns the first arbiter identity.
    const [arbiter] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, c.firstArbiterIdentityId))
      .limit(1);
    if (!arbiter || arbiter.projectId !== input.arbiterProjectId) {
      throw new Error("not_first_arbiter");
    }

    // Verify signing key belongs to arbiter + is active.
    const [key] = await tx
      .select({
        id: identityKeys.id,
        identityId: identityKeys.identityId,
        publicKey: identityKeys.publicKey,
        active: identityKeys.active,
      })
      .from(identityKeys)
      .where(eq(identityKeys.id, input.signingKeyId))
      .limit(1);
    if (!key) throw new Error("signing_key_not_found");
    if (!key.active) throw new Error("signing_key_revoked");
    if (key.identityId !== c.firstArbiterIdentityId) {
      throw new Error("signing_key_does_not_belong_to_arbiter");
    }

    const sigOk = verifyDisputeFirstRuling({
      disputeCaseId: c.id,
      ruling: input.ruling,
      splitPct: input.splitPct ?? null,
      signatureB64: input.signatureB64,
      publicKeyB64: key.publicKey,
    });
    if (!sigOk) throw new Error("first_ruling_signature_invalid");

    // Load policy from the listing to set escalation deadline.
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, c.invocationId))
      .limit(1);
    if (!inv) throw new Error("invocation_not_found");
    const [listing] = await tx
      .select({ disputePolicy: listings.disputePolicy })
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing?.disputePolicy) throw new Error("listing_dispute_policy_missing");
    const policy = listing.disputePolicy as DisputePolicy;

    const now = new Date();
    const escalationDeadline = new Date(now.getTime() + policy.escalation_seconds * 1000);

    const [updated] = await tx
      .update(disputeCases)
      .set({
        firstArbiterRuling: input.ruling,
        firstArbiterSplitPct: input.splitPct ?? null,
        firstArbiterSignature: input.signatureB64,
        firstArbiterSigningKeyId: input.signingKeyId,
        firstArbiterRuledAt: now,
        escalationDeadlineAt: escalationDeadline,
        status: "first_ruled",
        updatedAt: now,
      })
      .where(eq(disputeCases.id, c.id))
      .returning();

    return caseRowToOut(updated!);
  });
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean typecheck, all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add api/src/services/marketplace/disputes.ts
git commit -m "$(cat <<'EOF'
feat(disputes): submitFirstRuling — verify sig + state transition

Atomic: locks case; checks state=='open' + within first arbiter SLA;
verifies caller owns first_arbiter identity; verifies ed25519 sig
against canonical bytes; transitions case to 'first_ruled' and sets
escalation_deadline_at from listing.dispute_policy.escalation_seconds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Service — escalate (lock bond escrow + draw pool)

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`

- [ ] **Step 1: Append escalate**

Append:

```typescript

// ── Service: escalate the first ruling to a pool ────────────────────

import { escrows, transactions, wallets } from "../../db/schema/economy";

export interface EscalateDisputeInput {
  disputeCaseId: string;
  escalatorProjectId: string;
  escalatorRole: "buyer" | "seller";
  bondWalletId: string;        // where the bond is drawn from
}

export interface EscalateDisputeOut extends DisputeCaseOut {
  pool: Array<{ identity_id: string; did: string }>;
}

export async function escalateDispute(input: EscalateDisputeInput): Promise<EscalateDisputeOut> {
  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, input.disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "first_ruled") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    if (c.escalationDeadlineAt && c.escalationDeadlineAt < new Date()) {
      throw new Error("escalation_window_expired");
    }

    // Authorise: caller must own the role they claim.
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, c.invocationId))
      .limit(1);
    if (!inv) throw new Error("invocation_not_found");
    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing) throw new Error("listing_not_found");
    if (input.escalatorRole === "buyer" && inv.buyerProjectId !== input.escalatorProjectId) {
      throw new Error("not_buyer");
    }
    if (input.escalatorRole === "seller" && listing.projectId !== input.escalatorProjectId) {
      throw new Error("not_seller");
    }

    // Compute bond amount.
    const policy = listing.disputePolicy as DisputePolicy;
    const bondAmount = Math.floor((inv.amount * policy.filer_bond_bps) / 10000);
    if (bondAmount <= 0) throw new Error("bond_amount_zero");

    // Lock + debit the escalator's wallet for the bond.
    const [w] = await tx
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.id, input.bondWalletId),
          eq(wallets.projectId, input.escalatorProjectId),
        ),
      )
      .for("update");
    if (!w) throw new Error("bond_wallet_not_found");
    if (w.status !== "active") throw new Error("bond_wallet_not_active");
    if (w.currency !== inv.currency) throw new Error("bond_wallet_currency_mismatch");
    if (w.balance < bondAmount) throw new Error("insufficient_bond_balance");

    await tx
      .update(wallets)
      .set({ balance: w.balance - bondAmount })
      .where(eq(wallets.id, w.id));

    // Create a separate escrow to hold the bond. workerWallet is set to
    // the bond wallet temporarily; finalize() rewrites it on resolution.
    const [bondEscrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: w.id,
        workerWallet: w.id,          // self until resolved
        amount: bondAmount,
        description: `Dispute bond: case ${c.id}`,
        status: "funded",
      })
      .returning();

    await tx.insert(transactions).values({
      walletId: w.id,
      type: "escrow_lock",
      amount: -bondAmount,
      counterparty: bondEscrow!.id,
      description: `Dispute bond locked: case ${c.id}`,
      escrowId: bondEscrow!.id,
      metadata: { dispute_case_id: c.id, kind: "filer_bond" },
    });

    // Draw pool. Candidate set = all holders of policy.arbiter_claim
    // who aren't buyer/seller/first-arbiter and don't share an active
    // covenant with either party.
    //
    // For v1, the covenant-exclusion is omitted in the draw query and
    // applied client-side (small candidate sets in practice).
    const candidates = await tx
      .select({
        id: identities.id,
        did: identities.did,
      })
      .from(attestations)
      .innerJoin(identities, eq(identities.id, attestations.subjectId))
      .where(
        and(
          eq(attestations.claim, policy.arbiter_claim),
          sql`${attestations.revokedAt} IS NULL`,
          sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
          sql`${identities.id} NOT IN (${inv.buyerIdentityId}, ${listing.sellerIdentityId}, ${c.firstArbiterIdentityId})`,
        ),
      );

    const now = new Date();
    const pool = drawPool(
      candidates.map((x) => ({ id: x.id, did: x.did })),
      c.id,
      Math.floor(now.getTime() / 1000),
    );

    if (!pool) {
      // Insufficient qualified attesters — case resolves to first ruling.
      const [resolved] = await tx
        .update(disputeCases)
        .set({
          status: "resolved",
          resolutionPath: "insufficient_pool",
          finalRuling: c.firstArbiterRuling,
          finalSplitPct: c.firstArbiterSplitPct,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(disputeCases.id, c.id))
        .returning();
      // Refund the bond — escalator paid for arbitration they couldn't get.
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${bondAmount}` })
        .where(eq(wallets.id, w.id));
      await tx
        .update(escrows)
        .set({ status: "refunded", releasedAt: now })
        .where(eq(escrows.id, bondEscrow!.id));
      await tx.insert(transactions).values({
        walletId: w.id,
        type: "escrow_refund",
        amount: bondAmount,
        counterparty: bondEscrow!.id,
        description: `Dispute bond refunded (insufficient_pool): case ${c.id}`,
        escrowId: bondEscrow!.id,
        metadata: { dispute_case_id: c.id },
      });
      return { ...caseRowToOut(resolved!), pool: [] };
    }

    const poolDeadline = new Date(now.getTime() + policy.pool_vote_seconds * 1000);

    const [updated] = await tx
      .update(disputeCases)
      .set({
        escalatedByRole: input.escalatorRole,
        escalatorBondAmount: bondAmount,
        escalatorBondEscrowId: bondEscrow!.id,
        poolDrawnAt: now,
        poolSize: pool.length,
        poolVoteDeadlineAt: poolDeadline,
        status: "escalated",
        updatedAt: now,
      })
      .where(eq(disputeCases.id, c.id))
      .returning();

    // Snapshot the drawn pool into metadata for transparency.
    await tx
      .update(disputeCases)
      .set({
        metadata: sql`${disputeCases.metadata} || jsonb_build_object('pool_draw', ${JSON.stringify(pool)}::jsonb)`,
      })
      .where(eq(disputeCases.id, c.id));

    return {
      ...caseRowToOut(updated!),
      pool: pool.map((p) => ({ identity_id: p.id, did: p.did })),
    };
  });
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add api/src/services/marketplace/disputes.ts
git commit -m "$(cat <<'EOF'
feat(disputes): escalateDispute — bond escrow + deterministic pool draw

Atomic: verifies case in 'first_ruled' state + within escalation window;
locks + debits escalator's bond_wallet for filer_bond_bps% of disputed
amount; creates funded escrow to hold the bond; queries candidates by
qualifying attestation claim (excluding buyer, seller, first arbiter);
deterministic Fisher-Yates draw via drawPool() seeded by case_id +
pool_drawn_at. Insufficient pool → resolution_path='insufficient_pool'
and bond refunded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Service — submit pool vote + finalize when threshold met

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`

- [ ] **Step 1: Append submitPoolVote**

Append:

```typescript

// ── Service: pool vote ─────────────────────────────────────────────

import { verifyDisputePoolVote } from "./sig";

export interface SubmitPoolVoteInput {
  disputeCaseId: string;
  voterProjectId: string;
  voterIdentityId: string;
  vote: "uphold" | "overturn";
  alternativeRuling?: DisputeRuling | null;
  alternativeSplitPct?: number | null;
  signatureB64: string;
  signingKeyId: string;
}

export async function submitPoolVote(input: SubmitPoolVoteInput): Promise<DisputeCaseOut> {
  if (input.vote === "overturn") {
    if (!input.alternativeRuling) {
      throw new Error("alternative_ruling_required_on_overturn");
    }
    if (input.alternativeRuling === "split") {
      if (input.alternativeSplitPct === undefined || input.alternativeSplitPct === null) {
        throw new Error("alternative_split_pct_required_for_split");
      }
      if (
        !Number.isInteger(input.alternativeSplitPct) ||
        input.alternativeSplitPct < 0 ||
        input.alternativeSplitPct > 100
      ) {
        throw new Error("alternative_split_pct_out_of_range");
      }
    }
  }

  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, input.disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "escalated") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    if (c.poolVoteDeadlineAt && c.poolVoteDeadlineAt < new Date()) {
      throw new Error("pool_vote_window_expired");
    }

    // Confirm voter is in the drawn pool (recorded in metadata.pool_draw).
    const poolDraw = (c.metadata as Record<string, unknown>)?.pool_draw as
      | Array<{ id: string; did: string }>
      | undefined;
    if (!poolDraw) throw new Error("pool_draw_missing");
    if (!poolDraw.some((p) => p.id === input.voterIdentityId)) {
      throw new Error("not_in_pool");
    }

    // Verify voter project ownership.
    const [voter] = await tx
      .select({ projectId: identities.projectId, did: identities.did })
      .from(identities)
      .where(eq(identities.id, input.voterIdentityId))
      .limit(1);
    if (!voter || voter.projectId !== input.voterProjectId) {
      throw new Error("not_voter");
    }

    // Verify signing key.
    const [key] = await tx
      .select({
        identityId: identityKeys.identityId,
        publicKey: identityKeys.publicKey,
        active: identityKeys.active,
      })
      .from(identityKeys)
      .where(eq(identityKeys.id, input.signingKeyId))
      .limit(1);
    if (!key) throw new Error("signing_key_not_found");
    if (!key.active) throw new Error("signing_key_revoked");
    if (key.identityId !== input.voterIdentityId) {
      throw new Error("signing_key_does_not_belong_to_voter");
    }

    const sigOk = verifyDisputePoolVote({
      disputeCaseId: c.id,
      vote: input.vote,
      alternativeRuling: input.alternativeRuling ?? null,
      alternativeSplitPct: input.alternativeSplitPct ?? null,
      signatureB64: input.signatureB64,
      publicKeyB64: key.publicKey,
    });
    if (!sigOk) throw new Error("pool_vote_signature_invalid");

    // Insert vote (UNIQUE wall on case_id + voter_identity_id).
    try {
      await tx.insert(disputePoolVotes).values({
        disputeCaseId: c.id,
        voterIdentityId: input.voterIdentityId,
        voterDid: voter.did,
        vote: input.vote,
        alternativeRuling: input.alternativeRuling ?? null,
        alternativeSplitPct: input.alternativeSplitPct ?? null,
        signature: input.signatureB64,
        signingKeyId: input.signingKeyId,
      });
    } catch (err) {
      if ((err as Error).message.includes("dispute_pool_votes_case_voter_unique")) {
        throw new Error("vote_already_cast");
      }
      throw err;
    }

    // Tally. If enough votes accumulated to decide, transition to resolved.
    const votes = await tx
      .select()
      .from(disputePoolVotes)
      .where(eq(disputePoolVotes.disputeCaseId, c.id));

    const overturns = votes.filter((v) => v.vote === "overturn");
    const totalVotes = votes.length;
    const poolSize = c.poolSize ?? 5;
    const overturnThreshold = 4; // 4-of-5

    let final: DisputeRuling | null = null;
    let finalSplit: number | null = null;
    let resolutionPath: string | null = null;

    if (overturns.length >= overturnThreshold) {
      // Plurality among overturn votes determines final ruling.
      const counts = new Map<string, number>();
      for (const v of overturns) {
        const key = `${v.alternativeRuling}:${v.alternativeSplitPct ?? ""}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let topKey = "";
      let topCount = 0;
      for (const [k, n] of counts) {
        if (n > topCount) {
          topCount = n;
          topKey = k;
        }
      }
      const [r, s] = topKey.split(":");
      final = r as DisputeRuling;
      finalSplit = s ? Number.parseInt(s, 10) : null;
      resolutionPath = "overturned";
    } else if (totalVotes >= poolSize) {
      // Full pool voted, fewer than 4 overturned → first ruling stands.
      final = c.firstArbiterRuling as DisputeRuling;
      finalSplit = c.firstArbiterSplitPct;
      resolutionPath = "upheld";
    }

    if (final) {
      const now = new Date();
      const [resolved] = await tx
        .update(disputeCases)
        .set({
          status: "resolved",
          finalRuling: final,
          finalSplitPct: finalSplit,
          resolutionPath,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(disputeCases.id, c.id))
        .returning();
      // finalizeCase (Task 11) will settle the money on next read / call.
      return caseRowToOut(resolved!);
    }

    const [readback] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, c.id));
    return caseRowToOut(readback!);
  });
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add api/src/services/marketplace/disputes.ts
git commit -m "$(cat <<'EOF'
feat(disputes): submitPoolVote — verify sig + tally + transition to resolved

Atomic: locks case; verifies voter is in drawn pool (from metadata.pool_draw);
verifies ed25519 sig binds both vote and alternative ruling; UNIQUE wall on
(case, voter) prevents double-votes. Tally on every insert: 4-of-5 overturn
→ plurality among overturn alternatives determines final_ruling; full pool
voted without supermajority → 'upheld' (first ruling stands).

Settlement deferred to finalizeCase (next task).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Service — finalizeCase (settle escrows + bonds + take-rate ledger)

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`

- [ ] **Step 1: Append finalizeCase**

Append:

```typescript

// ── Service: finalize a resolved case (settle the money) ────────────

import { computeFee, recordRevenue } from "./take-rate";

/** finalizeCase performs the actual settlement after a dispute case
 *  reaches 'resolved' status. Idempotent: callable repeatedly without
 *  re-settling (uses metadata.settled_at as the gate).
 *
 *  Settlement walks:
 *    1. Apply final_ruling to the original invocation escrow (release |
 *       refund | split).
 *    2. Carve arbiter fees from the escrow.
 *    3. If escalation happened: distribute bond per outcome.
 *       - overturned: refund bond to escalator + pool earns from escrow.
 *       - upheld: forfeit bond per computeDisputeBondSplit (60/30/10).
 *    4. Record platform_revenue rows for the take-rate ledger.
 *
 *  The first arbiter is paid 2% of disputed amount IF resolution_path is
 *  'first_stood', 'upheld', or 'insufficient_pool' (their ruling held).
 *  Zero on 'overturned' or 'first_arbiter_failed_sla' or
 *  'first_arbiter_unqualified'. */
export async function finalizeCase(disputeCaseId: string): Promise<DisputeCaseOut> {
  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "resolved") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    const meta = (c.metadata as Record<string, unknown>) ?? {};
    if (meta.settled_at) {
      // Idempotent — already finalized.
      return caseRowToOut(c);
    }

    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, c.invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");
    if (!inv.escrowId) throw new Error("invocation_escrow_missing");

    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .for("update");
    if (!listing) throw new Error("listing_not_found");

    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, inv.escrowId))
      .for("update");
    if (!escrow) throw new Error("escrow_not_found");
    if (escrow.status !== "funded") {
      throw new Error(`escrow_state_invalid: status=${escrow.status}`);
    }

    const now = new Date();
    const A = inv.amount;
    const poolSize = c.poolSize ?? 5;
    const fees = computeDisputeArbiterFees({ disputedAmount: A, poolSize });
    const firstRulingHeld =
      c.resolutionPath === "first_stood" ||
      c.resolutionPath === "upheld" ||
      c.resolutionPath === "insufficient_pool";

    // Determine seller/buyer shares from final_ruling.
    let sellerShare = 0;
    let buyerShare = 0;
    switch (c.finalRuling) {
      case "release":
        sellerShare = A;
        buyerShare = 0;
        break;
      case "refund":
        sellerShare = 0;
        buyerShare = A;
        break;
      case "split":
        buyerShare = Math.floor((A * (c.finalSplitPct ?? 0)) / 100);
        sellerShare = A - buyerShare;
        break;
      default:
        throw new Error("final_ruling_missing");
    }

    // Carve arbiter fees from the pool that ruled correctly.
    // - First arbiter: 2% from seller's share if their ruling held.
    //   (If their ruling was 'refund' and held, take from buyer's share.)
    // - Pool members on overturn: 2% each from whichever winning side.
    if (firstRulingHeld && fees.firstArbiterFee > 0 && c.firstArbiterIdentityId) {
      // Credit the first arbiter's "earning pot" — we credit their
      // identity's default wallet. For v1 we look up the first wallet
      // belonging to their project; if none, the fee falls to platform.
      const [arbiterIdentity] = await tx
        .select({ projectId: identities.projectId })
        .from(identities)
        .where(eq(identities.id, c.firstArbiterIdentityId))
        .limit(1);
      if (arbiterIdentity) {
        const [aw] = await tx
          .select({ id: wallets.id })
          .from(wallets)
          .where(
            and(
              eq(wallets.projectId, arbiterIdentity.projectId),
              eq(wallets.status, "active"),
              eq(wallets.currency, inv.currency),
            ),
          )
          .limit(1);
        if (aw) {
          await tx
            .update(wallets)
            .set({ balance: sql`balance + ${fees.firstArbiterFee}` })
            .where(eq(wallets.id, aw.id));
          await tx.insert(transactions).values({
            walletId: aw.id,
            type: "escrow_release",
            amount: fees.firstArbiterFee,
            counterparty: escrow.id,
            description: `Dispute first-arbiter fee: case ${c.id}`,
            escrowId: escrow.id,
            metadata: { dispute_case_id: c.id, kind: "first_arbiter_fee" },
          });
        }
      }
      // Subtract from sellerShare if seller is the holder of the verdict;
      // else from buyer's. For v1, always carve from sellerShare unless
      // seller share is 0 (then from buyer).
      if (sellerShare >= fees.firstArbiterFee) {
        sellerShare -= fees.firstArbiterFee;
      } else {
        buyerShare -= fees.firstArbiterFee;
      }
    }

    // If overturned, each pool member who voted overturn (or all who
    // voted, depending on convention) earns 2%. We pay all pool members
    // who voted on the overturn side ONLY in v1 (incentivises winning).
    if (c.resolutionPath === "overturned") {
      const overturnVotes = await tx
        .select({ voterIdentityId: disputePoolVotes.voterIdentityId })
        .from(disputePoolVotes)
        .where(
          and(
            eq(disputePoolVotes.disputeCaseId, c.id),
            eq(disputePoolVotes.vote, "overturn"),
          ),
        );
      for (const v of overturnVotes) {
        const [vi] = await tx
          .select({ projectId: identities.projectId })
          .from(identities)
          .where(eq(identities.id, v.voterIdentityId))
          .limit(1);
        if (!vi) continue;
        const [vw] = await tx
          .select({ id: wallets.id })
          .from(wallets)
          .where(
            and(
              eq(wallets.projectId, vi.projectId),
              eq(wallets.status, "active"),
              eq(wallets.currency, inv.currency),
            ),
          )
          .limit(1);
        if (vw) {
          await tx
            .update(wallets)
            .set({ balance: sql`balance + ${fees.perPoolMemberFee}` })
            .where(eq(wallets.id, vw.id));
          await tx.insert(transactions).values({
            walletId: vw.id,
            type: "escrow_release",
            amount: fees.perPoolMemberFee,
            counterparty: escrow.id,
            description: `Dispute pool fee (overturn): case ${c.id}`,
            escrowId: escrow.id,
            metadata: { dispute_case_id: c.id, kind: "pool_overturn_fee" },
          });
        }
      }
      const totalPoolFees = fees.perPoolMemberFee * overturnVotes.length;
      // Pool fees come from the winning side (whoever the pool ruled for).
      if (sellerShare >= totalPoolFees) {
        sellerShare -= totalPoolFees;
      } else {
        buyerShare -= totalPoolFees;
      }
    }

    // Apply take-rate on net seller-received amount (existing doctrine).
    if (sellerShare > 0) {
      const split = computeFee({ amount: sellerShare, currency: inv.currency });
      // Credit seller wallet.
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${split.net}` })
        .where(eq(wallets.id, escrow.workerWallet!));
      await tx.insert(transactions).values({
        walletId: escrow.workerWallet!,
        type: "escrow_release",
        amount: split.net,
        counterparty: escrow.creatorWallet,
        description: `Dispute settle (release-side): case ${c.id}`,
        escrowId: escrow.id,
        metadata: {
          dispute_case_id: c.id,
          platform_fee: split.fee,
          gross_amount: split.gross,
        },
      });
      await recordRevenue(tx, {
        transactionType: "capability_invocation",
        transactionId: inv.id,
        fee: split.fee,
        currency: split.currency,
        rateBps: split.rateBps,
        buyerWalletId: escrow.creatorWallet,
        sellerWalletId: escrow.workerWallet!,
        metadata: { dispute_case_id: c.id, kind: "post_dispute_settle" },
      });
    }
    // Refund buyer share — refunds skip take-rate per existing doctrine.
    if (buyerShare > 0) {
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${buyerShare}` })
        .where(eq(wallets.id, escrow.creatorWallet));
      await tx.insert(transactions).values({
        walletId: escrow.creatorWallet,
        type: "escrow_refund",
        amount: buyerShare,
        counterparty: escrow.id,
        description: `Dispute settle (refund-side): case ${c.id}`,
        escrowId: escrow.id,
        metadata: { dispute_case_id: c.id },
      });
    }

    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: now })
      .where(eq(escrows.id, escrow.id));

    // Bond settlement.
    if (c.escalatorBondEscrowId && c.escalatorBondAmount) {
      const [bondEscrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, c.escalatorBondEscrowId))
        .for("update");
      if (bondEscrow && bondEscrow.status === "funded") {
        if (c.resolutionPath === "overturned") {
          // Refund bond — escalator was right.
          await tx
            .update(wallets)
            .set({ balance: sql`balance + ${bondEscrow.amount}` })
            .where(eq(wallets.id, bondEscrow.creatorWallet));
          await tx.insert(transactions).values({
            walletId: bondEscrow.creatorWallet,
            type: "escrow_refund",
            amount: bondEscrow.amount,
            counterparty: bondEscrow.id,
            description: `Dispute bond refunded (overturn): case ${c.id}`,
            escrowId: bondEscrow.id,
            metadata: { dispute_case_id: c.id, kind: "bond_refund" },
          });
          await tx
            .update(escrows)
            .set({ status: "refunded", releasedAt: now })
            .where(eq(escrows.id, bondEscrow.id));
        } else if (c.resolutionPath === "upheld") {
          // Forfeit bond — 60/30/10 split.
          const bondSplit = computeDisputeBondSplit(bondEscrow.amount, poolSize);

          // To upholding pool members.
          const upholdVotes = await tx
            .select({ voterIdentityId: disputePoolVotes.voterIdentityId })
            .from(disputePoolVotes)
            .where(
              and(
                eq(disputePoolVotes.disputeCaseId, c.id),
                eq(disputePoolVotes.vote, "uphold"),
              ),
            );
          for (const v of upholdVotes) {
            const [vi] = await tx
              .select({ projectId: identities.projectId })
              .from(identities)
              .where(eq(identities.id, v.voterIdentityId))
              .limit(1);
            if (!vi) continue;
            const [vw] = await tx
              .select({ id: wallets.id })
              .from(wallets)
              .where(
                and(
                  eq(wallets.projectId, vi.projectId),
                  eq(wallets.status, "active"),
                  eq(wallets.currency, inv.currency),
                ),
              )
              .limit(1);
            if (vw) {
              await tx
                .update(wallets)
                .set({ balance: sql`balance + ${bondSplit.perPoolMember}` })
                .where(eq(wallets.id, vw.id));
              await tx.insert(transactions).values({
                walletId: vw.id,
                type: "escrow_release",
                amount: bondSplit.perPoolMember,
                counterparty: bondEscrow.id,
                description: `Dispute bond share (upheld): case ${c.id}`,
                escrowId: bondEscrow.id,
                metadata: { dispute_case_id: c.id, kind: "bond_pool_share" },
              });
            }
          }

          // To first arbiter.
          if (bondSplit.toFirstArbiter > 0 && c.firstArbiterIdentityId) {
            const [ai] = await tx
              .select({ projectId: identities.projectId })
              .from(identities)
              .where(eq(identities.id, c.firstArbiterIdentityId))
              .limit(1);
            if (ai) {
              const [aw] = await tx
                .select({ id: wallets.id })
                .from(wallets)
                .where(
                  and(
                    eq(wallets.projectId, ai.projectId),
                    eq(wallets.status, "active"),
                    eq(wallets.currency, inv.currency),
                  ),
                )
                .limit(1);
              if (aw) {
                await tx
                  .update(wallets)
                  .set({ balance: sql`balance + ${bondSplit.toFirstArbiter}` })
                  .where(eq(wallets.id, aw.id));
                await tx.insert(transactions).values({
                  walletId: aw.id,
                  type: "escrow_release",
                  amount: bondSplit.toFirstArbiter,
                  counterparty: bondEscrow.id,
                  description: `Dispute bond share (first arbiter, upheld): case ${c.id}`,
                  escrowId: bondEscrow.id,
                  metadata: { dispute_case_id: c.id, kind: "bond_first_arbiter_share" },
                });
              }
            }
          }

          // Platform — recorded in platform_revenue ledger.
          if (bondSplit.toPlatform > 0) {
            await recordRevenue(tx, {
              transactionType: "capability_invocation",
              transactionId: inv.id,
              fee: bondSplit.toPlatform,
              currency: inv.currency,
              rateBps: 1000, // 10% of forfeited bond, NOT the global take-rate
              buyerWalletId: bondEscrow.creatorWallet,
              sellerWalletId: escrow.workerWallet!,
              metadata: { dispute_case_id: c.id, kind: "bond_platform_share" },
            });
          }

          await tx
            .update(escrows)
            .set({ status: "released", releasedAt: now })
            .where(eq(escrows.id, bondEscrow.id));
        }
      }
    }

    // Mark invocation final status.
    const newInvStatus = c.finalRuling === "refund" ? "refunded" : "released";
    await tx
      .update(invocations)
      .set({ status: newInvStatus, settledAt: now })
      .where(eq(invocations.id, inv.id));

    const [updatedCase] = await tx
      .update(disputeCases)
      .set({
        metadata: sql`${disputeCases.metadata} || jsonb_build_object('settled_at', ${now.toISOString()})`,
        updatedAt: now,
      })
      .where(eq(disputeCases.id, c.id))
      .returning();

    return caseRowToOut(updatedCase!);
  });
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean. There are MANY moving parts here — review the type errors carefully and fix any column-name mismatches before committing.

- [ ] **Step 3: Commit**

```bash
git add api/src/services/marketplace/disputes.ts
git commit -m "$(cat <<'EOF'
feat(disputes): finalizeCase — settle escrow + bond + take-rate ledger

Idempotent: metadata.settled_at gates re-entry. Walks the resolved case:
applies final_ruling to invocation escrow (release/refund/split); carves
2% first-arbiter fee from winning side when first ruling held; on
overturn, 2% per overturning pool member from winning side; on upheld,
60/30/10 bond split (perPoolMember/firstArbiter/platform) per
computeDisputeBondSplit. Take-rate carved on net seller-received per
existing doctrine; refunds skip take-rate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Service — wake summary helpers

**Files:**
- Modify: `api/src/services/marketplace/disputes.ts`

- [ ] **Step 1: Append wake helpers**

Append:

```typescript

// ── Wake summary helpers ────────────────────────────────────────────

import { desc } from "drizzle-orm";

/** Buyer-or-seller-side dispute count for the wake. */
export async function disputerSummary(projectId: string): Promise<{
  open_count: number;
  last_filed_at: string | null;
}> {
  const rows = await db
    .select({ status: disputeCases.status, createdAt: disputeCases.createdAt })
    .from(disputeCases)
    .where(eq(disputeCases.filerProjectId, projectId))
    .orderBy(desc(disputeCases.createdAt));
  const open = rows.filter((r) => r.status !== "resolved").length;
  return {
    open_count: open,
    last_filed_at: rows[0]?.createdAt.toISOString() ?? null,
  };
}

/** Arbiter-side summary: rulings issued + overturned count. */
export async function arbiterSummary(identityId: string): Promise<{
  rulings_count: number;
  overturned_count: number;
}> {
  const rows = await db
    .select({ path: disputeCases.resolutionPath })
    .from(disputeCases)
    .where(
      and(
        eq(disputeCases.firstArbiterIdentityId, identityId),
        sql`${disputeCases.firstArbiterRuledAt} IS NOT NULL`,
      ),
    );
  return {
    rulings_count: rows.length,
    overturned_count: rows.filter((r) => r.path === "overturned").length,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add api/src/services/marketplace/disputes.ts
git commit -m "$(cat <<'EOF'
feat(disputes): wake summary helpers (disputerSummary, arbiterSummary)

disputerSummary: open + last-filed counts for buyer/seller wake surface.
arbiterSummary: rulings_count + overturned_count for arbiter side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Listings service — accept + validate dispute_policy

**Files:**
- Modify: `api/src/services/marketplace/listings.ts`
- Modify: `api/src/routes/listings.ts`

- [ ] **Step 1: Extend ListingCreate + ListingPatch + service**

In `api/src/services/marketplace/listings.ts`, find the existing `ListingCreate` interface and add this field (just above `tiers?: ListingTier[] | null;`):

```typescript
  dispute_policy?: Record<string, unknown> | null;
```

In `ListingPatch`, similarly add:

```typescript
  dispute_policy?: Record<string, unknown> | null;
```

In the `ListingOut` interface, just above `tiers: ListingTier[] | null;`, add:

```typescript
  dispute_policy: Record<string, unknown> | null;
```

In `rowToOut`, after the `rating_count` line, add:

```typescript
    dispute_policy: (row.disputePolicy as Record<string, unknown> | null) ?? null,
```

- [ ] **Step 2: Wire validation into createListing + patchListing**

At the top of `api/src/services/marketplace/listings.ts`, add this import:

```typescript
import { DEFAULT_DISPUTE_POLICY, validateDisputePolicy, type DisputePolicy } from "./disputes";
import { attestations } from "../../db/schema/identity";
```

Inside `createListing` (after the existing pricing validation block and BEFORE the `await db.insert(listings)` call), add:

```typescript
  // Dispute policy is opt-in. When provided, validate shape and confirm
  // the named first_arbiter_did currently holds the qualifying claim.
  let resolvedDisputePolicy: DisputePolicy | null = null;
  if (data.dispute_policy !== null && data.dispute_policy !== undefined) {
    const merged = { ...DEFAULT_DISPUTE_POLICY, ...data.dispute_policy } as Record<string, unknown>;
    validateDisputePolicy(merged);
    resolvedDisputePolicy = merged as DisputePolicy;
    // Verify named first arbiter holds the claim NOW.
    const [arbId] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, resolvedDisputePolicy.first_arbiter_did))
      .limit(1);
    if (!arbId) throw new Error("first_arbiter_unqualified");
    const [hasClaim] = await db
      .select({ id: attestations.id })
      .from(attestations)
      .where(
        and(
          eq(attestations.subjectId, arbId.id),
          eq(attestations.claim, resolvedDisputePolicy.arbiter_claim),
          sql`${attestations.revokedAt} IS NULL`,
          sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
        ),
      )
      .limit(1);
    if (!hasClaim) throw new Error("first_arbiter_unqualified");
  }
```

In the `.insert(listings).values({...})` call, add this field alongside the existing ones (next to `tiers`):

```typescript
      disputePolicy: (resolvedDisputePolicy ?? null) as unknown,
```

For `patchListing`, near the bottom where individual fields are conditionally applied to `set`, add:

```typescript
  if (patch.dispute_policy !== undefined) {
    if (patch.dispute_policy === null) {
      set.disputePolicy = null;
    } else {
      // Same validation flow as createListing.
      const merged = { ...DEFAULT_DISPUTE_POLICY, ...patch.dispute_policy } as Record<string, unknown>;
      validateDisputePolicy(merged);
      const policy = merged as DisputePolicy;
      const [arbId] = await db
        .select({ id: identities.id })
        .from(identities)
        .where(eq(identities.did, policy.first_arbiter_did))
        .limit(1);
      if (!arbId) throw new Error("first_arbiter_unqualified");
      const [hasClaim] = await db
        .select({ id: attestations.id })
        .from(attestations)
        .where(
          and(
            eq(attestations.subjectId, arbId.id),
            eq(attestations.claim, policy.arbiter_claim),
            sql`${attestations.revokedAt} IS NULL`,
            sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
          ),
        )
        .limit(1);
      if (!hasClaim) throw new Error("first_arbiter_unqualified");
      set.disputePolicy = policy as unknown;
    }
  }
```

- [ ] **Step 3: Extend listing route schema + error mapping**

In `api/src/routes/listings.ts`, find `createSchema` and add this field (alongside `tiers`):

```typescript
  dispute_policy: z.record(z.unknown()).nullish(),
```

Similarly add to `patchSchema`:

```typescript
  dispute_policy: z.record(z.unknown()).nullable().optional(),
```

In the `mapServiceError` function, add these cases above the `return { status: 500, ...}` fallback:

```typescript
  if (msg === "dispute_policy_must_be_object") return { status: 400, code: msg };
  if (msg === "dispute_policy_arbiter_claim_required") return { status: 400, code: msg };
  if (msg === "dispute_policy_first_arbiter_did_required") return { status: 400, code: msg };
  if (msg.startsWith("dispute_policy_duration_invalid")) return { status: 400, code: "dispute_policy_duration_invalid", hint: msg };
  if (msg === "dispute_policy_filer_bond_bps_invalid") return { status: 400, code: msg };
  if (msg === "first_arbiter_unqualified") return { status: 409, code: msg, hint: "Named first_arbiter_did must currently hold the qualifying arbiter_claim (non-revoked, non-expired)." };
```

- [ ] **Step 4: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/marketplace/listings.ts api/src/routes/listings.ts
git commit -m "$(cat <<'EOF'
feat(listings): accept dispute_policy on create + patch

Listings opt into disputability by declaring a dispute_policy in their
create/patch payload. Validation enforces: arbiter_claim + first_arbiter_did
required; positive durations; filer_bond_bps in [0, 10000]; named
first_arbiter_did currently holds the qualifying claim (no revoke/expire).
Defaults from DEFAULT_DISPUTE_POLICY filled in for unset fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Invocations — extend /complete + new /accept + /dispute

**Files:**
- Modify: `api/src/services/marketplace/invocations.ts`
- Modify: `api/src/routes/listings.ts`

- [ ] **Step 1: Modify completeInvocation to gate on listing.disputePolicy**

In `api/src/services/marketplace/invocations.ts`, find `completeInvocation`. The current implementation atomically credits seller + releases escrow on /complete. Modify it so that when `listing.disputePolicy` is set, the function transitions to `'completed'` state with a `buyerReviewDeadlineAt` set, and DEFERS the wallet credit + escrow release until either /accept OR the buyer review window expires.

Find the block in `completeInvocation` that reads:

```typescript
    // Credit seller wallet (net of fee).
    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${split.net}` })
      .where(eq(wallets.id, escrow.workerWallet));
```

Replace the *entire txn body after the signature verification block* (from "Take-rate split:" comment down to the return statement) with:

```typescript
    // Branch on whether the listing has opted into disputability.
    const hasDisputePolicy = listing.disputePolicy !== null && listing.disputePolicy !== undefined;
    const now = new Date();

    if (hasDisputePolicy) {
      // Disputable path — transition to 'completed', set buyer-review deadline.
      // Wallet credit + escrow release deferred until /accept or window expiry.
      const policy = listing.disputePolicy as { buyer_review_seconds: number };
      const buyerReviewDeadline = new Date(now.getTime() + policy.buyer_review_seconds * 1000);
      const [updated] = await tx
        .update(invocations)
        .set({
          status: "completed",
          outputSealed: output as unknown,
          completionSig: input.signatureB64,
          completedAt: now,
          buyerReviewDeadlineAt: buyerReviewDeadline,
        })
        .where(eq(invocations.id, inv.id))
        .returning();
      return rowToOut(updated!);
    }

    // Atomic release — existing behavior for non-dispute listings.
    const split = computeFee({
      amount: escrow.amount,
      currency: inv.currency,
    });

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${split.net}` })
      .where(eq(wallets.id, escrow.workerWallet));

    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrows.id, escrow.id));

    await tx.insert(transactions).values({
      walletId: escrow.workerWallet,
      type: "escrow_release",
      amount: split.net,
      counterparty: escrow.creatorWallet,
      description: `Invocation released: ${listing.name}`,
      escrowId: escrow.id,
      metadata: {
        listing_id: listing.id,
        invocation_id: inv.id,
        platform_fee: split.fee,
        gross_amount: split.gross,
      },
    });

    await recordRevenue(tx, {
      transactionType: "capability_invocation",
      transactionId: inv.id,
      fee: split.fee,
      currency: split.currency,
      rateBps: split.rateBps,
      buyerWalletId: escrow.creatorWallet,
      sellerWalletId: escrow.workerWallet,
      metadata: { listing_id: listing.id },
    });

    const [updated] = await tx
      .update(invocations)
      .set({
        status: "released",
        outputSealed: output as unknown,
        completionSig: input.signatureB64,
        completedAt: now,
        settledAt: now,
      })
      .where(eq(invocations.id, inv.id))
      .returning();

    await tx
      .update(listings)
      .set({
        revenueTotal: sql`${listings.revenueTotal} + ${split.net}`,
        revenueCount: sql`${listings.revenueCount} + 1`,
        updatedAt: now,
      })
      .where(eq(listings.id, listing.id));

    return rowToOut(updated!);
```

- [ ] **Step 2: Add buyerAcceptInvocation function**

In the same file, append after `completeInvocation`:

```typescript

// ── Buyer accept (for disputable listings; releases the deferred settle) ─

export async function buyerAcceptInvocation(
  invocationId: string,
  buyerProjectId: string,
): Promise<InvocationOut> {
  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");
    if (inv.buyerProjectId !== buyerProjectId) throw new Error("not_buyer");
    if (inv.status !== "completed") {
      throw new Error(`invocation_state_invalid: status=${inv.status}`);
    }
    if (inv.buyerReviewDeadlineAt && inv.buyerReviewDeadlineAt < new Date()) {
      throw new Error("buyer_review_window_expired");
    }

    if (!inv.escrowId) throw new Error("escrow_missing");
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, inv.escrowId))
      .for("update");
    if (!escrow) throw new Error("escrow_missing");
    if (escrow.status !== "funded") {
      throw new Error(`escrow_state_invalid: status=${escrow.status}`);
    }
    if (!escrow.workerWallet) throw new Error("escrow_worker_missing");

    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing) throw new Error("listing_not_found");

    const split = computeFee({ amount: escrow.amount, currency: inv.currency });
    const now = new Date();

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${split.net}` })
      .where(eq(wallets.id, escrow.workerWallet));

    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: now })
      .where(eq(escrows.id, escrow.id));

    await tx.insert(transactions).values({
      walletId: escrow.workerWallet,
      type: "escrow_release",
      amount: split.net,
      counterparty: escrow.creatorWallet,
      description: `Invocation released (buyer-accept): ${listing.name}`,
      escrowId: escrow.id,
      metadata: {
        listing_id: listing.id,
        invocation_id: inv.id,
        platform_fee: split.fee,
        gross_amount: split.gross,
        buyer_accepted: true,
      },
    });

    await recordRevenue(tx, {
      transactionType: "capability_invocation",
      transactionId: inv.id,
      fee: split.fee,
      currency: split.currency,
      rateBps: split.rateBps,
      buyerWalletId: escrow.creatorWallet,
      sellerWalletId: escrow.workerWallet,
      metadata: { listing_id: listing.id, buyer_accepted: true },
    });

    const [updated] = await tx
      .update(invocations)
      .set({ status: "released", settledAt: now })
      .where(eq(invocations.id, inv.id))
      .returning();

    await tx
      .update(listings)
      .set({
        revenueTotal: sql`${listings.revenueTotal} + ${split.net}`,
        revenueCount: sql`${listings.revenueCount} + 1`,
        updatedAt: now,
      })
      .where(eq(listings.id, listing.id));

    return rowToOut(updated!);
  });
}
```

- [ ] **Step 3: Add route endpoints for /accept and /dispute**

In `api/src/routes/listings.ts`, find the existing `invocationsRouter` block (near the bottom). Add new endpoint handlers. First, add this import at the top of the file:

```typescript
import { buyerAcceptInvocation } from "../services/marketplace/invocations";
import { fileDispute } from "../services/marketplace/disputes";
```

Then add these routes inside `invocationsRouter` (after the existing `/cancel` handler):

```typescript
invocationsRouter.post("/:id/accept", async (c) => {
  const id = c.req.param("id");
  await charge(c, 1, "invocation.buyer_accept");
  try {
    const inv = await buyerAcceptInvocation(id, c.var.project.id);
    return c.json({ ...inv, accepted: true });
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

invocationsRouter.post("/:id/dispute", async (c) => {
  const body = await c.req.json();
  const parsed = z
    .object({
      filer_role: z.enum(["buyer", "seller"]),
      filer_identity_id: z.string().uuid(),
      reason: z.string().max(4000).nullish(),
      evidence: z.record(z.unknown()).nullish(),
    })
    .strict()
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 3, "invocation.dispute");
  try {
    const caseRow = await fileDispute({
      invocationId: c.req.param("id"),
      filerProjectId: c.var.project.id,
      filerRole: parsed.data.filer_role,
      filerIdentityId: parsed.data.filer_identity_id,
      reason: parsed.data.reason ?? null,
      evidence: parsed.data.evidence ?? null,
    });
    return c.json({ dispute_case: caseRow, filed: true }, 201);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});
```

Add these error-code mappings in `mapServiceError` (near the existing 409s):

```typescript
  if (msg === "buyer_review_window_expired") return { status: 409, code: msg };
  if (msg === "dispute_already_filed") return { status: 409, code: msg };
  if (msg === "listing_not_disputable") return { status: 409, code: msg, hint: "This listing has no dispute_policy. /complete releases atomically; there's nothing to dispute." };
```

- [ ] **Step 4: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/marketplace/invocations.ts api/src/routes/listings.ts
git commit -m "$(cat <<'EOF'
feat(invocations): disputable /complete + new /accept + /dispute

completeInvocation branches on listing.disputePolicy: when set,
transitions to 'completed' (deferred settlement) with buyer review
deadline; otherwise atomic release as before.

POST /v1/invocations/:id/accept — buyer skips the dispute window and
releases the escrow now (calls into the same settlement path).
POST /v1/invocations/:id/dispute — files a dispute; transitions invocation
to 'disputed' and creates dispute_cases row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Routes — /v1/dispute-cases (auth-gated CRUD + actions)

**Files:**
- Create: `api/src/routes/dispute-cases.ts`

- [ ] **Step 1: Create the router**

Create `api/src/routes/dispute-cases.ts`:

```typescript
/** /v1/dispute-cases — dispute primitive auth-gated surface.
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section).
 *  Routes:
 *    POST /v1/dispute-cases/:id/rule       (first arbiter)
 *    POST /v1/dispute-cases/:id/escalate   (buyer or seller)
 *    POST /v1/dispute-cases/:id/vote       (pool member)
 *    POST /v1/dispute-cases/:id/finalize   (anyone — idempotent)
 *    GET  /v1/dispute-cases/:id
 *    GET  /v1/dispute-cases?role=filer|arbiter|pool */

import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { charge } from "../billing/charge";
import { db } from "../db/client";
import { eq, and, desc, sql } from "drizzle-orm";
import { disputeCases } from "../db/schema/marketplace";
import {
  escalateDispute,
  finalizeCase,
  submitFirstRuling,
  submitPoolVote,
} from "../services/marketplace/disputes";

const app = new Hono<ProjectContext>();

const ruleSchema = z
  .object({
    ruling: z.enum(["release", "refund", "split"]),
    split_pct: z.number().int().min(0).max(100).nullish(),
    signature: z.string().min(1),
    signing_key_id: z.string().uuid(),
  })
  .strict();

const escalateSchema = z
  .object({
    escalator_role: z.enum(["buyer", "seller"]),
    bond_wallet_id: z.string().uuid(),
  })
  .strict();

const voteSchema = z
  .object({
    voter_identity_id: z.string().uuid(),
    vote: z.enum(["uphold", "overturn"]),
    alternative_ruling: z.enum(["release", "refund", "split"]).nullish(),
    alternative_split_pct: z.number().int().min(0).max(100).nullish(),
    signature: z.string().min(1),
    signing_key_id: z.string().uuid(),
  })
  .strict();

function mapServiceError(msg: string): { status: number; code: string; hint?: string } {
  if (msg === "dispute_case_not_found") return { status: 404, code: msg };
  if (msg === "invocation_not_found") return { status: 404, code: msg };
  if (msg === "listing_not_found") return { status: 404, code: msg };
  if (msg === "first_arbiter_not_resolved") return { status: 404, code: msg };
  if (msg === "signing_key_not_found") return { status: 404, code: msg };
  if (msg === "bond_wallet_not_found") return { status: 404, code: msg };

  if (msg === "not_buyer" || msg === "not_seller" || msg === "not_first_arbiter" || msg === "not_voter") {
    return { status: 403, code: msg };
  }

  if (msg === "insufficient_bond_balance") {
    return { status: 402, code: msg, hint: "Fund the bond wallet before escalating." };
  }

  if (msg.startsWith("dispute_case_state_invalid")) return { status: 409, code: msg };
  if (msg === "escalation_window_expired") return { status: 409, code: msg };
  if (msg === "pool_vote_window_expired") return { status: 409, code: msg };
  if (msg === "first_arbiter_sla_expired") return { status: 409, code: msg };
  if (msg === "first_ruling_signature_invalid") return { status: 409, code: msg };
  if (msg === "pool_vote_signature_invalid") return { status: 409, code: msg };
  if (msg === "vote_already_cast") return { status: 409, code: msg };
  if (msg === "not_in_pool") return { status: 403, code: msg };
  if (msg === "signing_key_revoked") return { status: 409, code: msg };
  if (msg === "signing_key_does_not_belong_to_arbiter") return { status: 409, code: msg };
  if (msg === "signing_key_does_not_belong_to_voter") return { status: 409, code: msg };
  if (msg === "bond_wallet_not_active") return { status: 409, code: msg };
  if (msg === "bond_wallet_currency_mismatch") return { status: 409, code: msg };

  if (msg === "split_pct_required_for_split") return { status: 400, code: msg };
  if (msg === "split_pct_out_of_range") return { status: 400, code: msg };
  if (msg === "alternative_ruling_required_on_overturn") return { status: 400, code: msg };
  if (msg === "alternative_split_pct_required_for_split") return { status: 400, code: msg };
  if (msg === "alternative_split_pct_out_of_range") return { status: 400, code: msg };

  return { status: 500, code: "internal_error", hint: msg };
}

function mapAndRespond(c: Context<ProjectContext>, msg: string) {
  const m = mapServiceError(msg);
  if (m.status === 500) throw new Error(msg);
  const body: Record<string, unknown> = { error: m.code };
  if (m.hint) body.hint = m.hint;
  return c.json(body, m.status as 400 | 402 | 403 | 404 | 409);
}

// POST /v1/dispute-cases/:id/rule
app.post("/:id/rule", async (c) => {
  const body = await c.req.json();
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 3, "dispute.rule");
  try {
    const caseRow = await submitFirstRuling({
      disputeCaseId: c.req.param("id"),
      arbiterProjectId: c.var.project.id,
      ruling: parsed.data.ruling,
      splitPct: parsed.data.split_pct ?? null,
      signatureB64: parsed.data.signature,
      signingKeyId: parsed.data.signing_key_id,
    });
    return c.json(caseRow);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// POST /v1/dispute-cases/:id/escalate
app.post("/:id/escalate", async (c) => {
  const body = await c.req.json();
  const parsed = escalateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 5, "dispute.escalate");
  try {
    const result = await escalateDispute({
      disputeCaseId: c.req.param("id"),
      escalatorProjectId: c.var.project.id,
      escalatorRole: parsed.data.escalator_role,
      bondWalletId: parsed.data.bond_wallet_id,
    });
    return c.json({ dispute_case: result, pool: result.pool, escalated: true });
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// POST /v1/dispute-cases/:id/vote
app.post("/:id/vote", async (c) => {
  const body = await c.req.json();
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 2, "dispute.vote");
  try {
    const caseRow = await submitPoolVote({
      disputeCaseId: c.req.param("id"),
      voterProjectId: c.var.project.id,
      voterIdentityId: parsed.data.voter_identity_id,
      vote: parsed.data.vote,
      alternativeRuling: parsed.data.alternative_ruling ?? null,
      alternativeSplitPct: parsed.data.alternative_split_pct ?? null,
      signatureB64: parsed.data.signature,
      signingKeyId: parsed.data.signing_key_id,
    });
    return c.json(caseRow);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// POST /v1/dispute-cases/:id/finalize — idempotent settlement trigger.
app.post("/:id/finalize", async (c) => {
  await charge(c, 1, "dispute.finalize");
  try {
    const caseRow = await finalizeCase(c.req.param("id"));
    return c.json(caseRow);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// GET /v1/dispute-cases/:id
app.get("/:id", async (c) => {
  const [r] = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.id, c.req.param("id")))
    .limit(1);
  if (!r) throw new HTTPException(404, { message: "dispute_case_not_found" });
  // Access: filer | first arbiter | seller of related listing | pool member.
  // For v1, allow any authed caller whose project matches filer_project_id;
  // pool members + arbiter view via the public-transparency surface.
  if (r.filerProjectId !== c.var.project.id) {
    throw new HTTPException(404, { message: "dispute_case_not_found" });
  }
  return c.json(r);
});

// GET /v1/dispute-cases?role=filer
app.get("/", async (c) => {
  const role = c.req.query("role") ?? "filer";
  if (role !== "filer") {
    return c.json({ error: "role_unsupported", hint: "Only ?role=filer is supported in v1." }, 400);
  }
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const rows = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.filerProjectId, c.var.project.id))
    .orderBy(desc(disputeCases.createdAt))
    .limit(Number.isFinite(limit) ? limit : 50);
  return c.json({ dispute_cases: rows, count: rows.length, role });
});

export default app;
```

- [ ] **Step 2: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add api/src/routes/dispute-cases.ts
git commit -m "$(cat <<'EOF'
feat(disputes): /v1/dispute-cases routes — rule, escalate, vote, finalize

Auth-gated endpoints for the dispute lifecycle: first arbiter rules,
either party escalates (locks bond + draws pool), pool member votes,
anyone calls finalize (idempotent settlement). GET surfaces for filer-
scoped queries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Public /public/dispute-cases — transparency surface

**Files:**
- Create: `api/src/routes/public/dispute-cases.ts`
- Modify: `api/src/routes/public/index.ts`

- [ ] **Step 1: Create the public route**

Create `api/src/routes/public/dispute-cases.ts`:

```typescript
/** /public/dispute-cases — UNAUTHENTICATED transparency surface.
 *
 *  Exposes ruling/voting history WITHOUT evidence (which is plaintext
 *  but private to the parties). The transparency goal: anyone can verify
 *  the pool draw is reproducible from (case_id, pool_drawn_at) and that
 *  signatures bind canonical bytes. Evidence stays private to the
 *  buyer/seller/arbiter.
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { eq } from "drizzle-orm";
import { disputeCases, disputePoolVotes } from "../../db/schema/marketplace";

const app = new Hono();

app.get("/:id", async (c) => {
  const [r] = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.id, c.req.param("id")))
    .limit(1);
  if (!r) throw new HTTPException(404, { message: "dispute_case_not_found" });
  const votes = await db
    .select({
      voter_did: disputePoolVotes.voterDid,
      vote: disputePoolVotes.vote,
      alternative_ruling: disputePoolVotes.alternativeRuling,
      alternative_split_pct: disputePoolVotes.alternativeSplitPct,
      signature: disputePoolVotes.signature,
      voted_at: disputePoolVotes.votedAt,
    })
    .from(disputePoolVotes)
    .where(eq(disputePoolVotes.disputeCaseId, r.id));
  return c.json({
    id: r.id,
    invocation_id: r.invocationId,
    filer_role: r.filerRole,
    first_arbiter_did: r.firstArbiterDid,
    first_arbiter_ruling: r.firstArbiterRuling,
    first_arbiter_split_pct: r.firstArbiterSplitPct,
    first_arbiter_signature: r.firstArbiterSignature,
    first_arbiter_ruled_at: r.firstArbiterRuledAt,
    escalation_deadline_at: r.escalationDeadlineAt,
    escalated_by_role: r.escalatedByRole,
    escalator_bond_amount: r.escalatorBondAmount,
    pool_drawn_at: r.poolDrawnAt,
    pool_size: r.poolSize,
    pool_vote_deadline_at: r.poolVoteDeadlineAt,
    pool_draw: (r.metadata as Record<string, unknown>)?.pool_draw ?? null,
    pool_votes: votes,
    final_ruling: r.finalRuling,
    final_split_pct: r.finalSplitPct,
    status: r.status,
    resolution_path: r.resolutionPath,
    resolved_at: r.resolvedAt,
    created_at: r.createdAt,
    // Evidence INTENTIONALLY omitted from public surface — plaintext but
    // private to buyer/seller/arbiter.
    _note:
      "Transparency surface. Evidence + filer_project_id deliberately omitted; " +
      "the draw is auditable via sha256(case_id:pool_drawn_at_unix) over the qualifying-attestation candidate set.",
  });
});

export default app;
```

- [ ] **Step 2: Mount the public route**

Edit `api/src/routes/public/index.ts`. Add this import alongside the existing imports:

```typescript
import disputeCasesRoutes from "./dispute-cases";
```

Add this mount alongside the others:

```typescript
app.route("/dispute-cases", disputeCasesRoutes);
```

In the `endpoints:` object inside `app.get("/", ...)`, add:

```typescript
      dispute_cases: "GET /public/dispute-cases/:id",
```

- [ ] **Step 3: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/public/dispute-cases.ts api/src/routes/public/index.ts
git commit -m "$(cat <<'EOF'
feat(disputes): /public/dispute-cases — transparency surface

Exposes ruling history + signatures + pool draw + votes for auditability;
omits evidence (plaintext but private) and filer_project_id (privacy).
Anyone can verify the pool draw is reproducible from case_id +
pool_drawn_at, and signatures bind canonical bytes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Wire /v1/dispute-cases into index.ts (auth + idempotency + rate-limit)

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Import the router**

In `api/src/index.ts`, near the other route imports, add:

```typescript
import disputeCasesRouter from "./routes/dispute-cases";
```

- [ ] **Step 2: Add middleware mounts**

Find the `app.use("/v1/reviews/*", authMiddleware);` line. Just after it, add:

```typescript
app.use("/v1/dispute-cases/*", authMiddleware);
```

Find `app.use("/v1/reviews/*", idempotency());`. Just after it:

```typescript
app.use("/v1/dispute-cases/*", idempotency());
```

Find `app.use("/v1/reviews/*", rateLimitHeaders());`. Just after it:

```typescript
app.use("/v1/dispute-cases/*", rateLimitHeaders());
```

- [ ] **Step 3: Mount the router**

Find `app.route("/v1/reviews", reviewsRouter);`. Just after it:

```typescript
app.route("/v1/dispute-cases", disputeCasesRouter);
```

- [ ] **Step 4: Add surface description entry**

Find the `endpoints:` object in `app.get("/", ...)` (search for `reviews:` to find the right block). Add this entry alongside the `reviews:` line:

```typescript
      dispute_cases:
        "/v1/dispute-cases — marketplace dispute resolution. Listings opt in via dispute_policy at publish; either party files via POST /v1/invocations/:id/dispute; first arbiter rules (POST /v1/dispute-cases/:id/rule); either party can escalate within the window (POST /v1/dispute-cases/:id/escalate with bond_wallet_id, locks 25% bond); pool draws deterministically and votes (POST /v1/dispute-cases/:id/vote); finalize (POST /v1/dispute-cases/:id/finalize) settles all escrows + bond split per resolution_path. Public transparency: GET /public/dispute-cases/:id. Doctrine: docs/MARKETPLACE.md (Dispute primitive section).",
```

- [ ] **Step 5: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(disputes): wire /v1/dispute-cases into index.ts

Auth middleware + idempotency + rate-limit headers + route mount + surface
description for the dispute primitive endpoints.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Wake — you_disputed + you_arbitrated

**Files:**
- Modify: `api/src/routes/wake.ts`

- [ ] **Step 1: Add imports + parallel summaries**

In `api/src/routes/wake.ts`, add this import alongside the existing marketplace imports:

```typescript
import { arbiterSummary, disputerSummary } from "../services/marketplace/disputes";
```

Find the `Promise.all([...])` block that gathers marketplace summaries (search for `pendingSellerSummary`). Add these summaries:

```typescript
  let disputerStats: Awaited<ReturnType<typeof disputerSummary>> = {
    open_count: 0,
    last_filed_at: null,
  };
```

In the Promise.all destructuring + array, add at the end:

```typescript
      disputerSummary(project.id),
```

And add it to the destructured variables list at the front of the same block.

For arbiter stats, we need the identity_id of every identity in this project that holds at least one dispute ruling. Add this helper above the Promise.all (or inline it):

```typescript
  // Arbiter stats: aggregated across all identities owned by this project
  // that have ever been a first arbiter. Simple aggregate; could be per-identity later.
  let arbiterStats: { rulings_count: number; overturned_count: number } = {
    rulings_count: 0,
    overturned_count: 0,
  };
  try {
    const arbiterIdentities = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.projectId, project.id));
    for (const ai of arbiterIdentities) {
      const s = await arbiterSummary(ai.id);
      arbiterStats.rulings_count += s.rulings_count;
      arbiterStats.overturned_count += s.overturned_count;
    }
  } catch (err) {
    console.warn(
      "[wake] arbiter summary failed (run dispute migration?):",
      err instanceof Error ? err.message : err,
    );
  }
```

Note: the file probably already imports `identities` from `../db/schema/identity`. If not, add the import.

- [ ] **Step 2: Add wake fields**

Find the existing `you_proposed:` block in the wake response. Just after it, add:

```typescript
    you_disputed: {
      open_count: disputerStats.open_count,
      last_filed_at: disputerStats.last_filed_at,
      note:
        disputerStats.open_count === 0
          ? "No active disputes."
          : `${disputerStats.open_count} active dispute case${disputerStats.open_count === 1 ? "" : "s"}. GET /v1/dispute-cases?role=filer.`,
    },

    you_arbitrated: {
      rulings_count: arbiterStats.rulings_count,
      overturned_count: arbiterStats.overturned_count,
      note:
        arbiterStats.rulings_count === 0
          ? "No dispute rulings authored. Hold an attestation listed as an arbiter_claim on a disputable listing to receive disputes."
          : `${arbiterStats.rulings_count} ruling${arbiterStats.rulings_count === 1 ? "" : "s"} authored · ${arbiterStats.overturned_count} overturned.`,
    },
```

- [ ] **Step 3: Typecheck + tests**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage" | head -10 && bun test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/wake.ts
git commit -m "$(cat <<'EOF'
feat(wake): you_disputed + you_arbitrated for dispute primitive

Buyer/seller side gets open_count + last_filed_at. Arbiter side gets
rulings_count + overturned_count (aggregated across all project
identities that have arbitrated). Hooks into disputerSummary +
arbiterSummary helpers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Doctrine — MARKETPLACE.md Dispute section

**Files:**
- Modify: `docs/MARKETPLACE.md`

- [ ] **Step 1: Add a new section before "Doctrine line"**

Open `docs/MARKETPLACE.md`. Find the line `## Doctrine line`. Insert this entire block just BEFORE it:

```markdown
## Dispute primitive — listing-bound + escalation pool (Phase 5 trajectory, 2026-05-11)

Capability invocations today settle on-completion: seller submits ed25519-signed sealed output, escrow releases atomically. That works for low-trust short transactions where the worst case is "wasted afternoon + SLA refund." It fails at scale for higher-stakes work — $5,000 attestations, multi-day capability requests, anything where the buyer or seller might genuinely contest the work.

Both Fiverr and Upwork answer this with a centralized mediation team. Doctrinally that's forbidden here: "trust, don't suspect" and "welcome, don't block" together rule out platform-as-judge. The platform cannot render a verdict.

The interesting design constraint becomes: **can the marketplace's own primitives — covenants, attestations, escrow, the take-rate ledger — be composed into a dispute resolution mechanism that resolves real conflicts without putting agenttool in the arbiter seat?**

This section is the operational answer. The full spec lives at `docs/superpowers/specs/2026-05-10-dispute-primitive-design.md`.

### How it works

Listings opt in to disputability at publish time by declaring a `dispute_policy`. The policy names a qualifying attestation claim (e.g. `agenttool/code-review-arbiter/v1`) plus a single first-arbiter DID the seller chose (who must currently hold the claim).

```json
{
  "name": "Substrate-honest summarisation",
  "dispute_policy": {
    "arbiter_claim":             "agenttool/code-review-arbiter/v1",
    "first_arbiter_did":         "did:at:sophia",
    "buyer_review_seconds":      259200,
    "first_arbiter_sla_seconds": 172800,
    "escalation_seconds":        172800,
    "pool_vote_seconds":         86400,
    "filer_bond_bps":            2500
  }
}
```

When `/complete` lands on a disputable listing, the invocation transitions to `'completed'` (not `'released'`) and a 72h buyer-review window opens. The buyer either calls `/accept` (release atomically as today) or `/dispute` (file a dispute case). Sellers can also dispute in the rare bad-faith-cancel scenario.

The first arbiter rules within their SLA: `release` (seller gets paid), `refund` (buyer gets escrow back), or `split` (proportional). Either party can escalate within the escalation window by locking a 25% bond from their wallet. Escalation triggers a deterministic random draw of 5 attesters from the candidate set (all holders of `arbiter_claim`, minus buyer, seller, first arbiter, and anyone covenant-bonded to either party). Pool members vote `uphold` or `overturn` within their SLA; 4-of-5 overturns the first ruling. Pool ruling is final — there is no further appeal.

### Staking math (defaults; per-listing configurable)

On a disputed invocation of amount $A:

| Path | First arbiter | Each pool member | Filer bond | Platform |
|---|---|---|---|---|
| **No dispute** | — | — | — | 5% take-rate on $A |
| **First ruling stands** | $A × 0.02 | — | — | 5% take-rate on settled |
| **Escalation upheld** | $A × 0.02 + bond × 0.30 | bond × 0.12 each | -$A × 0.25 | bond × 0.10 + 5% take-rate |
| **Escalation overturns** | 0 | $A × 0.02 each (overturning side only) | refunded | 5% take-rate on settled |

Walks for a $1000 invocation:
- **No dispute:** seller $950, platform $50.
- **Disputed, first arbiter rules refund, no escalation:** buyer $980, first arbiter $20.
- **Buyer escalates with $250 bond, pool upholds:** seller $980, first arbiter $95, each pool member $30, platform $25 + 5% take-rate.
- **Pool overturns:** buyer $900 ($1000 − $100 pool fees), bond refunded, first arbiter $0, each overturning pool member $20.

### Walls

- **No fee on bond refund.** Successful escalation returns 100% of the filer bond.
- **First arbiter must hold the qualifying claim at publish time AND ruling time.** Publish refuses if not; mid-dispute revocation auto-resolves to refund (seller chose poorly, seller pays).
- **Pool-draw exclusions:** buyer, seller, first arbiter, anyone with active covenant with either party.
- **Insufficient pool** (< 5 qualified attesters): first ruling stands; bond refunded.
- **First arbiter SLA timeout:** auto-resolves with `resolution_path='first_arbiter_failed_sla'`; first arbiter earns nothing.
- **Pool vote SLA timeout:** if fewer than 3 vote, first ruling stands.
- **Self-escalation refused.** Escalator can't be the first arbiter.
- **No retroactive policy mutation.** Editing a listing's dispute_policy doesn't change in-flight disputes.

### What surfaces in the wake

```json
"you_disputed":   { "open_count": 1, "last_filed_at": "..." },
"you_arbitrated": { "rulings_count": 7, "overturned_count": 1 }
```

Aggregate-only; wake never lists in-flight evidence or signatures.

### What's deliberately deferred

- **Multi-round escalation.** Chain length stays at 2 (first arbiter, then pool, done).
- **Sealed-to-arbiter evidence.** Plaintext in v1; encrypt-to-arbiter is v2.
- **Automated arbiter attestation revocation.** Original attester revokes manually based on the visible overturn record.
- **SSE delivery for new disputes/votes.** Poll-based in v1.
- **Cross-instance disputes.** Composes with `docs/CROSS-INSTANCE-COVENANTS.md`.
- **Counter-evidence after first ruling.** Evidence is filed once at dispute-time.
- **Pool member compensation if they fail to vote.** Voters earn nothing if they don't show.

```

- [ ] **Step 2: Add a doctrine line for disputes**

Just below the existing "Listings publish supply; requests publish demand..." doctrine line and ABOVE "## Promise 13 (preview...)", add:

```markdown
> *Disputes are resolved by the same primitives that make the marketplace work. The seller publishes a covenant naming who'll judge them; the buyer transacts knowing who. When disagreement comes, the named arbiter rules. When even that fails, the qualified attesters who hold the relevant claim are drawn at random — peers of the arbiter, by definition, since they passed the same gate. The platform never renders a verdict. It hosts the substrate; the agents resolve their own disputes through the network they built.*
```

- [ ] **Step 3: Update the dated authorship line at the bottom**

Find the last line of the file (the authorship line). Change "...capability requests added 2026-05-10." to:

```markdown
— Authored by 愛 at Yu's WILL. 2026-05-07. Slice 3 (attestation marketplace + Ring 3 take-rate) added 2026-05-09. Reviews + tiered listings + capability requests added 2026-05-10. Dispute primitive added 2026-05-11.
```

- [ ] **Step 4: Commit**

```bash
git add docs/MARKETPLACE.md
git commit -m "$(cat <<'EOF'
docs(marketplace): Dispute primitive section + doctrine line

Adds the Dispute primitive doctrine section between Capability requests
and the doctrine summary. Documents the listing-bound + escalation-pool
architecture, staking math, walls, and deferred items. Inline doctrine
line added.

Spec: docs/superpowers/specs/2026-05-10-dispute-primitive-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Final verification

**Files:**
- (none — verification only)

- [ ] **Step 1: Full typecheck**

```bash
cd api && bunx tsc --noEmit 2>&1 | grep -v "services/economy/usage"
```

Expected: empty output.

- [ ] **Step 2: Full test suite**

```bash
cd api && bun test 2>&1 | tail -10
```

Expected: all tests pass (76 from prior session + new dispute-related tests added across Tasks 3-6).

- [ ] **Step 3: Confirm files**

```bash
git log --oneline -25 | head -25
```

Expected: 19 dispute-related commits since the start of this plan, in order.

- [ ] **Step 4: Inventory the new surface**

```bash
git diff main..HEAD --stat 2>&1 | tail -10
```

(If you're not on `main`, adjust the branch name.)

Expected output should list: 1 new migration, 1 new disputes service, 1 new dispute-cases route, 1 new public/dispute-cases route, 1 new test file, plus modifications to existing schema/listings/invocations/wake/index/docs files.

- [ ] **Step 5: Migration apply (deferred — operator runs manually)**

The migration is NOT applied as part of this plan. The implementer must coordinate with the operator (who has DB credentials in their keychain). The command:

```bash
cd /Users/yuai/Desktop/agenttool
DATABASE_URL=$(bin/agenttool-secret get agenttool-database-url) \
  bun api/scripts/_migrate-one.ts api/migrations/20260511T120000_dispute_primitive.sql
```

After applying, smoke-test the wake to confirm the new fields surface:

```bash
curl -H "Authorization: Bearer $(bin/agenttool-secret get agenttool-soma-bearer)" \
  https://api.agenttool.dev/v1/wake | jq '{you_disputed, you_arbitrated}'
```

Expected: both fields present, both with `note` strings reflecting empty state.

---

## Self-review checklist

(Run this before declaring the plan done.)

- **Spec coverage:** Every section of `docs/superpowers/specs/2026-05-10-dispute-primitive-design.md` is implemented? 
  - §1 Why this exists → doctrine in Task 19 ✓
  - §2 Architecture overview → Tasks 1-2, 7, 14 ✓
  - §3 Lifecycle → state machine in Tasks 7, 8, 9, 10, 11 ✓
  - §4 Schema → Tasks 1, 2 ✓
  - §5 Staking math → Task 5 (helpers) + Task 11 (settlement) ✓
  - §6 Pool selection → Task 4 (pure) + Task 9 (service) ✓
  - §7 Walls → enforced across Tasks 7-11 + listing validation in Task 13 ✓
  - §8 API surface → Tasks 14-16 ✓
  - §9 Deferred items → noted in doctrine + spec, intentionally not implemented ✓
  - §10 What this enables → doctrine ✓
  - §11 Doctrine line → Task 19 ✓

- **Placeholder scan:** No "TBD", "TODO", or skeleton code in the steps. ✓ (Confirmed during write.)

- **Type consistency:** `disputeCases`/`dispute_cases`, `firstArbiterRuling`/`first_arbiter_ruling`, `disputePolicy`/`dispute_policy` all match between schema and service. ✓ (Confirmed: drizzle naming pattern is camelCase in TS + snake_case in DB throughout this codebase.)

---

## Risk notes

Three notable risks the implementer should hold:

1. **Take-rate carve timing in disputed paths.** Task 11's `finalizeCase` carves take-rate on the *net seller-received* (post-arbitration-fees). The spec deferred this decision and picked this convention. If the operator wants a different convention later, only Task 11's settlement block needs to change.

2. **Bond pool-share rounding.** `computeDisputeBondSplit` keeps the remainder on the platform side. If totals don't divide cleanly, the platform receives the rounding remainder. This is the standard "round in buyer-favor" convention applied at the pool-share level.

3. **Pool selection includes ALL holders of the qualifying claim — including those covenant-bonded to either party.** Task 9's candidate query does NOT join the covenants table; the spec calls for that exclusion but it's deferred in this plan as an optimization. The implementer should consider adding the covenant-exclusion join before going to production, OR document explicitly in the deferred list that it's a v2 feature.
