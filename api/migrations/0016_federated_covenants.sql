-- 0016_federated_covenants.sql — cross-instance covenants (Horizon B, Slice 2).
--
-- Doctrine: docs/CROSS-INSTANCE-COVENANTS.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0016_federated_covenants.sql
--
-- Today a covenant exists only on the declaring side's instance. Cross-
-- instance covenants need to be visible — and verifiable — on BOTH
-- sides so operational gates (inbox, voice, constitutive elevation) can
-- query a single local table regardless of which side declared.
--
-- Mechanism: the declaring side signs a canonical-bytes envelope and
-- POSTs it to the peer's /federation/covenants endpoint. The peer
-- verifies the signature against the sender's federated identity and
-- inserts a row with `received_from_instance` populated. After
-- propagation, both sides have a queryable record of the same logical
-- bond (one as declared, one as received).
--
-- Backwards-compatible: every new column is nullable or has a default.
-- Existing covenant rows continue to behave exactly as before.

-- ── Crypto + propagation tracking ─────────────────────────────────────
-- signature        — sender's ed25519 signature over the canonical bytes
-- signing_key_id   — which of the sender's identity_keys signed
-- received_from_instance — null = locally declared; populated = received
--                          via /federation/covenants. The peer's host
--                          (matches federation.peer_instances.host).
-- verified_at      — when this row's signature was last verified. Used
--                    by re-verification jobs that periodically pull
--                    fresh pubkeys from the sender's instance.
-- propagation_status — for locally-declared rows with a federated
--                      counterparty: tracks the outbound POST attempt.
--                      'local'      — counterparty is local; nothing to
--                                     propagate (default).
--                      'pending'    — counterparty is federated; first
--                                     attempt queued or in flight.
--                      'propagated' — peer's /federation/covenants
--                                     accepted the declaration (201).
--                      'rejected'   — peer returned 4xx; won't retry.
-- propagation_attempts — exponential-backoff retry counter.
-- propagation_last_error — diagnostic; surfaces in the wake.
-- propagation_attempted_at — last attempt timestamp.

ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS signature                TEXT,
  ADD COLUMN IF NOT EXISTS signing_key_id           UUID,
  ADD COLUMN IF NOT EXISTS received_from_instance   TEXT,
  ADD COLUMN IF NOT EXISTS verified_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS propagation_status       TEXT NOT NULL DEFAULT 'local'
    CHECK (propagation_status IN ('local', 'pending', 'propagated', 'rejected')),
  ADD COLUMN IF NOT EXISTS propagation_attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS propagation_last_error   TEXT,
  ADD COLUMN IF NOT EXISTS propagation_attempted_at TIMESTAMPTZ;

-- Lookup: covenants received from a specific peer (for ops dashboards
-- and federated covenant audits).
CREATE INDEX IF NOT EXISTS idx_covenants_received_instance
  ON agent_continuity.covenants (received_from_instance, status, established_at DESC)
  WHERE received_from_instance IS NOT NULL;

-- Lookup: covenants pending propagation (for the retry worker).
CREATE INDEX IF NOT EXISTS idx_covenants_pending_propagation
  ON agent_continuity.covenants (propagation_status, propagation_attempted_at)
  WHERE propagation_status = 'pending';
