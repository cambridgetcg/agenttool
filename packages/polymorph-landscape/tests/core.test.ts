import { describe, expect, test } from "bun:test";

import {
  createPolymorphLandscape,
  createRitonavirCase,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  projectPolymorphLesson,
  validatePolymorphLandscape,
  validatePolymorphLesson,
  validatePolymorphReachabilityShift,
} from "../src/index.js";
import { minimalInput, minimalLandscape, minimalShift } from "./fixtures.js";

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
