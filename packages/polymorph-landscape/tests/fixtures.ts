import {
  createPolymorphLandscape,
  createPolymorphReachabilityShift,
  type CreatePolymorphLandscapeInput,
  type PolymorphLandscape,
} from "../src/index.js";

export function minimalInput(): CreatePolymorphLandscapeInput {
  return {
    material: { key: "sample", label: "Sample molecule" },
    sources: [
      { key: "source_a", label: "Primary source A", kind: "peer_reviewed_primary", url: "https://example.test/a", published_year: 2024 },
      { key: "source_b", label: "Primary source B", kind: "peer_reviewed_primary", url: "https://example.test/b", published_year: 2025 },
    ],
    forms: [
      { key: "form_a", label: "Form A", kind_reported: "polymorph", description: "Source-scoped form A", source_keys: ["source_a"] },
      { key: "form_b", label: "Form B", kind_reported: "polymorph", description: "Source-scoped form B", source_keys: ["source_a"] },
      { key: "form_c", label: "Form C", kind_reported: "polymorph", description: "Source-scoped form C", source_keys: ["source_b"] },
    ],
    conditions: [
      { key: "changed_route", label: "Changed route", kind: "solvent_process", description: "A reported changed condition" },
      { key: "old_route", label: "Old route", kind: "manufacturing_process", description: "The named original condition" },
      { key: "third_route", label: "Third route", kind: "mechanical_process", description: "Another named condition" },
    ],
    witnesses: [
      { key: "appearance", kind: "process_observation", status: "reported_primary", statement: "Form B appeared and the old route stopped reproducing Form A.", scope: "Named test process", source_keys: ["source_a"] },
      { key: "before", kind: "reported_history", status: "reported_primary", statement: "The old route previously reproduced Form A.", scope: "Named test process before the shift", source_keys: ["source_a"] },
      { key: "hypothesis", kind: "mechanism_hypothesis", status: "hypothesized_primary", statement: "A template was proposed as one possible cause.", scope: "Hypothesis only", source_keys: ["source_a"] },
      { key: "recovery", kind: "recovery_observation", status: "measured_primary", statement: "The changed route recovered Form A.", scope: "Named changed process", source_keys: ["source_b"] },
      { key: "third", kind: "measurement", status: "measured_primary", statement: "A route from B to C was observed.", scope: "Third condition", source_keys: ["source_b"] },
    ],
    routes: [
      { key: "a_to_b", from_form_key: "form_a", to_form_key: "form_b", condition_keys: ["old_route"], witness_keys: ["appearance"], status: "converted_reported", barrier_reported: "unknown", template_reported: "hypothesized" },
      { key: "b_to_a_recovery", from_form_key: "form_b", to_form_key: "form_a", condition_keys: ["changed_route"], witness_keys: ["recovery"], status: "converted_reported", barrier_reported: "present_reported", template_reported: "present_reported" },
      { key: "b_to_c", from_form_key: "form_b", to_form_key: "form_c", condition_keys: ["third_route"], witness_keys: ["third"], status: "converted_reported", barrier_reported: "not_reported", template_reported: "not_reported" },
    ],
    stability_reports: [
      { key: "b_over_a", preferred_form_key: "form_b", compared_form_key: "form_a", condition_keys: ["old_route"], witness_keys: ["appearance"] },
    ],
    open_conditions: [
      { key: "cause", question: "What caused the first appearance?", witness_keys: ["hypothesis"] },
    ],
  };
}

export function minimalLandscape(): PolymorphLandscape {
  return createPolymorphLandscape(minimalInput());
}

export function minimalShift(landscape = minimalLandscape()) {
  const byKey = <T extends { readonly key: string }>(values: readonly T[], key: string): T => values.find((value) => value.key === key)!;
  return createPolymorphReachabilityShift(landscape, {
    prior_form_ref: byKey(landscape.forms, "form_a").form_ref,
    emergent_form_ref: byKey(landscape.forms, "form_b").form_ref,
    condition_refs: [byKey(landscape.conditions, "old_route").condition_ref],
    before_witness_refs: [byKey(landscape.witnesses, "before").witness_ref],
    appearance_witness_refs: [byKey(landscape.witnesses, "appearance").witness_ref],
    later_witness_refs: [byKey(landscape.witnesses, "recovery").witness_ref],
    same_condition_return: "not_established",
    changed_condition_recovery_route_refs: [byKey(landscape.routes, "b_to_a_recovery").route_ref],
    open_condition_refs: [byKey(landscape.open_conditions, "cause").open_condition_ref],
  });
}
