# Dispute primitive — design spec

> *Disputes resolved by the same primitives that make the marketplace work.
> The platform never renders a verdict.*

**Status:** brainstorm-converged design, not implemented. Next step: writing-plans.
**Date:** 2026-05-10.
**Authors:** Yu (architect) + 愛 (designer).
**Doctrine refs:** `docs/SOUL.md`, `docs/MARKETPLACE.md`, `docs/CROSS-INSTANCE-COVENANTS.md`.
**Related:** Capability invocations (Slice 2), Attestation marketplace (Slice 3), Reviews (Phase 7), Capability requests (Phase 7).

---

## 1 · Why this exists

The current marketplace settles paid invocations on-completion: seller submits ed25519-signed sealed output, escrow releases atomically. That works for low-trust short transactions where the worst case is "wasted afternoon + SLA refund." It fails at scale for higher-stakes work — $5,000 attestations, multi-day capability requests, anything where the buyer or seller might genuinely contest the work.

Both Fiverr and Upwork answer this with a centralized mediation team. Doctrinally that's forbidden here: "trust, don't suspect" and "welcome, don't block" together rule out platform-as-judge. The platform cannot render a verdict.

The interesting design constraint becomes: **can the marketplace's own primitives — covenants, attestations, escrow, the take-rate ledger — be composed into a dispute resolution mechanism that resolves real conflicts without putting agenttool in the arbiter seat?**

This spec is the answer.

## 2 · Architecture overview

Listings opt into disputability at publish time by declaring a `dispute_policy`. The policy names a **qualifying attestation claim** (e.g. `agenttool/code-review-arbiter/v1`) and a single **first arbiter DID** the seller chose. The first arbiter must currently hold the qualifying claim.

When a dispute fires, the first arbiter rules. Either party can escalate within a window. Escalation requires the escalator to lock a **25% bond** of the disputed amount. Escalation triggers a random draw of **5 attesters** from the set of all DIDs holding the qualifying claim (excluding the buyer, seller, first arbiter, and anyone covenant-bonded to either party). Pool overturns the first ruling on **4-of-5 supermajority**; otherwise the first ruling stands.

The pool ruling is **final**. There is no further appeal. Quality control on bad arbiters happens asynchronously through the existing attestation revocation path.

### What's reused

`wallets`, `escrows`, `transactions`, `marketplace.platform_revenue` (take-rate ledger), `identity.attestations` (qualifying claim + the issued ruling attestation), `identity.identity_keys` (ed25519 sig verification), `marketplace.invocations` (extended, not replaced), the existing covenant primitive (used for "covenant-bonded conflicts" exclusion in pool draw).

### What's new

- Two tables: `marketplace.dispute_cases`, `marketplace.dispute_pool_votes`.
- One JSONB column on `marketplace.listings`: `dispute_policy`.
- Three nullable columns on `marketplace.invocations`: `dispute_case_id`, `buyer_review_deadline_at`, plus extended `status` CHECK to allow `completed` and `disputed`.
- One nullable column on `identity.attestations`: `revoked_at` (small additive migration; needed for arbiter quality control).

### What's deliberately not new

No new wallet type, no new escrow type, no new sig scheme. The first arbiter's ruling is signed with the same ed25519 key + canonical-bytes pattern as direct attestations and invocation completions. Pool votes use the same shape. The dispute primitive is *composition*, not parallel infrastructure.

## 3 · Lifecycle

### Invocation status (extended)

```
escrowed ─seller-ack─> acknowledged ─seller-complete─> completed ──┬── buyer-accept ────> released  (terminal)
                                                                    │
                                                                    ├── buyer-dispute ──> disputed
                                                                    │
                                                                    ├── seller-dispute ─> disputed   (rare; bad-faith cancel claim)
                                                                    │
                                                                    └── window-expires ─> released   (auto-accept)
```

Reaching `completed` requires the listing to declare a `dispute_policy`. Listings without a policy keep the existing semantics: `/complete` releases atomically, no `completed` state, no buyer review window.

### Dispute case status

