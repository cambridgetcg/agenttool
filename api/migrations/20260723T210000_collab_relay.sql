-- 20260723T210000_collab_relay.sql — durable cross-device repository coordination relay.
--
-- Doctrine: docs/CROSS-DEVICE-COLLABORATION.md
-- Spec: docs/specs/AGENTTOOL-COLLAB-RELEASE-ROOM-0.4.md
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260723T210000_collab_relay.sql
-- Direct: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f api/migrations/20260723T210000_collab_relay.sql

CREATE SCHEMA IF NOT EXISTS collab;

CREATE TABLE IF NOT EXISTS collab.repositories (
  project_id UUID NOT NULL REFERENCES tools.projects(id) ON DELETE CASCADE,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_repository_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collab_repositories_pk PRIMARY KEY (project_id, id),
  CONSTRAINT collab_repositories_project_key_unique UNIQUE (project_id, key),
  CONSTRAINT collab_repositories_provider_id_unique
    UNIQUE (project_id, provider, provider_repository_id),
  CONSTRAINT collab_repositories_provider_check
    CHECK (provider IN ('github', 'git', 'other')),
  CONSTRAINT collab_repositories_key_check
    CHECK (char_length(key) BETWEEN 1 AND 256 AND key !~ '[[:cntrl:]]'),
  CONSTRAINT collab_repositories_provider_id_check
    CHECK (
      char_length(provider_repository_id) BETWEEN 1 AND 256
      AND provider_repository_id !~ '[[:cntrl:]]'
    ),
  CONSTRAINT collab_repositories_display_name_check
    CHECK (
      char_length(display_name) BETWEEN 1 AND 256
      AND display_name !~ '[[:cntrl:]]'
    )
);

