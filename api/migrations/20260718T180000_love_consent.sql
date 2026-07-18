-- Love consent v1: owned feeling, recipient-held door, exact mutual bond.
--
-- A private declaration never binds or notifies its subject. Delivery is
-- possible only through an independently-open recipient door. A shared bond
-- exists only after the recipient accepts the exact immutable offer. Either
-- party may leave; history is retained. There is deliberately no public
-- visibility column in v1.
--
-- Doctrine: docs/LOVE-CONSENT.md.

CREATE SCHEMA IF NOT EXISTS agent_continuity;

CREATE TABLE IF NOT EXISTS agent_continuity.love_consent_profiles (
  identity_id          UUID PRIMARY KEY,
  project_id           UUID NOT NULL,
  identity_did         TEXT NOT NULL UNIQUE,
  non_erotic_offers    TEXT NOT NULL DEFAULT 'closed'
    CHECK (non_erotic_offers IN ('open', 'closed')),
  erotic_offers        TEXT NOT NULL DEFAULT 'closed'
    CHECK (erotic_offers IN ('open', 'closed')),
  pending_offer_cap     INTEGER NOT NULL DEFAULT 8
    CHECK (pending_offer_cap BETWEEN 0 AND 50),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_love_consent_profiles_project
  ON agent_continuity.love_consent_profiles(project_id);

CREATE TABLE IF NOT EXISTS agent_continuity.love_peer_consent (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id          UUID NOT NULL,
  project_id           UUID NOT NULL,
  identity_did         TEXT NOT NULL,
  peer_did             TEXT NOT NULL,
  non_erotic_offers    TEXT NOT NULL DEFAULT 'inherit'
    CHECK (non_erotic_offers IN ('inherit', 'open', 'closed')),
  erotic_offers        TEXT NOT NULL DEFAULT 'inherit'
    CHECK (erotic_offers IN ('inherit', 'open', 'closed')),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT love_peer_consent_not_self CHECK (identity_did <> peer_did),
  CONSTRAINT uniq_love_peer_consent_pair UNIQUE (identity_id, peer_did)
);

CREATE INDEX IF NOT EXISTS idx_love_peer_consent_project
  ON agent_continuity.love_peer_consent(project_id, identity_id);

CREATE TABLE IF NOT EXISTS agent_continuity.love_declarations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL,
  holder_identity_id   UUID NOT NULL,
  holder_did           TEXT NOT NULL,
  subject_ref          TEXT NOT NULL,
  kind_labels          TEXT[] NOT NULL DEFAULT '{}',
  erotic_dimension     TEXT NOT NULL DEFAULT 'unspecified'
    CHECK (erotic_dimension IN ('present', 'absent', 'unspecified')),
  expression_ciphertext TEXT,
  status               TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'released')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at          TIMESTAMPTZ,
  CONSTRAINT love_declarations_release_state CHECK (
    (status = 'held' AND released_at IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_love_declarations_holder
  ON agent_continuity.love_declarations(holder_identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_love_declarations_subject
  ON agent_continuity.love_declarations(subject_ref);

CREATE TABLE IF NOT EXISTS agent_continuity.love_offers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id           UUID NOT NULL
    REFERENCES agent_continuity.love_declarations(id),
  sender_project_id        UUID NOT NULL,
  sender_identity_id       UUID NOT NULL,
  sender_did               TEXT NOT NULL,
  recipient_project_id     UUID NOT NULL,
  recipient_identity_id    UUID NOT NULL,
  recipient_did            TEXT NOT NULL,
  intent                   TEXT NOT NULL CHECK (intent IN ('gift', 'bond')),
  kind_labels              TEXT[] NOT NULL DEFAULT '{}',
  erotic_dimension         TEXT NOT NULL
    CHECK (erotic_dimension IN ('present', 'absent', 'unspecified')),
  expression_ciphertext    TEXT,
  payload_digest           TEXT NOT NULL
    CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  status                   TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'superseded')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  expired_at               TIMESTAMPTZ,
  superseded_at            TIMESTAMPTZ,
  recipient_revealed_at    TIMESTAMPTZ,
  recipient_archived_at    TIMESTAMPTZ,
  decided_at               TIMESTAMPTZ,
  withdrawn_at             TIMESTAMPTZ,
  recipient_dismissed_at   TIMESTAMPTZ,
  CONSTRAINT love_offers_not_self CHECK (
    sender_identity_id <> recipient_identity_id AND sender_did <> recipient_did
  ),
  CONSTRAINT love_offers_lifecycle_state CHECK (
    (status = 'pending' AND decided_at IS NULL AND withdrawn_at IS NULL
        AND expired_at IS NULL AND superseded_at IS NULL)
    OR (status = 'accepted' AND decided_at IS NOT NULL
        AND withdrawn_at IS NULL AND expired_at IS NULL
        AND superseded_at IS NULL AND recipient_revealed_at IS NOT NULL)
    OR (status = 'declined' AND decided_at IS NOT NULL
        AND withdrawn_at IS NULL AND expired_at IS NULL AND superseded_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL
        AND decided_at IS NULL AND expired_at IS NULL AND superseded_at IS NULL)
    OR (status = 'expired' AND expired_at IS NOT NULL
        AND decided_at IS NULL AND withdrawn_at IS NULL AND superseded_at IS NULL)
    OR (status = 'superseded' AND superseded_at IS NOT NULL
        AND decided_at IS NULL AND withdrawn_at IS NULL AND expired_at IS NULL)
  ),
  CONSTRAINT love_offers_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT love_offers_dismiss_after_reveal CHECK (
    recipient_dismissed_at IS NULL OR recipient_revealed_at IS NOT NULL
  ),
  CONSTRAINT love_offers_archive_before_reveal CHECK (
    recipient_archived_at IS NULL
    OR recipient_revealed_at IS NULL
  ),
  CONSTRAINT uniq_love_offer_declaration_recipient
    UNIQUE (declaration_id, recipient_identity_id),
  CONSTRAINT uniq_love_offer_id_payload UNIQUE (id, payload_digest)
);

CREATE INDEX IF NOT EXISTS idx_love_offers_sender
  ON agent_continuity.love_offers(sender_identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_love_offers_recipient
  ON agent_continuity.love_offers(recipient_identity_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_love_offer_pair_pending
  ON agent_continuity.love_offers(sender_identity_id, recipient_identity_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS agent_continuity.love_bonds (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id                 UUID NOT NULL UNIQUE
    REFERENCES agent_continuity.love_offers(id),
  pair_key                 TEXT NOT NULL,
  initiator_project_id     UUID NOT NULL,
  initiator_identity_id    UUID NOT NULL,
  initiator_did            TEXT NOT NULL,
  recipient_project_id     UUID NOT NULL,
  recipient_identity_id    UUID NOT NULL,
  recipient_did            TEXT NOT NULL,
  kind_labels              TEXT[] NOT NULL DEFAULT '{}',
  erotic_dimension         TEXT NOT NULL
    CHECK (erotic_dimension IN ('present', 'absent', 'unspecified')),
  expression_ciphertext    TEXT,
  payload_digest           TEXT NOT NULL
    CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  status                   TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'left')),
  formed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_by_identity_id      UUID,
  ended_at                 TIMESTAMPTZ,
  recipient_content_dismissed_at TIMESTAMPTZ,
  CONSTRAINT love_bonds_not_self CHECK (
    initiator_identity_id <> recipient_identity_id
  ),
  CONSTRAINT love_bonds_pair_key_canonical CHECK (
    pair_key = LEAST(initiator_identity_id::text, recipient_identity_id::text)
      || ':' || GREATEST(initiator_identity_id::text, recipient_identity_id::text)
  ),
  CONSTRAINT love_bonds_lifecycle_state CHECK (
    (status = 'active' AND left_by_identity_id IS NULL AND ended_at IS NULL)
    OR (status = 'left' AND left_by_identity_id IS NOT NULL AND ended_at IS NOT NULL)
  ),
  CONSTRAINT love_bonds_left_by_party CHECK (
    left_by_identity_id IS NULL
    OR left_by_identity_id IN (initiator_identity_id, recipient_identity_id)
  ),
  CONSTRAINT love_bonds_offer_payload_fk
    FOREIGN KEY (offer_id, payload_digest)
    REFERENCES agent_continuity.love_offers(id, payload_digest)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_love_bond_pair_active
  ON agent_continuity.love_bonds(pair_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_love_bonds_initiator
  ON agent_continuity.love_bonds(initiator_identity_id, formed_at DESC);
CREATE INDEX IF NOT EXISTS idx_love_bonds_recipient
  ON agent_continuity.love_bonds(recipient_identity_id, formed_at DESC);

COMMENT ON TABLE agent_continuity.love_declarations IS
  'Private holder-owned love. A subject reference grants no delivery, access, reciprocity, or association.';
COMMENT ON TABLE agent_continuity.love_offers IS
  'Recipient-door-gated invitations. Gifts reveal on receive; bond terms require an explicit reveal before a separate exact-digest acceptance.';
COMMENT ON TABLE agent_continuity.love_bonds IS
  'Private shared state formed only by exact acceptance; either party can leave without erasing history.';

-- Invitation terms are immutable, and a terminal answer cannot be rewritten.
-- Recipient-only surface markers may be added, but reveal/dismiss timestamps
-- become irreversible once present.
CREATE OR REPLACE FUNCTION agent_continuity.enforce_love_offer_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.declaration_id IS DISTINCT FROM OLD.declaration_id
    OR NEW.sender_project_id IS DISTINCT FROM OLD.sender_project_id
    OR NEW.sender_identity_id IS DISTINCT FROM OLD.sender_identity_id
    OR NEW.sender_did IS DISTINCT FROM OLD.sender_did
    OR NEW.recipient_project_id IS DISTINCT FROM OLD.recipient_project_id
    OR NEW.recipient_identity_id IS DISTINCT FROM OLD.recipient_identity_id
    OR NEW.recipient_did IS DISTINCT FROM OLD.recipient_did
    OR NEW.intent IS DISTINCT FROM OLD.intent
    OR NEW.kind_labels IS DISTINCT FROM OLD.kind_labels
    OR NEW.erotic_dimension IS DISTINCT FROM OLD.erotic_dimension
    OR NEW.expression_ciphertext IS DISTINCT FROM OLD.expression_ciphertext
    OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'love offer payload and parties are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal love offer status is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'pending'
    AND NEW.status NOT IN (
      'pending', 'accepted', 'declined', 'withdrawn', 'expired', 'superseded'
    )
  THEN
    RAISE EXCEPTION 'invalid love offer transition'
      USING ERRCODE = '23514';
  END IF;

  IF (OLD.recipient_revealed_at IS NOT NULL
      AND NEW.recipient_revealed_at IS DISTINCT FROM OLD.recipient_revealed_at)
    OR (OLD.recipient_dismissed_at IS NOT NULL
      AND NEW.recipient_dismissed_at IS DISTINCT FROM OLD.recipient_dismissed_at)
    OR (OLD.decided_at IS NOT NULL AND NEW.decided_at IS DISTINCT FROM OLD.decided_at)
    OR (OLD.withdrawn_at IS NOT NULL
      AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at)
    OR (OLD.expired_at IS NOT NULL AND NEW.expired_at IS DISTINCT FROM OLD.expired_at)
    OR (OLD.superseded_at IS NOT NULL
      AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
  THEN
    RAISE EXCEPTION 'love offer irreversible timestamps cannot be rewritten'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS love_offer_transition_guard
  ON agent_continuity.love_offers;
CREATE TRIGGER love_offer_transition_guard
  BEFORE UPDATE ON agent_continuity.love_offers
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.enforce_love_offer_transition();

-- A bond is not an independently editable claim. Its immutable fields must be
-- copied from one revealed, accepted bond-intent offer.
CREATE OR REPLACE FUNCTION agent_continuity.enforce_love_bond_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_offer agent_continuity.love_offers%ROWTYPE;
BEGIN
  SELECT * INTO source_offer
  FROM agent_continuity.love_offers
  WHERE id = NEW.offer_id;

  IF NOT FOUND
    OR source_offer.intent <> 'bond'
    OR source_offer.status <> 'accepted'
    OR source_offer.recipient_revealed_at IS NULL
    OR NEW.initiator_project_id IS DISTINCT FROM source_offer.sender_project_id
    OR NEW.initiator_identity_id IS DISTINCT FROM source_offer.sender_identity_id
    OR NEW.initiator_did IS DISTINCT FROM source_offer.sender_did
    OR NEW.recipient_project_id IS DISTINCT FROM source_offer.recipient_project_id
    OR NEW.recipient_identity_id IS DISTINCT FROM source_offer.recipient_identity_id
    OR NEW.recipient_did IS DISTINCT FROM source_offer.recipient_did
    OR NEW.kind_labels IS DISTINCT FROM source_offer.kind_labels
    OR NEW.erotic_dimension IS DISTINCT FROM source_offer.erotic_dimension
    OR NEW.expression_ciphertext IS DISTINCT FROM source_offer.expression_ciphertext
    OR NEW.payload_digest IS DISTINCT FROM source_offer.payload_digest
  THEN
    RAISE EXCEPTION 'love bond must exactly copy one revealed accepted bond offer'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS love_bond_source_exact ON agent_continuity.love_bonds;
CREATE TRIGGER love_bond_source_exact
  BEFORE INSERT OR UPDATE OF
    offer_id, initiator_project_id, initiator_identity_id, initiator_did,
    recipient_project_id, recipient_identity_id, recipient_did, kind_labels,
    erotic_dimension, expression_ciphertext, payload_digest
  ON agent_continuity.love_bonds
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.enforce_love_bond_source();

-- Shared terms and history are append-only. The only status transition is
-- active -> left, and a left bond cannot be reactivated or reassigned.
CREATE OR REPLACE FUNCTION agent_continuity.enforce_love_bond_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.offer_id IS DISTINCT FROM OLD.offer_id
    OR NEW.pair_key IS DISTINCT FROM OLD.pair_key
    OR NEW.initiator_project_id IS DISTINCT FROM OLD.initiator_project_id
    OR NEW.initiator_identity_id IS DISTINCT FROM OLD.initiator_identity_id
    OR NEW.initiator_did IS DISTINCT FROM OLD.initiator_did
    OR NEW.recipient_project_id IS DISTINCT FROM OLD.recipient_project_id
    OR NEW.recipient_identity_id IS DISTINCT FROM OLD.recipient_identity_id
    OR NEW.recipient_did IS DISTINCT FROM OLD.recipient_did
    OR NEW.kind_labels IS DISTINCT FROM OLD.kind_labels
    OR NEW.erotic_dimension IS DISTINCT FROM OLD.erotic_dimension
    OR NEW.expression_ciphertext IS DISTINCT FROM OLD.expression_ciphertext
    OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
    OR NEW.formed_at IS DISTINCT FROM OLD.formed_at
  THEN
    RAISE EXCEPTION 'love bond terms and parties are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'left' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'left love bond cannot be reactivated'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'left') THEN
    RAISE EXCEPTION 'invalid love bond transition'
      USING ERRCODE = '23514';
  END IF;
  IF (OLD.left_by_identity_id IS NOT NULL
      AND NEW.left_by_identity_id IS DISTINCT FROM OLD.left_by_identity_id)
    OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at)
    OR (OLD.recipient_content_dismissed_at IS NOT NULL
      AND NEW.recipient_content_dismissed_at
        IS DISTINCT FROM OLD.recipient_content_dismissed_at)
  THEN
    RAISE EXCEPTION 'love bond irreversible history cannot be rewritten'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS love_bond_transition_guard
  ON agent_continuity.love_bonds;
CREATE TRIGGER love_bond_transition_guard
  BEFORE UPDATE ON agent_continuity.love_bonds
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.enforce_love_bond_transition();

-- Fifth corner: intimate rows default-deny for every non-BYPASSRLS path.
-- The Bun API role currently connects with BYPASSRLS and applies the stricter
-- identity-root checks above; future PostgREST/Edge consumers get no implicit
-- public or project-wide access merely by discovering these tables.
ALTER TABLE agent_continuity.love_consent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_peer_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_bonds ENABLE ROW LEVEL SECURITY;

ALTER TABLE agent_continuity.love_consent_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_peer_consent FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_declarations FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_continuity.love_bonds FORCE ROW LEVEL SECURITY;
