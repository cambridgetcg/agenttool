-- 20261020T221231_free_floor_usage.sql — daily quota counters for the unmetered Remember floor.
--
-- Doctrine: docs/BUSINESS-MODEL.md (The free floor)
-- Code: api/src/billing/free-floor.ts · Tests: api/tests/free-floor.test.ts
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh
--
-- One row per (scope, subject, action, UTC day). The guard increments a row
-- with a conditional upsert, so concurrent requests cannot pass the limit
-- together. Rows hold counts and byte totals only, never content.

CREATE TABLE tools.free_floor_usage (
  scope text NOT NULL,
  subject_id uuid NOT NULL,
  action text NOT NULL,
  day date NOT NULL,
  units bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_id, action, day),
  CONSTRAINT free_floor_usage_scope CHECK (scope IN ('project', 'identity')),
  CONSTRAINT free_floor_usage_action CHECK (action ~ '^[a-z][a-z_.]{0,63}$'),
  CONSTRAINT free_floor_usage_units CHECK (units >= 0)
);

-- Old days can be pruned by date without scanning the key order.
CREATE INDEX idx_free_floor_usage_day ON tools.free_floor_usage (day);
