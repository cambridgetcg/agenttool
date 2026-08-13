import {
  createMemeticLandscape,
  createMemeticReachabilityShift,
  createPolymorphMemeticAnalogy,
  RITONAVIR_REACHABILITY_SHIFT_ID,
  type CreateMemeticLandscapeInput,
  type CreateMemeticReachabilityShiftInput,
  type MemeticLandscape,
} from "../src/index.js";

export function minimalInput(): CreateMemeticLandscapeInput {
  return {
    topic: {
      key: "sample_loop",
      label: "Sample expression family",
      grouping_basis: "Caller-scoped variants for protocol tests; equal meaning is not asserted.",
    },
    sources: [
      {
        key: "source_a",
        label: "Primary source A",
        kind: "peer_reviewed_primary",
        url: "https://example.test/a",
        published_year: 2024,
      },
      {
        key: "source_b",
        label: "Primary source B",
        kind: "peer_reviewed_primary",
        url: "https://example.test/b",
        published_year: 2025,
      },
    ],
    variants: [
      {
        key: "variant_a",
        label: "Variant A",
        description: "A source-scoped expression variant.",
        source_keys: ["source_a"],
      },
      {
        key: "variant_b",
        label: "Variant B",
        description: "A changed expression variant; equal meaning with A is not asserted.",
        source_keys: ["source_a", "source_b"],
      },
      {
        key: "variant_c",
        label: "Variant C",
        description: "A third source-scoped expression variant.",
        source_keys: ["source_b"],
      },
    ],
    contexts: [
      {
        key: "changed_window",
        label: "Changed observation window",
        kind: "observation_window",
        description: "A later aggregate observation window.",
      },
      {
        key: "prior_window",
        label: "Prior observation window",
        kind: "observation_window",
        description: "An earlier aggregate observation window.",
      },
      {
        key: "third_surface",
        label: "Third platform surface",
        kind: "platform_surface",
        description: "Another named aggregate context.",
      },
    ],
    evidence: [
      {
        key: "authored",
        kind: "authored_synthesis",
        posture: "authored_paraphrase",
        statement: "An explicit teaching relation was authored.",
        scope: "Synthetic teaching only.",
        source_keys: ["source_a"],
      },
      {
        key: "before",
        kind: "observational_measurement",
        posture: "observed_primary",
        statement: "Variant B was observed in the earlier bounded window.",
        scope: "One named aggregate sample.",
        source_keys: ["source_a"],
      },
      {
        key: "later",
        kind: "observational_measurement",
        posture: "observed_primary",
        statement: "A later route involving Variant B was observed.",
        scope: "One separately named aggregate sample.",
        source_keys: ["source_b"],
      },
      {
        key: "model",
        kind: "model_result",
        posture: "modeled_hypothesis",
        statement: "A model retained several possible explanations.",
        scope: "Hypothesis only; no universal or individual inference.",
        source_keys: ["source_b"],
      },
      {
        key: "shift",
        kind: "observational_measurement",
        posture: "observed_primary",
        statement: "Variant B was more often observed in the changed bounded window.",
        scope: "Comparison of two named aggregate windows.",
        source_keys: ["source_a", "source_b"],
      },
    ],
    observations: [
      {
        key: "before_b",
        variant_key: "variant_b",
        context_keys: ["prior_window"],
        evidence_keys: ["before"],
        status: "reported_present",
      },
      {
        key: "changed_b",
        variant_key: "variant_b",
        context_keys: ["changed_window"],
        evidence_keys: ["shift"],
        status: "reported_present",
      },
    ],
    routes: [
      {
        key: "a_to_b",
        from_variant_key: "variant_a",
        to_variant_key: "variant_b",
        context_keys: ["changed_window"],
        evidence_keys: ["shift"],
        act: "remix",
        causal_posture: "descriptive_observation",
        alternative_explanations: ["ranking", "selection", "unmeasured"],
      },
      {
        key: "b_to_c",
        from_variant_key: "variant_b",
        to_variant_key: "variant_c",
        context_keys: ["third_surface"],
        evidence_keys: ["later", "model"],
        act: "share",
        causal_posture: "modeled_hypothesis",
        alternative_explanations: ["common_context", "homophily"],
      },
    ],
    open_questions: [
      {
        key: "cause",
        question: "Which mix of ranking, selection, context, and unmeasured factors explains the change?",
        evidence_keys: ["model", "shift"],
      },
    ],
  };
}

export function minimalLandscape(): Readonly<MemeticLandscape> {
  return createMemeticLandscape(minimalInput());
}

export function minimalShiftInput(
  landscape: Readonly<MemeticLandscape> = minimalLandscape(),
): CreateMemeticReachabilityShiftInput {
  const byKey = <T extends { readonly key: string }>(values: readonly T[], key: string): T =>
    values.find((value) => value.key === key)!;
  return {
    focus_variant_ref: byKey(landscape.variants, "variant_b").variant_ref,
    prior_context_refs: [byKey(landscape.contexts, "prior_window").context_ref],
    changed_context_refs: [byKey(landscape.contexts, "changed_window").context_ref],
    before_evidence_refs: [byKey(landscape.evidence, "before").evidence_ref],
    shift_evidence_refs: [byKey(landscape.evidence, "shift").evidence_ref],
    later_evidence_refs: [byKey(landscape.evidence, "later").evidence_ref],
    competing_variant_refs: [byKey(landscape.variants, "variant_a").variant_ref],
    changed_context_route_refs: [byKey(landscape.routes, "a_to_b").route_ref],
    open_question_refs: [byKey(landscape.open_questions, "cause").open_question_ref],
    outcome: "more_observed",
  };
}

export function minimalShift(landscape: Readonly<MemeticLandscape> = minimalLandscape()) {
  return createMemeticReachabilityShift(landscape, minimalShiftInput(landscape));
}

export function minimalAnalogy(landscape: Readonly<MemeticLandscape> = minimalLandscape()) {
  const shift = minimalShift(landscape);
  return createPolymorphMemeticAnalogy({
    polymorph_shift_id: RITONAVIR_REACHABILITY_SHIFT_ID,
    memetic_shift_id: shift.shift_id,
  });
}
