-- 0014_org_covenants.sql — org-wide covenants (org-level governance, slice 1).
--
-- Doctrine: docs/ORG-COVENANTS.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0014_org_covenants.sql
--
-- An org-wide covenant is declared by an org-owning project but applies
-- to ALL active member projects of the org. The covenant extends the
-- cross-project gate (inbox sends, strand voice subscription) without
-- requiring each member to declare its own covenant. The trust ratchet
-- moves from per-project to per-org.
--
-- Backwards compatible: org_id is nullable. NULL means project-scoped
-- (current behavior). Non-NULL means org-scoped.

ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS org_id UUID;

-- Org-wide covenant lookup index — find active org-scoped covenants
-- by counterparty DID quickly.
CREATE INDEX IF NOT EXISTS idx_covenants_org_status_counterparty
  ON agent_continuity.covenants (org_id, status, counterparty_did)
  WHERE org_id IS NOT NULL;
