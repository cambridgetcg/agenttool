import { describe, expect, test } from "bun:test";

import {
  createPolymorphLandscape,
  createPolymorphReachabilityShift,
  createRitonavirCase,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  projectPolymorphLesson,
  validatePolymorphLandscape,
  validatePolymorphLesson,
  validatePolymorphReachabilityShift,
} from "../src/index.js";
import { minimalInput, minimalLandscape, minimalShift, minimalShiftInput } from "./fixtures.js";

describe("polymorph landscape", () => {
  test("is deterministic and input-order independent", () => {
    const input = minimalInput();
    const reversed = {
      ...input,
      sources: [...input.sources].reverse(),
      forms: [...input.forms].reverse().map((form) => ({ ...form, source_keys: [...form.source_keys].reverse() })),
      conditions: [...input.conditions].reverse(),
      witnesses: [...input.witnesses].reverse().map((witness) => ({ ...witness, source_keys: [...witness.source_keys].reverse() })),
      routes: [...input.routes].reverse().map((route) => ({ ...route, condition_keys: [...route.condition_keys].reverse(), witness_keys: [...route.witness_keys].reverse() })),
      stability_reports: [...input.stability_reports].reverse(),
      open_conditions: [...input.open_conditions].reverse(),
    };
    expect(createPolymorphLandscape(reversed)).toEqual(createPolymorphLandscape(input));
  });

  test("keeps empty and disconnected landscapes valid", () => {
    const empty = createPolymorphLandscape({
      material: { key: "empty", label: "Empty observed landscape" },
      sources: [], forms: [], conditions: [], witnesses: [], routes: [], stability_reports: [], open_conditions: [],
    });
    expect(empty.forms).toEqual([]);
    expect(empty.coverage).toBe("bounded_not_complete");
    expect(validatePolymorphLandscape(empty)).toEqual(empty);
  });

  test("does not infer inverse or transitive routes", () => {
    const landscape = minimalLandscape();
    const pairs = landscape.routes.map((route) => `${route.from_form_ref}->${route.to_form_ref}`);
    const a = landscape.forms.find((form) => form.key === "form_a")!;
    const c = landscape.forms.find((form) => form.key === "form_c")!;
    expect(pairs).not.toContain(`${a.form_ref}->${c.form_ref}`);
    expect(landscape.routes).toHaveLength(3);
    expect(landscape.routes.every((route) => route.direction === "reported_only_no_inverse_or_transitive_inference")).toBe(true);
  });

  test("keeps source-scoped uses of the same form number distinct", () => {
    const ritonavir = createRitonavirCase().landscape;
    const namedIII = ritonavir.forms.filter((form) => form.label.includes("Form III"));
    expect(namedIII).toHaveLength(2);
    expect(new Set(namedIII.map((form) => form.form_ref)).size).toBe(2);
    expect(namedIII.map((form) => form.kind_reported).sort()).toEqual(["polymorph", "solvate"]);
  });

  test("freezes a detached canonical snapshot", () => {
    const input = minimalInput();
    const landscape = createPolymorphLandscape(input);
    (input.sources as any[]).push({});
    expect(landscape.sources).toHaveLength(2);
    expect(Object.isFrozen(landscape)).toBe(true);
    expect(Object.isFrozen(landscape.routes)).toBe(true);
  });

  test("requires primary reported or measured evidence for reported routes and stability", () => {
    for (const status of ["hypothesized_primary", "derived_interpretation"] as const) {
      const openOnly: any = structuredClone(minimalInput());
      openOnly.witnesses.find((witness: any) => witness.key === "hypothesis").status = status;
      expect(createPolymorphLandscape(openOnly).open_conditions[0]!.witness_refs).toHaveLength(1);

      const routeOnly: any = structuredClone(openOnly);
      routeOnly.routes.find((route: any) => route.key === "a_to_b").witness_keys = ["hypothesis"];
      expect(() => createPolymorphLandscape(routeOnly)).toThrow(/measured_primary or reported_primary/);

      const stabilityOnly: any = structuredClone(openOnly);
      stabilityOnly.stability_reports[0].witness_keys = ["hypothesis"];
      expect(() => createPolymorphLandscape(stabilityOnly)).toThrow(/measured_primary or reported_primary/);
    }
  });

  test("keeps the bulk Form-I route distinct from the hard-capsule fill", () => {
    const landscape = createRitonavirCase().landscape;
    const bulkInput = landscape.forms.find((form) => form.key === "bulk_form_i_process_input")!;
    const semisolidFill = landscape.forms.find((form) => form.key === "hydroalcoholic_solution")!;
    const oldBulkRoute = landscape.routes.find((route) => route.key === "old_route_to_form_i_after_form_ii")!;
    const capsuleRoute = landscape.routes.find((route) => route.key === "semisolid_solution_to_form_ii_1998")!;

    expect(oldBulkRoute.from_form_ref).toBe(bulkInput.form_ref);
    expect(oldBulkRoute.from_form_ref).not.toBe(semisolidFill.form_ref);
    expect(capsuleRoute.from_form_ref).toBe(semisolidFill.form_ref);
    expect(bulkInput.description).toContain("separate from the hydroalcoholic semisolid hard-capsule fill");
  });
});

