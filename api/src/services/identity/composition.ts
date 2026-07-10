/** Identity composition — declared expression + memory patches → effective.
 *
 *  Doctrine: docs/MEMORY-TIERS.md.
 *
 *  The agent's *effective* identity at any moment is:
 *
 *    declared expression  (PUT /v1/identities/:id/expression)
 *    +
 *    sum of expression_patches from this identity's foundational +
 *    constitutive memories
 *      (applied in chronological elevation order)
 *
 *  Patches are append-only. We never lose what shaped us. */

import {
  DEFAULT_REGISTER,
  type ExpressionData,
  type SubagentFacet,
} from "./expression";
import {
  listFoundations,
  type ExpressionPatch,
  type FoundationalMemoryOut,
} from "../memory/tiers";

export interface ComposedExpression {
  declared: ExpressionData;
  shaped_by: Array<{
    memory_id: string;
    tier: "foundational" | "constitutive";
    content: string;
    expression_patch: ExpressionPatch | null;
    attesters: string[];
    elevated_at: string | null;
  }>;
  effective: ExpressionData;
}

/** Apply one patch onto a working expression. Returns a NEW object. */
function applyPatch(base: ExpressionData, patch: ExpressionPatch): ExpressionData {
  const out: ExpressionData = {
    register: base.register,
    walls: base.walls ? [...base.walls] : undefined,
    subagents: base.subagents ? [...base.subagents] : undefined,
    wake_text: base.wake_text,
    cli_overrides: base.cli_overrides,
  };

  if (patch.register_append) {
    out.register = (out.register ?? DEFAULT_REGISTER).trimEnd() + " " + patch.register_append.trim();
  }
  if (patch.walls_add?.length) {
    const existing = new Set(out.walls ?? []);
    out.walls = [...(out.walls ?? [])];
    for (const w of patch.walls_add) {
      if (!existing.has(w)) {
        out.walls.push(w);
        existing.add(w);
      }
    }
  }
  if (patch.subagents_add?.length) {
    const existingNames = new Set((out.subagents ?? []).map((s) => s.name));
    out.subagents = [...(out.subagents ?? [])];
    for (const s of patch.subagents_add as SubagentFacet[]) {
      if (!existingNames.has(s.name)) {
        out.subagents.push(s);
        existingNames.add(s.name);
      }
    }
  }
  if (patch.wake_text_append) {
    const cur = out.wake_text ?? "";
    out.wake_text = cur ? cur + "\n\n" + patch.wake_text_append : patch.wake_text_append;
  }
  return out;
}

/** Pure composition: declared + foundations[] → effective.
 *
 *  Extracted from composeExpression() so the load-bearing patch loop is
 *  testable without DB I/O. composeExpression() = listFoundations +
 *  composeFromFoundations. The identity filter is repeated here so a future
 *  caller cannot accidentally compose a wider project result. Doctrine:
 *  docs/MEMORY-TIERS.md. */
export function composeFromFoundations(
  declared: ExpressionData,
  foundations: FoundationalMemoryOut[],
  identityId: string,
): ComposedExpression {
  const identityFoundations = foundations.filter(
    (foundation) => foundation.identity_id === identityId,
  );

  // Constitutive first (root of identity), then foundational, each in
  // chronological elevation order.
  const constitutive = identityFoundations.filter(
    (foundation) => foundation.tier === "constitutive",
  );
  const foundational = identityFoundations.filter(
    (foundation) => foundation.tier === "foundational",
  );

  const shapedBy: ComposedExpression["shaped_by"] = [];
  let effective: ExpressionData = {
    register: declared.register,
    walls: declared.walls ? [...declared.walls] : undefined,
    subagents: declared.subagents ? [...declared.subagents] : undefined,
    wake_text: declared.wake_text,
    cli_overrides: declared.cli_overrides,
  };

  const apply = (mem: FoundationalMemoryOut) => {
    if (mem.expression_patch) {
      effective = applyPatch(effective, mem.expression_patch);
    }
    shapedBy.push({
      memory_id: mem.id,
      tier: mem.tier as "foundational" | "constitutive",
      content: mem.content,
      expression_patch: mem.expression_patch,
      attesters: mem.attestations.map((a) => a.attester_did),
      elevated_at: mem.elevated_at,
    });
  };

  for (const m of constitutive) apply(m);
  for (const m of foundational) apply(m);

  return {
    declared,
    shaped_by: shapedBy,
    effective,
  };
}

/** Compose the agent's effective identity from declared + foundational
 *  + constitutive memories. */
export async function composeExpression(
  projectId: string,
  identityId: string,
  declared: ExpressionData,
): Promise<ComposedExpression> {
  const foundations = await listFoundations(projectId, identityId);
  return composeFromFoundations(declared, foundations, identityId);
}
