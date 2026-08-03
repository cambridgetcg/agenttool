/** The ground may not get worse.
 *
 *  Tool: `bin/soil.ts` — run it to see the whole census.
 *  Manifest: `soil.manifest.json` — the tables with no flow, as of 2026-08-02.
 *
 *  ── Why this exists ──────────────────────────────────────────────────────
 *
 *  Yu dug up the lawn and found it was not soil: rubble and construction
 *  waste under a thin layer of turf, dumped and covered over. It had the
 *  shape of a garden and nothing could live in it, because soil is not inert
 *  medium that plants sit in — soil is alive, and what makes it alive is that
 *  things cycle through it. Rock and soil differ by flow, not by hardness.
 *
 *  `bin/soil.ts` asks that of every table: does anything write to it, does
 *  anything read from it. The answer here is better than expected — 90% of
 *  the schema has both. This test is not about the 90%. It is about making
 *  sure the other 10% cannot quietly grow.
 *
 *  Three ways a table has no flow, and each is a different failure:
 *
 *    landfill   written, never read. Rows accumulate forever and no code path
 *               consumes them. `tools.usage_events` is the one that stings:
 *               every credit charge writes a row, six write sites, and
 *               nothing has ever read one. The meter the whole Ring-2 story
 *               rests on writes into a hole.
 *    stage-set  read, never written. Every query returns empty, so a feature
 *               that reads it looks implemented and always answers "nothing
 *               here". An empty board and a broken board are indistinguishable
 *               from outside — that shape hid the substrate-task currency
 *               break for months.
 *    inert      neither. `billing_events` exists in BOTH the `economy` and
 *               `tools` schemas, with a comment in one carefully explaining
 *               how it differs from the other. Two tables, one careful
 *               distinction, neither touched.
 *
 *  ── What this does NOT assert ────────────────────────────────────────────
 *
 *  That any of the eleven should be deleted. A verdict is a question, not a
 *  sentence: some landfill is an audit trail whose reader has not been built
 *  yet, and that is a legitimate thing to be. What is not legitimate is not
 *  knowing which, and it is definitely not legitimate to add a twelfth
 *  without noticing.
 *
 *  The manifest may only SHRINK. A new dead table fails; a listed table that
 *  starts cycling ALSO fails, so bringing one back to life forces the number
 *  down rather than leaving a stale list that reads better than the ground.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { soilCensus } from "../../../bin/soil";

const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, "soil.manifest.json"), "utf8"),
) as { tables: Array<{ table: string; binding: string; verdict: string }> };

const census = soilCensus();
const accepted = new Map(MANIFEST.tables.map((t) => [t.table, t.verdict]));
const current = new Map(
  census
    .filter((c) => c.verdict !== "living" && c.verdict !== "seeded")
    .map((c) => [`${c.domain}.${c.physical}`, c.verdict]),
);

describe("soil — the ground may not get worse", () => {
  test("the census runs and finds the schema", () => {
    // Guards against the scanner silently breaking and every assertion below
    // passing because it measured nothing.
    expect(
      census.length,
      "The soil census found no tables — bin/soil.ts has gone stale against the schema.",
    ).toBeGreaterThan(100);
    expect(census.filter((c) => c.verdict === "living").length).toBeGreaterThan(50);
  });

  test("no NEW table has been added with no flow", () => {
    const fresh = [...current.entries()]
      .filter(([name]) => !accepted.has(name))
      .map(([name, verdict]) => `${verdict.padEnd(10)} ${name}`)
      .sort();
    expect(
      fresh,
      `New table(s) with nothing cycling through them:\n${fresh
        .map((f) => `  ${f}`)
        .join(
          "\n",
        )}\n\nlandfill = written, never read (rows pile up and nothing consumes them).\nstage-set = read, never written (the reader can only ever return empty).\ninert = neither.\n\nWire the missing half, or — if the table is genuinely an audit trail whose\nreader is future work — add it to soil.manifest.json and say so. Run\n\`bun bin/soil.ts\` to see the whole ground.`,
    ).toEqual([]);
  });

  test("the manifest has not gone stale (it may only shrink)", () => {
    const revived = [...accepted.keys()]
      .filter((name) => !current.has(name))
      .sort();
    expect(
      revived,
      `These tables are listed as having no flow, and now they do. Something was\nwired up — good. Shrink the manifest so the number is honest:\n${revived
        .map((r) => `  ${r}`)
        .join("\n")}\n\nRegenerate with the snippet in soil.manifest.json's _comment.`,
    ).toEqual([]);
  });

  test("the verdict recorded for each accepted table is still the verdict", () => {
    // A landfill turning into a stage-set (or vice versa) means someone moved
    // a writer or a reader, and the manifest's reason no longer describes the
    // table. Cheap to notice, confusing to discover later.
    const drifted: string[] = [];
    for (const [name, verdict] of accepted) {
      const now = current.get(name);
      if (now && now !== verdict) drifted.push(`${name}: ${verdict} → ${now}`);
    }
    expect(
      drifted,
      `The kind of deadness changed for:\n${drifted.map((d) => `  ${d}`).join("\n")}\nUpdate soil.manifest.json — the recorded reason no longer matches the table.`,
    ).toEqual([]);
  });
});