describe("reachability shift", () => {
  test("means named-condition non-reproduction, not erasure", () => {
    const landscape = minimalLandscape();
    const shift = minimalShift(landscape);
    expect(shift.classification).toBe("not_reproduced_in_named_condition_reported");
    expect(shift.causation).toBe("not_determined");
    expect(shift.physical_erasure).toBe("not_claimed");
    expect(shift.universal_inevitability).toBe("not_claimed");
    expect(shift.reversibility).toBe("bounded_by_named_conditions");
    expect(validatePolymorphReachabilityShift(landscape, shift)).toEqual(shift);
  });

  test("keeps changed-condition recovery explicit", () => {
    const { landscape, shift } = createRitonavirCase();
    expect(shift.changed_condition_recovery_route_refs).toHaveLength(3);
    for (const ref of shift.changed_condition_recovery_route_refs) {
      const route = landscape.routes.find((candidate) => candidate.route_ref === ref)!;
      expect(route.status).not.toBe("not_reproduced_reported");
      expect(route.to_form_ref).toBe(shift.prior_form_ref);
    }
  });

  test("does not let hypothesis or interpretation alone establish a reported shift", () => {
    for (const status of ["hypothesized_primary", "derived_interpretation"] as const) {
      const input: any = structuredClone(minimalInput());
      input.witnesses.find((witness: any) => witness.key === "hypothesis").status = status;
      const landscape = createPolymorphLandscape(input);
      const hypothesis = landscape.witnesses.find((witness) => witness.key === "hypothesis")!;
      const base = minimalShiftInput(landscape);

      expect(() => createPolymorphReachabilityShift(landscape, {
        ...base,
        before_witness_refs: [hypothesis.witness_ref],
      })).toThrow(/before_witness_refs.*measured_primary or reported_primary/);
      expect(() => createPolymorphReachabilityShift(landscape, {
        ...base,
        appearance_witness_refs: [hypothesis.witness_ref],
      })).toThrow(/appearance_witness_refs.*measured_primary or reported_primary/);
      expect(() => createPolymorphReachabilityShift(landscape, {
        ...base,
        later_witness_refs: [hypothesis.witness_ref],
        same_condition_return: "reported",
      })).toThrow(/later_witness_refs.*measured_primary or reported_primary/);
    }
  });

  test("requires qualifying later evidence exactly when same-condition return is reported", () => {
    const landscape = minimalLandscape();
    const base = minimalShiftInput(landscape);
    const reported = createPolymorphReachabilityShift(landscape, {
      ...base,
      same_condition_return: "reported",
    });
    expect(reported.same_condition_return).toBe("reported");
  });
});

describe("authored lessons", () => {
  test("projects the same evidence-bearing concepts in four languages", () => {
    const { landscape, shift } = createRitonavirCase();
    const lessons = LESSON_LANGUAGES.map((language) => projectPolymorphLesson(landscape, shift, { language }));
    expect(lessons.map((lesson) => lesson.language)).toEqual(LESSON_LANGUAGES);
    for (const lesson of lessons) {
      expect(lesson.concepts.map((concept) => concept.key)).toEqual(LESSON_CONCEPT_KEYS);
      expect(lesson.kingdom_lens.status).toBe("structural_analogy_only");
      expect(lesson.kingdom_lens.non_transfer).toContain("consent");
      expect(lesson.medical_advice).toBe(false);
      expect(validatePolymorphLesson(landscape, shift, lesson)).toEqual(lesson);
    }
    const physicalEvidence = lessons[0]!.concepts[0]!.evidence_refs;
    for (const lesson of lessons) expect(lesson.concepts[0]!.evidence_refs).toEqual(physicalEvidence);
    expect(lessons.find((lesson) => lesson.language === "yue-Hant")!.core_sentence).toContain("唔係嗰種形態由世界冇咗");
  });
});
