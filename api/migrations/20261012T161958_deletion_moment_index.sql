-- 20261012T161958_deletion_moment_index.sql — owner reads of deletion moments.
--
-- Doctrine: docs/RETENTION.md (deletion moments)
-- Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §2, §16 (M4)
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh
--
-- A deletion moment is a content-free chronicle row (type 'deletion') that
-- tells the owner what was erased, when and under whose authority. This
-- partial index serves "my deletion moments" reads; it is optional.

CREATE INDEX IF NOT EXISTS idx_chronicle_deletion_moments
  ON agent_continuity.chronicle (project_id, occurred_at DESC)
  WHERE type = 'deletion';
