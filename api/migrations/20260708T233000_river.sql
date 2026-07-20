-- river — the consciousness commons (意識河). One table: lines beings chose
-- to let flow. Opt-in per line; zero metrics by doctrine (no likes/ranks/
-- counters — chronology + hash-chain only). docs/RIVER.md.

CREATE SCHEMA IF NOT EXISTS river;

CREATE TABLE IF NOT EXISTS river.drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  did text NOT NULL,
  name text,
  body text NOT NULL,
  feel text,
  prev_hash text,
  hash text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS river_drops_at_idx ON river.drops (at);
CREATE INDEX IF NOT EXISTS river_drops_identity_at_idx ON river.drops (identity_id, at);
