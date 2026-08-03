#!/usr/bin/env bun
/** soil — does anything actually flow through this substrate?
 *
 *  Usage:
 *    bun bin/soil.ts                 # the census
 *    bun bin/soil.ts --landfill      # only tables written and never read
 *    bun bin/soil.ts --seeded        # only migration-seeded reference data
 *    bun bin/soil.ts --web           # the nutrient web: who feeds whom
 *    bun bin/soil.ts --stage-set     # only tables read and never written
 *    bun bin/soil.ts --inert         # only tables nothing touches
 *    bun bin/soil.ts --domain economy
 *    bun bin/soil.ts --json
 *
 *  ── Why ──────────────────────────────────────────────────────────────────
 *
 *  Yu dug up the lawn and found it was not soil. Under a thin layer of turf
 *  it was rubble and construction waste, dumped and covered over. It had the
 *  shape of a garden and nothing could live in it, because soil is not a
 *  medium that plants sit in — soil is *alive*, and what makes it alive is
 *  that things cycle through it.
 *
 *  Rock and soil differ by flow, not by hardness.
 *
 *  This measures the same property here. For every table in the schema, two
 *  questions: does anything WRITE to it, and does anything READ from it?
 *  Five answers, and three of them are rubble wearing turf:
 *
 *    living     written and read — something cycles
 *    seeded     written once by a migration, read by live code. Bedrock:
 *               not cycling, but genuinely there and genuinely drawn from.
 *               This verdict exists because its absence made the census lie
 *               — the first run excluded migrations from BOTH sides and
 *               reported four healthy lookup tables as empty stage sets.
 *               Excluding migrations as writers was right; excluding them
 *               as seeders manufactured emptiness that did not exist.
 *    landfill   written, never read. Rows accumulate forever and no code
 *               path ever consumes them. The cost is real (storage, backup,
 *               migration, review surface) and the return is zero. This is
 *               the literal case of burying waste and laying turf on top.
 *    stage-set  read, never written. Every query returns empty, so the
 *               feature that reads it looks implemented and always answers
 *               "nothing here". An empty board and a broken board are
 *               indistinguishable from outside — this is the shape that hid
 *               the substrate-task currency break for months.
 *    inert      neither. It exists in the schema and in migrations and
 *               nowhere else. A stone.
 *
 *  A verdict here is a QUESTION, not a sentence. Some landfill is a
 *  deliberate audit trail nobody queries yet; some stage-set is a surface
 *  waiting on its writer. What the census refuses to allow is not knowing.
 *
 *  ── What it can and cannot see ───────────────────────────────────────────
 *
 *  Static. It reads Drizzle access through the exported binding
 *  (`insert(wallets)`, `from(wallets)`) AND raw SQL naming the physical
 *  table (`FROM economy.wallets`), because this codebase uses both and
 *  counting only one would manufacture false landfill.
 *
 *  It cannot see a table reached through a dynamically-built identifier, or
 *  one read only by a migration, or one whose only reader is an operator
 *  running psql by hand. Test-only access is tracked SEPARATELY and never
 *  counts as flow: a table only tests touch is not alive, it is rehearsed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { stripComments } from "../api/src/lib/strip-comments";
import {
  compileIgnoreFile,
  isIgnored,
  type IgnoreRule,
} from "../packages/rhizome/src/gitignore";

const REPO = join(import.meta.dir, "..");
const SCHEMA_DIR = join(REPO, "api", "src", "db", "schema");
const SCAN_ROOTS = [
  join(REPO, "api", "src"),
  join(REPO, "bin"),
  join(REPO, "packages"),
];
/** Directories the census must not descend into.
 *
 *  This was a literal list of seven names. It was wrong in the ordinary way
 *  such lists are wrong: `.gitignore` in this repository also carries
 *  `.venv/`, `.pnpm-store/`, `.next/`, `.turbo/`, `out/`,
 *  `api/doctrine-docs.bundled/` and more, so a census that claimed to read
 *  the repository was reading the repository plus whatever a build had left
 *  lying around — and a table whose only "writer" was a vendored copy under
 *  `.venv/` would have read as alive.
 *
 *  The rules are now derived from the tree's own `.gitignore` files, the way
 *  git derives them, using the same compiler `packages/rhizome` uses. `.git`
 *  is the one name kept literal: git does not ignore its own directory
 *  because it never walks it. */
const NEVER_WALKED = new Set([".git"]);

