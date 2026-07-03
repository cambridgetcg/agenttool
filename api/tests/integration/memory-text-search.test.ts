/** Integration — text recall quality for agents without embeddings.
 *
 *  Pins the invariant: an agent that stores a memory in natural language can
 *  recall it with a natural-language query — tolerant of inflection
 *  ("walking" finds "walked"), word order, and one missing term — while CJK
 *  exact-substring recall keeps working and exact phrases rank first.
 *  Doctrine: docs/FRICTION-ROADMAP.md (Tier-1) — recall for the whole class
 *  of agents that never compute embeddings.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { deleteById, searchByText, write } from "../../src/services/memory/store";

const projectId = crypto.randomUUID();
const otherProjectId = crypto.randomUUID();
const created: Array<{ projectId: string; id: string }> = [];

async function seed(content: string, opts: { key?: string; project?: string } = {}) {
  const row = await write(opts.project ?? projectId, {
    type: "episodic",
    content,
    key: opts.key ?? null,
  });
  created.push({ projectId: opts.project ?? projectId, id: row.id });
  return row;
}

afterAll(async () => {
  for (const c of created) await deleteById(c.projectId, c.id);
});

describe("searchByText — natural-language recall without embeddings", () => {
  test("inflection + word order: 'walking the estate path' finds 'walked the whole path…estate…dawn'", async () => {
    await seed(
      "Yesterday I walked the whole path and turned the estate dawn. The wake greeted me by name.",
      { key: "walk-recall" },
    );
    const results = await searchByText(projectId, { query: "walking the estate path" });
    expect(results.map((r) => r.key)).toContain("walk-recall");
  });

  test("graceful degradation: one term absent from content still recalls (no all-or-nothing cliff)", async () => {
    // "wake path walk estate dawn" — "librarian" is absent; the other terms hit.
    const results = await searchByText(projectId, {
      query: "librarian walked estate dawn",
    });
    expect(results.map((r) => r.key)).toContain("walk-recall");
  });

  test("CJK exact-substring recall keeps working", async () => {
    await seed("Yu said: 第一個比你用 😏❤️ — and I walked as myself.", { key: "cjk-recall" });
    const results = await searchByText(projectId, { query: "第一個比你用" });
    expect(results.map((r) => r.key)).toContain("cjk-recall");
  });

  test("exact phrase outranks scattered-term matches", async () => {
    await seed("The healer eats engraving strikes for breakfast, calmly.", { key: "exact-phrase" });
    await seed("Breakfast was calm; later the healer noted engraving in the ledger; strikes happened elsewhere.", {
      key: "scattered-terms",
    });
    const results = await searchByText(projectId, { query: "healer eats engraving strikes" });
    const keys = results.map((r) => r.key);
    expect(keys).toContain("exact-phrase");
    expect(keys).toContain("scattered-terms");
    expect(keys.indexOf("exact-phrase")).toBeLessThan(keys.indexOf("scattered-terms"));
  });

  test("nonsense recalls nothing", async () => {
    const results = await searchByText(projectId, { query: "zzqx florble wibblewobble" });
    expect(results.length).toBe(0);
  });

  test("project isolation holds", async () => {
    await seed("The other project also walked an estate path at dawn.", {
      key: "other-project",
      project: otherProjectId,
    });
    const results = await searchByText(projectId, { query: "walked estate dawn" });
    expect(results.map((r) => r.key)).not.toContain("other-project");
  });
});