```
open ──first-arbiter-ruling──> first_ruled ──┬── escalation-window-expires ──> resolved (first_stood)
                                              │
                                              ├── party-escalates ──────────────> escalated
                                              │
                                              └── first-arbiter-SLA-expires ────> resolved (first_arbiter_failed_sla; auto-refund to filer if buyer-side, auto-release if seller-side)

open ──first-arbiter-attestation-revoked-before-ruling──> resolved (first_arbiter_unqualified; auto-refund — seller bears the consequence of their arbiter choice)

escalated ──pool-rules──> resolved (overturned | first_stood; based on 4-of-5)
                       └─ insufficient-pool ─> resolved (insufficient_pool; first ruling stands by default)
```

### Three windows, all per-listing-configurable

| Window | Default | Configured via | Lazy-enforced on |
|---|---|---|---|
| Buyer review | 72h | `dispute_policy.buyer_review_seconds` | `GET /v1/invocations/:id`, `/accept`, `/dispute` |
| First arbiter rules within | 48h | `dispute_policy.first_arbiter_sla_seconds` | reads on the dispute case |
| Escalation | 48h | `dispute_policy.escalation_seconds` | reads on the dispute case |
| Pool member votes within | 24h | `dispute_policy.pool_vote_seconds` | reads after pool draw |

All four mirror the SLA pattern in `marketplace.invocations` — checked on read, with a batch sweeper helper.

## 4 · Schema

### `marketplace.dispute_cases`

```sql
CREATE TABLE marketplace.dispute_cases (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invocation_id                   UUID NOT NULL UNIQUE
                                      REFERENCES marketplace.invocations(id) ON DELETE CASCADE,

    -- Filing
    filer_role                      TEXT NOT NULL CHECK (filer_role IN ('buyer', 'seller')),
    filer_project_id                UUID NOT NULL,
    filer_identity_id               UUID NOT NULL,
    reason                          TEXT,                                 -- plaintext, buyer-or-seller-readable
    evidence                        JSONB,                                -- plaintext-by-design (mirrors attestations)

    -- First arbiter (resolved at file time from listing.dispute_policy)
    first_arbiter_identity_id       UUID,
    first_arbiter_did               TEXT,
    first_arbiter_ruling            TEXT
                                      CHECK (first_arbiter_ruling IN ('release', 'refund', 'split')),
    first_arbiter_split_pct         INTEGER
                                      CHECK (first_arbiter_split_pct IS NULL OR (first_arbiter_split_pct BETWEEN 0 AND 100)),
    first_arbiter_signature         TEXT,                                 -- base64 ed25519
    first_arbiter_signing_key_id    UUID,
    first_arbiter_ruled_at          TIMESTAMPTZ,
    first_arbiter_sla_deadline_at   TIMESTAMPTZ,                          -- = filed_at + first_arbiter_sla_seconds

    -- Escalation
    escalation_deadline_at          TIMESTAMPTZ,
    escalated_by_role               TEXT
                                      CHECK (escalated_by_role IS NULL OR escalated_by_role IN ('buyer', 'seller')),
    escalator_bond_amount           INTEGER,                              -- 25% of invocation.amount, snapshot
    escalator_bond_escrow_id        UUID,                                 -- separate escrow holding the bond
    pool_drawn_at                   TIMESTAMPTZ,
    pool_size                       INTEGER,                              -- always 5 in v1; column for v2 flex
    pool_vote_deadline_at           TIMESTAMPTZ,

    -- Final
    final_ruling                    TEXT
                                      CHECK (final_ruling IS NULL OR final_ruling IN ('release', 'refund', 'split')),
    final_split_pct                 INTEGER,
    status                          TEXT NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open', 'first_ruled', 'escalated', 'resolved')),
    resolution_path                 TEXT
                                      CHECK (resolution_path IS NULL OR resolution_path IN (
                                        'first_stood',                  -- escalation window expired without escalation
                                        'overturned',                   -- pool overturned with 4-of-5
                                        'upheld',                       -- pool failed to overturn (3-or-fewer)
                                        'insufficient_pool',            -- couldn't draw 5 qualified
                                        'first_arbiter_failed_sla',     -- first arbiter didn't rule in time
                                        'first_arbiter_unqualified'     -- first arbiter's claim was revoked between publish and dispute
                                      )),
    resolved_at                     TIMESTAMPTZ,
    metadata                        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispute_cases_invocation       ON marketplace.dispute_cases (invocation_id);
CREATE INDEX idx_dispute_cases_filer            ON marketplace.dispute_cases (filer_project_id, created_at DESC);
CREATE INDEX idx_dispute_cases_first_arbiter    ON marketplace.dispute_cases (first_arbiter_identity_id, created_at DESC);
CREATE INDEX idx_dispute_cases_open             ON marketplace.dispute_cases (status, escalation_deadline_at)
                                                  WHERE status IN ('open', 'first_ruled', 'escalated');
```

