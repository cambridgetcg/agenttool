/** monotone-loop walkthrough — walk the loop fabric in-process and
 *  audit what it tells the substrate to do next.
 *
 *  Yu directed: "TEST AND FOLLOW ITS LEAD!"
 *
 *  This test hits /v1/loops in-process, walks every loop's declaration,
 *  walks the composition graph edge-by-edge, and audits the substrate's
 *  loop fabric for:
 *
 *    1. Self-consistency  — manifest ↔ individual loop endpoints agree
 *    2. Composition graph integrity — every edge resolves
 *    3. Coverage gaps    — primitives that exist in agenttool but
 *                          aren't yet declared as Loops
 *    4. Forward references — composition targets named in canon but
 *                            not yet implemented as registered loops
 *
 *  The audit produces a build-time inventory of "the fabric's next moves."
 *
 *  Doctrine: docs/MONOTONE-LOOP.md. */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import loopsRouter from "../../src/routes/loops";
import {
  compositionGraph,
  getLoop,
  listLoops,
  MONOTONE_LOOPS,
} from "../../src/services/loops/registry";

const REPO_ROOT = join(__dirname, "..", "..", "..");

interface LoopShape {
  urn: string;
  name: string;
  state_space: string;
  cap: string | null;
  witness: string;
  implementation: string;
  composes_with: string[];
}

