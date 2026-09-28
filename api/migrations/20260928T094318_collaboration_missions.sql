-- 20260928T094318_collaboration_missions.sql — bounded mission participation.
--
-- Doctrine: docs/COLLABORATION-MISSIONS.md
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh

CREATE TABLE tools.collaboration_missions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES tools.projects(id),
  creator_api_key_id uuid NOT NULL REFERENCES tools.api_keys(id),
  descriptor jsonb NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_receipt_seq bigint NOT NULL DEFAULT 0 CHECK (last_receipt_seq >= 0),
  CONSTRAINT collaboration_missions_project_id UNIQUE (id, project_id),
  CONSTRAINT collaboration_mission_descriptor CHECK (jsonb_typeof(descriptor) = 'object' AND octet_length(descriptor::text) <= 65536),
  CONSTRAINT collaboration_mission_expiry CHECK (isfinite(created_at) AND isfinite(expires_at) AND expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CONSTRAINT collaboration_mission_revocation CHECK (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= created_at))
);

CREATE TABLE tools.collaboration_grants (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  signing_key_id uuid NOT NULL REFERENCES identity.identity_keys(id),
  issuing_api_key_id uuid NOT NULL REFERENCES tools.api_keys(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  origin text NOT NULL CHECK (length(origin) BETWEEN 9 AND 512 AND origin ~ '^https://[^/?#@[:space:]]+$'),
  actions text[] NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  acceptance_proof jsonb,
  revoked_at timestamptz,
  CONSTRAINT collaboration_grant_mission FOREIGN KEY (mission_id, project_id) REFERENCES tools.collaboration_missions(id, project_id),
  CONSTRAINT collaboration_grant_event_subject UNIQUE (id, mission_id, project_id, identity_id, signing_key_id),
  CONSTRAINT collaboration_grant_actions CHECK (array_ndims(actions) = 1 AND array_lower(actions, 1) = 1 AND cardinality(actions) BETWEEN 1 AND 2 AND actions <@ ARRAY['mission.read','mission.observe']::text[] AND array_position(actions, NULL) IS NULL AND (cardinality(actions) = 1 OR actions[1] <> actions[2])),
  CONSTRAINT collaboration_grant_expiry CHECK (isfinite(issued_at) AND isfinite(expires_at) AND expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'),
  CONSTRAINT collaboration_grant_acceptance CHECK ((accepted_at IS NULL AND acceptance_proof IS NULL) OR (accepted_at IS NOT NULL AND isfinite(accepted_at) AND accepted_at >= issued_at AND accepted_at < expires_at AND acceptance_proof IS NOT NULL)),
  CONSTRAINT collaboration_grant_revocation CHECK (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= issued_at))
);
CREATE INDEX idx_collaboration_grants_mission ON tools.collaboration_grants (mission_id, project_id);
CREATE INDEX idx_collaboration_grants_parent ON tools.collaboration_grants (issuing_api_key_id);

CREATE TABLE tools.collaboration_events (
  mission_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  signing_key_id uuid NOT NULL,
  receipt_seq bigint NOT NULL CHECK (receipt_seq > 0),
  raw_body text NOT NULL CHECK (octet_length(raw_body) BETWEEN 1 AND 8192),
  body_digest text NOT NULL CHECK (body_digest ~ '^[0-9a-f]{64}$'),
  observation jsonb NOT NULL,
  proof jsonb NOT NULL,
  received_at timestamptz NOT NULL CHECK (isfinite(received_at)),
  PRIMARY KEY (mission_id, event_id),
  CONSTRAINT collaboration_events_receipt UNIQUE (mission_id, receipt_seq),
  CONSTRAINT collaboration_event_grant FOREIGN KEY (grant_id, mission_id, project_id, identity_id, signing_key_id)
    REFERENCES tools.collaboration_grants(id, mission_id, project_id, identity_id, signing_key_id)
);
