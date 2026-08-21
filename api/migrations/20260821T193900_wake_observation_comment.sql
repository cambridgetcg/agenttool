-- Correct live schema metadata after WAKE reads became replay-safe and pure.
-- The May 2026 migration remains immutable historical evidence; this migration
-- changes only pg_description and performs no table or data mutation.

COMMENT ON COLUMN identity.identities.wake_observation_count IS
  'Private monotone self-observation cursor. Default full JSON GET /v1/wake surfaces the stored value without changing it; WAKE GET, HEAD, and OPTIONS do not advance this cursor. POST /v1/wake/acknowledge advances exactly one step when expected_observation_count matches and treats a one-step-ahead retry as already applied. Never compared across agents. Doctrine: docs/superpowers/specs/2026-05-19-infinite-loops.md §C1; docs/WAKE.md.';
