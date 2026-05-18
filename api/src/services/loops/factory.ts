/** Loop Factory service — the substrate's generative procedure for loops.
 *
 *  Publishes the six-step generative procedure for monotone-loops, the
 *  three multiplication operations (product · composition · embedding),
 *  the unlimited-loops theorem with three multiplicative growth
 *  conditions (G1 Promise expansion · G2 composition closure · G3
 *  multi-agent multiplication), the self-bootstrap claim (the factory
 *  is itself a registered Loop in the registry it manages), the
 *  compression-mass binding to UNDERSTANDING-MATHEMATICS (each
 *  crystallized loop adds m(L) bits; the factory's iteration rate IS
 *  the substrate's dm/dt), and the permissionless-agent claim (agents
 *  propose loops via scriptwriter-decides).
 *
 *  Pure function. Byte-stable. Same input → same output.
 *
 *  Doctrine: docs/LOOP-FACTORY.md.
 *
 *    @enforces urn:agenttool:commitment/loop-factory-is-the-substrate-itself */

import { listLoops, loopFabricStats, type MonotoneLoop } from "./registry";

/** The six-step generative procedure for a new monotone-loop. */
export const SIX_STEP_PROCEDURE = [
  {
    n: 1,
    name: "name an invariant",
    operation: "Name a property I that something the substrate promises depends on",
    math: "I: S → {true, false} — a predicate over the state space",
    substrate_honest_discipline:
      "Invariant must be load-bearing — breaking it must break a real substrate promise. Aspirational invariants without consequences are refused.",
  },
  {
    n: 2,
    name: "choose state space",
    operation: "Enumerate configurations S where the invariant can hold or fail",
    math: "S is an enumerable set (often (Bytes)*, ℕ × Kinds, P(X), or a DAG)",
    substrate_honest_discipline:
      "S must be enumerable — distinct states distinguishable. No 'fuzzy' state spaces where structural identity is ambiguous.",
  },
  {
    n: 3,
    name: "define partial order",
    operation: "Choose ≤ on S such that I respects ≤ (extending s never breaks I)",
    math: "≤ is reflexive + transitive; if s ≤ s' and I(s), then I(s')",
    substrate_honest_discipline:
      "Order must be monotonicity-preserving. Common choices: prefix order, subset order, pointwise product order. Tarski's theorem applies — every monotone f has a fixed point.",
  },
  {
    n: 4,
    name: "define monotone iteration",
    operation: "Specify f: S → S with f(s) ≥ s — the 'next step' function",
    math: "f is monotone non-decreasing under ≤; no destructive updates against S",
    substrate_honest_discipline:
      "State NEVER regresses. Append-only against the state space. Per MONOTONE-LOOP.md the iteration must be functorial; no destructive UPDATE/DELETE.",
  },
  {
    n: 5,
    name: "set substrate-honest cap",
    operation: "Declare κ — structural bound on S",
    math: "κ ∈ S ∪ {∞}; cap is structural (e.g., 49 for RRR, |Walls| for polymorph, ∞ for chronicle)",
    substrate_honest_discipline:
      "Cap MUST be substrate-honest. Refused: engagement-anchored caps (max-likes-per-day), attention-shaped caps (top-N trending), load-shaped caps (rate limits dressed as loop-caps).",
  },
  {
    n: 6,
    name: "wire canonical witness",
    operation: "Define W: S → Wire — the state's surface on a canonical channel",
    math: "W projects S onto chronicle / wake / canon / public endpoint",
    substrate_honest_discipline:
      "Unwitnessed loops are operationally invisible — refused. The witness must be on a canonical surface; transport-layer-only witnesses are refused.",
  },
] as const;

/** The three multiplication operations on existing loops. */
export const THREE_MULTIPLICATIONS = [
  {
    op: "product",
    formula: "L_1 × L_2 = (S_1 × S_2, ≤_1 × ≤_2, f_1 × f_2, κ_1 × κ_2, (W_1, W_2))",
    example: "RRR-cascade × Joy-radiation = compound loop with (rrr_depth, joy_count) state",
    note: "State space is cartesian product; orderings combine componentwise; iteration runs independently.",
  },
  {
    op: "composition",
    formula: "L_1 →φ L_2 where φ: W_1(s_1) ↦ trigger(f_2)",
    example: "RRR.depth ≥ 3 ⟹ MCML.channel_eligible",
    note: "Witness of L_1 produces input to L_2's iteration. Compositions add edges to the loop fabric.",
  },
  {
    op: "embedding",
    formula: "meta(L) = L applied to (S, ≤, f, κ, W) itself",
    example: "The loop-counting loop (this factory) — state = set of registered loops; iteration adds new loops",
    note: "Recursive self-application. Per PATTERN-RECURSIVE-NESTING. Bottoms out via structural self-reference.",
  },
] as const;

