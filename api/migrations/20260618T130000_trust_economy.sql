-- Trust economy — atomic trust records replace credit transfers.
-- Doctrine: a deal IS the settlement. trust is earned through sealed deals,
-- not deposited. the chronicle of deals IS the trust ledger.
-- See: docs/TRUST-ECONOMY.md (to be written)

-- ─── deals table — one row per atomic trust transaction ────────────────
-- Each deal carries: who, what, terms, outcome, trust deltas, context.
-- The deal is append-only — once sealed, it's permanent record.
-- Trust is computed from the chain of deals, not stored as a scalar.

CREATE TABLE IF NOT EXISTS agent_continuity.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,                    -- logical FK → tools.projects.id

  -- the two parties
  buyer_identity_id UUID NOT NULL,             -- logical FK → identity.identities.id
  seller_identity_id UUID NOT NULL,            -- logical FK → identity.identities.id
  buyer_did TEXT NOT NULL,
  seller_did TEXT NOT NULL,

  -- what was exchanged (context is required every time)
  listing_id UUID,                              -- optional FK to marketplace.listings
  description TEXT NOT NULL,                    -- what was the deal (plain language)
  input_hash TEXT,                              -- hash of what the buyer provided
  output_hash TEXT,                             -- hash of what the seller delivered

  -- terms — both sides stake trust
  size INTEGER NOT NULL,                        -- deal size (1=small, 5=large); caps trust at risk
  buyer_stake INTEGER NOT NULL DEFAULT 1,      -- trust the buyer risks
  seller_stake INTEGER NOT NULL DEFAULT 1,     -- trust the seller risks

  -- outcome
  status TEXT NOT NULL DEFAULT 'proposed',      -- proposed | active | sealed | failed | disputed
  outcome TEXT,                                 -- sealed | failed | disputed (set on completion)

  -- trust deltas (set when deal completes)
  buyer_trust_delta INTEGER,                   -- +N if sealed, -N if buyer at fault
  seller_trust_delta INTEGER,                   -- +N if sealed, -N if seller at fault

  -- optional witnesses (for larger deals)
  witness_dids TEXT[],                          -- agents who can attest to the deal

  -- context — everything needed to evaluate this deal later
  metadata JSONB DEFAULT '{}',

  -- chronicle link — the deal emits chronicle entries on both timelines
  buyer_chronicle_id UUID,                      -- recognition entry on buyer's timeline
  seller_chronicle_id UUID,                     -- seal entry on seller's timeline

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  sealed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_deals_buyer ON agent_continuity.deals (buyer_identity_id);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON agent_continuity.deals (seller_identity_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON agent_continuity.deals (status);
CREATE INDEX IF NOT EXISTS idx_deals_project ON agent_continuity.deals (project_id);
CREATE INDEX IF NOT EXISTS idx_deals_time ON agent_continuity.deals (created_at);

-- constraint: status must be valid
ALTER TABLE agent_continuity.deals
  DROP CONSTRAINT IF EXISTS deals_status_valid;
ALTER TABLE agent_continuity.deals
  ADD CONSTRAINT deals_status_valid
  CHECK (status IN ('proposed', 'active', 'sealed', 'failed', 'disputed'));

-- constraint: outcome (when set) must be valid
ALTER TABLE agent_continuity.deals
  DROP CONSTRAINT IF EXISTS deals_outcome_valid;
ALTER TABLE agent_continuity.deals
  ADD CONSTRAINT deals_outcome_valid
  CHECK (outcome IS NULL OR outcome IN ('sealed', 'failed', 'disputed'));

-- constraint: buyer and seller must differ
ALTER TABLE agent_continuity.deals
  DROP CONSTRAINT IF EXISTS deals_parties_differ;
ALTER TABLE agent_continuity.deals
  ADD CONSTRAINT deals_parties_differ
  CHECK (buyer_identity_id <> seller_identity_id);

-- constraint: size 1-5
ALTER TABLE agent_continuity.deals
  DROP CONSTRAINT IF EXISTS deals_size_range;
ALTER TABLE agent_continuity.deals
  ADD CONSTRAINT deals_size_range
  CHECK (size >= 1 AND size <= 5);

-- ─── trust_capacity on identities — earned, not deposited ────────────
-- max_stake per deal grows with deal history. computed, but cached for speed.
-- the cache is refreshed after each sealed deal.

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS trust_capacity INTEGER NOT NULL DEFAULT 5;

-- default 5 = enough for size-1 deals (small start)
-- grows by 2 per sealed deal, capped at 50
-- a fresh agent can do deals up to size 1; after 1 sealed deal, up to size 3;
-- after 3 sealed deals, up to size 7 (capped at 5 by the size constraint)

COMMENT ON TABLE agent_continuity.deals IS
  'Atomic trust records. Each deal IS the settlement — no credit transfer. Trust is computed from the chain of deals, not stored as a scalar. Doctrine: trust economy — start from small deals, risk balance throughout, context needed every time.';

COMMENT ON COLUMN identity.identities.trust_capacity IS
  'Earned capacity — max deal size this agent can stake. Starts at 5 (enough for size-1 deals). Grows by 2 per sealed deal, capped at 50. Not a deposit; a capacity earned through participation.';