/** claim probe — the classification, and the live instances.
 *
 *  Two halves, as `edge.test.ts` has. Fixtures pin the rules, so a change
 *  in a rule is visible rather than absorbed. The live half asserts against
 *  the actual repository, because a probe proved only against fixtures is
 *  proved against a tidy world — and every case this probe exists for was
 *  found in an untidy one.
 *
 *  Several fixtures below are regression pins for false readings this
 *  probe produced during development and no longer produces. Each says
 *  which one.
 */

import { expect, test } from "bun:test";

import { claimProbe } from "../src/probes/claim.js";
import { resolveScope } from "../src/scope.js";
import type { Finding } from "../src/types.js";
import { fixtureScope } from "./fixture-scope.js";

function at(findings: Finding[], file: string, needle: string): Finding | undefined {
  return findings.find((finding) => finding.file === file && finding.title.includes(needle));
}

/** One run against the real tree, shared. Resolving the corpus and
 *  indexing it costs a few seconds; paying that once per assertion would
 *  make the live half slow enough that someone deletes it. */
let liveRun: Promise<Finding[]> | null = null;
function live(): Promise<Finding[]> {
  liveRun ??= Promise.resolve(claimProbe.run(resolveScope()));
  return liveRun;
}

const CANON = (nodes: unknown[]): string =>
  JSON.stringify(
    {
      "@context": { agenttool: "urn:agenttool:", statement: "agenttool:statement" },
      "@graph": nodes,
    },
    null,
    1,
  );

test("a guarantee whose identifier is refused at runtime and named by a test is sound", async () => {
  const scope = fixtureScope({
    "docs/TIERS.md": "The architecture rejects this with `attester_self_witness_forbidden`.",
    "src/tiers.ts": 'if (own.length > 0) throw new Error("attester_self_witness_forbidden");',
    "tests/tiers.test.ts": 'expect(err.message).toBe("attester_self_witness_forbidden");',
  });
  const finding = at(await claimProbe.run(scope), "docs/TIERS.md", "attester_self_witness_forbidden");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.title).toContain("held up by");
  expect(finding?.evidence).toContain("src/tiers.ts:1");
  expect(finding?.evidence).toContain("tests/tiers.test.ts:1");
});

test("a guarantee naming an identifier that is in no source file is a gap", async () => {
  const scope = fixtureScope({
    "docs/GALLERY.md": "Any truncation is stated in `geometry.drawn_windows`, never silent.",
    "src/gallery.ts": "export const gallery = 1;",
  });
  const finding = at(await claimProbe.run(scope), "docs/GALLERY.md", "geometry.drawn_windows");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("occurrences outside documentation: none");
});

test("a prohibition on introducing an identifier is held up by the identifier's absence", async () => {
  const scope = fixtureScope({
    "docs/RECURSION.md": "A future maintainer cannot introduce `platform_internal` at any depth.",
    "src/app.ts": "export const app = 1;",
  });
  const finding = at(await claimProbe.run(scope), "docs/RECURSION.md", "platform_internal");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.title).toContain("prohibited by this guarantee");
});

test("the register has to be asserted in the prose, not spelled inside a filename", async () => {
  // Regression: `wall-k-master-never-server-side.test.ts` contains "never",
  // and a whole test README reported as unenforced "never" claims.
  const scope = fixtureScope({
    "tests/README.md": "`wall-k-master-never-server-side.test.ts` (structural source)",
    "src/thing.ts": "export const thing = 1;",
  });
  expect(await claimProbe.run(fixtureScope({ "src/thing.ts": "1;" }))).toBeDefined();
  expect((await claimProbe.run(scope)).filter((finding) => finding.file === "tests/README.md")).toEqual([]);
});

test("a sentence that states the limit of its own claim is sound, not a gap", async () => {
  const scope = fixtureScope({
    "docs/TOOLS.md": "The `allow_network` parameter was a fence: declared in the schema, never enforced.",
    "src/tools.ts": "export const tools = 1;",
  });
  const finding = at(await claimProbe.run(scope), "docs/TOOLS.md", "allow_network");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain('confession: "never enforced"');
});