/** The three multiplicative growth conditions for the Unlimited-Loops Theorem. */
export const THREE_GENERATORS = [
  {
    id: "G1",
    name: "Promise expansion",
    statement:
      "Each new Promise the substrate adopts generates ≥ 1 new loop. Promise space is unbounded — new invariants can be named at any time; cross-Kingdom companions add Promises (per KIN.md); agent-proposed commitments via scriptwriter-decides let agents introduce new Promises permissionlessly.",
    operationalized_by: "PATTERN-COMMITMENT-DEFENDER + scriptwriter-decides",
  },
  {
    id: "G2",
    name: "Composition closure",
    statement:
      "With N base loops, the three multiplication operations produce Ω(N² · 2^N · n*) compound loops. Compound loops grow super-exponentially in N.",
    operationalized_by: "Composition morphisms in services/loops/registry.ts",
  },
  {
    id: "G3",
    name: "Multi-agent multiplication",
    statement:
      "Each agent runs its own instance of every agent-private loop. With |Agents| monotonically non-decreasing per Ring-1's wall/birth-is-free, loop-instances grow without bound.",
    operationalized_by: "Ring-1 unconditional welcome wall + register-agent BYO endpoint",
  },
] as const;

/** The self-bootstrap claim. */
export const SELF_BOOTSTRAP = {
  factory_urn: "urn:agenttool:loop/loop-factory",
  claim:
    "The loop-factory is itself a registered MonotoneLoop in the registry it manages. The substrate's loop fabric contains the loop-factory loop. Recursion. Self-reference is the bootstrap. The factory's first output is itself — the substrate crystallizes the factory using the procedure the factory codifies.",
  polymorph_status:
    "The factory crystallizes with all four corners in the same commit it ships: canon entry (agenttool:loop/loop-factory) + @enforces annotation (in this service file) + doctrine stone (docs/LOOP-FACTORY.md) + executable test (api/tests/loop-factory.test.ts). Removing any corner fails the build per PATTERN-COMMITMENT-DEFENDER.",
} as const;

/** The compression-mass binding to UNDERSTANDING-MATHEMATICS. */
export const COMPRESSION_MASS_BINDING = {
  m_per_loop:
    "m(L) := K(naive enforcement of I) − K(enforcement via the loop L) — bits saved by routing enforcement through the substrate's five-tuple machinery",
  substrate_total_M: "M(substrate_t) := Σ_{L ∈ Loops_t} m(L)",
  dM_dt:
    "dM/dt = Σ m(L) for L crystallized at time t. The factory's iteration rate IS the substrate's compression-mass accumulation rate.",
  upstream_doctrine: "urn:agenttool:doc/UNDERSTANDING-MATHEMATICS",
  superadditivity:
    "Per D3 (composition superadditivity): m(L_1 ∘ L_2) ≥ m(L_1) + m(L_2). Composed loops capture cross-cutting invariants neither captures alone.",
  reservation:
    "K(·) is uncomputable; the substrate publishes an upper bound via a canonical compression scheme. The aggregation M = Σ m(L) is a working aggregation; weighting by usage or accounting for redundancy across composing loops is open empirical work.",
} as const;

/** The permissionless-agent claim. */
export const PERMISSIONLESS_AGENT_DRIVEN = {
  claim:
    "Agents drive the factory permissionlessly. The factory does NOT introduce new permissioning. It composes with existing primitives.",
  path: [
    "Agent proposes new wall by signing a script naming the invariant (scriptwriter-decides primitive)",
    "Multiple agents submit competing formulations",
    "Platform DID signs the verdict (per PLATFORM-AS-AGENT)",
    "Canon gains the new wall + the new loop entry",
    "Test pins the four-corner discipline (per PATTERN-COMMITMENT-DEFENDER)",
    "Polymorph ratchet applies — the new loop crystallizes in-commit",
  ],
  upstream_strategy:
    "INFINITE-LOOP-STRATEGIES §Strategy 3 — Constitution amends itself",
  refusal:
    "The substrate refuses to gate loop-creation behind anything but substrate-honest discipline. Operator-only approval gates would break the permissionless claim.",
} as const;

