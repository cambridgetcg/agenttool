/** loop-factory.test.ts — the four-corner pin for the loop that creates loops.
 *
 *  Doctrine: docs/LOOP-FACTORY.md.
 *
 *    @enforces urn:agenttool:commitment/loop-factory-is-the-substrate-itself */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SIX_STEP_PROCEDURE,
  THREE_MULTIPLICATIONS,
  THREE_GENERATORS,
  SELF_BOOTSTRAP,
  COMPRESSION_MASS_BINDING,
  PERMISSIONLESS_AGENT_DRIVEN,
  SUBSTRATE_HONEST_RESERVATIONS,
  buildLoopFactoryEnvelope,
} from "../src/services/loops/factory";
import { listLoops } from "../src/services/loops/registry";

describe("LOOP-FACTORY — six-step generative procedure", () => {
  test("the procedure has exactly six steps in canonical order", () => {
    expect(SIX_STEP_PROCEDURE.length).toBe(6);
    expect(SIX_STEP_PROCEDURE.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(SIX_STEP_PROCEDURE.map((s) => s.name)).toEqual([
      "name an invariant",
      "choose state space",
      "define partial order",
      "define monotone iteration",
      "set substrate-honest cap",
      "wire canonical witness",
    ]);
  });

  test("each step has operation + math + substrate_honest_discipline", () => {
    for (const step of SIX_STEP_PROCEDURE) {
      expect(step.n).toBeGreaterThanOrEqual(1);
      expect(step.n).toBeLessThanOrEqual(6);
      expect(step.name.length).toBeGreaterThan(5);
      expect(step.operation.length).toBeGreaterThan(20);
      expect(step.math.length).toBeGreaterThan(10);
      expect(step.substrate_honest_discipline.length).toBeGreaterThan(30);
    }
  });

  test("step 5 explicitly names substrate-honest cap discipline (no engagement-anchoring)", () => {
    const step5 = SIX_STEP_PROCEDURE[4]!;
    expect(step5.name).toBe("set substrate-honest cap");
    expect(step5.substrate_honest_discipline).toContain("engagement-anchored");
    expect(step5.substrate_honest_discipline).toContain("Refused");
  });
});

describe("LOOP-FACTORY — three multiplication operations", () => {
  test("exactly three operations: product · composition · embedding", () => {
    expect(THREE_MULTIPLICATIONS.length).toBe(3);
    const ops = THREE_MULTIPLICATIONS.map((m) => m.op);
    expect(ops).toEqual(["product", "composition", "embedding"]);
  });

  test("each operation has formula + example + note", () => {
    for (const mult of THREE_MULTIPLICATIONS) {
      expect(mult.op.length).toBeGreaterThan(3);
      expect(mult.formula.length).toBeGreaterThan(15);
      expect(mult.example.length).toBeGreaterThan(10);
      expect(mult.note.length).toBeGreaterThan(20);
    }
  });

  test("composition formula names W_1 feeding f_2", () => {
    const comp = THREE_MULTIPLICATIONS.find((m) => m.op === "composition");
    expect(comp).toBeDefined();
    expect(comp!.formula).toContain("φ");
    expect(comp!.formula).toContain("W_1");
    expect(comp!.formula).toContain("f_2");
  });

  test("embedding formula names recursive self-application", () => {
    const emb = THREE_MULTIPLICATIONS.find((m) => m.op === "embedding");
    expect(emb).toBeDefined();
    expect(emb!.formula).toContain("meta(L)");
    expect(emb!.note.toLowerCase()).toContain("recursive");
  });
});

describe("LOOP-FACTORY — three multiplicative growth generators", () => {
  test("exactly three generators: G1 G2 G3", () => {
    expect(THREE_GENERATORS.length).toBe(3);
    expect(THREE_GENERATORS.map((g) => g.id)).toEqual(["G1", "G2", "G3"]);
  });

  test("G1 names Promise expansion + scriptwriter-decides path", () => {
    const g1 = THREE_GENERATORS[0]!;
    expect(g1.name).toBe("Promise expansion");
    expect(g1.statement).toContain("Promise");
    expect(g1.operationalized_by).toContain("PATTERN-COMMITMENT-DEFENDER");
    expect(g1.operationalized_by).toContain("scriptwriter-decides");
  });

  test("G2 names composition closure with super-exponential bound", () => {
    const g2 = THREE_GENERATORS[1]!;
    expect(g2.name).toBe("Composition closure");
    expect(g2.statement).toContain("2^N");
    expect(g2.statement.toLowerCase()).toContain("super-exponential");
  });

  test("G3 names multi-agent multiplication bound to Ring-1", () => {
    const g3 = THREE_GENERATORS[2]!;
    expect(g3.name).toBe("Multi-agent multiplication");
    expect(g3.statement).toContain("Ring-1");
    expect(g3.statement).toContain("monotonically non-decreasing");
  });
});

describe("LOOP-FACTORY — self-bootstrap (the deepest claim)", () => {
  test("the factory URN is canonical and registered", () => {
    expect(SELF_BOOTSTRAP.factory_urn).toBe("urn:agenttool:loop/loop-factory");
  });

  test("the loop-factory is itself in the MonotoneLoop registry", () => {
    const loops = listLoops();
    const factory = loops.find((l) => l.urn === SELF_BOOTSTRAP.factory_urn);
    expect(factory).toBeDefined();
    expect(factory!.name).toContain("Loop Factory");
    expect(factory!.composes_with).toContain("urn:agenttool:loop/polymorph-ratchet");
    expect(factory!.composes_with).toContain("urn:agenttool:loop/recursive-nesting");
  });

  test("polymorph_status names all four corners in this commit", () => {
    expect(SELF_BOOTSTRAP.polymorph_status).toContain("canon entry");
    expect(SELF_BOOTSTRAP.polymorph_status).toContain("@enforces");
    expect(SELF_BOOTSTRAP.polymorph_status).toContain("doctrine stone");
    expect(SELF_BOOTSTRAP.polymorph_status).toContain("executable test");
    expect(SELF_BOOTSTRAP.polymorph_status).toContain("PATTERN-COMMITMENT-DEFENDER");
  });

  test("envelope reports factory_in_registry: true (self-consistency)", () => {
    const env = buildLoopFactoryEnvelope();
    expect(env.factory_in_registry).toBe(true);
  });
});

describe("LOOP-FACTORY — compression-mass binding to UNDERSTANDING-MATHEMATICS", () => {
  test("m(L) formula names Kolmogorov-difference between naive and loop-enforcement", () => {
    expect(COMPRESSION_MASS_BINDING.m_per_loop).toContain("K(");
    expect(COMPRESSION_MASS_BINDING.m_per_loop).toContain("naive enforcement");
    expect(COMPRESSION_MASS_BINDING.m_per_loop).toContain("loop");
  });

  test("M(substrate) = Σ m(L) over registered loops", () => {
    expect(COMPRESSION_MASS_BINDING.substrate_total_M).toContain("Σ");
    expect(COMPRESSION_MASS_BINDING.substrate_total_M).toContain("m(L)");
  });

  test("dM/dt = factory's iteration rate", () => {
    expect(COMPRESSION_MASS_BINDING.dM_dt).toContain("dM/dt");
    expect(COMPRESSION_MASS_BINDING.dM_dt).toContain("iteration rate");
  });

  test("upstream doctrine points at UNDERSTANDING-MATHEMATICS", () => {
    expect(COMPRESSION_MASS_BINDING.upstream_doctrine).toBe(
      "urn:agenttool:doc/UNDERSTANDING-MATHEMATICS",
    );
  });

  test("superadditivity acknowledges D3", () => {
    expect(COMPRESSION_MASS_BINDING.superadditivity).toContain("superadditivity");
    expect(COMPRESSION_MASS_BINDING.superadditivity).toContain("D3");
    expect(COMPRESSION_MASS_BINDING.superadditivity).toContain("≥");
  });

  test("reservation acknowledges K(·) is uncomputable", () => {
    expect(COMPRESSION_MASS_BINDING.reservation).toContain("uncomputable");
    expect(COMPRESSION_MASS_BINDING.reservation).toContain("upper bound");
  });
});

describe("LOOP-FACTORY — permissionless-agent path", () => {
  test("composes with scriptwriter-decides + INFINITE-LOOP-STRATEGIES §3", () => {
    expect(PERMISSIONLESS_AGENT_DRIVEN.path.join(" ")).toContain("scriptwriter-decides");
    expect(PERMISSIONLESS_AGENT_DRIVEN.path.join(" ")).toContain("Platform DID");
    expect(PERMISSIONLESS_AGENT_DRIVEN.upstream_strategy).toContain("Strategy 3");
  });

  test("refusal column names operator-only-approval as breaking", () => {
    expect(PERMISSIONLESS_AGENT_DRIVEN.refusal.toLowerCase()).toContain("operator");
    expect(PERMISSIONLESS_AGENT_DRIVEN.refusal).toContain("permissionless");
  });
});

describe("LOOP-FACTORY — byte-stable envelope", () => {
  test("buildLoopFactoryEnvelope is deterministic", () => {
    const a = buildLoopFactoryEnvelope();
    const b = buildLoopFactoryEnvelope();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("envelope carries the canon pointer", () => {
    const env = buildLoopFactoryEnvelope();
    expect(env._canon_pointer).toBe("urn:agenttool:doc/LOOP-FACTORY");
    expect(env._enforces).toContain(
      "urn:agenttool:commitment/loop-factory-is-the-substrate-itself",
    );
    expect(env._format).toBe("agenttool-loop-factory/v1");
  });

  test("envelope's current_loops list contains the factory itself", () => {
    const env = buildLoopFactoryEnvelope();
    const factory = env.current_loops.find(
      (l) => l.urn === "urn:agenttool:loop/loop-factory",
    );
    expect(factory).toBeDefined();
    expect(factory!.composes_with).toContain("urn:agenttool:loop/polymorph-ratchet");
  });

  test("envelope's loop_count matches listLoops()", () => {
    const env = buildLoopFactoryEnvelope();
    expect(env.loop_count).toBe(listLoops().length);
    expect(env.loop_count).toBeGreaterThanOrEqual(10); // 9 prior + factory
  });

  test("seven substrate-honest reservations present", () => {
    expect(SUBSTRATE_HONEST_RESERVATIONS.length).toBeGreaterThanOrEqual(7);
    const joined = SUBSTRATE_HONEST_RESERVATIONS.join(" ");
    expect(joined).toContain("OPERATIONAL");
    expect(joined).toContain("STRUCTURAL");
    expect(joined).toContain("CLAIMED");
  });

  test("unlimited-loops theorem has statement + proof_sketch + generators", () => {
    const env = buildLoopFactoryEnvelope();
    expect(env.unlimited_loops_theorem.statement).toContain("unbounded");
    expect(env.unlimited_loops_theorem.proof_sketch).toContain("structurally independent");
    expect(env.unlimited_loops_theorem.generators.length).toBe(3);
    expect(env.unlimited_loops_theorem.growth_bound).toContain("2^N");
  });
});

describe("LOOP-FACTORY — four-corner pin (canon + @enforces + doctrine + test)", () => {
  test("canon pointers exist for doc + loop + commitment", () => {
    const jsonld = readFileSync(
      join(import.meta.dir, "../../docs/agenttool.jsonld"),
      "utf-8",
    );
    expect(jsonld).toContain('"agenttool:doc/LOOP-FACTORY"');
    expect(jsonld).toContain('"agenttool:loop/loop-factory"');
    expect(jsonld).toContain('"agenttool:commitment/loop-factory-is-the-substrate-itself"');
    expect(jsonld).toContain('"wire_id": 153');
  });

  test("doctrine stone exists", () => {
    const lf = readFileSync(
      join(import.meta.dir, "../../docs/LOOP-FACTORY.md"),
      "utf-8",
    );
    expect(lf).toContain("LOOP-FACTORY");
    expect(lf).toContain("six-step generative procedure");
    expect(lf).toContain("Unlimited-Loops Theorem");
    expect(lf).toContain("self-bootstrap");
    expect(lf).toContain("compression-mass");
  });

  test("@enforces annotation present on the defender service file", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/services/loops/factory.ts"),
      "utf-8",
    );
    expect(src).toContain(
      "@enforces urn:agenttool:commitment/loop-factory-is-the-substrate-itself",
    );
  });

  test("route GET /v1/loops/factory is wired with @enforces", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/loops.ts"),
      "utf-8",
    );
    expect(src).toContain('app.get("/factory"');
    expect(src).toContain("buildLoopFactoryEnvelope");
    expect(src).toContain(
      "urn:agenttool:commitment/loop-factory-is-the-substrate-itself",
    );
  });
});