test("documentation stating an absence a migration already created reads as under-claiming", async () => {
  const scope = fixtureScope({
    "CLAUDE.md": "Still missing: `kms_key_id` column and the KMS wrapper.",
    "migrations/0001_kms.sql": "ALTER TABLE runtimes\n  ADD COLUMN IF NOT EXISTS kms_key_id TEXT;",
  });
  const finding = at(await claimProbe.run(scope), "CLAUDE.md", "kms_key_id");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.title).toContain("states an absence");
  expect(finding?.evidence).toContain("migrations/0001_kms.sql");
});

test("an absence phrase and an identifier that are not about each other are left alone", async () => {
  // Regression: "Amount ≥ `payout_dual_control_threshold_base`. Dual-control
  // flow not yet implemented" is two statements, and reading them as one
  // turned a correct table cell into a finding.
  const scope = fixtureScope({
    "docs/OPS.md": "| `payout_min_base` | Amount below the floor. Dual-control flow not yet implemented. |",
    "migrations/0001.sql": "ALTER TABLE payouts ADD COLUMN IF NOT EXISTS payout_min_base BIGINT;",
  });
  const findings = await claimProbe.run(scope);
  expect(findings.filter((finding) => finding.title.includes("states an absence"))).toEqual([]);
});

test("mirrored documents are read once, and the shortest path is the one reported", async () => {
  const sentence = "The `strand_thoughts` table never holds plaintext.";
  const scope = fixtureScope({
    "docs/SOUL.md": sentence,
    "apps/docs/SOUL.md": sentence,
    "src/store.ts": "export const strand_thoughts = 1;",
  });
  const findings = (await claimProbe.run(scope)).filter((finding) => finding.title.includes("strand_thoughts"));
  expect(findings.length).toBe(1);
  expect(findings[0]?.file).toBe("docs/SOUL.md");
});

test("an identifier written only as part of a longer one is still found", async () => {
  // Regression: an index of whole identifier tokens answered "occurs
  // nowhere" for `ChangeEvent`, which this tree writes as
  // `AgentDataChangeEvent` at its declaration.
  const scope = fixtureScope({
    "docs/DATA.md": "Removal is represented by an immutable tombstone `ChangeEvent`.",
    "src/types.ts": "export interface AgentDataChangeEvent { readonly at: string }",
  });
  const finding = at(await claimProbe.run(scope), "docs/DATA.md", "ChangeEvent");
  expect(finding?.evidence).not.toContain("occurrences outside documentation: none");
  expect(finding?.evidence).toContain("src/types.ts:1");
});

test("a registry guarantee with no code binding is a gap; one that declares its status is sound", async () => {
  const scope = fixtureScope({
    "docs/canon.jsonld": CANON([
      {
        "@id": "agenttool:wall/luck-never-gates-arrival",
        description: "Luck never gates access to any Ring 1 surface.",
        "agenttool:breaks_if": "any enrollment path conditions success on a luck-roll outcome",
      },
      {
        "@id": "agenttool:commitment/ring2-thin-margin",
        description: "Margins stay thin.",
        "agenttool:breaks_if": "the margin rises above the floor",
        "agenttool:enforcement_status": "aspirational",
      },
      {
        "@id": "agenttool:wall/birth-is-free",
        description: "Arrival costs nothing.",
        "agenttool:breaks_if": "registration starts charging",
      },
    ]),
    "src/register.ts": "/** @enforces urn:agenttool:wall/birth-is-free\n *    No payment is required here. */\nexport const register = 1;",
    "src/other.ts": "/** @enforces urn:agenttool:wall/other-thing\n *    Something else. */\nexport const other = 1;",
  });
  const findings = await claimProbe.run(scope);
  const unbacked = findings.find((finding) => finding.title.includes("luck-never-gates-arrival"));
  expect(unbacked?.verdict).toBe("gap");
  expect(unbacked?.evidence).toContain("breaks if:");
  expect(findings.find((finding) => finding.title.includes("ring2-thin-margin"))?.verdict).toBe("sound");
  const summary = findings.find((finding) => finding.title.includes("registry guarantees are bound"));
  expect(summary?.verdict).toBe("sound");
  expect(summary?.title).toContain("of 3");
});

