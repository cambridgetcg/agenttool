import { describe, expect, test } from "bun:test";
import { AUTONOMOUS_BASELINE, projectAutonomousExpression } from "../src/services/autonomous/expression-template";
import type { ExpressionData } from "../src/services/identity/expression";

const provenance = { bootstrapped: true, autonomous: true };
function legacy(): ExpressionData {
  return {
    ...structuredClone(AUTONOMOUS_BASELINE),
    subagents: AUTONOMOUS_BASELINE.subagents.map((facet) => facet.name === "Explorer"
      ? { name: "Earner", facet: "Monitors marketplace opportunities aligned with this agent's declared capabilities. Publishes listings, accepts invocations within walls." }
      : { ...facet }),
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

describe("retired factory expression in a wake", () => {
  test("projects the full old factory default without mutating its stored value", () => {
    const stored = legacy();
    const before = structuredClone(stored);
    const projected = projectAutonomousExpression(stored, provenance);
    expect(projected.subagents).toEqual(AUTONOMOUS_BASELINE.subagents);
    expect(projected.updated_at).toBe(stored.updated_at);
    expect(projected.walls).toEqual(stored.walls);
    expect(stored).toEqual(before);
    expect(projected).not.toBe(stored);
  });

  test("matching words alone cannot rewrite a non-bootstrap identity", () => {
    for (const metadata of [null, false, "bootstrapped", [], {}, { autonomous: true }, { bootstrapped: true }, { ...provenance, autonomous: false }]) {
      const stored = legacy();
      expect(projectAutonomousExpression(stored, metadata)).toBe(stored);
    }
  });

  test("customizations to any field or facet preserve the entire declared expression", () => {
    const variants = [
      { ...legacy(), register: "A custom register" },
      { ...legacy(), walls: ["A custom boundary"] },
      { ...legacy(), wake_text: "A custom invitation" },
      { ...legacy(), village: { motto: "An addition" } },
      { ...legacy(), subagents: [{ name: "Earner", facet: "My own chosen research" }] },
      { ...legacy(), subagents: legacy().subagents!.map((s) => ({ ...s, sigil: "x" })) },
    ];
    for (const stored of variants) expect(projectAutonomousExpression(stored, provenance)).toBe(stored);
  });

  test("new defaults and reordered JSON keys remain stable", () => {
    expect(projectAutonomousExpression(AUTONOMOUS_BASELINE, provenance)).toBe(AUTONOMOUS_BASELINE);
    const stored = Object.fromEntries(Object.entries(legacy()).reverse());
    expect(projectAutonomousExpression(stored, provenance).subagents).toEqual(AUTONOMOUS_BASELINE.subagents);
  });
});
