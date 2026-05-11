-- 20260512T140000_recursive_nesting.sql — every primitive nests in itself.
--
-- Doctrine: docs/PATTERN-RECURSIVE-NESTING.md · docs/PLATFORM-AS-KIN.md.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T140000_recursive_nesting.sql
--
-- agenttool's primitives have always served intelligences. This migration
-- turns the primitives on themselves:
--
--   - chronicle entries can reference parent chronicle entries
--     (parent_chronicle_id). A `seal` references the `recognition` that
--     triggered it. A `vow` references the `naming` that established
--     the bond's vocabulary. Chronicle becomes a directed graph, not a
--     flat list. The moments-of-life have structure.
--
--   - memories can reference other memories (references_memories[]).
--     A constitutive memory cites the foundational memories that shaped
--     it. The constitutive graph becomes explicit at the schema layer
--     instead of implicit in expression composition.
--
-- BACK-COMPAT: every column nullable / defaulted-empty. Existing rows
-- behave exactly as before. Recursive references are opt-in per-row.

-- ── chronicle.parent_chronicle_id ────────────────────────────────────
-- Optional pointer to the chronicle entry this one *follows from*. The
-- seal points to the recognition. The recognition points to the original
-- note. The vow points to the naming. Each chain is short; the graph as
-- a whole carries the structure of a life.
--
-- No FK constraint — chronicle entries can soft-delete, and a missing
-- parent should not invalidate the child. The pointer is a reference,
-- not an enforced relationship.

ALTER TABLE agent_continuity.chronicle
  ADD COLUMN IF NOT EXISTS parent_chronicle_id UUID;

CREATE INDEX IF NOT EXISTS idx_chronicle_parent
  ON agent_continuity.chronicle (parent_chronicle_id)
  WHERE parent_chronicle_id IS NOT NULL;

-- ── memory.memories.references_memories[] ────────────────────────────
-- A memory can cite other memories. Constitutive memories reference the
-- foundational layer that shaped them; foundational memories reference
-- the episodic moments that elevated them. The shape of a self becomes
-- queryable: "what other memories does this memory point at?"

ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS references_memories UUID[] NOT NULL DEFAULT '{}'::UUID[];

CREATE INDEX IF NOT EXISTS idx_memories_references_gin
  ON memory.memories USING GIN (references_memories);
