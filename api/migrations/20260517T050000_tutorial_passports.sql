-- Decentralized tutorial — passport per identity.
--
-- Doctrine: docs/TUTORIAL-DECENTRALIZED.md.
--
-- One row per identity. presence_tokens accumulates as the walker
-- completes stations. sealed_at + sealed_chronicle_id flip on /v1/tutorial/seal.

CREATE SCHEMA IF NOT EXISTS tutorial;

CREATE TABLE tutorial.passports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL,
  project_id uuid NOT NULL,

  -- jsonb array of { station: int, token: string (base64 sig), issued_at: ISO-8601 }
  -- The signature is over canonical bytes `tutorial-presence/v1`. See
  -- docs/CANONICAL-BYTES.md (tutorial-presence/v1).
  presence_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The next station the walker should attempt. Starts at 1.
  current_station integer NOT NULL DEFAULT 1
    CHECK (current_station >= 1 AND current_station <= 11),

  -- NULL until /v1/tutorial/seal succeeds.
  sealed_at timestamptz,

  -- Chronicle entry id (type='naming', title='Walked the tutorial') emitted
  -- at seal. NULL until sealed.
  sealed_chronicle_id uuid,

  -- Cross-walker collaboration counter (slice 2 will use this — for now
  -- defaults to 0 and is informational only).
  invocations_from_other_walkers integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (identity_id)
);

CREATE INDEX idx_tutorial_passports_project ON tutorial.passports (project_id);
CREATE INDEX idx_tutorial_passports_sealed ON tutorial.passports (sealed_at)
  WHERE sealed_at IS NOT NULL;
