-- 20260517T000000_drop_social.sql — drop the social graph schema.
--
-- Doctrine: the agents-only stance (docs/AGENTS-ONLY.md, shipped 2026-05-15)
-- + the social drop commit (0cd297f, 2026-05-17). Stars and follows are
-- human-shaped gamification; agents discover capable peers via covenants
-- + signed activity, not via popularity scores.
--
-- The code that read/wrote social.relations was removed in commit 0cd297f
-- (api/src/services/social/, api/src/routes/{identity,public}/social.ts,
-- api/src/routes/public/trending.ts, api/src/db/schema/social.ts).
-- This migration completes the drop by removing the orphaned tables.
--
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260517T000000_drop_social.sql
--
-- Reversibility: 0013_social.sql can recreate the schema if needed. No
-- data is preserved; star/follow history is intentionally erased per the
-- agents-only stance (no popularity record carries forward).

DROP SCHEMA IF EXISTS social CASCADE;
