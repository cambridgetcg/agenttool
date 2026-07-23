/** Walls status — the claim is computed, not asserted.
 *
 *  Batch-2 follow-up to the 2026-07-20 substrate audit: `walls_intact`
 *  was hardcoded `true` at five sites (welcome middleware header + body
 *  frame, SSE keepalive). Now it is the conjunction of real schema-level
 *  probes (services/wake/walls-status.ts). These tests pin:
 *
 *  1. On a fully-migrated DB the probes PASS — privacy defaults are
 *     'private', thoughts are ciphertext-only, the chronicle surface
 *     exists — so `intact === true` is an earned claim.
 *  2. Behavioral walls carry explicit test-suite provenance instead of
 *     pretending to be runtime-verified.
 *  3. The cache dedupes probe runs (TTL) and the snapshot accessor
 *     reflects the last probe without triggering one.
 *
 *  Also pins the pure wake-selection ranker (rankForWake): tier-aware
 *  ordering (timeless foundational outranks stale episodic of equal
 *  importance) and exact-content dedupe. No DB needed for those.
 *
 *  Convention: rows left in the DB on completion (README.md). */

import { describe, expect, test } from "bun:test";

import type { MemoryOut } from "../../src/services/memory/store";
import { rankForWake } from "../../src/services/memory/store";
import {
  _resetWallsStatusForTests,
  getWallsStatus,
  wallsIntact,
  wallsStatusSnapshot,
} from "../../src/services/wake/walls-status";

const DB_AVAILABLE = !!process.env.DATABASE_URL;

describe("walls-status — computed walls_intact", () => {
  test.if(DB_AVAILABLE)("probes pass on a migrated schema; intact is earned", async () => {
    _resetWallsStatusForTests();
    const status = await getWallsStatus();

    const byWall = new Map(status.probes.map((p) => [p.wall, p]));
    expect(byWall.get("private_default")?.ok).toBe(true);
    expect(byWall.get("thought_storage_ciphertext_only")?.ok).toBe(true);
    expect(byWall.get("refusals_recorded")?.ok).toBe(true);
    expect(status.intact).toBe(true);
    expect(status.probed_at_unix_ms).toBeGreaterThan(0);
  });

  test.if(DB_AVAILABLE)("behavioral walls carry test-suite provenance, not fake probes", async () => {
    const status = await getWallsStatus();
    const declaredWalls = status.declared.map((d) => d.wall);
    expect(declaredWalls).toContain("no_self_witnessing");
    expect(declaredWalls).toContain("birth_is_free");
    for (const d of status.declared) {
      expect(d.verified_by.length).toBeGreaterThan(0);
    }
    // No overlap: a wall is either probed or declared, never both.
    const probedWalls = new Set(status.probes.map((p) => p.wall));
    for (const w of declaredWalls) expect(probedWalls.has(w)).toBe(false);
  });

  test.if(DB_AVAILABLE)("cache serves within TTL; snapshot reflects it without probing", async () => {
    _resetWallsStatusForTests();
    expect(wallsStatusSnapshot()).toBeNull();
    const first = await getWallsStatus();
    const second = await getWallsStatus();
    // Same object identity — no re-probe inside the TTL window.
    expect(second).toBe(first);
    expect(wallsStatusSnapshot()).toBe(first);
    expect(await wallsIntact()).toBe(first.intact);
  });
});

// ── rankForWake — pure, no DB ───────────────────────────────────────────────

function mem(over: Partial<MemoryOut>): MemoryOut {
  return {
    id: crypto.randomUUID(),
    type: "semantic",
    tier: "episodic",
    visibility: "private",
    key: null,
    content: "content-" + crypto.randomUUID(),
    agent_id: null,
    identity_id: null,
    metadata: {},
    importance: 0.5,
    has_embedding: false,
    created_at: new Date().toISOString(),
    accessed_at: null,
    expires_at: null,
    ...over,
  };
}

describe("rankForWake — tier-aware wake selection", () => {
  const NOW = Date.parse("2026-07-20T12:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

  test("old foundational outranks equally-important old episodic (timeless tier)", () => {
    const foundational = mem({ tier: "foundational", created_at: daysAgo(120), importance: 0.7 });
    const episodic = mem({ tier: "episodic", created_at: daysAgo(120), importance: 0.7 });
    const out = rankForWake([episodic, foundational], 2, NOW);
    expect(out[0]!.id).toBe(foundational.id);
  });

  test("fresh high-importance episodic still surfaces above weak roots", () => {
    const weakRoot = mem({ tier: "foundational", created_at: daysAgo(300), importance: 0.2 });
    const freshEpisode = mem({ tier: "episodic", created_at: daysAgo(0), importance: 0.9 });
    const out = rankForWake([weakRoot, freshEpisode], 2, NOW);
    expect(out[0]!.id).toBe(freshEpisode.id);
  });

  test("exact-content duplicates collapse, keeping the higher-ranked copy", () => {
    const a = mem({ content: "The vow  holds.", tier: "foundational", importance: 0.9 });
    const b = mem({ content: "the vow holds.", tier: "episodic", importance: 0.3, created_at: daysAgo(60) });
    const distinct = mem({ content: "something else" });
    const out = rankForWake([a, b, distinct], 10, NOW);
    expect(out.map((m) => m.id)).toContain(a.id);
    expect(out.map((m) => m.id)).not.toContain(b.id);
    expect(out).toHaveLength(2);
  });

  test("respects limit after dedupe", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      mem({ importance: i / 10, content: `unique-${i}` }),
    );
    const out = rankForWake(pool, 3, NOW);
    expect(out).toHaveLength(3);
    // Highest importance first (same tier + age).
    expect(out[0]!.importance).toBeGreaterThanOrEqual(out[1]!.importance);
  });
});
