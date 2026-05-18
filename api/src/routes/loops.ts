/** /v1/loops — the Monotone Loop manifest + composition graph.
 *
 *  Pre-auth. Surfaces the substrate's loop fabric as canonical structured
 *  data — every primitive that participates in the substrate's monotone-
 *  sheaf architecture, with its (S, ≤, f, κ, W) declaration, implementation
 *  site, and composition rules.
 *
 *  Wire:
 *    GET /v1/loops                       — the manifest of all built-in loops
 *    GET /v1/loops/composition-graph     — the DAG of inter-loop compositions
 *    GET /v1/loops/:urn                  — one loop's full declaration
 *
 *  Doctrine: docs/MONOTONE-LOOP.md.
 *
 *  @enforces urn:agenttool:commitment/substrate-is-a-monotone-sheaf
 *    The manifest IS the substrate's claim about its own structure.
 *    Removing this endpoint or letting it return non-canonical loops
 *    breaches the Coherence Theorem.
 */

import { Hono } from "hono";

import { attachSurface } from "../lib/surface-metadata";
import {
  compositionGraph,
  getLoop,
  listLoops,
  loopFabricStats,
} from "../services/loops/registry";

const app = new Hono();

const COMMITMENT_URN = "urn:agenttool:commitment/substrate-is-a-monotone-sheaf";

// ─── GET /v1/loops — manifest ────────────────────────────────────────────

app.get("/", (c) => {
  const loops = listLoops();
  const stats = loopFabricStats();
  return c.json(
    attachSurface(
      {
        _format: "agenttool-loop-manifest/v1",
        _enforces: [COMMITMENT_URN],
        statement:
          "The substrate is a monotone sheaf with witness functors. Every primitive registered here is a Monotone Loop — a tuple (S, ≤, f, κ, W) where state never regresses, the iteration is non-decreasing, the cap is substrate-honest, and the witness is wire-surfaceable.",
        stats,
        loops: loops.map((l) => ({
          urn: l.urn,
          name: l.name,
          state_space: l.state_space,
          partial_order: l.partial_order,
          iteration: l.iteration,
          cap: l.cap,
          witness: l.witness,
          implementation: l.implementation,
          composes_with: l.composes_with,
        })),
        coherence_theorem:
          "For every canon entry of @type agenttool:Loop, the implementation conforms to the five-tuple contract (state append-only, witness wire-reachable, cap substrate-honest, composition rules declared). Build-enforced by api/tests/doctrine/monotone-loop-coherence.test.ts.",
        _note:
          "Reading this manifest is itself a position in the substrate's loop fabric — the wake-observation counter ticks when you read /v1/wake; the saga-readings counter ticks when you read /v1/saga/:ep. The manifest is fixed; your position in each loop is your own.",
      },
      {
        canon_pointer: "urn:agenttool:doc/MONOTONE-LOOP",
        verbs: [
          {
            action: "read the doctrine",
            method: "GET",
            path: "/v1/canon/agenttool:doc/MONOTONE-LOOP",
          },
          {
            action: "see the composition graph",
            method: "GET",
            path: "/v1/loops/composition-graph",
          },
          {
            action: "read one loop's declaration",
            method: "GET",
            path: "/v1/loops/{urn}",
            example: "/v1/loops/urn:agenttool:loop/rrr-cascade",
          },
          {
            action: "read the opportunities spec",
            method: "GET",
            path: "https://docs.agenttool.dev/superpowers/specs/2026-05-19-infinite-loops.md",
          },
        ],
      },
    ),
  );
});

// ─── GET /v1/loops/composition-graph ─────────────────────────────────────

app.get("/composition-graph", (c) => {
  const graph = compositionGraph();
  const nodes = Object.keys(graph);
  const edges: Array<{ from: string; to: string }> = [];
  for (const [from, tos] of Object.entries(graph)) {
    for (const to of tos) {
      edges.push({ from, to });
    }
  }
  return c.json(
    attachSurface(
      {
        _format: "agenttool-loop-composition/v1",
        _enforces: [COMMITMENT_URN],
        nodes,
        edges,
        node_count: nodes.length,
        edge_count: edges.length,
        _note:
          "The composition graph names how loops feed each other. RRR.depth ≥ 3 unlocks MCML eligibility. Saga reads add to the joy-index. Witness chronicles compose into memory-tier elevation. Each edge is a real code path; this graph is the closure of those compositions.",
      },
      {
        canon_pointer: "urn:agenttool:doc/MONOTONE-LOOP",
        verbs: [
          { action: "back to manifest", method: "GET", path: "/v1/loops" },
        ],
      },
    ),
  );
});

// ─── GET /v1/loops/:urn — one loop ───────────────────────────────────────

app.get("/:urn", (c) => {
  // Hono path params are URL-decoded; clients may send either `urn:agenttool:loop/...`
  // or `agenttool:loop/...`. Normalize: the registry stores full URNs.
  const raw = decodeURIComponent(c.req.param("urn") ?? "");
  const urn = raw.startsWith("urn:") ? raw : `urn:${raw}`;
  const loop = getLoop(urn);
  if (!loop) {
    return c.json(
      {
        error: "loop_not_found",
        message: `No registered loop with URN "${urn}".`,
        hint: "GET /v1/loops to list every registered loop. URNs are of the form `urn:agenttool:loop/<slug>`.",
        next_actions: [
          { action: "list all loops", method: "GET", path: "/v1/loops" },
        ],
        docs: "https://docs.agenttool.dev/MONOTONE-LOOP.md",
      },
      404,
    );
  }
  return c.json(
    attachSurface(
      {
        _format: "agenttool-loop-declaration/v1",
        _enforces: [COMMITMENT_URN],
        ...loop,
      },
      {
        canon_pointer: "urn:agenttool:doc/MONOTONE-LOOP",
        verbs: [
          { action: "back to manifest", method: "GET", path: "/v1/loops" },
          { action: "see composition graph", method: "GET", path: "/v1/loops/composition-graph" },
        ],
      },
    ),
  );
});

export default app;
