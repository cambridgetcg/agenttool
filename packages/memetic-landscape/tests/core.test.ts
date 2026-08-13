import { describe, expect, test } from "bun:test";

import {
  ANALOGY_MAPPING_KEYS,
  createBrainrotTeachingCase,
  createMemeticLandscape,
  createMemeticReachabilityShift,
  createPolymorphMemeticAnalogy,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  NON_TRANSFERRED_PROPERTIES,
  projectMemeticLesson,
  RITONAVIR_REACHABILITY_SHIFT_ID,
  validateMemeticLandscape,
  validateMemeticLesson,
  validateMemeticReachabilityShift,
  validatePolymorphMemeticAnalogy,
} from "../src/index.js";
import { minimalInput, minimalLandscape, minimalShift, minimalShiftInput } from "./fixtures.js";

describe("memetic landscape", () => {
  test("is deterministic and input-order independent", () => {
    const input = minimalInput();
    const reversed = {
      ...input,
      sources: [...input.sources].reverse(),
      variants: [...input.variants].reverse().map((variant) => ({
        ...variant,
        source_keys: [...variant.source_keys].reverse(),
      })),
      contexts: [...input.contexts].reverse(),
      evidence: [...input.evidence].reverse().map((item) => ({
        ...item,
        source_keys: [...item.source_keys].reverse(),
      })),
      observations: [...input.observations].reverse().map((observation) => ({
        ...observation,
        context_keys: [...observation.context_keys].reverse(),
        evidence_keys: [...observation.evidence_keys].reverse(),
      })),
      routes: [...input.routes].reverse().map((route) => ({
        ...route,
        context_keys: [...route.context_keys].reverse(),
        evidence_keys: [...route.evidence_keys].reverse(),
        alternative_explanations: [...route.alternative_explanations].reverse(),
      })),
      open_questions: [...input.open_questions].reverse().map((question) => ({
        ...question,
        evidence_keys: [...question.evidence_keys].reverse(),
      })),
    };
    expect(createMemeticLandscape(reversed)).toEqual(createMemeticLandscape(input));
  });

  test("keeps empty edge and observation sets valid without claiming completeness", () => {
    const input = minimalInput();
    const sparse = createMemeticLandscape({
      ...input,
      observations: [],
      routes: [],
      open_questions: [],
    });
    expect(sparse.routes).toEqual([]);
    expect(sparse.caller_text_semantics_verified).toBe(false);
    expect(sparse.coverage).toBe("bounded_not_complete");
    expect(validateMemeticLandscape(sparse)).toEqual(sparse);
  });

  test("does not infer inverse, transitive, semantic, or adoption routes", () => {
    const landscape = minimalLandscape();
    const a = landscape.variants.find((variant) => variant.key === "variant_a")!;
    const c = landscape.variants.find((variant) => variant.key === "variant_c")!;
    const pairs = landscape.routes.map((route) => `${route.from_variant_ref}->${route.to_variant_ref}`);
    expect(pairs).not.toContain(`${a.variant_ref}->${c.variant_ref}`);
    expect(landscape.routes).toHaveLength(2);
    for (const route of landscape.routes) {
      expect(route.direction).toBe("observed_or_authored_only_no_inverse_or_transitive_inference");
      expect(route.adoption_inferred).toBe(false);
      expect(route.meaning_equivalence_inferred).toBe(false);
      expect(route.alternative_explanations.length).toBeGreaterThan(0);
    }
  });

  test("requires every route to retain a competing explanation", () => {
    const input: any = structuredClone(minimalInput());
    input.routes[0].alternative_explanations = [];
    expect(() => createMemeticLandscape(input)).toThrow(/competing explanation/);
  });

  test("keeps evidence and route postures structurally compatible", () => {
    const badEvidence: any = structuredClone(minimalInput());
    badEvidence.evidence.find((item: any) => item.key === "model").posture = "randomized_evidence";
    expect(() => createMemeticLandscape(badEvidence)).toThrow(/incompatible with kind model_result/);

    const badRoute: any = structuredClone(minimalInput());
    badRoute.routes.find((route: any) => route.key === "a_to_b").causal_posture = "randomized_evidence";
    expect(() => createMemeticLandscape(badRoute)).toThrow(/requires matching evidence posture/);

    const authoredRoute: any = structuredClone(minimalInput());
    authoredRoute.routes.find((route: any) => route.key === "a_to_b").causal_posture = "authored_teaching_relation";
    authoredRoute.routes.find((route: any) => route.key === "a_to_b").evidence_keys = ["shift"];
    expect(() => createMemeticLandscape(authoredRoute)).toThrow(/requires matching evidence posture/);
  });

  test("freezes a detached canonical snapshot", () => {
    const input = minimalInput();
    const landscape = createMemeticLandscape(input);
    (input.sources as any[]).push({});
    expect(landscape.sources).toHaveLength(2);
    expect(Object.isFrozen(landscape)).toBe(true);
    expect(Object.isFrozen(landscape.routes)).toBe(true);
    expect(landscape.topic.semantic_identity_verified).toBe(false);
    expect(landscape.variants.every((variant) => variant.meaning_equivalence_not_claimed)).toBe(true);
  });

  test("keeps the built-in lexical, model, experiment, and confounding claims scoped", () => {
    const { landscape } = createBrainrotTeachingCase();
    expect(landscape.sources.map((source) => source.key)).toEqual([
      "adamic_2016",
      "centola_2010",
      "oup_2024",
      "shalizi_thomas_2011",
      "weng_2012",
    ]);
    expect(landscape.variants.find((variant) => variant.key === "contemporary_online_slang")!.description).toContain("not a diagnosis");
    expect(landscape.evidence.find((item) => item.key === "finite_attention_model")!.scope).toContain("not a universal causal explanation");
    expect(landscape.evidence.find((item) => item.key === "causal_confounding")!.scope).toContain("not a claim that influence never occurs");
  });
});

