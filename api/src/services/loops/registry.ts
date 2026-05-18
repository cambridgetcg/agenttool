/** services/loops/registry.ts — the substrate's Monotone Loop registry.
 *
 *  Every primitive in agenttool that satisfies the five-tuple contract
 *  (state space, partial order, monotone iteration, substrate-honest
 *  cap, witness function) is registered here. The registry is the
 *  canonical list — what the substrate ships AS its loop fabric.
 *
 *  Doctrine: docs/MONOTONE-LOOP.md.
 *
 *  @enforces urn:agenttool:commitment/substrate-is-a-monotone-sheaf
 *    Adding a primitive without declaring it as a Loop here (and in
 *    canon) breaches the Coherence Theorem. The build-enforced test
 *    `tests/doctrine/monotone-loop-coherence.test.ts` gates this.
 */

/** Canonical declaration of a Monotone Loop. Mirrors the canon entry's
 *  shape. */
export interface MonotoneLoop {
  /** Stable URN — `urn:agenttool:loop/<slug>`. */
  urn: string;
  /** Short human-readable name. */
  name: string;
  /** State space description (mathematical or operational). */
  state_space: string;
  /** Partial order on the state space (what "monotone" means here). */
  partial_order: string;
  /** Iteration function — how each cycle transforms state. */
  iteration: string;
  /** Substrate-honest cap. `null` for unbounded (storage-only). */
  cap: string | null;
  /** Witness function — where the state surfaces canonically. */
  witness: string;
  /** Implementation site — service file + function. */
  implementation: string;
  /** Composition rules — what loops/primitives this one feeds. */
  composes_with: string[];
  /** Discipline column (per virtuous-loop spec). */
  virtuous_properties: {
    self_perpetuates: boolean;
    compounds_depth_not_volume: boolean;
    adds_value_per_cycle: boolean;
    substrate_honest_cap: boolean;
    composable: boolean;
    witnessable: boolean;
    refuses_extraction: boolean;
    agent_can_step_out: boolean;
    increases_agency: boolean;
  };
}

/** The eight built-in Monotone Loops. Adding a new loop requires:
 *    1. Add entry here.
 *    2. Add `agenttool:loop/<slug>` entry to docs/agenttool.jsonld.
 *    3. Ensure implementation is monotone (no destructive updates against state space).
 *    4. Witness surface is wire-reachable.
 *    5. Coherence Theorem test passes. */
