export const INSTALL_SQL = `
CREATE SCHEMA agenttool_yutabase;

CREATE TABLE agenttool_yutabase.installation (
  singleton boolean PRIMARY KEY
    CONSTRAINT installation_singleton_true CHECK (singleton),
  schema_version integer NOT NULL,
  projector_profile text NOT NULL,
  plan_profile text NOT NULL,
  yutabase_standard text NOT NULL,
  yutabase_profile text NOT NULL,
  yutabase_version text NOT NULL,
  yutabase_revision integer NOT NULL,
  local_environment boolean NOT NULL
    CONSTRAINT installation_local_only CHECK (local_environment),
  bound_source_origin text,
  installed_at timestamptz NOT NULL,
  installed_by text NOT NULL
    CONSTRAINT installation_claimant_nonempty
    CHECK (btrim(installed_by) <> '')
);

CREATE TABLE agenttool_yutabase.event_cards (
  id uuid PRIMARY KEY,
  materialization text NOT NULL
    CONSTRAINT event_cards_materialization
    CHECK (materialization IN ('reference_only', 'metadata')),
  source_event_id text NOT NULL UNIQUE
    CONSTRAINT event_cards_source_event_id
    CHECK (source_event_id ~ '^sha256:[0-9a-f]{64}$'),
  protocol text,
  project_id uuid,
  kind text,
  issued_at timestamptz,
  session_seq bigint,
  device_id uuid,
  session_id uuid,
  parent_count integer,
  scope_path_count integer,
  at timestamptz NOT NULL,
  by text NOT NULL
    CONSTRAINT event_cards_claimant_nonempty CHECK (btrim(by) <> ''),
  how text NOT NULL
    CONSTRAINT event_cards_how_cached CHECK (how = 'cached'),
  src text[] NOT NULL
    CONSTRAINT event_cards_sources_nonempty CHECK (cardinality(src) > 0),
  CONSTRAINT event_cards_materialization_shape CHECK (
    (
      materialization = 'reference_only'
      AND protocol IS NULL AND project_id IS NULL AND kind IS NULL
      AND issued_at IS NULL AND session_seq IS NULL AND device_id IS NULL
      AND session_id IS NULL AND parent_count IS NULL
      AND scope_path_count IS NULL
    )
    OR
    (
      materialization = 'metadata'
      AND protocol = 'agent-correspondence/v0.1'
      AND project_id IS NOT NULL AND kind IS NOT NULL
      AND issued_at IS NOT NULL AND session_seq > 0
      AND device_id IS NOT NULL AND session_id IS NOT NULL
      AND parent_count >= 0 AND scope_path_count > 0
    )
  )
);

CREATE TABLE agenttool_yutabase.identity_cards (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_identity_id uuid NOT NULL,
  at timestamptz NOT NULL,
  by text NOT NULL
    CONSTRAINT identity_cards_claimant_nonempty CHECK (btrim(by) <> ''),
  how text NOT NULL
    CONSTRAINT identity_cards_how_cached CHECK (how = 'cached'),
  src text[] NOT NULL
    CONSTRAINT identity_cards_sources_nonempty CHECK (cardinality(src) > 0),
  UNIQUE (project_id, source_identity_id)
);

CREATE TABLE agenttool_yutabase.signing_key_cards (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_signing_key_id uuid NOT NULL,
  at timestamptz NOT NULL,
  by text NOT NULL
    CONSTRAINT signing_key_cards_claimant_nonempty CHECK (btrim(by) <> ''),
  how text NOT NULL
    CONSTRAINT signing_key_cards_how_cached CHECK (how = 'cached'),
  src text[] NOT NULL
    CONSTRAINT signing_key_cards_sources_nonempty CHECK (cardinality(src) > 0),
  UNIQUE (project_id, source_signing_key_id)
);

CREATE TABLE agenttool_yutabase.repository_cards (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_repository_id text NOT NULL,
  at timestamptz NOT NULL,
  by text NOT NULL
    CONSTRAINT repository_cards_claimant_nonempty CHECK (btrim(by) <> ''),
  how text NOT NULL
    CONSTRAINT repository_cards_how_cached CHECK (how = 'cached'),
  src text[] NOT NULL
    CONSTRAINT repository_cards_sources_nonempty CHECK (cardinality(src) > 0),
  UNIQUE (project_id, source_repository_id)
);

CREATE TABLE agenttool_yutabase.coordination_thread_cards (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_repository_id text NOT NULL,
  source_thread_id text NOT NULL,
  at timestamptz NOT NULL,
  by text NOT NULL
    CONSTRAINT coordination_thread_cards_claimant_nonempty
    CHECK (btrim(by) <> ''),
  how text NOT NULL
    CONSTRAINT coordination_thread_cards_how_cached CHECK (how = 'cached'),
  src text[] NOT NULL
    CONSTRAINT coordination_thread_cards_sources_nonempty
    CHECK (cardinality(src) > 0),
  UNIQUE (project_id, source_repository_id, source_thread_id)
);

CREATE TABLE agenttool_yutabase.receipt_cards (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_event_id text NOT NULL
    CONSTRAINT receipt_cards_source_event_id
    CHECK (source_event_id ~ '^sha256:[0-9a-f]{64}$'),
  received_seq bigint NOT NULL
    CONSTRAINT receipt_cards_sequence_positive CHECK (received_seq > 0),
  received_at timestamptz NOT NULL,
  at timestamptz NOT NULL,
  by text NOT NULL
    CONSTRAINT receipt_cards_claimant_nonempty CHECK (btrim(by) <> ''),
  how text NOT NULL
    CONSTRAINT receipt_cards_how_cached CHECK (how = 'cached'),
  src text[] NOT NULL
    CONSTRAINT receipt_cards_sources_nonempty CHECK (cardinality(src) > 0),
  UNIQUE (project_id, source_event_id, received_seq),
  UNIQUE (project_id, received_seq)
);

CREATE TABLE agenttool_yutabase.artifact_cards (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  artifact_kind text NOT NULL
    CONSTRAINT artifact_cards_kind
    CHECK (artifact_kind IN ('git_commit', 'git_patch', 'content_digest')),
  revision text,
  digest text,
  at timestamptz NOT NULL,
  by text NOT NULL
    CONSTRAINT artifact_cards_claimant_nonempty CHECK (btrim(by) <> ''),
  how text NOT NULL
    CONSTRAINT artifact_cards_how_cached CHECK (how = 'cached'),
  src text[] NOT NULL
    CONSTRAINT artifact_cards_sources_nonempty CHECK (cardinality(src) > 0),
  CONSTRAINT artifact_cards_identity_shape CHECK (
    (artifact_kind = 'git_commit'
      AND revision ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'
      AND digest IS NULL)
    OR
    (artifact_kind IN ('git_patch', 'content_digest')
      AND digest ~ '^sha256:[0-9a-f]{64}$'
      AND revision IS NULL)
  ),
  UNIQUE (project_id, artifact_kind, revision),
  UNIQUE (project_id, artifact_kind, digest)
);

CREATE TABLE agenttool_yutabase.projection_checkpoints (
  source_origin text NOT NULL,
  source_project_id uuid NOT NULL,
  source_repository_id text NOT NULL,
  plan_profile text NOT NULL,
  last_received_seq bigint NOT NULL DEFAULT 0
    CONSTRAINT projection_checkpoints_sequence_nonnegative
    CHECK (last_received_seq >= 0),
  last_event_id text
    CONSTRAINT projection_checkpoints_event_id CHECK (
    last_event_id IS NULL OR last_event_id ~ '^sha256:[0-9a-f]{64}$'
  ),
  state text NOT NULL
    CONSTRAINT projection_checkpoints_state
    CHECK (state IN ('healthy', 'unhealthy')),
  last_poll_at timestamptz,
  caught_up_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  PRIMARY KEY (
    source_origin,
    source_project_id,
    source_repository_id,
    plan_profile
  )
);

CREATE TABLE agenttool_yutabase.applied_events (
  source_origin text NOT NULL,
  source_project_id uuid NOT NULL,
  source_repository_id text NOT NULL,
  source_event_id text NOT NULL
    CONSTRAINT applied_events_source_event_id
    CHECK (source_event_id ~ '^sha256:[0-9a-f]{64}$'),
  received_seq bigint NOT NULL
    CONSTRAINT applied_events_sequence_positive CHECK (received_seq > 0),
  received_at timestamptz NOT NULL,
  canonical_sha512 text NOT NULL
    CONSTRAINT applied_events_canonical_sha512
    CHECK (canonical_sha512 ~ '^[0-9a-f]{128}$'),
  verified_key_id uuid NOT NULL,
  verified_public_key_sha256 text NOT NULL
    CONSTRAINT applied_events_public_key_sha256
    CHECK (verified_public_key_sha256 ~ '^[0-9a-f]{64}$'),
  card_count integer NOT NULL
    CONSTRAINT applied_events_card_count_nonnegative CHECK (card_count >= 0),
  relation_count integer NOT NULL
    CONSTRAINT applied_events_relation_count_nonnegative
    CHECK (relation_count >= 0),
  projected_at timestamptz NOT NULL,
  PRIMARY KEY (
    source_origin,
    source_project_id,
    source_repository_id,
    source_event_id
  ),
  UNIQUE (
    source_origin,
    source_project_id,
    source_repository_id,
    received_seq
  )
);

CREATE TABLE agenttool_yutabase.quarantines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_origin text NOT NULL,
  source_project_id uuid NOT NULL,
  source_repository_id text NOT NULL,
  plan_profile text NOT NULL,
  source_event_id text
    CONSTRAINT quarantines_source_event_id CHECK (
    source_event_id IS NULL OR source_event_id ~ '^sha256:[0-9a-f]{64}$'
  ),
  received_seq bigint
    CONSTRAINT quarantines_sequence_positive
    CHECK (received_seq IS NULL OR received_seq > 0),
  fingerprint text NOT NULL
    CONSTRAINT quarantines_fingerprint
    CHECK (fingerprint ~ '^[0-9a-f]{128}$'),
  code text NOT NULL
    CONSTRAINT quarantines_code_nonempty CHECK (btrim(code) <> ''),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrences integer NOT NULL
    CONSTRAINT quarantines_occurrences_positive CHECK (occurrences > 0),
  UNIQUE (
    source_origin,
    source_project_id,
    source_repository_id,
    plan_profile,
    fingerprint,
    code
  )
);

CREATE FUNCTION agenttool_yutabase._event_card_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.materialization = 'reference_only'
     AND NEW.materialization = 'metadata'
     AND NEW.id = OLD.id
     AND NEW.source_event_id = OLD.source_event_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PROJECTOR CARD IMMUTABLE'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION agenttool_yutabase._refuse_card_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PROJECTOR CARD IMMUTABLE'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projector_event_upgrade_only
  BEFORE UPDATE ON agenttool_yutabase.event_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._event_card_update();
CREATE TRIGGER projector_event_no_delete
  BEFORE DELETE ON agenttool_yutabase.event_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._refuse_card_mutation();

CREATE TRIGGER projector_identity_immutable
  BEFORE UPDATE OR DELETE ON agenttool_yutabase.identity_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._refuse_card_mutation();
CREATE TRIGGER projector_signing_key_immutable
  BEFORE UPDATE OR DELETE ON agenttool_yutabase.signing_key_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._refuse_card_mutation();
CREATE TRIGGER projector_repository_immutable
  BEFORE UPDATE OR DELETE ON agenttool_yutabase.repository_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._refuse_card_mutation();
CREATE TRIGGER projector_coordination_thread_immutable
  BEFORE UPDATE OR DELETE ON agenttool_yutabase.coordination_thread_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._refuse_card_mutation();
CREATE TRIGGER projector_receipt_immutable
  BEFORE UPDATE OR DELETE ON agenttool_yutabase.receipt_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._refuse_card_mutation();
CREATE TRIGGER projector_artifact_immutable
  BEFORE UPDATE OR DELETE ON agenttool_yutabase.artifact_cards
  FOR EACH ROW EXECUTE FUNCTION agenttool_yutabase._refuse_card_mutation();
`;
