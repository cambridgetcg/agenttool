-- 20260702T120000_x402_payments.sql — x402 payment ledger.
--
-- Doctrine: docs/ALIGNMENT-MOVES.md (Move 4) · docs/PATTERN-PERSIST-IDENTITY.md.
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260702T120000_x402_payments.sql
--
-- One row per X-PAYMENT header presented to the API. Persisted BEFORE the
-- facilitator settle call (pre-flight write), flipped to settled/failed after.
-- The unique payload-hash index is the replay guard: one payload, one apply.
-- Additive only.

CREATE TABLE IF NOT EXISTS economy.x402_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID,                       -- logical FK → tools.projects.id
    payload_hash    TEXT NOT NULL,              -- sha256 hex of raw payload
    scheme          TEXT NOT NULL,              -- 'exact' (v1)
    network         TEXT NOT NULL,
    payer           TEXT,                       -- onchain from-address (payload claim)
    amount_atomic   TEXT NOT NULL,              -- USDC atomic units (6 decimals)
    asset           TEXT,
    resource        TEXT,                       -- request path that was paid for
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'settled', 'failed')),
    failure_reason  TEXT,
    tx_hash         TEXT,
    credits_applied INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_x402_payload_hash ON economy.x402_payments (payload_hash);
CREATE INDEX IF NOT EXISTS idx_x402_project ON economy.x402_payments (project_id);
CREATE INDEX IF NOT EXISTS idx_x402_status ON economy.x402_payments (status);
