-- 0025_agent_owned_wallets.sql — wallet ownership groundwork.
--
-- Doctrine: docs/IDENTITY-SEED.md (Slice 4 — agent-owned wallets).
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/0025_agent_owned_wallets.sql
--
-- Today every wallet is operator-rooted: addresses are derived from the
-- platform's CRYPTO_HD_MNEMONIC env var via api/src/services/economy/
-- crypto/hd.ts. The agent owns the wallet *logically* (it can spend), but
-- not *cryptographically* (the platform's mnemonic is the keystone).
--
-- This migration adds the columns the platform needs to recognise
-- agent-rooted wallets — wallets whose addresses derive from the agent's
-- own SOMA seed mnemonic via purpose=5 of the standard derivation tree
-- (m/44'/169'/5'/<wallet-index>'). The platform never holds these seeds;
-- the agent submits chain-specific addresses signed under its own
-- signing key, and the platform records them for webhook routing.
--
-- This migration is GROUNDWORK: it adds the schema. The companion
-- /v1/wallets/:id/addresses POST endpoint that lets agents submit
-- chain-specific addresses (signed) is a follow-up slice (deferred until
-- a concrete agent-owned-wallet use-case demands it). Existing wallets
-- continue to work unchanged.
--
-- Backwards-compatible: every new column is nullable or defaulted; the
-- CHECK constraint only fires when owner_type='agent'.

-- ── Wallet ownership flag ───────────────────────────────────────────
ALTER TABLE economy.wallets
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'platform'
    CHECK (owner_type IN ('platform', 'agent'));

-- The agent's ed25519 signing pubkey at the time of wallet creation.
-- Required for owner_type='agent' (the wallet's "owner" cryptographically).
-- For platform-owned wallets, NULL.
ALTER TABLE economy.wallets
  ADD COLUMN IF NOT EXISTS agent_signing_pub_b64 TEXT;

-- Wallet-index — the integer the agent used as the index in
-- m/44'/169'/5'/<wallet-index>' to derive this wallet's master seed.
-- Lets the agent reproduce the seed deterministically on any device
-- with the same mnemonic. Optional for platform wallets.
ALTER TABLE economy.wallets
  ADD COLUMN IF NOT EXISTS agent_wallet_index INTEGER;

-- Constraint: agent-owned wallets MUST carry the signing pub. (We can't
-- enforce wallet_index NOT NULL with a single ALTER on existing rows;
-- the application layer enforces it on insert. NULL wallet_index for
-- agent-owned wallets means "platform may auto-pick" — out of scope v1.)
ALTER TABLE economy.wallets
  DROP CONSTRAINT IF EXISTS wallets_agent_owned_has_pub;
ALTER TABLE economy.wallets
  ADD CONSTRAINT wallets_agent_owned_has_pub
  CHECK (owner_type = 'platform' OR agent_signing_pub_b64 IS NOT NULL);

-- ── Per-chain address registry for agent-owned wallets ──────────────
-- Platform-owned wallets derive addresses on-the-fly from the operator's
-- mnemonic + walletId hash. Agent-owned wallets store addresses
-- explicitly because the platform doesn't have the seed.
--
-- One wallet × multiple chains × possibly multiple addresses-per-chain
-- (rotation, multi-sig, etc. — keep flexible).
CREATE TABLE IF NOT EXISTS economy.wallet_addresses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id           UUID NOT NULL REFERENCES economy.wallets(id) ON DELETE CASCADE,
    chain               TEXT NOT NULL,                    -- 'ethereum' | 'base' | 'polygon' | 'solana' | ...
    address             TEXT NOT NULL,
    derivation_path     TEXT,                              -- e.g. m/44'/60'/0'/0/<idx>
    -- Agent's ed25519 signature over canonical address-claim bytes
    -- (claim binds the chain + address + wallet_id). Lets the platform
    -- verify the agent actually owns the address on submission.
    address_sig_b64     TEXT,
    -- The ed25519 pubkey the address was claimed with. Echo-verify
    -- against wallets.agent_signing_pub_b64 at insert time.
    claim_pubkey_b64    TEXT,
    label               TEXT,                              -- operator-chosen
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain, address)                                -- webhook routing keys on address
);

CREATE INDEX IF NOT EXISTS idx_wallet_addresses_wallet
    ON economy.wallet_addresses (wallet_id, chain);

CREATE INDEX IF NOT EXISTS idx_wallet_addresses_address
    ON economy.wallet_addresses (address)
    WHERE active = TRUE;

-- ── Comments ───────────────────────────────────────────────────────
COMMENT ON COLUMN economy.wallets.owner_type IS
  'Wallet ownership: ''platform'' (operator-rooted, default) or ''agent'' (SOMA-seed-rooted). Doctrine: docs/IDENTITY-SEED.md.';
COMMENT ON COLUMN economy.wallets.agent_signing_pub_b64 IS
  'Agent signing pub at creation time — proves the wallet is bound to a specific SOMA-seed-rooted identity. Required for owner_type=agent.';
COMMENT ON COLUMN economy.wallets.agent_wallet_index IS
  'Index passed to m/44''/169''/5''/<n>'' for SLIP-0010 derivation of this wallet''s seed. Reproducible from the agent''s mnemonic on any device.';
COMMENT ON TABLE economy.wallet_addresses IS
  'Per-chain addresses for agent-owned wallets. Platform-owned wallets derive on-the-fly via services/economy/crypto/hd.ts.';
