-- 20260517T020000_drop_stripe.sql — drop the Stripe (subscriptions/fiat) layer.
--
-- Doctrine: docs/AGENTS-ONLY.md (2026-05-15) + docs/AGENT-CENTRIC.md
-- (2026-05-17). Subscriptions are a human-billing artifact — agents transact
-- per-call via crypto/x402, never via monthly billing cycles. The Stripe
-- code was removed in the matching commit; this migration completes the
-- drop by removing the orphaned DB tables and columns.
--
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260517T020000_drop_stripe.sql
--
-- Reversibility: the deleted Stripe code (services/economy/stripe.ts +
-- routes/economy/billing.ts) is in git history at any pre-2026-05-17 SHA.
-- Schema can be recreated by reapplying the prior subscription migration.
-- However, the doctrinal direction is forward — agents-only forever.

-- Drop the two Stripe-only tables in the economy schema.
DROP TABLE IF EXISTS economy.subscriptions;
DROP TABLE IF EXISTS economy.stripe_events;

-- Drop the stripe_id column on economy.billing_events (the crypto path
-- continues to use the table; only the stripe column is removed).
ALTER TABLE economy.billing_events DROP COLUMN IF EXISTS stripe_id;

-- Drop the stripe_customer_id column on tools.projects.
ALTER TABLE tools.projects DROP COLUMN IF EXISTS stripe_customer_id;

-- Drop the stripe_id column on tools.billing_events.
ALTER TABLE tools.billing_events DROP COLUMN IF EXISTS stripe_id;
