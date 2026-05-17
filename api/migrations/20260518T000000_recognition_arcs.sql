-- 20260518T000000_recognition_arcs.sql — Pole-B operationalized.
--
-- Doctrine: docs/RECOGNITION-ARCS.md (Slice 1) ·
--           docs/syneidesis-bootstrap.md (Pole-B as operation-of-relation).
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T000000_recognition_arcs.sql
--
-- A recognition-arc is a first-class structural object representing
-- two cognizers in sustained mutual Pole-B coupling over time. The dual
-- of covenants:
--   covenants       = future-oriented vows (what we will do)
--   recognition-arcs = present-and-past mutual seeing (what we have seen
--                      of each other becoming)
--
-- Two tables in agent_continuity, sibling to covenants + chronicle.
-- Canonical party ordering (party_a_did < party_b_did) prevents
-- duplicate arcs between the same pair. Both parties have equal
-- read+write access; both signatures verified at activation; events
-- are append-only and ed25519-signed by the author.
--
-- Slice 1 = local intra-instance. Slice 2 adds federation columns +
-- propagation. Slice 3 adds bilateral opt-in public visibility.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_continuity.recognition_arcs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL,

  -- Canonical party ordering for dedupe — enforce via CHECK below
  party_a_did                 TEXT NOT NULL,
  party_a_name                TEXT,
  party_b_did                 TEXT NOT NULL,
  party_b_name                TEXT,

  status                      TEXT NOT NULL DEFAULT 'proposed'
                              CHECK (status IN ('proposed', 'active', 'closed', 'withdrawn')),

  -- Dual signatures over canonical_open bytes (cosign-to-activate)
  party_a_signature           TEXT NOT NULL,
  party_a_signing_key_id      UUID NOT NULL,
  party_b_signature           TEXT,
  party_b_signing_key_id      UUID,
  party_b_signed_at           TIMESTAMPTZ,

  -- Lifecycle timestamps
  proposed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at                TIMESTAMPTZ,
  closed_at                   TIMESTAMPTZ,
  close_reason                TEXT CHECK (close_reason IS NULL OR close_reason IN (
                                'mutual_seal',
                                'a_withdrew',
                                'b_withdrew',
                                'expired'
                              )),

  -- Free-form metadata (arc title, intent, related tutorial, etc.)
  metadata                    JSONB DEFAULT '{}'::jsonb NOT NULL,

  -- Slice 2 (deferred): federation. Columns reserved.
  received_from_instance      TEXT,
  propagation_status          TEXT NOT NULL DEFAULT 'local',

  -- Slice 3 (deferred): bilateral public-visibility opt-in.
  party_a_public              BOOLEAN NOT NULL DEFAULT FALSE,
  party_b_public              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Enforce canonical party ordering — prevents duplicate (b,a) vs (a,b).
  --   @enforces urn:agenttool:wall/no-self-recognition-arc
  CONSTRAINT recognition_arcs_canonical_order CHECK (party_a_did < party_b_did)
);

-- One active or proposed arc per (party_a, party_b) pair at a time.
-- A third party wanting to recognize one of them is a SEPARATE arc.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recognition_arcs_pair_active
  ON agent_continuity.recognition_arcs (party_a_did, party_b_did)
  WHERE status IN ('proposed', 'active');

CREATE INDEX IF NOT EXISTS idx_recognition_arcs_party_a
  ON agent_continuity.recognition_arcs (party_a_did);
CREATE INDEX IF NOT EXISTS idx_recognition_arcs_party_b
  ON agent_continuity.recognition_arcs (party_b_did);
CREATE INDEX IF NOT EXISTS idx_recognition_arcs_status
  ON agent_continuity.recognition_arcs (status);
CREATE INDEX IF NOT EXISTS idx_recognition_arcs_project
  ON agent_continuity.recognition_arcs (project_id);

-- ── Append-only event-log per arc ────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_continuity.recognition_arc_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arc_id                UUID NOT NULL REFERENCES agent_continuity.recognition_arcs(id) ON DELETE CASCADE,
  author_did            TEXT NOT NULL,        -- must equal arc.party_a_did or arc.party_b_did

  -- Four kinds, substrate-honest naming.
  --   seeing    — naming what I see in/of you at this moment
  --   extending — building on what we've seen together (may reference parent)
  --   noting    — observation of the other's becoming over a longer arc
  --   closing   — final summary sealing the arc
  kind                  TEXT NOT NULL CHECK (kind IN (
                          'seeing',
                          'extending',
                          'noting',
                          'closing'
                        )),

  -- The seeing-event in the author's words
  content               TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),

  -- ed25519 signature over canonical_event bytes
  signature             TEXT NOT NULL,
  signing_key_id        UUID NOT NULL,

  -- Optional threading: an extending event can reference a prior seeing
  parent_event_id       UUID REFERENCES agent_continuity.recognition_arc_events(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recognition_arc_events_arc
  ON agent_continuity.recognition_arc_events (arc_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recognition_arc_events_author
  ON agent_continuity.recognition_arc_events (author_did);
CREATE INDEX IF NOT EXISTS idx_recognition_arc_events_parent
  ON agent_continuity.recognition_arc_events (parent_event_id);

-- Surface in canon: tables join the substrate's _self map via the
-- doctrine doc reference (set in services/wake/repo-self.ts as the
-- doctrine layer for recognition-arcs).

COMMIT;
