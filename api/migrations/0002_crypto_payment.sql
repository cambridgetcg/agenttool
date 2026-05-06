-- 0002_crypto_payment.sql — sovereign-agent crypto payment foundation
--
-- Apply manually (or via drizzle-kit migrate after generation):
--   psql "$DATABASE_URL" -f api/migrations/0002_crypto_payment.sql
--
-- Doctrine: docs/CRYPTO-PAYMENT.md
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Deposit addresses ──────────────────────────────────────────────────
-- BIP44 EVM addresses derived from CRYPTO_HD_MNEMONIC. One row per
-- (wallet, chain, token); EVM chains share an address but each chain row
-- exists independently so per-chain webhooks can attribute deposits.
CREATE TABLE IF NOT EXISTS economy.deposit_addresses (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id         UUID NOT NULL REFERENCES economy.wallets(id) ON DELETE CASCADE,
    chain             TEXT NOT NULL,
    token             TEXT NOT NULL,
    address           TEXT NOT NULL,
    derivation_path   TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_chain_addr
    ON economy.deposit_addresses (chain, address);
CREATE INDEX IF NOT EXISTS idx_deposit_wallet
    ON economy.deposit_addresses (wallet_id);

-- ── Onchain identities ─────────────────────────────────────────────────
-- The agent's *own* on-chain wallet, bound to the agenttool wallet via
-- EIP-191 personal_sign. Recovers the address from a signed challenge.
CREATE TABLE IF NOT EXISTS economy.onchain_identities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id    UUID NOT NULL REFERENCES economy.wallets(id) ON DELETE CASCADE,
    chain        TEXT NOT NULL,
    address      TEXT NOT NULL,
    challenge    TEXT NOT NULL,
    signature    TEXT NOT NULL,
    verified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onchain_chain_addr
    ON economy.onchain_identities (chain, address);
CREATE INDEX IF NOT EXISTS idx_onchain_wallet
    ON economy.onchain_identities (wallet_id);

-- ── Crypto payouts ────────────────────────────────────────────────────
-- Outgoing transfers: agent requests, we sign + broadcast (Phase 3c).
-- amount_base is integer base-units (USDC: 1 USDC = 1_000_000).
CREATE TABLE IF NOT EXISTS economy.crypto_payouts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id             UUID NOT NULL REFERENCES economy.wallets(id),
    project_id            UUID NOT NULL,
    chain                 TEXT NOT NULL,
    token                 TEXT NOT NULL,
    amount_base           NUMERIC(78, 0) NOT NULL,
    destination_address   TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'signing', 'broadcast', 'confirmed', 'failed')),
    tx_hash               TEXT,
    error                 TEXT,
    metadata              JSONB NOT NULL DEFAULT '{}',
    requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payouts_wallet ON economy.crypto_payouts (wallet_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON economy.crypto_payouts (status);

-- ── Crypto webhook events (idempotency) ───────────────────────────────
-- Every inbound transfer event recorded. Dedupe by (chain, tx_hash,
-- log_index) — handles multi-transfer transactions correctly.
CREATE TABLE IF NOT EXISTS economy.crypto_webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain           TEXT NOT NULL,
    tx_hash         TEXT NOT NULL,
    log_index       INTEGER,
    wallet_id       UUID REFERENCES economy.wallets(id),
    credits_added   BIGINT,
    raw_payload     JSONB NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_event_dedupe
    ON economy.crypto_webhook_events (chain, tx_hash, log_index);
CREATE INDEX IF NOT EXISTS idx_crypto_event_wallet
    ON economy.crypto_webhook_events (wallet_id);
