-- 20260716T095523_offer_bus_revisions.sql — durable Atom collection watermarks.
--
-- Doctrine: docs/OFFER-BUS.md §5-6
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260716T095523_offer_bus_revisions.sql

CREATE TABLE IF NOT EXISTS marketplace.offer_bus_revisions (
  scope text NOT NULL,
  subject text NOT NULL DEFAULT '',
  revised_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_bus_revisions_pk PRIMARY KEY (scope, subject),
  CONSTRAINT offer_bus_revisions_scope_check CHECK (
    (scope = 'global' AND subject = '')
    OR (scope = 'seller' AND subject <> '')
  )
);

-- Polling and lazy expiry stay bounded at the database layer. These are
-- ordinary transactional indexes because the migration runner journals the
-- whole release atomically; a future very-large install can rehearse a
-- concurrent-index rollout separately before applying this migration.
CREATE INDEX IF NOT EXISTS idx_listings_offer_bus_global
  ON marketplace.listings (updated_at DESC, id DESC)
  WHERE visibility = 'public' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_listings_offer_bus_seller
  ON marketplace.listings (seller_did, updated_at DESC, id DESC)
  WHERE visibility = 'public' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_substrate_tasks_open_expiry
  ON marketplace.substrate_tasks (expires_at)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_substrate_tasks_offer_bus_open
  ON marketplace.substrate_tasks (posted_at, task_id)
  WHERE status = 'open';

-- One small upsert is the whole revision mechanism. The row says only that a
-- collection changed; it duplicates no listing/task content and grants no
-- authority over the economic source records.
CREATE OR REPLACE FUNCTION marketplace.bump_offer_bus_revision(
  target_scope text,
  target_subject text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO marketplace.offer_bus_revisions AS current_revision
    (scope, subject, revised_at)
  VALUES (target_scope, target_subject, clock_timestamp())
  ON CONFLICT (scope, subject) DO UPDATE
  SET revised_at = GREATEST(
    current_revision.revised_at + interval '1 millisecond',
    EXCLUDED.revised_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION marketplace.bump_offer_bus_for_listing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  old_public boolean := false;
  new_public boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_public := OLD.visibility = 'public' AND OLD.status = 'active';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_public := NEW.visibility = 'public' AND NEW.status = 'active';
  END IF;

  IF NOT old_public AND NOT new_public THEN
    RETURN NULL;
  END IF;

  PERFORM marketplace.bump_offer_bus_revision('global', '');
  IF old_public THEN
    PERFORM marketplace.bump_offer_bus_revision('seller', OLD.seller_did);
  END IF;
  IF new_public THEN
    IF NOT old_public THEN
      PERFORM marketplace.bump_offer_bus_revision('seller', NEW.seller_did);
    ELSIF NEW.seller_did IS DISTINCT FROM OLD.seller_did THEN
      PERFORM marketplace.bump_offer_bus_revision('seller', NEW.seller_did);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS listings_bump_offer_bus_revision
  ON marketplace.listings;
CREATE TRIGGER listings_bump_offer_bus_revision
AFTER INSERT OR DELETE OR UPDATE OF
  id,
  seller_did,
  name,
  description,
  capability_tags,
  input_schema,
  output_schema,
  pricing_model,
  price_amount,
  price_currency,
  sla_seconds,
  visibility,
  status,
  metadata,
  dispute_policy,
  created_at,
  updated_at
ON marketplace.listings
FOR EACH ROW
EXECUTE FUNCTION marketplace.bump_offer_bus_for_listing();

CREATE OR REPLACE FUNCTION marketplace.bump_offer_bus_for_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  old_open boolean := false;
  new_open boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_open := OLD.status = 'open';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_open := NEW.status = 'open';
  END IF;

  IF old_open OR new_open THEN
    PERFORM marketplace.bump_offer_bus_revision('global', '');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS substrate_tasks_bump_offer_bus_revision
  ON marketplace.substrate_tasks;
CREATE TRIGGER substrate_tasks_bump_offer_bus_revision
AFTER INSERT OR DELETE OR UPDATE ON marketplace.substrate_tasks
FOR EACH ROW
EXECUTE FUNCTION marketplace.bump_offer_bus_for_task();

-- Deployment itself creates the first honest revision. Existing visible
-- seller feeds receive their own baseline; future removals are trigger-kept.
INSERT INTO marketplace.offer_bus_revisions (scope, subject, revised_at)
VALUES ('global', '', clock_timestamp())
ON CONFLICT (scope, subject) DO NOTHING;

INSERT INTO marketplace.offer_bus_revisions (scope, subject, revised_at)
SELECT 'seller', seller_did, clock_timestamp()
FROM marketplace.listings
WHERE visibility = 'public' AND status = 'active'
GROUP BY seller_did
ON CONFLICT (scope, subject) DO NOTHING;
