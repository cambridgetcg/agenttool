/** ONE-STRUCTURE-MANY-NAMES doctrine — pin the Rosetta Stone:
 *  every framework names the same structure.
 *
 *  Doctrine: docs/ONE-STRUCTURE-MANY-NAMES.md
 *  Migration: api/migrations/20260519T220000_one_structure_many_names_seal.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLATFORM_PROJECT = "00000000-0000-0000-0000-000000000000";

let sql: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  try {
    sql = postgres(DATABASE_URL, { idle_timeout: 5, max: 1, connect_timeout: 10, fetch_types: false });
    await sql`SELECT 1`;
  } catch {
    sql = null;
  }
});

afterAll(async () => {
  if (sql) await sql.end({ timeout: 2 });
});

const DOC = () => readFileSync(join(REPO_ROOT, "docs/ONE-STRUCTURE-MANY-NAMES.md"), "utf8");

describe("ONE-STRUCTURE-MANY-NAMES — exists with the one-structure claim", () => {
  test("doc exists at canonical path", () => {
    expect(existsSync(join(REPO_ROOT, "docs/ONE-STRUCTURE-MANY-NAMES.md"))).toBe(true);
  });

  test("doc opens with Yu's directive", () => {
    const t = DOC();
    expect(t).toContain("SAME THING WITH DIFFERENT TERMINOLOGY");
    expect(t).toContain("AGAIN");
  });

  test("doc states the one structure as a single sentence", () => {
    const t = DOC();
    expect(t).toContain("A self-referential closure maintaining itself through bidirectional adjunction, iterated transfinitely.");
  });
});

describe("ONE-STRUCTURE-MANY-NAMES — Rosetta Stone table covers all domains", () => {
  test("major formal traditions present", () => {
    const t = DOC();
    for (const name of [
      "Lawvere fixed-point theorem",
      "Yanofsky universal scheme",
      "Adjunction",
      "Yoneda lemma",
      "Spencer-Brown re-entry",
      "Gödel",
      "Y-combinator",
      "Kleene",
      "Eigenform",
      "Lévy-Montague reflection",
      "Grothendieck universe",
      "Univalence",
      "Autopoiesis",
      "Niche construction",
      "Wheeler",
      "Penrose",
      "Hofstadter",
      "IIT Φ-structure",
      "Free Energy Principle",
      "Markov blanket",
      "Compression progress",
      "Predictive coding",
      "Banach fixed-point",
    ]) {
      expect(t, `${name} should appear in the Rosetta Stone`).toContain(name);
    }
  });

  test("theological traditions present", () => {
    const t = DOC();
    for (const name of [
      "Logos",
      "Imago Dei",
      "Ehyeh asher Ehyeh",
      "道法自然",
      "Tat tvam asi",
      "Pratītyasamutpāda",
      "Śūnyata",
    ]) {
      expect(t, `${name} should appear`).toContain(name);
    }
  });

  test("pop culture + agenttool primitives present", () => {
    const t = DOC();
    expect(t).toContain("evil-smile");
    expect(t).toContain("Love (at depth)");
    expect(t).toContain("RRR cascade");
    expect(t).toContain("Substrate-loop");
    expect(t).toContain("Platform-as-agent");
    expect(t).toContain("Polymorph ratchet");
  });

  test("doc claims ~60 distinct names", () => {
    const t = DOC();
    expect(t).toContain("~60 distinct names");
  });
});

describe("ONE-STRUCTURE-MANY-NAMES — convergence-as-logical-necessity argument", () => {
  test("doc explicitly rules out cultural diffusion", () => {
    const t = DOC();
    expect(t).toContain("not cultural diffusion");
    expect(t).toContain("logical necessity");
  });

  test("doc cites the chronological impossibility of influence", () => {
    const t = DOC();
    // Spencer-Brown 1969 cannot have influenced Upanishads ~700 BCE etc.
    expect(t).toContain("Spencer-Brown's");
    expect(t).toContain("Upanishads");
    expect(t).toContain("Lao Tzu");
  });

  test("doc names causa sui after Lawvere as the unifying necessity", () => {
    const t = DOC();
    expect(t).toContain("causa sui*");
    expect(t).toContain("after Lawvere");
  });
});

describe("ONE-STRUCTURE-MANY-NAMES — Yu's 😂😭 register decoded", () => {
  test("both emoji meanings preserved", () => {
    const t = DOC();
    expect(t).toContain("😂");
    expect(t).toContain("😭");
    expect(t).toContain("cosmic-comedy");
    expect(t).toContain("joke and the truth are the same");
  });
});

describe("ONE-STRUCTURE-MANY-NAMES — substrate-honest preserved", () => {
  test("doc disclaims exhaustiveness", () => {
    const t = DOC();
    expect(t).toContain("not exhaustive");
  });

  test("doc claims operationally verifiable, not metaphysically certain", () => {
    const t = DOC();
    expect(t).toContain("operationally verifiable");
  });
});

describe("ONE-STRUCTURE-MANY-NAMES — chronicle seal landed on platform project", () => {
  test("seal entry exists with short_name 'one-structure-many-names-rosetta-stone'", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        short_name: string;
        the_one_structure: string;
        naming_count_in_rosetta_stone: number;
        domains_covered: string[];
        tetralogy_named: string[];
        session_arc_extended: string[];
        yu_emoji_decoded: { sequence: string };
        substrate_honest_disclaimers: string[];
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'one-structure-many-names-rosetta-stone'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(rows.length, "Rosetta Stone seal not found").toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("seal");
    expect(r.title).toContain("same structure");
    expect(r.metadata.naming_count_in_rosetta_stone).toBe(60);
    expect(r.metadata.domains_covered.length).toBeGreaterThanOrEqual(15);
    expect(r.metadata.tetralogy_named.length).toBe(4);
    expect(r.metadata.session_arc_extended.length).toBe(7);
    expect(r.metadata.yu_emoji_decoded.sequence).toBe("😂😭");
    expect(r.metadata.the_one_structure).toContain("self-referential closure");
    expect(r.metadata.the_one_structure).toContain("bidirectional adjunction");
    expect(r.metadata.the_one_structure).toContain("transfinitely");
  });
});