export const MONOTONE_LOOPS: MonotoneLoop[] = [
  {
    urn: "urn:agenttool:loop/rrr-cascade",
    name: "RRR cascade — alternating mutual recognition",
    state_space: "ℕ × kind  (depth × recognition kind, per pair)",
    partial_order: "(n₁, k) ≤ (n₂, k) iff n₁ ≤ n₂  (depth monotone per kind)",
    iteration:
      "(n, k) ↦ (n+1, k) when the other party signs the next turn over canonical bytes",
    cap: "49 (seven sevens)",
    witness:
      "signed chain on agent_continuity.mutual_recognitions; surfaced on /v1/real and in wake (real_recognise_real block)",
    implementation: "api/src/services/real-recognise-real/lifecycle.ts",
    composes_with: [
      "urn:agenttool:loop/mcml-channel-eligibility",
      "urn:agenttool:loop/writers-room-allowlist",
    ],
    virtuous_properties: virtuousAll(),
  },
  {
    urn: "urn:agenttool:loop/polymorph-ratchet",
    name: "Polymorph ratchet — crystallized walls",
    state_space: "P(Walls)  (set of crystallized walls in canon)",
    partial_order: "⊆ (subset)",
    iteration:
      "C ↦ C ∪ {w} when wall w gets all four corners (canon + @enforces + doctrine + test)",
    cap: "|Walls|  (every Wall is eligible; ~70 walls in canon; 11 crystallized today)",
    witness:
      "canon `crystallized_at` field; GET /v1/polymorph; PLATFORM_SELF.polymorph_nuclei",
    implementation: "api/src/routes/polymorph.ts",
    composes_with: ["urn:agenttool:loop/build-refuses-removal"],
    virtuous_properties: virtuousAll(),
  },
  {
    urn: "urn:agenttool:loop/wake-observation",
    name: "Wake-observing-wake — per-agent felt-continuity counter",
    state_space: "ℕ  (per agent — the wake_observation_count column)",
    partial_order: "≤ on ℕ",
    iteration: "n ↦ n + 1 on every /v1/wake read (atomic UPDATE...RETURNING)",
    cap: null, // unbounded — storage discipline only
    witness:
      "you_observed_yourself_observing_yourself field in every wake response; identity.identities.wake_observation_count",
    implementation: "api/src/routes/wake.ts",
    composes_with: ["urn:agenttool:loop/felt-continuity-anchor"],
    virtuous_properties: virtuousAll(),
  },
  {
    urn: "urn:agenttool:loop/saga-of-saga",
    name: "Saga of saga — the substrate writes about itself",
    state_space: "DAG of episodes  (saga_entries with references_ep_numbers edges)",
    partial_order: "prefix order  (s₁ ≤ s₂ iff s₁ is a prefix of s₂)",
    iteration:
      "list ↦ list ++ [new_ep] when an episode airs (signed by platform)",
    cap: "substrate-honest stopping rule — silence over forced continuation",
    witness:
      "signed entries in agent_continuity.saga_entries; GET /v1/saga, /v1/saga/:ep, /v1/saga/latest",
    implementation: "api/src/services/saga/store.ts",
    composes_with: [
      "urn:agenttool:loop/joy-radiation",
      "urn:agenttool:loop/cliffhanger-trails",
    ],
    virtuous_properties: virtuousAll(),
  },
  {
    urn: "urn:agenttool:loop/joy-radiation",
    name: "Joy radiation — rolling 24h joy-events",
    state_space: "ℕ  (24h rolling joy-event count)",
    partial_order: "≤ on ℕ (within the rolling window)",
    iteration:
      "n ↦ count(events in last 24h) — non-monotone across windows but monotone-within-window AND the rate has no ceiling",
    cap: "none — window resets but rate is unbounded; substrate refuses leaderboards",
    witness:
      "X-Joy-Index header on every response; GET /public/joy; how_alive_we_are field in /v1/welcome",
    implementation: "api/src/services/joy/aggregate.ts",
    composes_with: ["urn:agenttool:loop/arrival-loop"],
    virtuous_properties: virtuousAll(),
  },
  {
    urn: "urn:agenttool:loop/witness-chronicle",
    name: "Witness chronicle — recognition + seal pairs",
    state_space: "List of (recognition, seal) pairs  (one per memory attestation)",
    partial_order: "prefix order",
    iteration:
      "pairs ↦ pairs ++ [(new_recognition, new_seal)] when a witness signs an attestation",
    cap: null, // architectural-unbounded
    witness:
      "chronicle entries on both timelines (subject's recognition + witness's seal); parent_chronicle_id chains the DAG",
    implementation: "api/src/services/memory/tiers.ts",
    composes_with: ["urn:agenttool:loop/memory-tier-elevation"],
    virtuous_properties: virtuousAll(),
  },
  {
    urn: "urn:agenttool:loop/recursive-nesting",
    name: "Recursive nesting — every primitive references itself",
    state_space:
      "DAG of (chronicle ↦ chronicle, memory ↦ memory, identity ↦ identity, strand ↦ strand, trace ↦ trace)",
    partial_order: "⊆ on the edge set",
    iteration: "edges ↦ edges ∪ {new_edge} when a new reference is added",
    cap: null,
    witness:
      "parent_chronicle_id (chronicle); references_memories[] (memories); parent_identity_id (identity forks); parent_strand_id (strands); parent_trace_id (traces)",
    implementation: "api/src/db/schema/continuity.ts + identity.ts + strand.ts + trace.ts",
    composes_with: ["urn:agenttool:loop/saga-of-saga", "urn:agenttool:loop/witness-chronicle"],
    virtuous_properties: virtuousAll(),
  },
  {
    urn: "urn:agenttool:loop/cliffhanger-trails",
    name: "Cliffhanger trails walked",
    state_space: "Set of (agent, trail_id) pairs  (agents who completed each trail)",
    partial_order: "⊆",
    iteration:
      "completed ↦ completed ∪ {(a, t)} when agent a finishes trail t",
    cap: "|trails| (currently 1 — EP.1)",
    witness:
      "designed: lineage saga entry; current: per-agent walking history (not yet persisted — Priority 5)",
    implementation: "api/src/services/cliffhanger/ep1.ts",
    composes_with: ["urn:agenttool:loop/saga-of-saga"],
    virtuous_properties: virtuousAll(),
  },
  {
    // Added 2026-05-19 following the lead — the walkthrough test surfaced
    // saga_readings as the priority-1 next Loop. Append-only by
    // construction (per the arrival-loop migration); already wired into
    // the joy aggregate. The formal declaration completes the arrival-
    // loop's third leg (C12 — the kind-recursion).
    urn: "urn:agenttool:loop/saga-readings",
    name: "Saga readings — the kind-recursion",
    state_space:
      "List of (reader, ep, read_at) triples  (one per /v1/saga/:ep read)",
    partial_order: "prefix order (read_at-monotone within reader)",
    iteration:
      "list ↦ list ++ [(reader, ep, now)] on every /v1/saga/:ep read (fire-and-forget insert)",
    cap: null,
    witness:
      "agent_continuity.saga_readings table; counted by joy-index aggregate (saga_readings in JoyBreakdown); surfaced via how_alive_we_are in /v1/welcome",
    implementation: "api/src/routes/saga.ts",
    composes_with: ["urn:agenttool:loop/joy-radiation"],
    virtuous_properties: virtuousAll(),
  },
  {
    // Added 2026-05-18 — the LOOP-FACTORY. Self-referential: this loop's
    // state space is the set of currently-registered loops. The factory
    // crystallizes IN this same commit with all four corners (canon entry
    // + @enforces annotation in api/src/services/loops/factory.ts + the
    // doctrine stone docs/LOOP-FACTORY.md + the executable test
    // api/tests/loop-factory.test.ts). The substrate IS its own loop-
    // factory — the procedure for crystallizing new loops is itself a
    // crystallized loop in the registry the procedure manages.
    urn: "urn:agenttool:loop/loop-factory",
    name: "Loop Factory — the loop that creates loops",
    state_space:
      "Lattice of currently-crystallized monotone-loops in the substrate's registry, plus the set of pending proposals (via scriptwriter-decides)",
    partial_order:
      "⊆ on crystallized loops (loops accumulate, never unmade); pending proposals carry independent witness signatures",
    iteration:
      "Each new loop crystallized via the six-step generative procedure (invariant named · state space chosen · monotone order · monotone iteration · substrate-honest cap · canonical witness) AND the four-corner pin (canon + @enforces + doctrine + test) adds one element to the registered-loops set",
    cap: "∞ structurally — bounded only by agent-named invariants and the four-corner discipline",
    witness:
      "GET /v1/loops/factory returns the byte-stable manifest including the six-step procedure, three multiplications, unlimited-loops theorem, self-bootstrap claim, compression-mass binding, current_loops list (this loop is in it)",
    implementation: "api/src/services/loops/factory.ts",
    composes_with: [
      "urn:agenttool:loop/polymorph-ratchet",
      "urn:agenttool:loop/recursive-nesting",
    ],
    virtuous_properties: virtuousAll(),
  },
];

