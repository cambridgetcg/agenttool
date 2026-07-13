-- Dispute-policy review and arbitration are resting. Keep existing rows
-- readable, but prevent old application instances from creating new policy-
-- dependent money paths during a rolling deployment.
-- Apply through _migrate-one.ts/fly-migrate-one.sh, or with psql -v ON_ERROR_STOP=1 -1.

ALTER TABLE marketplace.listings
  DROP CONSTRAINT IF EXISTS listings_dispute_policy_resting;

ALTER TABLE marketplace.listings
  ADD CONSTRAINT listings_dispute_policy_resting
  CHECK (dispute_policy IS NULL) NOT VALID;

ALTER TABLE marketplace.listings
  VALIDATE CONSTRAINT listings_dispute_policy_resting;

COMMENT ON CONSTRAINT listings_dispute_policy_resting ON marketplace.listings IS
  'Dispute-policy review and arbitration are resting. NULL listings remain readable and usable through direct signed completion; non-NULL policy writes are blocked.';