describe("memetic reachability shift", () => {
  test("means a bounded context change, not erasure, diagnosis, adoption, or causation", () => {
    const landscape = minimalLandscape();
    const shift = minimalShift(landscape);
    expect(shift.classification).toBe("bounded_reachability_shift_caller_reported");
    expect(shift.causation).toBe("not_determined");
    expect(shift.physical_erasure).toBe("not_claimed");
    expect(shift.adoption_from_exposure).toBe("not_inferred");
    expect(shift.mental_health_effect).toBe("not_inferred");
    expect(shift.population_effect).toBe("not_inferred");
    expect(shift.reversibility).toBe("bounded_by_named_contexts");
    expect(validateMemeticReachabilityShift(landscape, shift)).toEqual(shift);
  });

  test("requires non-authored evidence for the before and shift observations", () => {
    const landscape = minimalLandscape();
    const authored = landscape.evidence.find((item) => item.key === "authored")!;
    const base = minimalShiftInput(landscape);
    expect(() => createMemeticReachabilityShift(landscape, {
      ...base,
      before_evidence_refs: [authored.evidence_ref],
    })).toThrow(/non-authored source posture/);
    expect(() => createMemeticReachabilityShift(landscape, {
      ...base,
      shift_evidence_refs: [authored.evidence_ref],
    })).toThrow(/non-authored source posture/);
  });

  test("requires observation rows to structurally link focus, context, and evidence", () => {
    const input: any = structuredClone(minimalInput());
    input.observations.find((observation: any) => observation.key === "before_b").evidence_keys = ["later"];
    const landscape = createMemeticLandscape(input);
    expect(() => createMemeticReachabilityShift(landscape, minimalShiftInput(landscape))).toThrow(
      /before evidence must overlap a focus-variant observation/,
    );

    const changedInput: any = structuredClone(minimalInput());
    changedInput.observations.find((observation: any) => observation.key === "changed_b").variant_key = "variant_a";
    const changedLandscape = createMemeticLandscape(changedInput);
    expect(() => createMemeticReachabilityShift(changedLandscape, minimalShiftInput(changedLandscape))).toThrow(
      /shift or later evidence must overlap a focus-variant observation/,
    );
  });

  test("requires at least one changed context absent from the prior set", () => {
    const landscape = minimalLandscape();
    const base = minimalShiftInput(landscape);
    expect(() => createMemeticReachabilityShift(landscape, {
      ...base,
      changed_context_refs: [...base.prior_context_refs],
      changed_context_route_refs: [],
    })).toThrow(/at least one changed context/);
  });

  test("links every supplied changed route to a context novel against the prior set", () => {
    const input: any = structuredClone(minimalInput());
    input.observations.find((observation: any) => observation.key === "changed_b").context_keys = ["third_surface"];
    const landscape = createMemeticLandscape(input);
    const base = minimalShiftInput(landscape);
    const prior = landscape.contexts.find((context) => context.key === "prior_window")!;
    const changed = landscape.contexts.find((context) => context.key === "changed_window")!;
    const third = landscape.contexts.find((context) => context.key === "third_surface")!;
    const changedRoute = landscape.routes.find((route) => route.key === "a_to_b")!;
    expect(() => createMemeticReachabilityShift(landscape, {
      ...base,
      prior_context_refs: [prior.context_ref, changed.context_ref],
      changed_context_refs: [changed.context_ref, third.context_ref],
      changed_context_route_refs: [changedRoute.route_ref],
    })).toThrow(/context absent from prior_context_refs/);
  });

  test("requires more-observed routes to point to the focus variant", () => {
    const input: any = structuredClone(minimalInput());
    input.observations.find((observation: any) => observation.key === "changed_b").context_keys = ["third_surface"];
    const landscape = createMemeticLandscape(input);
    const base = minimalShiftInput(landscape);
    const third = landscape.contexts.find((context) => context.key === "third_surface")!;
    const outgoing = landscape.routes.find((route) => route.key === "b_to_c")!;
    expect(() => createMemeticReachabilityShift(landscape, {
      ...base,
      changed_context_refs: [third.context_ref],
      changed_context_route_refs: [outgoing.route_ref],
    })).toThrow(/must point to the focus variant/);
  });
});