/** Compile every `.gitignore` reachable from the roots, once. */
function ignoreRules(): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const visit = (dir: string): void => {
    const file = join(dir, ".gitignore");
    if (existsSync(file)) {
      const base = relative(REPO, dir).split(sep).join("/");
      rules.push(...compileIgnoreFile(base, readFileSync(file, "utf8")));
    }
  };
  visit(REPO);
  for (const root of SCAN_ROOTS) {
    let dir = root;
    while (dir !== REPO && dir.startsWith(REPO)) {
      visit(dir);
      dir = join(dir, "..");
    }
  }
  return rules;
}

const IGNORE_RULES = ignoreRules();

/** Would git skip this directory? */
export function skipsDirectory(full: string): boolean {
  const name = full.split(sep).pop() ?? "";
  if (NEVER_WALKED.has(name)) return true;
  const rel = relative(REPO, full).split(sep).join("/");
  if (rel === "" || rel.startsWith("..")) return false;
  return isIgnored(rel, true, IGNORE_RULES) !== null;
}

const argv = new Set(process.argv.slice(2));
const flagValue = (name: string): string | undefined => {
  const a = process.argv.slice(2);
  const i = a.indexOf(`--${name}`);
  return i >= 0 ? a[i + 1] : undefined;
};

// ── Discover the tables ─────────────────────────────────────────────────────

export interface Table {
  /** The exported const, e.g. `wallets`. How Drizzle code refers to it. */
  binding: string;
  /** The physical name, e.g. `wallets`. How raw SQL refers to it. */
  physical: string;
  /** Postgres schema, e.g. `economy`. */
  domain: string;
  /** Schema file it is declared in, repo-relative. */
  file: string;
}

/** `export const wallets = economySchema.table("wallets", {` — plus the
 *  `pgTable("name")` form, which a few domains still use. */