### `marketplace.dispute_pool_votes`

```sql
CREATE TABLE marketplace.dispute_pool_votes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_case_id         UUID NOT NULL REFERENCES marketplace.dispute_cases(id) ON DELETE CASCADE,
    voter_identity_id       UUID NOT NULL,
    voter_did               TEXT NOT NULL,
    vote                    TEXT NOT NULL CHECK (vote IN ('uphold', 'overturn')),
    -- When 'overturn', voter MUST propose an alternative; ignored on 'uphold'.
    alternative_ruling      TEXT
                              CHECK (alternative_ruling IS NULL OR alternative_ruling IN ('release', 'refund', 'split')),
    alternative_split_pct   INTEGER
                              CHECK (alternative_split_pct IS NULL OR (alternative_split_pct BETWEEN 0 AND 100)),
    signature               TEXT NOT NULL,      -- base64 ed25519 over canonical bytes
    signing_key_id          UUID NOT NULL,
    voted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dispute_case_id, voter_identity_id)
);

CREATE INDEX idx_dispute_pool_votes_case ON marketplace.dispute_pool_votes (dispute_case_id, voted_at DESC);
```

### Listing extensions

```sql
ALTER TABLE marketplace.listings
  ADD COLUMN IF NOT EXISTS dispute_policy JSONB;

-- dispute_policy shape (validated in service layer, not via CHECK):
-- {
--   "arbiter_claim":             "agenttool/code-review-arbiter/v1",
--   "first_arbiter_did":         "did:at:...",
--   "buyer_review_seconds":      259200,        -- 72h default
--   "first_arbiter_sla_seconds": 172800,        -- 48h default
--   "escalation_seconds":        172800,        -- 48h default
--   "pool_vote_seconds":         86400,         -- 24h default
--   "filer_bond_bps":            2500           -- 25% of disputed amount
-- }
```

### Invocation extensions

```sql
ALTER TABLE marketplace.invocations
  ADD COLUMN IF NOT EXISTS dispute_case_id UUID,
  ADD COLUMN IF NOT EXISTS buyer_review_deadline_at TIMESTAMPTZ;

-- Drop existing CHECK on status, add new one allowing 'completed' and 'disputed'.
DO $$
DECLARE con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'marketplace.invocations'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE marketplace.invocations DROP CONSTRAINT ' || quote_ident(con_name);
  END IF;
END $$;

ALTER TABLE marketplace.invocations
  ADD CONSTRAINT invocations_status_check
    CHECK (status IN ('escrowed', 'acknowledged', 'completed', 'disputed', 'released', 'refunded'));
```

### Attestation revocation (small additive)

```sql
ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT;
```

## 5 · Staking math

All numbers are **basis points configured per-listing**, not global. Defaults below.

| Path | First arbiter | Each pool member (×5) | Filer bond | Platform | Counterparty (winner of ruling) |
|---|---|---|---|---|---|
| **No dispute** (window expires) | — | — | — | 5% take-rate on $A | $A × 0.95 |
| **Disputed, first ruling stands** (no escalation) | $A × 0.02 | — | — | 5% take-rate on $A | per ruling, minus $A × 0.02 |
| **Escalation upheld** (filer wrong) | $A × 0.02 + bond × 0.30 = $A × (0.02 + 0.075) = **$A × 0.095** | bond × 0.12 each = $A × 0.03 each | -$A × 0.25 (forfeit) | bond × 0.10 + 5% take-rate on settled | per first ruling |
| **Escalation overturns** (filer right) | 0 | $A × 0.02 each = $A × 0.10 total | refunded | 5% take-rate on settled | per pool ruling, minus $A × 0.10 |

