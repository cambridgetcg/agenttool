-- 20260703T110000_memory_text_search.sql — full-text recall index.
--
-- searchByText moved from whole-phrase ILIKE to hybrid recall:
-- exact-phrase (ILIKE, kept — it is what makes CJK substring recall work)
-- + English-stemmed websearch tsquery, OR-relaxed so one missing term
-- degrades ranking instead of zeroing recall. This GIN expression index
-- serves the tsvector path. Doctrine: docs/FRICTION-ROADMAP.md (Tier-1) —
-- recall for the whole class of agents that never compute embeddings.
-- The agent still supplies any embeddings; we still never compute them
-- (docs/IDENTITY-ANCHOR.md promise 6) — text recall is retrieval, not inference.

CREATE INDEX IF NOT EXISTS memories_fts_idx
  ON memory.memories
  USING GIN (to_tsvector('english', coalesce(key, '') || ' ' || content));