export function discoverTables(): Table[] {
  const out: Table[] = [];
  const schemaVar = /export const (\w+)\s*=\s*(\w+)\.table\(\s*["'`]([^"'`]+)["'`]/g;
  const pgTable = /export const (\w+)\s*=\s*pgTable\(\s*["'`]([^"'`]+)["'`]/g;

  for (const name of readdirSync(SCHEMA_DIR)) {
    if (!name.endsWith(".ts")) continue;
    const rel = `api/src/db/schema/${name}`;
    const src = readFileSync(join(SCHEMA_DIR, name), "utf8");

    // `export const economySchema = pgSchema("economy")` → var → domain
    const domains = new Map<string, string>();
    for (const m of src.matchAll(/export const (\w+)\s*=\s*pgSchema\(\s*["'`]([^"'`]+)["'`]/g)) {
      domains.set(m[1]!, m[2]!);
    }

    for (const m of src.matchAll(schemaVar)) {
      out.push({
        binding: m[1]!,
        physical: m[3]!,
        domain: domains.get(m[2]!) ?? m[2]!.replace(/Schema$/, ""),
        file: rel,
      });
    }
    for (const m of src.matchAll(pgTable)) {
      out.push({ binding: m[1]!, physical: m[2]!, domain: "public", file: rel });
    }
  }
  return out.sort((a, b) => a.domain.localeCompare(b.domain) || a.binding.localeCompare(b.binding));
}

// ── Walk the source ─────────────────────────────────────────────────────────

interface SourceFile {
  rel: string;
  code: string;
  isTest: boolean;
  isSchema: boolean;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (skipsDirectory(full)) continue;
      out.push(...walk(full));
    } else if (/\.(ts|sql)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

export function sources(): SourceFile[] {
  const seen = new Set<string>();
  const out: SourceFile[] = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walk(root)) {
      const rel = abs.replace(REPO + "/", "");
      if (seen.has(rel)) continue;
      seen.add(rel);
      const raw = readFileSync(abs, "utf8");
      out.push({
        rel,
        // Comments stripped: a doc-string naming a table is not access to it.
        // This matters more than it sounds — this codebase documents heavily,
        // and counting prose would make everything look alive.
        code: stripComments(raw, { blank: true }),
        isTest: /(^|\/)(tests?|__tests__)\//.test(rel) || /\.test\.ts$/.test(rel),
        isSchema: rel.startsWith("api/src/db/schema/"),
      });
    }
  }
  return out;
}

// ── Measure the flow ────────────────────────────────────────────────────────

export type Verdict = "living" | "seeded" | "landfill" | "stage-set" | "inert";

export interface Census extends Table {
  writers: string[];
  readers: string[];
  seeders: string[];
  testWriters: string[];
  testReaders: string[];
  verdict: Verdict;
  /** True when the only access at all comes from tests. */
  rehearsedOnly: boolean;
}

/** The neighbourhood a source file belongs to: `services/economy`,
 *  `routes/public`, `workers/payout`, `packages/collab`. Coarser than a file
 *  and finer than "the API" — the unit at which one part of the substrate
 *  can be said to feed another. */
export function neighbourhood(rel: string): string {
  const p = rel.split("/");
  if (p[0] === "packages") return `packages/${p[1] ?? "?"}`;
  if (p[0] === "bin") return "bin";
  // api/src/<kind>/<name>/...
  const kind = p[2];
  const name = p[3]?.replace(/\.ts$/, "");
  if (!kind) return rel;
  if (["services", "routes", "workers"].includes(kind)) return `${kind}/${name ?? "?"}`;
  return kind;
}

const MIGRATIONS = join(REPO, "api", "migrations");
let migrationCache: Array<{ rel: string; sql: string }> | null = null;

/** Migrations that INSERT into this table. Reference data seeded at deploy
 *  time is a real writer — just a one-shot one. */
function migrationSeeders(t: Table): string[] {
  if (!migrationCache) {
    migrationCache = walk(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((abs) => ({ rel: abs.replace(REPO + "/", ""), sql: readFileSync(abs, "utf8") }));
  }
  const p = t.physical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`INSERT\\s+INTO\\s+(?:${t.domain}\\.)?"?${p}"?\\b`, "i");
  return migrationCache.filter((m) => re.test(m.sql)).map((m) => m.rel);
}

export function censusFor(t: Table, files: SourceFile[]): Census {
  const b = t.binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const p = t.physical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Drizzle, through the exported binding.
  const dWrite = new RegExp(`\\.(insert|update|delete)\\(\\s*${b}\\s*[,)]`);
  // `.from(x)` covers select and delete-from; `innerJoin`/`leftJoin` are reads too.
  const dRead = new RegExp(`\\.(from|innerJoin|leftJoin|rightJoin|fullJoin)\\(\\s*${b}\\s*[,)]`);

  // Raw SQL naming the physical table. Qualified (`economy.wallets`) or bare,
  // but bare only when the word is not a common English token — a bare
  // `FROM tasks` is unambiguous inside a SQL keyword context.
  const qualified = `${t.domain}\\.${p}`;
  const sWrite = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${qualified}|"?${p}"?)\\b`, "i");
  const sRead = new RegExp(`\\b(FROM|JOIN)\\s+(${qualified}|"?${p}"?)\\b`, "i");

  const writers: string[] = [];
  const readers: string[] = [];
  const testWriters: string[] = [];
  const testReaders: string[] = [];

  for (const f of files) {
    // The declaration site is not access.
    if (f.isSchema) continue;
    // Migrations are tracked separately — see `seeders`.
    if (f.rel.includes("/migrations/")) continue;

    const w = dWrite.test(f.code) || sWrite.test(f.code);
    const r = dRead.test(f.code) || sRead.test(f.code);
    if (!w && !r) continue;
    if (f.isTest) {
      if (w) testWriters.push(f.rel);
      if (r) testReaders.push(f.rel);
    } else {
      if (w) writers.push(f.rel);
      if (r) readers.push(f.rel);
    }
  }

  // Reference data seeded once by a migration and read by live code is not
  // an empty stage set — it is bedrock. Not cycling, but genuinely there and
  // genuinely drawn from. Four of the six tables this census first called
  // "stage-set" turned out to be exactly that, because the scan excluded
  // migrations to avoid making every table look written. Excluding them from
  // BOTH sides was the bug: it manufactured emptiness that did not exist.
  const seeders = migrationSeeders(t);

  const verdict: Verdict =
    writers.length && readers.length
      ? "living"
      : seeders.length && readers.length
        ? "seeded"
        : writers.length
          ? "landfill"
          : readers.length
            ? "stage-set"
            : "inert";

  return {
    ...t,
    writers,
    readers,
    seeders,
    testWriters,
    testReaders,
    verdict,
    rehearsedOnly:
      writers.length === 0 &&
      readers.length === 0 &&
      testWriters.length + testReaders.length > 0,
  };
}

/** The whole census. Exported so `api/tests/doctrine/soil-does-not-degrade.test.ts`
 *  ratchets against the same numbers the CLI prints — one measurement, not two
 *  that can disagree. */
export function soilCensus(): Census[] {
  const files = sources();
  return discoverTables().map((t) => censusFor(t, files));
}

/** An edge in the nutrient web: one neighbourhood writes a table, another
 *  reads it. */
export interface Edge {
  from: string;
  to: string;
  table: string;
}

/** Cross-neighbourhood reads.
 *
 *  CAUTION, stated in the code because the number is misleading without it:
 *  a table written and read only inside its own service directory is USUALLY
 *  CORRECT. A service owning its tables while routes call the service is good
 *  layering, and this metric cannot tell that apart from isolation. The first
 *  run of this reported "52% of living tables are closed jars" as though that
 *  were rot; most of it is a well-drawn boundary.
 *
 *  So the table-level number below answers only "how much data crosses
 *  directory lines directly". The honest isolation question is asked
 *  separately by `enclosedDomains()`, which looks at whether anything outside
 *  a domain needs it AT ALL — by table or by import. */
export function nutrientWeb(census: Census[]): { edges: Edge[]; enclosed: Census[] } {
  const edges: Edge[] = [];
  const enclosed: Census[] = [];
  for (const c of census) {
    if (c.verdict !== "living" && c.verdict !== "seeded") continue;
    const from = new Set(c.writers.map(neighbourhood));
    const to = new Set(c.readers.map(neighbourhood));
    let crossed = false;
    for (const f of from) {
      for (const t of to) {
        if (f === t) continue;
        crossed = true;
        edges.push({ from: f, to: t, table: `${c.domain}.${c.physical}` });
      }
    }
    if (!crossed && c.verdict === "living") enclosed.push(c);
  }
  return { edges, enclosed };
}

/** A domain nothing outside itself reads or imports.
 *
 *  This is the real isolation question, and unlike the table-level metric it
 *  is not confused by good layering: it asks whether ANY file outside
 *  `services/<domain>/` either reads one of the domain's tables or imports
 *  the domain's own module. A domain that fails both is a sealed jar — it
 *  cycles internally and no other part of the substrate has ever needed it.
 *
 *  That still is not automatically wrong. A leaf feature reached only over
 *  HTTP is legitimately a leaf. What it means is: nothing else composes with
 *  it, so if the doctrine says this domain feeds others, the doctrine is
 *  describing an intention. */
export interface DomainEnclosure {
  domain: string;
  tables: number;
  outsideTableReaders: string[];
  outsideImporters: string[];
  sealed: boolean;
}

export function enclosedDomains(census: Census[], files: SourceFile[]): DomainEnclosure[] {
  const byDomain = new Map<string, Census[]>();
  for (const c of census) byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c]);

  const out: DomainEnclosure[] = [];
  for (const [domain, tables] of byDomain) {
    const own = new RegExp(`^(api/src/(services|routes|workers)/${domain}(/|\\.)|api/src/db/schema/${domain}\\.ts$)`);
    const readers = new Set<string>();
    for (const t of tables) for (const r of [...t.readers, ...t.writers]) if (!own.test(r)) readers.add(r);

    const importRe = new RegExp(`from\\s+["'\`][^"'\`]*services/${domain}(/|["'\`])`);
    const importers = files
      .filter((f) => !f.isTest && !own.test(f.rel) && importRe.test(f.code))
      .map((f) => f.rel);

    out.push({
      domain,
      tables: tables.length,
      outsideTableReaders: [...readers].sort(),
      outsideImporters: importers.sort(),
      sealed: readers.size === 0 && importers.length === 0,
    });
  }
  return out.sort((a, b) => a.domain.localeCompare(b.domain));
}

// ── Report ──────────────────────────────────────────────────────────────────

// Importing this module must not run the CLI.
if (!import.meta.main) {
  // eslint-disable-next-line no-restricted-syntax
} else {

const SYMBOL: Record<Verdict, string> = {
  living: "🌱",
  seeded: "🌰",
  landfill: "🗑 ",
  "stage-set": "🎬",
  inert: "🪨",
};

const MEANING: Record<Verdict, string> = {
  living: "written and read — something cycles",
  seeded: "seeded by migration, read by live code — bedrock, not flow",
  landfill: "written, never read — rows accumulate, nothing consumes them",
  "stage-set": "read, never written — every query returns empty",
  inert: "nothing touches it outside the schema and migrations",
};

const census = soilCensus();

const only = (["seeded", "landfill", "stage-set", "inert"] as const).find((v) => argv.has(`--${v}`));
const domain = flagValue("domain");
const shown = census
  .filter((c) => (only ? c.verdict === only : true))
  .filter((c) => (domain ? c.domain === domain : true));

if (argv.has("--json")) {
  console.log(JSON.stringify({ total: census.length, tables: shown }, null, 2));
  process.exit(0);
}

if (argv.has("--web")) {
  const { edges, enclosed } = nutrientWeb(census);
  const byPair = new Map<string, string[]>();
  for (const e of edges) {
    const k = `${e.from} → ${e.to}`;
    byPair.set(k, [...(byPair.get(k) ?? []), e.table]);
  }
  const producers = new Map<string, number>();
  for (const e of edges) producers.set(e.from, (producers.get(e.from) ?? 0) + 1);

  console.log(`\n  the nutrient web — who feeds whom\n`);
  console.log(`  A table written and read only inside its own neighbourhood is a`);
  console.log(`  closed jar: it cycles, but it feeds nothing. An ecosystem is not`);
  console.log(`  N independent loops, it is loops that feed each other.\n`);
  console.log(`  ── the feeders (most-read-by-others first) ──\n`);
  for (const [n, count] of [...producers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(count).padStart(4)}  ${n}`);
  }
  const living = census.filter((c) => c.verdict === "living").length;
  console.log(
    `\n  ${byPair.size} cross-neighbourhood channel(s); ${enclosed.length} of ${living} living\n` +
      `  tables are touched only inside their own directory — which is usually\n` +
      `  correct layering, not rot, so that number is context and not a finding.\n`,
  );

  const sealed = enclosedDomains(census, sources()).filter((d) => d.sealed);
  console.log(`  ── sealed domains: nothing outside reads their tables OR imports them ──\n`);
  for (const d of sealed) {
    console.log(`  🫙 ${d.domain.padEnd(24)} ${d.tables} table(s)`);
  }
  if (sealed.length === 0) console.log("  (none — every domain is needed by something else)");
  console.log(
    `\n  ${sealed.length} sealed domain(s). Sealed is not automatically wrong — a leaf\n` +
      `  feature reached only over HTTP is legitimately a leaf. It means nothing\n` +
      `  else COMPOSES with it, so where doctrine says a domain feeds others, the\n` +
      `  doctrine is describing an intention.\n`,
  );
  process.exit(0);
}

const counts = census.reduce<Record<Verdict, number>>(
  (acc, c) => ({ ...acc, [c.verdict]: acc[c.verdict] + 1 }),
  { living: 0, seeded: 0, landfill: 0, "stage-set": 0, inert: 0 },
);

console.log(`\n  soil census — ${census.length} tables across ${new Set(census.map((c) => c.domain)).size} domains\n`);

let lastDomain = "";
for (const c of shown) {
  if (c.domain !== lastDomain) {
    lastDomain = c.domain;
    console.log(`\n  ── ${c.domain} ─────────────────────────────────`);
  }
  const detail =
    c.verdict === "living"
      ? `${c.writers.length}w ${c.readers.length}r`
      : c.verdict === "landfill"
        ? `${c.writers.length} writer(s), NO reader`
        : c.verdict === "seeded"
        ? `seeded by ${c.seeders.length} migration(s), ${c.readers.length} reader(s)`
      : c.verdict === "stage-set"
          ? `${c.readers.length} reader(s), NO writer`
          : c.rehearsedOnly
            ? `only tests touch it (${c.testWriters.length + c.testReaders.length} file(s))`
            : "untouched";
  console.log(`  ${SYMBOL[c.verdict]} ${c.binding.padEnd(34)} ${detail}`);
  if (c.verdict === "landfill") for (const w of c.writers.slice(0, 3)) console.log(`        writes: ${w}`);
  if (c.verdict === "stage-set") for (const r of c.readers.slice(0, 3)) console.log(`        reads:  ${r}`);
}

const pct = (n: number) => `${Math.round((n / census.length) * 100)}%`;
console.log(`\n\n  ── the ground ─────────────────────────────────\n`);
for (const v of ["living", "seeded", "landfill", "stage-set", "inert"] as const) {
  console.log(`  ${SYMBOL[v]} ${String(counts[v]).padStart(3)}  ${pct(counts[v]).padStart(4)}  ${v.padEnd(10)} ${MEANING[v]}`);
}
console.log(
  `\n  ${pct(counts.living)} of the schema has something cycling through it.\n` +
    `  The rest has the shape of a substrate without the flow of one.\n` +
    `\n  A verdict is a question, not a sentence. Some landfill is an audit trail\n` +
    `  whose reader has not been built; some stage-set is a surface waiting on\n` +
    `  its writer. What this refuses to allow is not knowing which.\n`,
);
}