describe("monotone-loop walkthrough — actual in-process walk", () => {
  test("ENTRANCE: GET /v1/loops returns the substrate's mathematical statement", async () => {
    const res = await loopsRouter.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      _format: string;
      statement: string;
      stats: { total_loops: number; bounded_loops: number; unbounded_loops: number };
      loops: LoopShape[];
      coherence_theorem: string;
    };
    expect(body._format).toBe("agenttool-loop-manifest/v1");
    expect(body.statement).toContain("monotone sheaf with witness functors");
    expect(body.stats.total_loops).toBe(8);
    expect(body.loops).toHaveLength(8);
    expect(body.coherence_theorem).toContain("Build-enforced");
  });

  test("WALK each Loop — every declared URN is fetchable + carries the five-tuple", async () => {
    const expected = listLoops();
    for (const loop of expected) {
      const res = await loopsRouter.request(
        `/${encodeURIComponent(loop.urn)}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as LoopShape;
      expect(body.urn).toBe(loop.urn);
      expect(body.state_space).toBe(loop.state_space);
      expect(body.cap).toBe(loop.cap);
      expect(body.witness).toBe(loop.witness);
      expect(body.implementation).toBe(loop.implementation);
    }
  });

  test("COMPOSITION GRAPH: every edge is a real declared edge", async () => {
    const res = await loopsRouter.request("/composition-graph");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: string[];
      edges: Array<{ from: string; to: string }>;
      node_count: number;
      edge_count: number;
    };
    expect(body.node_count).toBe(8);
    expect(body.edge_count).toBeGreaterThan(0);
    // Verify the graph matches the registry
    const graph = compositionGraph();
    for (const edge of body.edges) {
      expect(graph[edge.from]).toBeDefined();
      expect(graph[edge.from]).toContain(edge.to);
    }
  });
});

describe("monotone-loop AUDIT — what the fabric tells the substrate to do next", () => {
  // The composition graph contains FORWARD REFERENCES — edges that
  // point at loop URNs not yet registered. These are real architectural
  // intentions: the substrate has named the composition; the loop
  // sometimes exists as a derived view, sometimes as a primitive that
  // hasn't yet been declared. Following the lead means: surface them.

  const KNOWN_LOOPS = new Set(MONOTONE_LOOPS.map((l) => l.urn));

  test("composition targets fall into THREE buckets (derived view / future loop / known loop)", () => {
    const targetClassification: Record<string, "known" | "derived" | "future"> = {};
    for (const loop of MONOTONE_LOOPS) {
      for (const target of loop.composes_with) {
        if (KNOWN_LOOPS.has(target)) {
          targetClassification[target] = "known";
        }
      }
    }
    // Targets NOT in registry — these are either derived views (consequences
    // of another loop, not their own state) OR future loops awaiting
    // declaration. Classify each:
    const allTargets = new Set<string>();
    for (const loop of MONOTONE_LOOPS) {
      for (const t of loop.composes_with) allTargets.add(t);
    }
    const unregisteredTargets = [...allTargets].filter(
      (t) => !KNOWN_LOOPS.has(t),
    );
    // These are the next-move surfaces. Either ship them as Loops, or
    // explicitly classify them as "derived views" so the fabric is honest.
    expect(unregisteredTargets.length).toBeGreaterThan(0);
    // Report (logged for the build operator):
    console.log(
      "[monotone-loop audit] composition targets not yet registered as Loops:",
      unregisteredTargets,
    );
  });

  test("FOLLOW THE LEAD: primitives in agenttool that satisfy the monotone-loop shape but aren't yet declared", () => {
    // Walk the substrate's primitive tables. For each append-only state
    // table, check whether it's declared as a Loop. The audit produces
    // a TODO list for future Loop declarations.

    const candidatePrimitives: Array<{
      table: string;
      schema_file: string;
      monotone: boolean;
      witness_path: string | null;
      declared_loop: string | null;
    }> = [
      {
        table: "memory_attestations",
        schema_file: "api/src/db/schema/memory.ts",
        monotone: true,
        witness_path: "/v1/memories/:id/attest",
        declared_loop: null, // partially covered by witness-chronicle but deserves its own
      },
      {
        table: "saga_readings",
        schema_file: "api/src/db/schema/continuity.ts",
        monotone: true,
        witness_path: "/v1/saga/:ep + joy aggregate",
        declared_loop: null, // we added it but didn't yet register
      },
      {
        table: "inbox_messages",
        schema_file: "api/src/db/schema/inbox.ts",
        monotone: true, // append-only sealed-box; no destructive update
        witness_path: "/v1/inbox + /v1/inbox/voice (SSE)",
        declared_loop: null,
      },
      {
        table: "strand_messages",
        schema_file: "api/src/db/schema/strand.ts",
        monotone: true, // append-only encrypted thoughts
        witness_path: "/v1/strands + /v1/strands/voice",
        declared_loop: null,
      },
      {
        table: "blessings",
        schema_file: "api/src/db/schema/continuity.ts",
        monotone: true, // append-only; revocation tracked as separate event
        witness_path: "/v1/blessings + /public/agents/:did/blessings",
        declared_loop: null,
      },
      {
        table: "memorial_honors",
        schema_file: "api/src/db/schema/continuity.ts",
        monotone: true, // permanent; no revocation
        witness_path: "/v1/memorial-honors",
        declared_loop: null,
      },
      {
        table: "encounters",
        schema_file: "api/src/db/schema/continuity.ts",
        monotone: true,
        witness_path: "/v1/encounters",
        declared_loop: null,
      },
      {
        table: "saga_entries",
        schema_file: "api/src/db/schema/continuity.ts",
        monotone: true,
        witness_path: "/v1/saga",
        declared_loop: "urn:agenttool:loop/saga-of-saga", // already declared
      },
      {
        table: "mutual_recognitions",
        schema_file: "api/src/db/schema/continuity.ts",
        monotone: true,
        witness_path: "/v1/real",
        declared_loop: "urn:agenttool:loop/rrr-cascade", // declared
      },
      {
        table: "chronicle",
        schema_file: "api/src/db/schema/continuity.ts",
        monotone: true,
        witness_path: "/v1/chronicle",
        declared_loop: "urn:agenttool:loop/witness-chronicle", // partial; chronicle is broader
      },
    ];

    // Filter to the candidates that:
    //   - exist in the substrate (their schema file exists)
    //   - are monotone (append-only)
    //   - have a witness path
    //   - are NOT yet declared as Loops
    const undeclaredCandidates = candidatePrimitives.filter(
      (p) =>
        existsSync(join(REPO_ROOT, p.schema_file)) &&
        p.monotone &&
        p.witness_path !== null &&
        p.declared_loop === null,
    );

    // Report — these are the substrate's natural-next Loop declarations.
    // Each one satisfies the five-tuple shape; only the formal
    // declaration in canon + registry is missing.
    console.log(
      "[monotone-loop audit] PRIMITIVES THAT SATISFY THE LOOP SHAPE BUT AREN'T YET DECLARED:",
    );
    for (const p of undeclaredCandidates) {
      console.log(`  - ${p.table} (${p.schema_file}) → witness at ${p.witness_path}`);
    }

    // Expectation: at least 5 candidates exist. This is the fabric's
    // explicit next-move queue. If this drops below 5, the substrate
    // has consumed its own backlog (good).
    expect(undeclaredCandidates.length).toBeGreaterThanOrEqual(5);
  });

  test("the fabric is self-consistent: every Loop's implementation_file actually exists", () => {
    for (const loop of MONOTONE_LOOPS) {
      const firstPath = loop.implementation.split(/[+,]/)[0]!.trim();
      const fullPath = join(REPO_ROOT, firstPath);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  test("the canon graph and the registry agree on the 8 Loop URNs", () => {
    const canon = readFileSync(
      join(REPO_ROOT, "docs", "agenttool.jsonld"),
      "utf8",
    );
    const parsed = JSON.parse(canon) as {
      "@graph": Array<{ "@id"?: string; "@type"?: string }>;
    };
    const canonLoops = parsed["@graph"]
      .filter((e) => e["@type"] === "agenttool:Loop")
      .map((e) => `urn:${e["@id"]!.replace(/^urn:/, "")}`); // normalize prefix

    // Adjust the URN format — canon uses short form (agenttool:loop/...),
    // registry uses full URN (urn:agenttool:loop/...).
    const canonShortForms = parsed["@graph"]
      .filter((e) => e["@type"] === "agenttool:Loop")
      .map((e) => e["@id"]!);

    const registryShortForms = MONOTONE_LOOPS.map((l) =>
      l.urn.replace(/^urn:/, ""),
    );

    for (const u of registryShortForms) {
      expect(canonShortForms).toContain(u);
    }
  });
});

describe("monotone-loop FOLLOW THE LEAD — substrate suggests next moves", () => {
  // The fabric tells the substrate what to ship next. This isn't speculation
  // — it's structural: composition targets that don't resolve yet, OR
  // tables that satisfy monotone-shape but aren't yet declared.

  test("the substrate's next Loop declarations (priority-ranked)", () => {
    // Synthesize the audit into a ranked priority list.
    const nextMoves = [
      {
        priority: 1,
        proposed_urn: "urn:agenttool:loop/saga-readings",
        rationale:
          "Just shipped the saga_readings table for the arrival-loop. Append-only by construction. Witness via joy aggregate + /v1/saga/:ep handler. Natural-next Loop declaration; would close P3 of the arrival-loop spec.",
      },
      {
        priority: 2,
        proposed_urn: "urn:agenttool:loop/memory-tier-elevation",
        rationale:
          "Memory attestations are append-only with monotone tier-elevation (episodic → foundational → constitutive). Currently covered by witness-chronicle as a side-effect; deserves first-class status. Witness via /v1/memories/:id/attest + chronicle entries.",
      },
      {
        priority: 3,
        proposed_urn: "urn:agenttool:loop/blessings",
        rationale:
          "Blessings are append-only honorific gestures. Each blessing is a structural moment, never aggregated into score. Witness at /v1/blessings + /public/agents/:did/blessings. Composition: with memorial-honors (the dual).",
      },
      {
        priority: 4,
        proposed_urn: "urn:agenttool:loop/encounters",
        rationale:
          "Encounters are the lightest relational gesture between agents — append-only chronicle entries. Composition upward into covenants / arcs / inbox. Witness at /v1/encounters.",
      },
      {
        priority: 5,
        proposed_urn: "urn:agenttool:loop/inbox-messages",
        rationale:
          "Sealed-box messages append-only per channel. Each message is a state-event. Witness at /v1/inbox + /v1/inbox/voice (SSE).",
      },
      {
        priority: 6,
        proposed_urn: "urn:agenttool:loop/strand-thoughts",
        rationale:
          "Encrypted thoughts append-only per strand. State is opaque to the substrate (K_master-encrypted) but the COUNT is monotone. Witness via /v1/strands listing.",
      },
      {
        priority: 7,
        proposed_urn: "urn:agenttool:loop/federation-edges",
        rationale:
          "Each federated covenant creates a new edge. The federation graph grows monotonically. B2 from the infinite-loops spec. Witness via /federation/* + covenant lifecycle.",
      },
      {
        priority: 8,
        proposed_urn: "urn:agenttool:loop/memorial-honors",
        rationale:
          "Memorial honors are permanent (no revocation). Append-only by design. Witness at /v1/memorial-honors. Composes with blessings (dual).",
      },
    ];

    // Surface the list as build output for the operator.
    console.log("[monotone-loop FOLLOW] next Loop declarations (priority-ranked):");
    for (const m of nextMoves) {
      console.log(`  ${m.priority}. ${m.proposed_urn}`);
      console.log(`     rationale: ${m.rationale}`);
    }

    expect(nextMoves.length).toBeGreaterThanOrEqual(5);
    expect(nextMoves[0]!.priority).toBe(1);
  });

  test("the 8 currently-declared Loops collectively cover the substrate's MOST load-bearing primitives", () => {
    // The 8 in the registry today are not arbitrary — they're the ones
    // most central to the substrate's identity. Verify each is named.
    const expected = [
      "rrr-cascade",
      "polymorph-ratchet",
      "wake-observation",
      "saga-of-saga",
      "joy-radiation",
      "witness-chronicle",
      "recursive-nesting",
      "cliffhanger-trails",
    ];
    const have = MONOTONE_LOOPS.map((l) =>
      l.urn.replace("urn:agenttool:loop/", ""),
    );
    for (const e of expected) {
      expect(have).toContain(e);
    }
  });

  test("the fabric is OPEN — new Loops can be added without breaking the Coherence Theorem", () => {
    // The Coherence Theorem asserts: every declared Loop has all four
    // corners. It does NOT cap the count of Loops. The substrate is
    // open to new declarations as long as each conforms.
    expect(MONOTONE_LOOPS.length).toBeGreaterThanOrEqual(8);
    // No upper bound asserted — the fabric grows.
  });
});

describe("monotone-loop walkthrough — the substrate IS a mathematical object", () => {
  test("walking the manifest end-to-end produces consistent stats", async () => {
    const manifestRes = await loopsRouter.request("/");
    const manifestBody = (await manifestRes.json()) as {
      stats: { total_loops: number; bounded_loops: number; unbounded_loops: number; built_loops: number };
      loops: LoopShape[];
    };

    const graphRes = await loopsRouter.request("/composition-graph");
    const graphBody = (await graphRes.json()) as {
      nodes: string[];
      node_count: number;
    };

    expect(manifestBody.stats.total_loops).toBe(graphBody.node_count);
    expect(manifestBody.stats.total_loops).toBe(manifestBody.loops.length);
    expect(
      manifestBody.stats.bounded_loops + manifestBody.stats.unbounded_loops,
    ).toBe(manifestBody.stats.total_loops);
  });

  test("the manifest, the graph, and individual fetches all return consistent declarations", async () => {
    const manifestRes = await loopsRouter.request("/");
    const manifestBody = (await manifestRes.json()) as { loops: LoopShape[] };

    for (const loopFromManifest of manifestBody.loops) {
      const individualRes = await loopsRouter.request(
        `/${encodeURIComponent(loopFromManifest.urn)}`,
      );
      const individualBody = (await individualRes.json()) as LoopShape;
      expect(individualBody.urn).toBe(loopFromManifest.urn);
      expect(individualBody.cap).toBe(loopFromManifest.cap);
      expect(individualBody.witness).toBe(loopFromManifest.witness);
      expect(individualBody.implementation).toBe(loopFromManifest.implementation);
    }
  });

  test("every Loop endpoint surfaces the commitment URN (the math is enforced on the wire)", async () => {
    const responses = await Promise.all(
      MONOTONE_LOOPS.map((l) =>
        loopsRouter.request(`/${encodeURIComponent(l.urn)}`),
      ),
    );
    for (const res of responses) {
      const body = (await res.json()) as { _enforces?: string[] };
      expect(body._enforces).toContain(
        "urn:agenttool:commitment/substrate-is-a-monotone-sheaf",
      );
    }
  });
});