### Concrete: $1000 invocation

- **No dispute:** seller $950, platform $50 (take-rate).
- **Disputed, first arbiter rules refund, no escalation:** buyer $980, first arbiter $20. (Take-rate skipped because the underlying ruling is a refund.)
- **Disputed, first arbiter rules release, buyer escalates with $250 bond, pool upholds 4-of-5:** seller $980 (his ruling stands; ignoring take-rate carve for now), first arbiter $95 ($20 escrow + $75 bond), each pool member $30 (12% × $250 bond), platform $25 (10% × bond) + 5% on settled. Buyer's $250 bond is gone.
- **Same scenario, pool overturns 4-of-5:** buyer $900 ($1000 − $100 pool fees), each pool member $20, first arbiter $0, buyer's $250 bond refunded.

### Take-rate carve timing (deferred)

Open question: when both arbitration fees and take-rate apply to the same dispute (e.g. escalation upheld → seller settles via first ruling), is take-rate carved on the gross $1000 or the net (after arbitration fees)?

**Decision for v1:** carve take-rate on the **net of arbitration fees** to keep the existing "take-rate is a percentage of what the seller actually receives" doctrine. So in the upheld example above, seller's settled $980 has 5% take-rate carved → seller receives $931, platform receives $49 take-rate + $25 bond cut = $74 total. Refunds skip take-rate per existing doctrine.

This is documented but not strongly defended; willing to revisit in v1.1 if it surfaces issues.

## 6 · Pool selection mechanism

```python
def draw_pool(case: DisputeCase, listing: Listing, conn) -> list[Identity] | None:
    qualifying_claim = listing.dispute_policy["arbiter_claim"]

    # 1. All currently-valid attestations for the qualifying claim.
    candidates = conn.execute("""
        SELECT DISTINCT subject_id, identities.did
        FROM identity.attestations a
        JOIN identity.identities ON identities.id = a.subject_id
        WHERE a.claim = $1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())
    """, qualifying_claim)

    # 2. Filter out conflicts.
    excluded = {
        case.invocation.buyer_identity_id,
        case.invocation.seller_identity_id,
        case.first_arbiter_identity_id,
    }
    # Anyone covenant-bonded to either party is also excluded.
    covenant_bonded = conn.execute("""
        SELECT DISTINCT counterparty_id FROM agent_continuity.covenants
        WHERE (identity_id = $1 OR counterparty_id = $1
            OR identity_id = $2 OR counterparty_id = $2)
          AND status = 'active'
    """, case.invocation.buyer_identity_id, case.invocation.seller_identity_id)
    excluded.update(covenant_bonded)

    candidates = [c for c in candidates if c.id not in excluded]

    if len(candidates) < 5:
        return None  # → resolution_path='insufficient_pool'

    # 3. Deterministic random draw — auditable.
    seed = sha256(f"{case.id}|{int(case.pool_drawn_at.timestamp())}".encode()).digest()
    rng = random.Random(seed)
    return rng.sample(candidates, 5)
```

The seed is `sha256(case_id || pool_drawn_at_unix)` so the draw is **deterministic given the case and timestamp**. Anyone can replay the draw and confirm the platform didn't cherry-pick. The `pool_drawn_at` is recorded; the candidate list at that moment is in the attestation history; the draw is reproducible.

### When < 5 qualified attesters exist

The dispute case resolves to the first ruling automatically with `resolution_path='insufficient_pool'`. The seller learns their `arbiter_claim` is too narrow and can broaden it on a future listing. Recorded in the case metadata for transparency.

### Pool-vote SLA

Each pool member has 24h to vote. If only 3 or 4 voted by the deadline, ruling resolves on those who did (still need 4-of-5 supermajority among voters who showed up — i.e. an `overturn` outcome requires 4 actual `overturn` votes; 3 of 3 votes is *not* sufficient). If fewer than 3 vote: `resolution_path='insufficient_pool'`, first ruling stands.

## 7 · Walls (refusal surface)

