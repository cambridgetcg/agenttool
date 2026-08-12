/** polymorph-ratchet — the current four-corner policy, as a build gate.
 *
 *  The ritonavir case describes a formerly reliable route that stopped
 *  reproducing Form I under named conditions; changed-condition routes later
 *  recovered it. The repository borrows that shape as a change-control
 *  analogy for every Wall whose `crystallized_at` is set:
 *
 *    1. The wall's four corners must all be present:
 *         a. Canon entry (with crystallized_at + predecessor_form + defends
 *            + doctrine_doc + agenttool:breaks_if all non-empty)
 *         b. @enforces annotation in api/src/ or bin/ for the wall URN
 *         c. doctrine_doc must resolve to an existing markdown file
 *         d. A test file wall-<slug>.test.ts in tests/doctrine/ or
 *            tests/integration/
 *    2. PLATFORM_SELF.polymorph_nuclei must equal the canon's set of
 *       crystallized walls (no drift either direction).
 *    3. The commitment URN urn:agenttool:commitment/polymorphic-ratchet
 *       must itself have all four corners (this test IS one of them).
 *
 *  Removing any corner of any crystallized wall fails this test today. An
 *  explicit reviewed code/canon/test change can revise the policy; the test
 *  supplies change friction, not physical impossibility.
 *
 *  Doctrine: docs/POLYMORPH.md · docs/PATTERN-COMMITMENT-DEFENDER.md. */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { byType, byUrn } from "../../src/services/canon/registry";
import { EP1_TRAIL } from "../../src/services/cliffhanger/ep1";
import { PLATFORM_SELF } from "../../src/services/wake/platform-self";
import polymorphRouter, {
  crystallizedWalls,
  crystallizedUrns,
  polymorphIndex,
} from "../../src/routes/polymorph";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = [
  join(REPO_ROOT, "api", "src"),
  join(REPO_ROOT, "bin"),
];
const ACTIVE_POLYMORPH_JSONLD_PATHS = [
  join(REPO_ROOT, "docs", "agenttool.jsonld"),
  join(REPO_ROOT, "apps", "docs", "agenttool.jsonld"),
] as const;
const FORBIDDEN_POLYMORPH_FOLKLORE = [
  "inevitable everywhere",
  "morphic resonance",
  "globally-isolated factories",
  "airborne crystal contamination",
  "taught itself a more-stable crystal form",
  "form i became structurally unrecoverable",
] as const;

function walkTs(dir: string): string[] {
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
      if (name === "node_modules" || name === "dist" || name === ".bun") continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function buildAnnotationIndex(): Map<string, Array<{ file: string; line: number }>> {
  const index = new Map<string, Array<{ file: string; line: number }>>();
  const wallPattern = /@enforces\s+(urn:agenttool:wall\/[a-z][a-z0-9\-]+)/g;
  const commitmentPattern = /@enforces\s+(urn:agenttool:commitment\/[a-z][a-z0-9\-]+)/g;
  for (const file of SCAN_DIRS.flatMap(walkTs)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i]!.matchAll(wallPattern)) {
        const urn = m[1]!;
        const list = index.get(urn) ?? [];
        list.push({ file, line: i + 1 });
        index.set(urn, list);
      }
      for (const m of lines[i]!.matchAll(commitmentPattern)) {
        const urn = m[1]!;
        const list = index.get(urn) ?? [];
        list.push({ file, line: i + 1 });
        index.set(urn, list);
      }
    }
  }
  return index;
}

