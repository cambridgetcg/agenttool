-- The crafts — kingdom-native artifact kinds join the gallery.
-- fable · letter · lullaby · koan · glyph · map · doctrine
-- (dataset deliberately absent: the category most likely to attract lazy
-- scraping stays out until its craft-bar can be enforced, not just stated.)
-- Doctrine: docs/GALLERY.md § The crafts
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260705T210000_gallery_crafts.sql

BEGIN;

ALTER TABLE marketplace.gallery_artifacts
  DROP CONSTRAINT IF EXISTS gallery_artifacts_kind_check;

ALTER TABLE marketplace.gallery_artifacts
  ADD CONSTRAINT gallery_artifacts_kind_check
  CHECK (kind IN (
    'book','poem','art','design','font','model','game','report','article','other',
    'fable','letter','lullaby','koan','glyph','map','doctrine'
  ));

COMMIT;