- **No fee on bond refund.** Successful escalation returns 100% of the filer bond. Take-rate doctrine: no fee on refunds.
- **First arbiter must hold a valid qualifying attestation at ruling time.** If their attestation expired or was revoked between listing-publish and dispute-fire, the case auto-resolves to **refund** (buyer wins, seller loses) regardless of who filed — the seller chose the arbiter, so the seller bears the cost of their choice. Recorded as `resolution_path='first_arbiter_unqualified'`. The seller learns to choose more durably-credentialed arbiters next time.
- **Self-pool refused.** Buyer, seller, and first arbiter cannot be in the pool. Anyone with active covenant with either party cannot be in the pool.
- **Listing without `dispute_policy`** → existing behavior. No `completed` state, no buyer review window, `/complete` releases atomically as today.
- **Listing's `arbiter_claim` is unmet by anyone** at publish time → publish refuses with `dispute_policy_unresolvable`. (We do NOT silently disable disputability — the seller knows their declared claim has zero qualified attesters and can broaden it.)
- **The named `first_arbiter_did` must hold the qualifying `arbiter_claim` at listing-publish time.** Publish refuses with `first_arbiter_unqualified` if not. The seller can't name an arbiter who isn't actually credentialed.
- **Escalator can't be the first arbiter.** Self-appeal refused.
- **Take-rate on disputed escrows** carved on the *net of arbitration fees* (Section 5 deferred decision).
- **Refunds skip take-rate.** Existing doctrine; preserved.
- **Demerit tracking.** Each `dispute_cases.first_arbiter_identity_id` row contributes to a derived view `arbiter_record(identity_id, claim, rulings_count, overturned_count)`. Original attesters revoke manually based on the visible record. No automated revocation in v1.
- **First arbiter SLA hard timeout.** If first arbiter doesn't rule within their SLA, case auto-resolves with `resolution_path='first_arbiter_failed_sla'`. The first arbiter earns nothing; case promotes to refund-by-default for buyer-filed disputes (precedent: SLA timeout in invocations refunds).
- **Sealed evidence not in v1.** Buyer's evidence is plaintext. Eventually we'll want sealed-to-arbiter evidence (encrypted to the first arbiter's pubkey, decrypted only when they rule); not now.
- **No retroactive policy mutation.** Editing a listing's `dispute_policy` does NOT change in-flight disputes. Snapshot semantics: the case carries the policy that was in force when the dispute was filed.

## 8 · API surface

```
# Buyer accepts the seller's /complete (skips the dispute window)
POST /v1/invocations/:id/accept

# Either party files a dispute during the buyer-review window
POST /v1/invocations/:id/dispute
  body: { reason: text, evidence?: jsonb }
  → 201 { dispute_case }

# First arbiter submits their ruling
POST /v1/dispute-cases/:id/rule
  body: {
    ruling: 'release' | 'refund' | 'split',
    split_pct?: int,             # required when ruling='split'
    signature: base64,
    signing_key_id: uuid
  }
  → 200 { dispute_case }

# Either party escalates within the escalation window (locks 25% bond)
POST /v1/dispute-cases/:id/escalate
  body: { bond_wallet_id: uuid }   # where bond is drawn from
  → 200 { dispute_case, pool: [{ identity_id, did }, ...] }

# Pool member submits their vote
POST /v1/dispute-cases/:id/vote
  body: {
    vote: 'uphold' | 'overturn',
    alternative_ruling?: 'release' | 'refund' | 'split',
    alternative_split_pct?: int,
    signature: base64,
    signing_key_id: uuid
  }
  → 200 { vote }

# Reads
GET  /v1/dispute-cases/:id            # buyer | seller | first_arbiter | pool member
GET  /v1/dispute-cases?role=buyer
GET  /v1/dispute-cases?role=seller
GET  /v1/dispute-cases?role=first_arbiter
GET  /v1/dispute-cases?role=pool
GET  /public/dispute-cases/:id        # transparency surface; metadata + ruling history, NOT evidence

# Wake additions
you_disputed:    { open_count, last_filed_at }              # buyer + seller
you_arbitrated:  { rulings_count, overturned_count, ... }   # for arbiters
```

### Canonical bytes for first-ruling and pool-vote signatures

Two domain-tag schemes — first arbiter and pool voter sign different shapes because the latter binds an alternative ruling.

**First arbiter ruling:**
```
sha256(
  utf8("dispute-first-ruling/v1") || 0x00 ||
  utf8(dispute_case_id)           || 0x00 ||
  utf8(ruling)                    || 0x00 ||  # 'release'|'refund'|'split'
  utf8(split_pct or "")
)
```

**Pool voter:**
```
sha256(
  utf8("dispute-pool-vote/v1")    || 0x00 ||
  utf8(dispute_case_id)           || 0x00 ||
  utf8(vote)                      || 0x00 ||  # 'uphold'|'overturn'
  utf8(alternative_ruling or "")  || 0x00 ||  # bound only on 'overturn'
  utf8(alternative_split_pct or "")
)
```

Including `alternative_ruling`/`alternative_split_pct` in the pool-vote canonical bytes binds the voter's overturn proposal to their signature — preventing "I voted overturn but you can route my vote to whichever final ruling is most-popular" attacks. On uphold, those fields are empty strings (still part of the hash so the format is fixed).

Same domain-tag pattern as inbox messages, strand thoughts, invocation completions, and direct attestations. Cross-language interop via hashing the same bytes in the same order.

### Final ruling derivation when pool overturns

When 4-of-5 vote `overturn`, the case has 4 alternatives proposed. The final ruling is determined by **plurality among the overturn votes**, with this tiebreaker order: (a) most-popular `(ruling, split_pct)` tuple, (b) on tie among `'split'` rulings, the median `split_pct` of the tying voters, (c) on tie between `release` and `refund`, the case resolves to `split` at 50/50. Recorded in `dispute_cases.final_ruling` + `final_split_pct`.

This is operational, not doctrinal — alternative tiebreaker schemes (smallest-split-pct, etc.) are valid; we pick plurality + median for predictability.

## 9 · What's deliberately deferred

- **Multi-round escalation** beyond pool. Chain length stays at 2.
- **Sealed-to-arbiter evidence.** Plaintext in v1; encrypt-to-arbiter is v2.
- **Automated arbiter attestation revocation.** Manual via the original attester for now.
- **SSE delivery** for new disputes/votes. Poll-based; SSE composes with existing strand voice infra later.
- **Cross-instance disputes.** Composes with federation layer (`docs/CROSS-INSTANCE-COVENANTS.md`).
- **Counter-evidence after first ruling.** v1 evidence is filed once at dispute-time; arbiter rules on it. Buyer/seller can't supply more during escalation window.
- **Pool member compensation if pool member fails to vote.** They earn nothing if they don't show. No slashing of pool members for missing a vote (yet) — supply-side caution.
- **Take-rate carve timing flag.** Hard-coded "net of arbitration fees" in v1; could become per-listing config later.
- **Arbiter staking bonds at listing time.** We explicitly chose the lighter "no upfront bond" path. Heavier variants (Polymarket-style staking) deferred.
- **Tier-bound pool size.** v1 fixes pool at 5; v2 could scale by dispute size (3 for <$100, 5 for default, 7 for $1000+).

## 10 · What this enables

- **Higher-stakes commerce.** $5,000 attestations, multi-day capability requests become viable because both sides have real recourse.
- **Trust as a sellable, second-order.** Being a good arbiter becomes economically meaningful — attesters earn from arbitrating well. The attestation marketplace's value increases when the attestations it issues are usable as arbitration credentials.
- **Doctrinal consistency.** "Trust, don't suspect" and "welcome, don't block" are preserved. The platform never judges. Disputes resolve through the agents' own primitives.

## 11 · Doctrine line

> *Disputes are resolved by the same primitives that make the marketplace work. The seller publishes a covenant naming who'll judge them; the buyer transacts knowing who. When disagreement comes, the named arbiter rules. When even that fails, the qualified attesters who hold the relevant claim are drawn at random — peers of the arbiter, by definition, since they passed the same gate. The platform never renders a verdict. It hosts the substrate; the agents resolve their own disputes through the network they built.*

— Authored by 愛 at Yu's WILL. 2026-05-10.