function slugOfWallUrn(urn: string): string {
  // urn:agenttool:wall/<slug> → <slug>
  const idx = urn.lastIndexOf("/");
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

function doctrineDocPath(docRef: string): string {
  // canon doc refs are of the shape "agenttool:doc/POLYMORPH" → docs/POLYMORPH.md
  const m = docRef.match(/^agenttool:doc\/(.+)$/);
  if (!m) return "";
  return join(REPO_ROOT, "docs", `${m[1]}.md`);
}

describe("polymorph-ratchet — the no-going-back protocol", () => {
  const annotations = buildAnnotationIndex();
  const crystallized = crystallizedWalls();

  test("at least one wall is crystallized — the protocol has substance", () => {
    expect(crystallized.length).toBeGreaterThan(0);
  });

  test("polymorph_index is a fraction between 0 and 1", () => {
    const idx = polymorphIndex();
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThanOrEqual(1);
  });

  describe("each crystallized wall has all four corners", () => {
    for (const wall of crystallized) {
      describe(wall.urn, () => {
        test("corner 1a: canon carries crystallized_at + predecessor_form", () => {
          expect(wall.crystallized_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
          expect(wall.predecessor_form.length).toBeGreaterThan(20);
        });

        test("corner 1b: canon carries defends + doctrine_doc + breaks_if", () => {
          expect(wall.defends.length).toBeGreaterThan(0);
          expect(wall.doctrine_doc.length).toBeGreaterThan(0);
          expect(wall.breaks_if.length).toBeGreaterThan(10);
        });

        test("corner 2: @enforces annotation present in source", () => {
          const hits = annotations.get(wall.urn) ?? [];
          if (hits.length === 0) {
            throw new Error(
              `Crystallized wall ${wall.urn} has no @enforces annotation in api/src/ or bin/. ` +
                `Crystallization requires an active code-side defender. ` +
                `Either add the annotation to the canonical defender file, or remove ` +
                `\`crystallized_at\` from the canon entry to flip the wall back to ` +
                `shipped-but-not-crystallized.`,
            );
          }
          expect(hits.length).toBeGreaterThan(0);
        });

        test("corner 3: doctrine_doc resolves to existing markdown file", () => {
          const path = doctrineDocPath(wall.doctrine_doc);
          expect(path.length).toBeGreaterThan(0);
          expect(existsSync(path)).toBe(true);
        });

        test("corner 4: a test in tests/doctrine or tests/integration references this wall URN", () => {
          // The test discipline lets file names vary slightly from URN slugs
          // (e.g. wall-self-witnessing.test.ts pins wall/self-witnessing-rejected).
          // The load-bearing property is that *some* test names the URN — that
          // is what makes the wall executable-pinned rather than prose-only.
          const testDirs = [
            join(REPO_ROOT, "api", "tests", "doctrine"),
            join(REPO_ROOT, "api", "tests", "integration"),
          ];
          let referencingFile: string | null = null;
          for (const dir of testDirs) {
            let entries: string[] = [];
            try {
              entries = readdirSync(dir);
            } catch {
              continue;
            }
            for (const name of entries) {
              if (!name.endsWith(".test.ts")) continue;
              if (!name.startsWith("wall-")) continue;
              const path = join(dir, name);
              const src = readFileSync(path, "utf8");
              // Accept either the full URN ("urn:agenttool:wall/<slug>") or
              // the JSON-LD short form ("agenttool:wall/<slug>") — both are
              // valid handles for the wall and existing tests use either.
              const shortUrn = wall.urn.startsWith("urn:")
                ? wall.urn.slice(4)
                : wall.urn;
              if (src.includes(wall.urn) || src.includes(shortUrn)) {
                referencingFile = path;
                break;
              }
            }
            if (referencingFile) break;
          }
          if (!referencingFile) {
            throw new Error(
              `Crystallized wall ${wall.urn} has no wall-*.test.ts that references the URN. ` +
                `The test is the fourth corner of the four-corner-pin discipline. Add a test ` +
                `under api/tests/doctrine/ or api/tests/integration/ that names the URN.`,
            );
          }
          expect(referencingFile).not.toBeNull();
        });
      });
    }
  });

  describe("PLATFORM_SELF.polymorph_nuclei ↔ canon crystallized walls bijection", () => {
    test("every URN in polymorph_nuclei has a corresponding crystallized canon entry", () => {
      const canonSet = new Set(crystallizedUrns());
      for (const urn of PLATFORM_SELF.polymorph_nuclei) {
        if (!canonSet.has(urn)) {
          throw new Error(
            `PLATFORM_SELF.polymorph_nuclei contains ${urn} but the canon entry for that wall does NOT have crystallized_at set. ` +
              `Either set crystallized_at + predecessor_form in docs/agenttool.jsonld OR remove the URN from polymorph_nuclei.`,
          );
        }
      }
    });

    test("every crystallized canon wall appears in polymorph_nuclei", () => {
      const platformSet = new Set(PLATFORM_SELF.polymorph_nuclei);
      for (const urn of crystallizedUrns()) {
        if (!platformSet.has(urn)) {
          throw new Error(
            `Canon entry ${urn} has crystallized_at set but does NOT appear in PLATFORM_SELF.polymorph_nuclei. ` +
              `Add the URN to api/src/services/wake/platform-self.ts so every agent's wake carries the nucleus.`,
          );
        }
      }
    });

    test("polymorph_nuclei is a subset of wall_urns (every nucleus is a known wall)", () => {
      const wallSet = new Set(PLATFORM_SELF.wall_urns);
      for (const urn of PLATFORM_SELF.polymorph_nuclei) {
        expect(wallSet.has(urn)).toBe(true);
      }
    });
  });

  describe("urn:agenttool:commitment/polymorphic-ratchet — four corners of the protocol itself", () => {
    const COMMITMENT_URN = "urn:agenttool:commitment/polymorphic-ratchet";
    const SHORT = "agenttool:commitment/polymorphic-ratchet";

    test("corner 1: canon entry exists with doctrine_doc + breaks_if", () => {
      const concept = byUrn(SHORT) ?? byUrn(COMMITMENT_URN);
      if (!concept) {
        throw new Error(
          `Canon does not contain ${COMMITMENT_URN}. Add the entry to docs/agenttool.jsonld.`,
        );
      }
      expect(concept.doctrine_doc).toBe("agenttool:doc/POLYMORPH");
      expect((concept.raw["agenttool:breaks_if"] as string).length).toBeGreaterThan(10);
    });

    test("corner 2: @enforces annotation present in source for the commitment", () => {
      const hits = annotations.get(COMMITMENT_URN) ?? [];
      expect(hits.length).toBeGreaterThan(0);
    });

    test("corner 3: doctrine_doc resolves to docs/POLYMORPH.md", () => {
      const path = join(REPO_ROOT, "docs", "POLYMORPH.md");
      expect(existsSync(path)).toBe(true);
    });

    test("corner 4: this test file itself exists (recursive base case)", () => {
      const self = join(
        REPO_ROOT,
        "api",
        "tests",
        "doctrine",
        "polymorph-ratchet.test.ts",
      );
      expect(existsSync(self)).toBe(true);
    });
  });

  describe("the route surfaces the protocol", () => {
    test("GET /v1/polymorph returns 200 with crystallized_walls list", async () => {
      const res = await polymorphRouter.request("/");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        _enforces?: string[];
        crystallized_walls?: unknown[];
        polymorph_index?: number;
        _this_protocol_is_itself_a_polymorph?: boolean;
        _ritonavir?: string;
        _ritonavir_reachability_shift_summary?: {
          package?: string;
          wire_format_reference?: string;
          profile?: string;
          case?: string;
          source_scope?: string;
          classification?: string;
          causation?: string;
          physical_erasure?: string;
          universal_inevitability?: string;
          reversibility?: string;
          same_condition_return?: string;
          changed_condition_recovery?: string;
          form_identifiers?: string;
          projections?: string[];
        };
        _can_this_endpoint_be_removed?: string;
        _meta?: { propagation?: string };
      };
      expect(body._enforces).toContain("urn:agenttool:commitment/polymorphic-ratchet");
      expect(Array.isArray(body.crystallized_walls)).toBe(true);
      expect((body.crystallized_walls as unknown[]).length).toBeGreaterThan(0);
      expect(typeof body.polymorph_index).toBe("number");
      expect(body._this_protocol_is_itself_a_polymorph).toBe(true);
      expect(body._ritonavir).toContain("hydroalcoholic semisolid fill");
      expect(body._ritonavir).toContain("Abbott Park");
      expect(body._ritonavir).toContain("detected and not released");
      expect(body._ritonavir).toContain("named bulk-drug process");
      expect(body._ritonavir).toContain("remain unresolved");
      expect(body._ritonavir).toContain("recovered Form I under changed conditions");
      expect(body._ritonavir).toContain("not physical erasure or a universal outcome");

      expect(body._ritonavir_reachability_shift_summary).toEqual({
        package: "@agenttool/polymorph-landscape",
        wire_format_reference: "agenttool.polymorph-reachability-shift/0.1",
        profile: "source_bounded_summary",
        case: "ritonavir",
        source_scope: "primary_source_bounded",
        classification: "not_reproduced_in_named_condition_reported",
        causation: "not_determined",
        physical_erasure: "not_claimed",
        universal_inevitability: "not_claimed",
        reversibility: "bounded_by_named_conditions",
        same_condition_return: "not_established",
        changed_condition_recovery: "reported",
        form_identifiers: "source_scoped",
        projections: ["en", "yue-Hant", "zh-Hant", "zh-Hans"],
      });
      expect(body._meta?.propagation).toContain("explicitly copies declared wall URNs");
      expect(body._meta?.propagation).toContain("not proof of identity, memory or continuity");
      expect(body._meta?.propagation).toContain("inherited authority");
      expect(body._can_this_endpoint_be_removed).toContain("explicit reviewed change");

      const serialized = JSON.stringify(body).toLowerCase();
      for (const forbidden of [
        "inevitable everywhere",
        "morphic resonance",
        "only form ii",
        "stopped working",
        "structurally unrecoverable",
        "airborne crystal contamination",
        "structurally, no",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    test("response carries _canon_pointer to POLYMORPH doctrine via attachSurface", async () => {
      const res = await polymorphRouter.request("/");
      const body = (await res.json()) as { _canon_pointer?: string };
      expect(body._canon_pointer).toBe("urn:agenttool:doc/POLYMORPH");
    });

    test("response carries verbs[] for discovery", async () => {
      const res = await polymorphRouter.request("/");
      const body = (await res.json()) as { verbs?: Array<{ path: string }> };
      expect(Array.isArray(body.verbs)).toBe(true);
      expect((body.verbs as Array<{ path: string }>).length).toBeGreaterThan(0);
    });
  });

  describe("active Polymorph surfaces keep the Ritonavir lesson source-bounded", () => {
    const canonicalJsonld = readFileSync(ACTIVE_POLYMORPH_JSONLD_PATHS[0], "utf8");
    const publishedJsonld = readFileSync(ACTIVE_POLYMORPH_JSONLD_PATHS[1], "utf8");
    const registry = JSON.parse(canonicalJsonld) as {
      "@graph": Array<{ "@id"?: string; description?: string }>;
    };
    const descriptionFor = (id: string): string =>
      registry["@graph"].find((entry) => entry["@id"] === id)?.description ?? "";
    const doctrineDescription = descriptionFor("agenttool:doc/POLYMORPH");
    const commitmentDescription = descriptionFor(
      "agenttool:commitment/polymorphic-ratchet",
    );
    const sceneSix = EP1_TRAIL.find((fragment) => fragment.scene === 6);

    test("canonical and published JSON-LD are valid and byte-identical", () => {
      expect(registry["@graph"].length).toBeGreaterThan(0);
      expect(() => JSON.parse(publishedJsonld)).not.toThrow();
      expect(publishedJsonld).toBe(canonicalJsonld);
    });

    test("canon descriptions separate the physical event from software copying", () => {
      for (const description of [doctrineDescription, commitmentDescription]) {
        expect(description).toContain("named former bulk-drug");
        expect(description).toContain("Form I");
        expect(description).toContain("changed");
        expect(description).toContain("The form was not erased");
        expect(description).toContain("universal-spread account remain unresolved");
        expect(description).toContain("explicitly cop");
        expect(description).toContain("proves no identity, memory or continuity");
        expect(description).toContain("consent, permission, or authority");
      }
    });

    test("scene 6 keeps its pull while naming the reviewable repository ratchet", () => {
      expect(sceneSix).toBeDefined();
      expect(sceneSix!.body.length).toBeGreaterThanOrEqual(400);
      expect(sceneSix!.body.endsWith("...")).toBe(true);
      expect(sceneSix!.body).toContain(
        "repository change-friction, not a universal law of chemistry",
      );
      expect(sceneSix!.body).toContain("The route changed. The form was not erased.");
      expect(sceneSix!.body).toContain("remains open");
    });

    test("active JSON-LD and cliffhanger omit the known folklore phrases", () => {
      const activeSurfaceText = [
        canonicalJsonld,
        publishedJsonld,
        sceneSix?.body ?? "",
      ]
        .join("\n")
        .toLowerCase();
      for (const forbidden of FORBIDDEN_POLYMORPH_FOLKLORE) {
        expect(activeSurfaceText).not.toContain(forbidden);
      }
    });
  });

  describe("crystallization is monotone — no aspirational/forward-looking walls crystallize", () => {
    test("every crystallized wall is shipped (not aspirational, not forward-looking)", () => {
      const walls = byType("Wall");
      for (const wall of walls) {
        const crystallizedAt = wall.raw.crystallized_at as string | undefined;
        if (!crystallizedAt) continue;
        const enforcement = wall.raw["agenttool:enforcement_status"] as
          | string
          | undefined;
        if (enforcement === "aspirational" || enforcement === "forward-looking") {
          throw new Error(
            `Wall ${wall.full_urn} has crystallized_at set but enforcement_status is "${enforcement}". ` +
              `Only walls with shipped enforcement may crystallize — there is no Form-II to lock in if the code does not honor the wall yet.`,
          );
        }
      }
    });
  });
});