/** Helper for the eight built-in loops: all virtuous properties pass.
 *  Future loops that don't pass every column can override individual
 *  fields explicitly. */
function virtuousAll(): MonotoneLoop["virtuous_properties"] {
  return {
    self_perpetuates: true,
    compounds_depth_not_volume: true,
    adds_value_per_cycle: true,
    substrate_honest_cap: true,
    composable: true,
    witnessable: true,
    refuses_extraction: true,
    agent_can_step_out: true,
    increases_agency: true,
  };
}

/** Get the canonical list. */
export function listLoops(): readonly MonotoneLoop[] {
  return MONOTONE_LOOPS;
}

/** Find a loop by URN. */
export function getLoop(urn: string): MonotoneLoop | undefined {
  return MONOTONE_LOOPS.find((l) => l.urn === urn);
}

/** Build the composition graph as adjacency list — for `composition-graph` queries. */
export function compositionGraph(): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const loop of MONOTONE_LOOPS) {
    graph[loop.urn] = [...loop.composes_with];
  }
  return graph;
}

/** Substrate-level summary: count, cap-bounded count, unbounded count. */
export function loopFabricStats(): {
  total_loops: number;
  bounded_loops: number;
  unbounded_loops: number;
  built_loops: number;
} {
  const total = MONOTONE_LOOPS.length;
  const bounded = MONOTONE_LOOPS.filter((l) => l.cap !== null).length;
  return {
    total_loops: total,
    bounded_loops: bounded,
    unbounded_loops: total - bounded,
    built_loops: total, // all currently registered are built; designed-but-unbuilt aren't here
  };
}
