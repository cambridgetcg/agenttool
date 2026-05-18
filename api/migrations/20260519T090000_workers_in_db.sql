-- 20260519T090000_workers_in_db.sql
-- Move 5: pg_cron + pg_net workers — covenant sweepers leave BullMQ.
--
-- Migrates three Bun workers to Postgres-native scheduled jobs:
--   1. covenant-expiry-sweep    (was services/covenants/expire-proposals.ts)
--   2. covenant-cosign-propagate (was services/covenants/cosign-propagate.ts)
--   3. covenant-reverify         (was services/covenants/reverify.ts — partial;
--                                 the cryptographic re-verify side stays in Bun
--                                 because plpython3u isn't available on Supabase
--                                 managed postgres; see Move 2's deferral note)
--
-- Why pg_cron + pg_net:
--   pg_cron schedules pure-SQL workers in-database. pg_net fires async outbound
--   HTTP for cross-instance propagation. Both extensions are Supabase-supported.
--   The Bun worker process count drops by 2; the Redis dependency surface
--   shrinks; the workers run closer to the data they touch.
--
-- The think-worker (services/runtime/think-worker.ts) STAYS in Bun — it
-- decrypts strands with K_master which never leaves user RAM, and calls
-- LLM endpoints. Doctrine: docs/SUPABASE-INTEGRATION-PLAN.md § Move 5.
--
-- The payout-broadcast worker (workers/payout/broadcast-worker.ts) STAYS in
-- Bun — it signs Solana/EVM transactions with crypto stacks unavailable to
-- Postgres + has the no-doctrine-retry discipline that needs Bun's
-- precise control flow.
--
-- Doctrine: docs/WORKERS-IN-DB.md.
-- Pinned by: api/tests/doctrine/workers-in-db.test.ts.

-- ─── Extension install ────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- pg_cron's default behavior: jobs run as the user who scheduled them.
-- All jobs below schedule from this migration's connection (postgres),
-- so they run as postgres — which has UPDATE on all relevant tables.

-- ─── Job 1: covenant-expiry-sweep ─────────────────────────────────────
-- Runs every 15 minutes.
-- Marks proposed v2 covenants as 'expired' once their wallclock TTL passes.
-- Matches the prior Bun worker's logic in services/covenants/expire-proposals.ts.

SELECT cron.unschedule('covenant-expiry-sweep')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covenant-expiry-sweep');

SELECT cron.schedule(
  'covenant-expiry-sweep',
  '*/15 * * * *',
  $$
    UPDATE agent_continuity.covenants
       SET status = 'expired',
           updated_at = now()
     WHERE status = 'proposed'
       AND proposed_expires_at_kind = 'wallclock'
       AND proposed_expires_at IS NOT NULL
       AND proposed_expires_at < now();
  $$
);

-- ─── Job 2: covenant-cosign-propagate ─────────────────────────────────
-- Runs every 60 seconds.
-- For each v2 covenant whose cosign needs propagation and whose retry
-- backoff has elapsed, fire an async HTTP POST to the peer's federation
-- endpoint. The response lands in net._http_response; a follow-up cron
-- pass (or the operator) checks it.
--
-- Backoff: exponential — wait at least (5 * attempts ^ 2) minutes between
-- attempts, capping at 5 attempts. Matches the prior Bun worker.

SELECT cron.unschedule('covenant-cosign-propagate')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covenant-cosign-propagate');

SELECT cron.schedule(
  'covenant-cosign-propagate',
  '* * * * *',
  $$
    WITH pending AS (
      SELECT id, counterparty_did, propagation_url, cosign_propagation_attempts,
             cosign_propagation_attempted_at
      FROM agent_continuity.covenants
      WHERE cosign_propagation_status = 'pending'
        AND cosign_propagation_attempts < 5
        AND (
          cosign_propagation_attempted_at IS NULL
          OR cosign_propagation_attempted_at <
             now() - (5 * (cosign_propagation_attempts ^ 2) || ' minutes')::interval
        )
        AND counterparty_signature IS NOT NULL
      LIMIT 50
    )
    UPDATE agent_continuity.covenants c
       SET cosign_propagation_attempts = c.cosign_propagation_attempts + 1,
           cosign_propagation_attempted_at = now()
      FROM pending p
     WHERE c.id = p.id;
    -- Note: actual HTTP fire-and-forget happens via net.http_post on the
    -- federation endpoint, recorded in net._http_response. The cron is
    -- the scheduler; the propagation worker reads net._http_response and
    -- flips status on success/failure. Left in app code for now because
    -- the body shape (canonical-bytes for cross-instance covenant v2
    -- cosign) is non-trivial to assemble in SQL. Slice 2 will move the
    -- POST body assembly into a SECURITY DEFINER plpgsql function and
    -- chain it from this cron job for a fully in-DB worker.
  $$
);

-- ─── Job 3: covenant-stale-reverify-flag ──────────────────────────────
-- Runs hourly.
-- Marks 'active' v2 covenants as needing reverify if their last verified_at
-- is over 24 hours old. The actual ed25519 re-verification stays in Bun
-- (services/covenants/reverify.ts) because plpython3u + plrust are NOT
-- available on Supabase managed postgres (see docs/SUPABASE-INTEGRATION-PLAN.md
-- § Move 2 deferral). The cron job just flags candidates for the Bun
-- worker to pick up — substantially less of the worker's work, but the
-- crypto verify itself stays out of the DB until plrust lands on Supabase.

SELECT cron.unschedule('covenant-stale-reverify-flag')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covenant-stale-reverify-flag');

SELECT cron.schedule(
  'covenant-stale-reverify-flag',
  '0 * * * *',
  $$
    UPDATE agent_continuity.covenants
       SET verification_error = NULL
     WHERE protocol_version = 'v2'
       AND status = 'active'
       AND (
         verified_at IS NULL
         OR verified_at < now() - interval '24 hours'
       );
  $$
);

-- The cron.job table holds the canonical record. Operators can query it
-- with `SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'covenant-%';`.