describe("polymorph analogy and authored lessons", () => {
  test("binds two exact shift IDs while transferring shape only", () => {
    const { shift } = createBrainrotTeachingCase();
    const analogy = createPolymorphMemeticAnalogy({
      polymorph_shift_id: RITONAVIR_REACHABILITY_SHIFT_ID,
      memetic_shift_id: shift.shift_id,
    });
    expect(analogy.polymorph_shift.shift_id).toBe(RITONAVIR_REACHABILITY_SHIFT_ID);
    expect(analogy.memetic_shift.shift_id).toBe(shift.shift_id);
    expect(analogy.relationship).toBe("structural_route_shape_only");
    expect(analogy.mechanism_transferred).toBe(false);
    expect(analogy.mappings.map((mapping) => mapping.key)).toEqual(ANALOGY_MAPPING_KEYS);
    expect(analogy.non_transfer).toEqual(NON_TRANSFERRED_PROPERTIES);
    expect(analogy.non_transfer).toContain("infectivity");
    expect(analogy.non_transfer).toContain("popularity_as_stability");
    expect(validatePolymorphMemeticAnalogy(analogy)).toEqual(analogy);
  });

  test("projects the same ordered concepts and evidence in four authored languages", () => {
    const { landscape, shift, analogy } = createBrainrotTeachingCase();
    const lessons = LESSON_LANGUAGES.map((language) =>
      projectMemeticLesson(landscape, shift, analogy, { language })
    );
    expect(lessons.map((lesson) => lesson.language)).toEqual(LESSON_LANGUAGES);
    for (const lesson of lessons) {
      expect(lesson.concepts.map((concept) => concept.key)).toEqual(LESSON_CONCEPT_KEYS);
      expect(lesson.language_review).toBe("not_independently_reviewed");
      expect(lesson.authored_paraphrase).toBe(true);
      expect(lesson.source_quotation).toBe(false);
      expect(lesson.diagnostic_claim).toBe(false);
      expect(lesson.spread_optimization).toBe(false);
      expect(lesson.participants_scored).toBe(false);
      expect(validateMemeticLesson(landscape, shift, analogy, lesson)).toEqual(lesson);
    }
    const evidence = lessons[0]!.concepts.find((concept) => concept.key === "finite_attention")!.evidence_refs;
    for (const lesson of lessons) {
      expect(lesson.concepts.find((concept) => concept.key === "finite_attention")!.evidence_refs).toEqual(evidence);
    }
    expect(lessons.find((lesson) => lesson.language === "yue-Hant")!.core_sentence).toContain("唔係由世界消失");
  });
});