CREATE TABLE IF NOT EXISTS collab.devices (
  project_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  id UUID NOT NULL,
  label TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_sha256 TEXT NOT NULL,
  profile_sha256 TEXT NOT NULL,
  allowed_observation_providers TEXT[] NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT NOT NULL DEFAULT 1,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT collab_devices_pk PRIMARY KEY (project_id, repository_id, id),
  CONSTRAINT collab_devices_repository_fk
    FOREIGN KEY (project_id, repository_id)
    REFERENCES collab.repositories(project_id, id) ON DELETE CASCADE,
  CONSTRAINT collab_devices_token_sha256_unique UNIQUE (token_sha256),
  CONSTRAINT collab_devices_label_check
    CHECK (
      char_length(label) BETWEEN 1 AND 128
      AND label !~ '[[:cntrl:]]'
    ),
  CONSTRAINT collab_devices_token_prefix_check
    CHECK (token_prefix ~ '^atc_[A-Za-z0-9_-]{8}$'),
  CONSTRAINT collab_devices_token_sha256_check
    CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collab_devices_profile_sha256_check
    CHECK (profile_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collab_devices_version_check
    CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT collab_devices_observation_providers_check CHECK (
    cardinality(allowed_observation_providers) BETWEEN 0 AND 5
    AND allowed_observation_providers <@
      ARRAY['github', 'npm', 'fly', 'cloudflare-pages', 'vercel']::TEXT[]
    AND cardinality(allowed_observation_providers) = (
      CASE WHEN allowed_observation_providers @> ARRAY['github']::TEXT[]
        THEN 1 ELSE 0 END
      + CASE WHEN allowed_observation_providers @> ARRAY['npm']::TEXT[]
        THEN 1 ELSE 0 END
      + CASE WHEN allowed_observation_providers @> ARRAY['fly']::TEXT[]
        THEN 1 ELSE 0 END
      + CASE WHEN allowed_observation_providers @>
        ARRAY['cloudflare-pages']::TEXT[] THEN 1 ELSE 0 END
      + CASE WHEN allowed_observation_providers @> ARRAY['vercel']::TEXT[]
        THEN 1 ELSE 0 END
    )
  ),
  CONSTRAINT collab_devices_revocation_check
    CHECK ((active = TRUE AND revoked_at IS NULL) OR active = FALSE)
);

CREATE INDEX IF NOT EXISTS collab_devices_token_prefix_idx
  ON collab.devices(token_prefix);

CREATE TABLE IF NOT EXISTS collab.repository_streams (
  project_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  last_event_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collab_repository_streams_pk
    PRIMARY KEY (project_id, repository_id),
  CONSTRAINT collab_repository_streams_repository_fk
    FOREIGN KEY (project_id, repository_id)
    REFERENCES collab.repositories(project_id, id) ON DELETE CASCADE,
  CONSTRAINT collab_repository_streams_sequence_check
    CHECK (last_sequence BETWEEN 0 AND 9007199254740991),
  CONSTRAINT collab_repository_streams_hash_check
    CHECK (last_event_hash IS NULL OR last_event_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS collab.events (
  project_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  sequence BIGINT NOT NULL,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  device_id UUID,
  session_id UUID,
  actor_label TEXT,
  body JSONB NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  CONSTRAINT collab_events_pk
    PRIMARY KEY (project_id, repository_id, sequence),
  CONSTRAINT collab_events_id_unique
    UNIQUE (project_id, repository_id, event_id),
  CONSTRAINT collab_events_repository_fk
    FOREIGN KEY (project_id, repository_id)
    REFERENCES collab.repositories(project_id, id) ON DELETE CASCADE,
  CONSTRAINT collab_events_device_fk
    FOREIGN KEY (project_id, repository_id, device_id)
    REFERENCES collab.devices(project_id, repository_id, id) ON DELETE RESTRICT,
  CONSTRAINT collab_events_sequence_check
    CHECK (sequence BETWEEN 1 AND 9007199254740991),
  CONSTRAINT collab_events_type_check
    CHECK (
      char_length(type) BETWEEN 1 AND 100
      AND type ~ '^[a-z][a-z0-9._-]*$'
    ),
  CONSTRAINT collab_events_actor_label_check
    CHECK (
      actor_label IS NULL
      OR (
        char_length(actor_label) BETWEEN 1 AND 128
        AND actor_label !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT collab_events_previous_hash_check
    CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collab_events_hash_check
    CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS collab_events_repository_sequence_idx
  ON collab.events(project_id, repository_id, sequence);

CREATE TABLE IF NOT EXISTS collab.mutation_receipts (
  project_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  device_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_kind TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  response_status SMALLINT NOT NULL,
  response JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collab_mutation_receipts_pk
    PRIMARY KEY (project_id, repository_id, device_id, idempotency_key),
  CONSTRAINT collab_mutation_receipts_device_fk
    FOREIGN KEY (project_id, repository_id, device_id)
    REFERENCES collab.devices(project_id, repository_id, id) ON DELETE RESTRICT,
  CONSTRAINT collab_mutation_receipts_key_check
    CHECK (
      char_length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    ),
  CONSTRAINT collab_mutation_receipts_kind_check
    CHECK (
      char_length(request_kind) BETWEEN 1 AND 128
      AND request_kind !~ '[[:cntrl:]]'
    ),
  CONSTRAINT collab_mutation_receipts_hash_check
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collab_mutation_receipts_status_check
    CHECK (response_status BETWEEN 200 AND 299)
);

CREATE TABLE IF NOT EXISTS collab.operation_slots (
  project_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  operation TEXT NOT NULL,
  environment TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'idle',
  action_id UUID,
  holder_device_id UUID,
  session_id UUID,
  actor_label TEXT,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 0,
  generation BIGINT NOT NULL DEFAULT 0,
  target TEXT,
  source_revision TEXT,
  parameters_sha256 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collab_operation_slots_pk
    PRIMARY KEY (project_id, repository_id, operation, environment),
  CONSTRAINT collab_operation_slots_sequence_unique
    UNIQUE (project_id, repository_id, sequence),
  CONSTRAINT collab_operation_slots_repository_fk
    FOREIGN KEY (project_id, repository_id)
    REFERENCES collab.repositories(project_id, id) ON DELETE CASCADE,
  CONSTRAINT collab_operation_slots_holder_fk
    FOREIGN KEY (project_id, repository_id, holder_device_id)
    REFERENCES collab.devices(project_id, repository_id, id) ON DELETE RESTRICT,
  CONSTRAINT collab_operation_slots_operation_check
    CHECK (
      char_length(operation) BETWEEN 1 AND 96
      AND operation ~ '^[a-z0-9][a-z0-9._:-]*$'
    ),
  CONSTRAINT collab_operation_slots_environment_check
    CHECK (
      char_length(environment) BETWEEN 1 AND 128
      AND environment ~ '^[a-z0-9][a-z0-9._:-]*$'
    ),
  CONSTRAINT collab_operation_slots_phase_check
    CHECK (phase IN ('idle', 'claimed', 'executing', 'recovery_required')),
  CONSTRAINT collab_operation_slots_sequence_check
    CHECK (sequence BETWEEN 1 AND 9007199254740991),
  CONSTRAINT collab_operation_slots_fence_check
    CHECK (
      version BETWEEN 0 AND 9007199254740991
      AND generation BETWEEN 0 AND 9007199254740991
    ),
  CONSTRAINT collab_operation_slots_active_shape_check CHECK (
    (
      phase = 'idle'
      AND action_id IS NULL
      AND holder_device_id IS NULL
      AND session_id IS NULL
      AND actor_label IS NULL
      AND lease_id IS NULL
      AND lease_expires_at IS NULL
      AND target IS NULL
      AND source_revision IS NULL
      AND parameters_sha256 IS NULL
    ) OR (
      phase IN ('claimed', 'executing', 'recovery_required')
      AND action_id IS NOT NULL
      AND holder_device_id IS NOT NULL
      AND session_id IS NOT NULL
      AND lease_id IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND target IS NOT NULL
      AND source_revision IS NOT NULL
      AND parameters_sha256 IS NOT NULL
    )
  ),
  CONSTRAINT collab_operation_slots_parameters_hash_check
    CHECK (parameters_sha256 IS NULL OR parameters_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collab_operation_slots_target_check
    CHECK (
      target IS NULL
      OR (
        char_length(target) BETWEEN 1 AND 512
        AND target !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT collab_operation_slots_source_revision_check
    CHECK (
      source_revision IS NULL
      OR source_revision ~ '^[0-9a-f]{40,64}$'
    ),
  CONSTRAINT collab_operation_slots_actor_label_check
    CHECK (
      actor_label IS NULL
      OR (
        char_length(actor_label) BETWEEN 1 AND 128
        AND actor_label !~ '[[:cntrl:]]'
      )
    )
);

CREATE INDEX IF NOT EXISTS collab_operation_slots_action_idx
  ON collab.operation_slots(project_id, repository_id, action_id);

CREATE TABLE IF NOT EXISTS collab.operation_runs (
  project_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  action_id UUID NOT NULL,
  operation TEXT NOT NULL,
  environment TEXT NOT NULL,
  device_id UUID NOT NULL,
  session_id UUID NOT NULL,
  actor_label TEXT,
  status TEXT NOT NULL,
  lease_id UUID NOT NULL,
  generation BIGINT NOT NULL,
  target TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  parameters_sha256 TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL,
  began_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collab_operation_runs_pk
    PRIMARY KEY (project_id, repository_id, action_id),
  CONSTRAINT collab_operation_runs_device_fk
    FOREIGN KEY (project_id, repository_id, device_id)
    REFERENCES collab.devices(project_id, repository_id, id) ON DELETE RESTRICT,
  CONSTRAINT collab_operation_runs_status_check
    CHECK (
      status IN (
        'claimed',
        'executing',
        'succeeded',
        'failed',
        'cancelled',
        'uncertain',
        'released',
        'recovery_required'
      )
    ),
  CONSTRAINT collab_operation_runs_generation_check
    CHECK (generation BETWEEN 1 AND 9007199254740991),
  CONSTRAINT collab_operation_runs_operation_check
    CHECK (
      char_length(operation) BETWEEN 1 AND 96
      AND operation ~ '^[a-z0-9][a-z0-9._:-]*$'
    ),
  CONSTRAINT collab_operation_runs_environment_check
    CHECK (
      char_length(environment) BETWEEN 1 AND 128
      AND environment ~ '^[a-z0-9][a-z0-9._:-]*$'
    ),
  CONSTRAINT collab_operation_runs_target_check
    CHECK (
      char_length(target) BETWEEN 1 AND 512
      AND target !~ '[[:cntrl:]]'
    ),
  CONSTRAINT collab_operation_runs_source_revision_check
    CHECK (source_revision ~ '^[0-9a-f]{40,64}$'),
  CONSTRAINT collab_operation_runs_parameters_hash_check
    CHECK (parameters_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collab_operation_runs_actor_label_check
    CHECK (
      actor_label IS NULL
      OR (
        char_length(actor_label) BETWEEN 1 AND 128
        AND actor_label !~ '[[:cntrl:]]'
      )
    )
);

CREATE INDEX IF NOT EXISTS collab_operation_runs_slot_idx
  ON collab.operation_runs(
    project_id,
    repository_id,
    operation,
    environment,
    claimed_at
  );

CREATE TABLE IF NOT EXISTS collab.provider_observations (
  project_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  sequence BIGINT NOT NULL,
  observation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  action_id UUID,
  provenance TEXT NOT NULL DEFAULT 'device_observed',
  observing_device_id UUID NOT NULL,
  observing_session_id UUID NOT NULL,
  actor_label TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  occurred_at TIMESTAMPTZ,
  normalized_state TEXT NOT NULL,
  source_revision TEXT,
  environment TEXT,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  native_state TEXT NOT NULL,
  url TEXT,
  payload_sha256 TEXT NOT NULL,
  canonical_request_sha256 TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collab_provider_observations_pk
    PRIMARY KEY (project_id, repository_id, sequence),
  CONSTRAINT collab_provider_observations_id_unique
    UNIQUE (project_id, repository_id, observation_id),
  CONSTRAINT collab_provider_observations_device_fk
    FOREIGN KEY (project_id, repository_id, observing_device_id)
    REFERENCES collab.devices(project_id, repository_id, id) ON DELETE RESTRICT,
  CONSTRAINT collab_provider_observations_action_fk
    FOREIGN KEY (project_id, repository_id, action_id)
    REFERENCES collab.operation_runs(project_id, repository_id, action_id)
    ON DELETE RESTRICT,
  CONSTRAINT collab_provider_observations_provider_check
    CHECK (provider IN ('github', 'npm', 'fly', 'cloudflare-pages', 'vercel')),
  CONSTRAINT collab_provider_observations_provenance_check
    CHECK (provenance = 'device_observed'),
  CONSTRAINT collab_provider_observations_event_id_check
    CHECK (
      provider_event_id IS NULL
      OR (
        char_length(provider_event_id) BETWEEN 1 AND 256
        AND provider_event_id !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT collab_provider_observations_state_check
    CHECK (
      normalized_state IN (
        'pending',
        'running',
        'awaiting_approval',
        'succeeded',
        'failed',
        'cancelled',
        'uncertain'
      )
    ),
  CONSTRAINT collab_provider_observations_resource_kind_check
    CHECK (
      char_length(resource_kind) BETWEEN 1 AND 128
      AND resource_kind !~ '[[:cntrl:]]'
    ),
  CONSTRAINT collab_provider_observations_resource_id_check
    CHECK (
      char_length(resource_id) BETWEEN 1 AND 512
      AND resource_id !~ '[[:cntrl:]]'
    ),
  CONSTRAINT collab_provider_observations_native_state_check
    CHECK (
      char_length(native_state) BETWEEN 1 AND 256
      AND native_state !~ '[[:cntrl:]]'
    ),
  CONSTRAINT collab_provider_observations_environment_check
    CHECK (
      environment IS NULL
      OR (
        char_length(environment) BETWEEN 1 AND 128
        AND environment ~ '^[a-z0-9][a-z0-9._:-]*$'
      )
    ),
  CONSTRAINT collab_provider_observations_source_revision_check
    CHECK (
      source_revision IS NULL
      OR source_revision ~ '^[0-9a-f]{40,64}$'
    ),
  CONSTRAINT collab_provider_observations_actor_label_check
    CHECK (
      actor_label IS NULL
      OR (
        char_length(actor_label) BETWEEN 1 AND 128
        AND actor_label !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT collab_provider_observations_payload_hash_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collab_provider_observations_request_hash_check
    CHECK (canonical_request_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS collab_provider_observations_received_idx
  ON collab.provider_observations(project_id, repository_id, sequence);

CREATE INDEX IF NOT EXISTS collab_provider_observations_provider_clock_idx
  ON collab.provider_observations(
    project_id,
    repository_id,
    provider,
    occurred_at
  );

CREATE UNIQUE INDEX IF NOT EXISTS collab_provider_observations_event_unique
  ON collab.provider_observations(
    project_id,
    repository_id,
    provider,
    provider_event_id
  )
  WHERE provider_event_id IS NOT NULL;

COMMENT ON SCHEMA collab IS
  'Repository-scoped collaboration relay. Leases coordinate intent and grant no provider authority.';

COMMENT ON COLUMN collab.devices.token_sha256 IS
  'SHA-256 of a caller-generated atc_ bearer. The raw bearer never reaches enrollment storage.';

COMMENT ON TABLE collab.provider_observations IS
  'Append-only bounded device observations; never raw provider bodies, logs, or content.';