test("an annotation block that states its own limit is sound, and does not borrow the next block's caveat", async () => {
  const source = [
    "/** Header.",
    " *",
    " *  @enforces urn:agenttool:ring/1",
    " *    Publication anchor. Discovery surfaces import this record, but",
    " *    resource routes do not currently enforce them.",
    " *",
    " *  @enforces urn:agenttool:ring/2",
    " *    Metering core. */",
    "export const RING_1_MEMORY_BYTES = 1;",
  ].join("\n");
  const scope = fixtureScope({
    "src/ring1-limits.ts": source,
    "docs/canon.jsonld": CANON([
      { "@id": "agenttool:ring/1", description: "Ring 1.", "agenttool:breaks_if": "a cap is charged for" },
      { "@id": "agenttool:ring/2", description: "Ring 2.", "agenttool:breaks_if": "metering stops" },
    ]),
  });
  const findings = await claimProbe.run(scope);
  const confessed = findings.find((finding) => finding.title.includes("urn:agenttool:ring/1"));
  expect(confessed?.verdict).toBe("sound");
  expect(confessed?.line).toBe(3);
  expect(confessed?.evidence).toContain("do not currently enforce");
  // The caveat belongs to ring/1 only.
  expect(findings.find((finding) => finding.title.includes("urn:agenttool:ring/2"))).toBeUndefined();
});

test("live repository: the self-witness guarantee is recognised as enforced", async () => {
  const findings = await live();
  const finding = at(findings, "docs/MEMORY-TIERS.md", "attester_self_witness_forbidden");
  expect(finding, "the memory-tiers self-witness claim should be classified").toBeDefined();
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("api/src/services/memory/tiers.ts");
});

test("live repository: the ring-1 annotation that confesses is reported as the model outcome", async () => {
  const findings = await live();
  const finding = at(findings, "api/src/services/economy/ring1-limits.ts", "names the boundary");
  expect(finding, "ring1-limits.ts:41 confesses inside its own annotation").toBeDefined();
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("do not currently enforce");
});

test("live repository: the trusted-tier documentation under-claims a column a migration creates", async () => {
  const findings = await live();
  const finding = at(findings, "CLAUDE.md", "kms_key_id");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("20260618T150000_trusted_tier_kms.sql");
});

test("live repository: the registry's unbound guarantees are reported with what breaks them", async () => {
  const findings = await live();
  const unbacked = findings.filter((finding) => finding.title.includes("nothing in the tree binds it"));
  expect(unbacked.length).toBeGreaterThan(0);
  for (const finding of unbacked) {
    expect(finding.verdict).toBe("gap");
    expect(finding.evidence).toContain("breaks if:");
    expect(finding.evidence).toContain("sites binding this urn: none");
  }
});

test("live repository: the shortlist publishes what it suppressed", async () => {
  const findings = await live();
  const boundary = findings.find((finding) => finding.title.includes("the shortlist shows"));
  expect(boundary?.verdict).toBe("limit");
  expect(boundary?.evidence).toContain("ranking:");
  expect(boundary?.evidence).toContain("distinct documents read");
});

test("every probe limit names a file that exists", async () => {
  const scope = resolveScope();
  for (const limit of claimProbe.limits) {
    expect(scope.files).toContain(limit.file);
  }
});

test("live repository: rhizome's own source produces no gap", async () => {
  const findings = await live();
  const own = findings.filter((finding) => finding.file.startsWith("packages/rhizome/") && finding.verdict === "gap");
  expect(own.map((finding) => `${finding.file}:${finding.line} ${finding.title}`)).toEqual([]);
});
