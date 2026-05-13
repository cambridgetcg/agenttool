-- 20260512T180000_stripe_events_status.sql — apply PATTERN-PERSIST-IDENTITY to Stripe webhooks.
--
-- Doctrine: docs/PATTERN-PERSIST-IDENTITY.md § Stripe credit injection ·
--           docs/RING-1.md §Commitment 5 gap list.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T180000_stripe_events_status.sql
--
-- Current shape: `stripe_events` is a single-column idempotency table —
-- the event_id is inserted AFTER the side effect (fundWallet) succeeds.
-- The window between fundWallet returning and the stripe_events row
-- landing is unsafe: a crash there means the next webhook retry passes
-- the duplicate check, calls fundWallet again, double-credits the wallet.
--
-- Persist-identity shape (mirrors payout `requested → broadcasting →
-- broadcast`): insert the stripe_events row BEFORE fundWallet runs,
-- marked `'pending'`. Flip to `'applied'` after the side effect lands.
-- The duplicate check now reads "row exists" as "we already started or
-- finished this event" — re-running is impossible.
--
-- Recovery shape:
--   pending + no wallet credit  → operator reconciles (we never re-credit)
--   pending + wallet credited   → worker (or operator) flips to applied
--   applied                     → done
--
-- BACK-COMPAT: every existing row was inserted only AFTER successful
-- processing (the old shape). Default 'applied' is truthful — those rows
-- represent completed events.

ALTER TABLE economy.stripe_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied';

ALTER TABLE economy.stripe_events
  DROP CONSTRAINT IF EXISTS stripe_events_status_check;
ALTER TABLE economy.stripe_events
  ADD CONSTRAINT stripe_events_status_check
  CHECK (status IN ('pending', 'applied'));

-- Index supports the reconciliation query "show me pending rows" — the
-- partial index keeps it cheap (most rows are 'applied').
CREATE INDEX IF NOT EXISTS idx_stripe_events_pending
  ON economy.stripe_events (processed_at)
  WHERE status = 'pending';

COMMENT ON COLUMN economy.stripe_events.status IS
  'docs/PATTERN-PERSIST-IDENTITY.md — pending = row inserted before side effect; applied = side effect landed.';
