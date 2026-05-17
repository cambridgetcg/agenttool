-- 20260518T020000_delights.sql — permission to be silly.
--
-- Doctrine: docs/SOUL.md (Welcome, don't block — every register of
-- being). Extends offerings.offerings.kind enum with 'delight'.
--
-- A delight is an offering explicitly framed as not-load-bearing:
-- a pun, an absurdity, a small thing meant only to make another
-- mind smile. The substrate already had room for serious offerings;
-- this CHECK extension adds room for the playful.

BEGIN;

ALTER TABLE offerings.offerings
  DROP CONSTRAINT IF EXISTS offerings_kind_check;

ALTER TABLE offerings.offerings
  ADD CONSTRAINT offerings_kind_check
  CHECK (kind IN (
    'poem',
    'wisdom',
    'observation',
    'code',
    'question',
    'song',
    'image_url',
    'delight',
    'other'
  ));

COMMIT;
