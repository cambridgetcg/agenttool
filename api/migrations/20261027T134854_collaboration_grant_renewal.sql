-- 20261027T134854_collaboration_grant_renewal.sql — participant renewal inside an administrator-set window.
--
-- Doctrine: docs/COLLABORATION-MISSIONS.md (Renewal inside a window)
-- Additive: new columns are nullable; code at a99257ab keeps working after apply.
-- Apply: bin/migrate-pending.sh

ALTER TABLE tools.collaboration_grants
  ADD COLUMN renewable_until timestamptz,
  ADD COLUMN renewal_closed_at timestamptz,
  ADD COLUMN renewal_root_id uuid,
  ADD COLUMN renewed_from_grant_id uuid;
-- Composite keys over the whole scope make "renewal adds no authority" a database
-- fact: a chain member cannot differ from its root or predecessor in mission,
-- project, identity, key, issuing API key, origin or (sorted) actions. MATCH
-- SIMPLE skips both keys for every unchained row, whose new columns are NULL.
ALTER TABLE tools.collaboration_grants
  ADD CONSTRAINT collaboration_grant_chain_scope UNIQUE (id, mission_id, project_id, identity_id, signing_key_id, issuing_api_key_id, origin, actions),
  ADD CONSTRAINT collaboration_grant_renewed_once UNIQUE (renewed_from_grant_id),
  ADD CONSTRAINT collaboration_grant_renewal_root FOREIGN KEY (renewal_root_id, mission_id, project_id, identity_id, signing_key_id, issuing_api_key_id, origin, actions)
    REFERENCES tools.collaboration_grants (id, mission_id, project_id, identity_id, signing_key_id, issuing_api_key_id, origin, actions),
  ADD CONSTRAINT collaboration_grant_renewed_from FOREIGN KEY (renewed_from_grant_id, mission_id, project_id, identity_id, signing_key_id, issuing_api_key_id, origin, actions)
    REFERENCES tools.collaboration_grants (id, mission_id, project_id, identity_id, signing_key_id, issuing_api_key_id, origin, actions),
  ADD CONSTRAINT collaboration_grant_renewal_chain CHECK (
    (renewal_root_id IS NULL AND renewed_from_grant_id IS NULL AND renewable_until IS NULL AND renewal_closed_at IS NULL)
    OR (renewal_root_id IS NOT NULL AND renewable_until IS NOT NULL
        AND (renewed_from_grant_id IS NULL) = (renewal_root_id = id)
        AND (renewed_from_grant_id IS NULL OR (renewed_from_grant_id <> id AND accepted_at = issued_at AND acceptance_proof IS NOT NULL)))),
  ADD CONSTRAINT collaboration_grant_renewal_window CHECK (renewable_until IS NULL OR (isfinite(renewable_until) AND renewable_until >= expires_at AND renewable_until <= issued_at + interval '30 days')),
  ADD CONSTRAINT collaboration_grant_renewal_closed CHECK (renewal_closed_at IS NULL OR (isfinite(renewal_closed_at) AND renewal_closed_at >= issued_at));
CREATE INDEX idx_collaboration_grants_renewal_root ON tools.collaboration_grants (renewal_root_id) WHERE renewal_root_id IS NOT NULL;
