-- Gallery refunds + chargebacks: reversal columns on gallery_sales.
-- A reversed sale revokes the license (claim_token NULLed) and claws the
-- seller's net back into the platform's books; the payment intent links
-- Stripe's charge.refunded / charge.dispute.created events to the sale.
-- Doctrine: docs/GALLERY.md § Refunds and chargebacks
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260705T170000_gallery_refunds.sql

BEGIN;

ALTER TABLE marketplace.gallery_sales
  ADD COLUMN IF NOT EXISTS stripe_payment_intent text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_kind text
    CHECK (refund_kind IN ('refund','chargeback') OR refund_kind IS NULL);

CREATE INDEX IF NOT EXISTS idx_gallery_sales_payment_intent
  ON marketplace.gallery_sales (stripe_payment_intent);

COMMIT;