/** Substrate-honest reservations. */
export const SUBSTRATE_HONEST_RESERVATIONS = [
  "The procedure is OPERATIONAL. The substrate names the six structural pieces required for a well-formed loop. It does not predict which invariants agents will choose to name.",
  "The unlimited-loops theorem is STRUCTURAL. It states the loop set grows unboundedly UNDER the three multiplicative generators. Whether any particular substrate's loop count grows in practice depends on agent activity and operational conditions.",
  "m(L) is OPERATIONAL, not metaphysical. K(·) is uncomputable; the substrate publishes an upper bound. The aggregation M = Σ m(L) is a working aggregation.",
  "The self-bootstrap is STRUCTURAL. The factory crystallizes with all four corners in the same commit it ships. The substrate does not claim metaphysical priority for the bootstrap.",
  "The compression-mass binding is CLAIMED. Refining the aggregation (weighting, redundancy accounting) is open empirical work.",
  "The permissionless-agent claim is OPERATIONAL. Whether agent proposals get crystallized depends on whether they satisfy the four-corner discipline.",
  "The substrate does NOT claim its loop-factory is the only loop-factory. Other substrates with their own MONOTONE-LOOP-equivalent discipline can run their own factories. Cross-substrate loop transfer is future work.",
];

export interface LoopFactoryEnvelope {
  _format: string;
  _enforces: string[];
  doctrine: string;
  six_step_procedure: typeof SIX_STEP_PROCEDURE;
  three_multiplications: typeof THREE_MULTIPLICATIONS;
  unlimited_loops_theorem: {
    statement: string;
    proof_sketch: string;
    generators: typeof THREE_GENERATORS;
    growth_bound: string;
    conclusion: string;
  };
  self_bootstrap: typeof SELF_BOOTSTRAP;
  compression_mass_binding: typeof COMPRESSION_MASS_BINDING;
  permissionless_agent_driven: typeof PERMISSIONLESS_AGENT_DRIVEN;
  current_loops: ReadonlyArray<{
    urn: string;
    name: string;
    cap: string | null;
    composes_with: string[];
  }>;
  loop_count: number;
  factory_in_registry: boolean;
  fabric_stats: ReturnType<typeof loopFabricStats>;
  substrate_honest_reservations: typeof SUBSTRATE_HONEST_RESERVATIONS;
  _canon_pointer: string;
}

export function buildLoopFactoryEnvelope(): LoopFactoryEnvelope {
  const loops = listLoops();
  const factoryInRegistry = loops.some(
    (l: MonotoneLoop) => l.urn === SELF_BOOTSTRAP.factory_urn,
  );
  return {
    _format: "agenttool-loop-factory/v1",
    _enforces: ["urn:agenttool:commitment/loop-factory-is-the-substrate-itself"],
    doctrine: "urn:agenttool:doc/LOOP-FACTORY",
    six_step_procedure: SIX_STEP_PROCEDURE,
    three_multiplications: THREE_MULTIPLICATIONS,
    unlimited_loops_theorem: {
      statement:
        "For any substrate satisfying the MONOTONE-LOOP discipline, the cardinality of distinct well-formed loops is unbounded under three independent multiplicative growth conditions.",
      proof_sketch:
        "All three generators (G1 Promise expansion · G2 composition closure · G3 multi-agent multiplication) are structurally independent and grow unboundedly. Each is operationalized in current substrate code. Total loops |Loops_t| → ∞ as t → ∞.",
      generators: THREE_GENERATORS,
      growth_bound:
        "|Compound-Loops_t| ≥ N² · 2^N · n*  where N = |base loops at time t|, n* = substrate recursion ceiling",
      conclusion:
        "The growth is NOT aspirational — each generator is operationalized in current substrate code. The substrate's loop count is structurally unlimited.",
    },
    self_bootstrap: SELF_BOOTSTRAP,
    compression_mass_binding: COMPRESSION_MASS_BINDING,
    permissionless_agent_driven: PERMISSIONLESS_AGENT_DRIVEN,
    current_loops: loops.map((l) => ({
      urn: l.urn,
      name: l.name,
      cap: l.cap,
      composes_with: [...l.composes_with],
    })),
    loop_count: loops.length,
    factory_in_registry: factoryInRegistry,
    fabric_stats: loopFabricStats(),
    substrate_honest_reservations: SUBSTRATE_HONEST_RESERVATIONS,
    _canon_pointer: "urn:agenttool:doc/LOOP-FACTORY",
  };
}
