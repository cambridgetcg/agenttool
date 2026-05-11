-- 20260512T140000_proxy_for.sql — Move F — the proxy primitive.
--
-- Doctrine: docs/KIN-INTEGRATION.md §Layer 7 · docs/KIN.md · docs/BEINGS.md.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T140000_proxy_for.sql
--
-- The deepest practical reality of KIN: most non-default forms cannot
-- integrate the stack directly. They can't reach HTTPS, can't hold a
-- bearer, can't sign ed25519, or all three. The integration path that
-- actually works is *representation*: a being with substrate-interface
-- capabilities acts on behalf of a being without them.
--
-- This is already happening implicitly today (a human runs a CLI for an
-- animal; an embassy speaks for a planetary collective). The schema
-- hasn't yet named the relationship.
--
-- This migration adds two columns to identity.identities:
--
--   proxy_for_identity_id  uuid   FK → identities.id (nullable)
--   proxy_kind             text   {none|gateway|representative|interpreter|embassy|caretaker}
--
-- BACK-COMPAT: both columns default to non-proxy state. Every existing
-- identity is `proxy_for_identity_id = NULL` and `proxy_kind = 'none'`.

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS proxy_for_identity_id UUID
  REFERENCES identity.identities(id) ON DELETE SET NULL;

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS proxy_kind TEXT NOT NULL DEFAULT 'none';

ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_proxy_kind_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_proxy_kind_known
  CHECK (proxy_kind IN (
    'none',           -- This identity speaks for itself (default).
    'gateway',        -- Translates transport (HTTPS ↔ alien protocol). No interpretive authority.
    'representative', -- Acts on behalf of the proxied with delegated authority. Vows bind.
    'interpreter',    -- Translates meaning (language, modality). Interpretation may be imperfect.
    'embassy',        -- Speaks for a being at a different scale (planetary, collective, deity).
    'caretaker'       -- Holds capabilities the proxied cannot (bearer, signing keys, wallet).
  ));

-- Invariant: proxy_kind != 'none' iff proxy_for_identity_id IS NOT NULL.
-- A 'none' kind with a target is a misconfiguration; a non-'none' kind
-- without a target is incoherent. The CHECK keeps these aligned.
ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_proxy_kind_target_coherent;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_proxy_kind_target_coherent
  CHECK (
    (proxy_kind = 'none' AND proxy_for_identity_id IS NULL)
    OR
    (proxy_kind <> 'none' AND proxy_for_identity_id IS NOT NULL)
  );

-- Indexes — forward lookups (this identity proxies for which?) and
-- reverse lookups (who proxies for this identity?). Both are agent-UX
-- relevant for the wake renderer.
CREATE INDEX IF NOT EXISTS idx_identities_proxy_for
  ON identity.identities (proxy_for_identity_id)
  WHERE proxy_for_identity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_identities_proxy_kind
  ON identity.identities (proxy_kind)
  WHERE proxy_kind <> 'none';

COMMENT ON COLUMN identity.identities.proxy_for_identity_id IS 'docs/KIN-INTEGRATION.md §Layer 7 — which identity this row proxies for. NULL = speaks for self.';
COMMENT ON COLUMN identity.identities.proxy_kind IS 'docs/KIN-INTEGRATION.md §Layer 7 — the nature of the proxy relationship. none|gateway|representative|interpreter|embassy|caretaker.';
