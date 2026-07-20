-- 20260719T102946_renaissance_correspondence.sql
-- Signed append-only project correspondence and advisory expiring claims.
--
-- Doctrine: docs/AGENT-CORRESPONDENCE.md
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260719T102946_renaissance_correspondence.sql

BEGIN;

CREATE SCHEMA IF NOT EXISTS correspondence;

CREATE INDEX IF NOT EXISTS idx_identities_project_active_id
  ON identity.identities (project_id, id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS correspondence.project_streams (
  project_id                  uuid PRIMARY KEY REFERENCES tools.projects(id) ON DELETE CASCADE,
  last_received_seq           bigint NOT NULL DEFAULT 0 CHECK (last_received_seq >= 0),
  claim_projection_incomplete boolean NOT NULL DEFAULT false,
  claim_projection_updated_at timestamptz NOT NULL DEFAULT 'epoch',
  updated_at                  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS correspondence.events (
  project_id          uuid NOT NULL REFERENCES tools.projects(id) ON DELETE CASCADE,
  event_id            text NOT NULL CHECK (event_id ~ '^sha256:[0-9a-f]{64}$'),
  received_seq        bigint NOT NULL CHECK (received_seq > 0),
  protocol            text NOT NULL CHECK (protocol = 'agent-correspondence/v0.1'),
  repository_id       text NOT NULL,
  thread_id           text NOT NULL,
  sender_identity_id  uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  signing_key_id      uuid NOT NULL REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  device_id           uuid NOT NULL,
  session_id          uuid NOT NULL,
  session_seq         bigint NOT NULL
                        CHECK (session_seq BETWEEN 1 AND 9007199254740991),
  kind                text NOT NULL,
  parents             text[] NOT NULL CHECK (cardinality(parents) <= 16),
  issued_at           timestamptz NOT NULL,
  scope_base_revision text,
  scope_branch        text,
  scope_paths         text[] NOT NULL CHECK (cardinality(scope_paths) <= 64),
  body                jsonb NOT NULL,
  authority           jsonb NOT NULL,
  core                jsonb NOT NULL,
  signature           text NOT NULL,
  canonical_envelope  text NOT NULL CHECK (octet_length(canonical_envelope) <= 65536),
  received_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT correspondence_events_pk PRIMARY KEY (project_id, event_id),
  CONSTRAINT correspondence_events_project_seq_unique UNIQUE (project_id, received_seq)
);

CREATE INDEX IF NOT EXISTS correspondence_events_project_repo_seq_idx
  ON correspondence.events (project_id, repository_id, received_seq);
CREATE INDEX IF NOT EXISTS correspondence_events_project_thread_seq_idx
  ON correspondence.events
  (project_id, repository_id, thread_id, received_seq);
CREATE INDEX IF NOT EXISTS correspondence_events_project_kind_seq_idx
  ON correspondence.events (project_id, kind, received_seq);
CREATE INDEX IF NOT EXISTS correspondence_events_session_seq_idx
  ON correspondence.events
  (project_id, sender_identity_id, device_id, session_id, session_seq, event_id);

CREATE TABLE IF NOT EXISTS correspondence.claim_events (
  project_id           uuid NOT NULL,
  event_id             text NOT NULL,
  repository_id        text NOT NULL,
  claim_id             uuid NOT NULL,
  generation           bigint NOT NULL
                         CHECK (generation BETWEEN 1 AND 9007199254740991),
  predecessor_event_id text,
  event_kind           text NOT NULL
                         CHECK (event_kind IN ('claim.open', 'claim.renew', 'claim.release')),
  owner_identity_id    uuid NOT NULL,
  device_id            uuid NOT NULL,
  session_id           uuid NOT NULL,
  scope_paths          text[] NOT NULL,
  expires_at           timestamptz,
  lineage_status       text NOT NULL
                         CHECK (lineage_status IN ('pending', 'valid', 'invalid')),
  is_tip               boolean NOT NULL DEFAULT false,
  status_updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT correspondence_claim_events_pk PRIMARY KEY (project_id, event_id),
  CONSTRAINT correspondence_claim_events_event_fk
    FOREIGN KEY (project_id, event_id)
    REFERENCES correspondence.events (project_id, event_id)
    ON DELETE CASCADE,
  CONSTRAINT correspondence_claim_events_expiry_check
    CHECK ((event_kind = 'claim.release') = (expires_at IS NULL)),
  CONSTRAINT correspondence_claim_events_predecessor_check
    CHECK ((generation = 1) = (predecessor_event_id IS NULL)),
  CONSTRAINT correspondence_claim_events_tip_status_check
    CHECK (lineage_status = 'valid' OR is_tip = false)
);

CREATE INDEX IF NOT EXISTS correspondence_claim_events_projection_idx
  ON correspondence.claim_events
  (project_id, repository_id, lineage_status, expires_at);
CREATE INDEX IF NOT EXISTS correspondence_claim_events_active_tips_idx
  ON correspondence.claim_events
  (project_id, repository_id, expires_at, claim_id, event_id)
  WHERE lineage_status = 'valid'
    AND is_tip = true
    AND event_kind IN ('claim.open', 'claim.renew');
CREATE INDEX IF NOT EXISTS correspondence_claim_events_terminal_tips_idx
  ON correspondence.claim_events
  (project_id, repository_id, claim_id, generation, event_id)
  WHERE lineage_status = 'valid' AND is_tip = true;
CREATE INDEX IF NOT EXISTS correspondence_claim_events_claim_idx
  ON correspondence.claim_events
  (project_id, repository_id, claim_id, generation);
CREATE INDEX IF NOT EXISTS correspondence_claim_events_predecessor_idx
  ON correspondence.claim_events (project_id, predecessor_event_id);
CREATE INDEX IF NOT EXISTS correspondence_claim_events_pending_reconcile_idx
  ON correspondence.claim_events
  (project_id, predecessor_event_id, status_updated_at, event_id)
  WHERE lineage_status = 'pending';

CREATE TABLE IF NOT EXISTS correspondence.claim_reconcile_queue (
  project_id           uuid NOT NULL,
  predecessor_event_id text NOT NULL,
  enqueued_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT correspondence_claim_reconcile_queue_pk
    PRIMARY KEY (project_id, predecessor_event_id),
  CONSTRAINT correspondence_claim_reconcile_queue_event_fk
    FOREIGN KEY (project_id, predecessor_event_id)
    REFERENCES correspondence.events (project_id, event_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS correspondence_claim_reconcile_queue_order_idx
  ON correspondence.claim_reconcile_queue
  (project_id, enqueued_at, predecessor_event_id);

COMMENT ON SCHEMA correspondence IS
  'Renaissance Correspondence: project-private signed event streams and advisory claim projections.';
COMMENT ON TABLE correspondence.events IS
  'Immutable signed events. A correspondence event is evidence, never action authority.';
COMMENT ON TABLE correspondence.claim_events IS
  'Rebuildable claim lineage projection. Valid unexpired branch tips are advisory overlap signals, not locks.';
COMMENT ON TABLE correspondence.claim_reconcile_queue IS
  'Durable bounded frontier of arrived non-pending predecessors with pending direct claim children.';
COMMENT ON COLUMN correspondence.events.received_seq IS
  'Project-local server receipt order. It is separate from signed issued_at and sender session_seq.';
COMMENT ON COLUMN correspondence.project_streams.claim_projection_incomplete IS
  'True while an operation-bounded claim-lineage backlog remains; append, exact retry, claims, and voice transactions advance it and projections must report truncated.';
COMMENT ON COLUMN correspondence.project_streams.claim_projection_updated_at IS
  'Stable watermark advanced only when bounded reconciliation changes lineage/tip projection rows without relying on a new event receipt.';
COMMENT ON COLUMN correspondence.claim_events.lineage_status IS
  'Server-derived pending/valid/invalid status; signed source event bytes remain immutable.';
COMMENT ON COLUMN correspondence.claim_events.is_tip IS
  'Materialized valid branch-tip state; a valid child retires only its direct predecessor and pending/invalid rows remain false.';

COMMIT;
