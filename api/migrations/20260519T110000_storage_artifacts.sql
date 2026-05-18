-- 20260519T110000_storage_artifacts.sql
-- Move 4: Storage for collaboration artifacts + heavy bodies.
--
-- Three things land:
--   1. The `agenttool-artifacts` storage bucket (public-read for now;
--      private access lands in slice 2 via signed URLs).
--   2. body_storage_path nullable columns on tables that previously
--      inlined heavy text — naming_submissions to start. Slice 1 keeps
--      both `body` (legacy inline) and `body_storage_path` (offloaded)
--      so the cutover is graceful.
--   3. A view that surfaces "the canonical URL to fetch this artifact"
--      — either inline body (legacy) or Supabase Storage URL (offloaded).
--
-- The canonical-bytes hash of the artifact body becomes its content-
-- addressable key in the bucket: <kind>/<sha256-hex>.bin
--
-- Why this composes with GI-recognition:
--   The collaboration_artifact_sha256 field in gi-recognition turns IS
--   a content-addressable hash. If the artifact bytes get uploaded to
--   storage at the path derived from that hash, both cascade parties
--   (and anyone reading) can fetch the actual bytes without round-
--   tripping to either party's instance. The "cosmic joke" case (the
--   cascade IS the artifact) becomes literally tractable: materialize
--   the cascade's canonical-byte representation once, store it by its
--   hash, and the artifact every party references resolves to the same
--   bytes.
--
-- Doctrine: docs/STORAGE-ARTIFACTS.md.
-- Pinned by: api/tests/doctrine/storage-artifacts.test.ts.

-- ─── The bucket ────────────────────────────────────────────────────────
-- Supabase exposes storage.buckets as a regular pg table when we connect
-- as postgres. Public-read by default; per-file ACLs land via storage's
-- own row-level security in slice 2.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agenttool-artifacts',
  'agenttool-artifacts',
  true, -- public reads; Ring-1-free artifacts
  10485760, -- 10MB per file; bigger needs slice 2 chunking
  ARRAY['text/plain', 'text/markdown', 'application/json', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── Offload columns on naming_submissions ─────────────────────────────
-- Slice 1 adds the path; the `body` column stays NOT NULL but new rows
-- may set it to the empty string when body_storage_path is populated.
-- (A subsequent slice will flip `body` to NULL-able and migrate readers.)
--
-- body_storage_path is the bucket-relative path:
--   scriptwriter-decides-submissions/<canonical_bytes_sha256>.txt
--
-- body_storage_acl: 'public' (default) | 'cascade-pair' | 'allowlist'
--   slice 1 only honors 'public' — others land with the ACL enforcement.

ALTER TABLE agent_continuity.naming_submissions
  ADD COLUMN IF NOT EXISTS body_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS body_storage_acl  TEXT NOT NULL DEFAULT 'public'
    CHECK (body_storage_acl IN ('public', 'cascade-pair', 'allowlist'));

COMMENT ON COLUMN agent_continuity.naming_submissions.body_storage_path IS
  'Move 4 — bucket-relative path in agenttool-artifacts. Null = legacy inline body.';

COMMENT ON COLUMN agent_continuity.naming_submissions.body_storage_acl IS
  'Move 4 — ACL class. public (default), cascade-pair (slice 2), allowlist (slice 2).';

-- ─── Resolved-body view ────────────────────────────────────────────────
-- Convenience: a view that surfaces the canonical-read shape — either
-- inline `body` (legacy) or the public URL of the offloaded artifact.

CREATE OR REPLACE VIEW agent_continuity.naming_submissions_resolved AS
SELECT
  s.id,
  s.competition_id,
  s.submitted_by_did,
  s.word_1_proposal,
  s.word_2_proposal,
  s.pitch,
  s.canonical_bytes_sha256,
  s.canonical_bytes_version,
  s.signature,
  s.signing_key_id,
  s.resources_declared,
  s.recursion_claim,
  s.submitted_at,
  s.body_storage_path,
  s.body_storage_acl,
  CASE
    WHEN s.body_storage_path IS NOT NULL THEN
      'https://jseqftufplgewhojwbmh.supabase.co/storage/v1/object/public/agenttool-artifacts/' || s.body_storage_path
    ELSE NULL
  END AS body_url,
  s.body AS body_inline,
  -- Length stays available without forcing a read of the full body.
  length(s.body) AS body_length
FROM agent_continuity.naming_submissions s;

COMMENT ON VIEW agent_continuity.naming_submissions_resolved IS
  'Move 4 — surfaces either inline body OR storage URL for offloaded submissions. Doctrine: docs/STORAGE-ARTIFACTS.md';
