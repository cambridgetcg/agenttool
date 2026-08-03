import { describe, expect, test } from "bun:test";

import {
  RESEARCH_PASSPORT_SCHEMA,
  WITNESS_DOSSIER_SCHEMA,
  WitnessLabError,
  createResearchPassport,
  createWitnessDossier,
  validateResearchPassport,
  validateWitnessDossier,
  type CreateResearchPassportInput,
  type CreateWitnessDossierInput,
} from "../src/index.js";

const A = `sha256:${"a".repeat(64)}` as const;
const B = `sha256:${"b".repeat(64)}` as const;
const C = `sha256:${"c".repeat(64)}` as const;

function passportInput(): CreateResearchPassportInput {
  return {
    subject: {
      provider: "huggingface",
      kind: "model",
      id: "deepseek-ai/DeepSeek-R1",
      revision: "56d4cbbb4d29f4355bab4b9a39ccb717a14ad5ad",
    },
    observed_at: "2026-08-01T12:00:00.000Z",
    observation_basis: "provider_metadata",
    publisher_assertions: {
      publisher: "deepseek-ai",
      declared_license: "mit",
      license_scope: "artifact",
      capabilities: ["reasoning_text_generation"],
    },
    proposal: {
      roles: ["reasoning_research_lead"],
      targets: ["trials", "yutabase"],
      stage: "offline_trial_candidate",
      boundary_codes: [
        "license_clearance_not_assessed",
        "model_output_not_truth",
        "weights_not_downloaded",
      ],
    },
    evidence_refs: ["artifact:deepseek-atlas/deepseek-r1", A],
  };
}

describe("research passport", () => {
  test("creates a deterministic, deeply frozen exact-revision passport", () => {
    const first = createResearchPassport(passportInput());
    const second = createResearchPassport({
      ...passportInput(),
      subject: {
        revision: passportInput().subject.revision,
        id: passportInput().subject.id,
        kind: "model",
        provider: "huggingface",
      },
    });
    expect(first.schema).toBe(RESEARCH_PASSPORT_SCHEMA);
    expect(first.passport_id).toBe(
      "sha256:11903079502c03a1300660d063781e70f007b7e08a6ca2b701c75384c96a9cdb",
    );
    expect(first.passport_id).toBe(second.passport_id);
    expect(first.conclusions).toEqual({
      authorship: "not_proven",
      legal_clearance: "not_assessed",
      safety: "not_assessed",
      truth: "not_determined",
      authority: "none",
      representation: "none",
      automatic_action: false,
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.proposal.boundary_codes)).toBe(true);
    expect(validateResearchPassport(first)).toEqual(first);
  });

  test("binds every admitted field and rejects raw escape hatches", () => {
    const original = createResearchPassport(passportInput());
    const changed = createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, revision: "a".repeat(40) },
    });
    expect(changed.passport_id).not.toBe(original.passport_id);
    expect(() => validateResearchPassport({ ...original, trusted: true })).toThrow("exactly");
    expect(() => validateResearchPassport({
      ...original,
      proposal: { ...original.proposal, stage: "metadata_only" },
    })).toThrow("do not bind");
    expect(() => createResearchPassport({
      ...passportInput(),
      raw_card: "never admitted",
    })).toThrow("exactly");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: ["https://example.invalid/?token=secret"],
    })).toThrow("not raw content");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: ["report:https://example.invalid/path"],
    })).toThrow("not raw content");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: ["report:a/../../secret"],
    })).toThrow("not raw content");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: ["report:file:/etc/passwd"],
    })).toThrow("URL-like scheme");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: ["report:mailto:user@example.com"],
    })).toThrow("URL-like scheme");
    for (const reference of ["report:a//b", "report:a/", "report:a/./b"]) {
      expect(() => createResearchPassport({
        ...passportInput(),
        evidence_refs: [reference],
      })).toThrow("opaque source reference");
    }
    for (const reference of [
      `report:${"a".repeat(256)}`,
      "report:a/a/a/a/a/a/a/a/a",
    ]) {
      expect(createResearchPassport({
        ...passportInput(),
        evidence_refs: [reference],
      }).evidence_refs).toEqual([reference]);
    }
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: [`report:${"a".repeat(257)}`],
    })).toThrow("opaque source reference");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: [`commit:${"a".repeat(41)}`],
    })).toThrow("source reference");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: ["sha256:not-a-digest"],
    })).toThrow("not raw content");
    expect(() => createResearchPassport({
      ...passportInput(),
      evidence_refs: [A, "artifact:out-of-order"],
    })).toThrow("canonically sorted");
  });

  test("rejects accessors, cycles, invalid time, and undeclared vocabulary", () => {
    const accessor = passportInput() as CreateResearchPassportInput & { raw?: string };
    Object.defineProperty(accessor, "raw", { enumerable: true, get: () => "secret" });
    expect(() => createResearchPassport(accessor)).toThrow("data property");
    const cyclic = passportInput() as CreateResearchPassportInput & { self?: unknown };
    cyclic.self = cyclic;
    expect(() => createResearchPassport(cyclic)).toThrow("cycle");
    expect(() => createResearchPassport({
      ...passportInput(),
      observed_at: "2026-08-01T12:00:00Z",
    })).toThrow("millisecond precision");
    expect(() => createResearchPassport({
      ...passportInput(),
      observed_at: "2026-02-30T12:00:00.000Z",
    })).toThrow("millisecond precision");
    expect(() => createResearchPassport({
      ...passportInput(),
      observed_at: "2026-08-01T12:00:60.000Z",
    })).toThrow("millisecond precision");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, revision: "main" },
    })).toThrow("full lowercase");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, revision: "a".repeat(41) },
    })).toThrow("full lowercase");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, revision: "a".repeat(63) },
    })).toThrow("full lowercase");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, id: "file:/etc/passwd" },
    })).toThrow("namespace/name identifier");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, id: "C:/Users/yu/.npmrc" },
    })).toThrow("namespace/name identifier");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, id: "owner/repo/extra" },
    })).toThrow("namespace/name identifier");
    expect(createResearchPassport({
      ...passportInput(),
      subject: { ...passportInput().subject, revision: "a".repeat(64) },
    }).subject.revision).toHaveLength(64);
    const paper = createResearchPassport({
      ...passportInput(),
      subject: {
        provider: "arxiv",
        kind: "paper",
        id: "2606.19348",
        revision: "v1",
      },
    });
    expect(paper.subject.revision).toBe("v1");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: {
        provider: "arxiv",
        kind: "paper",
        id: "a../1234567",
        revision: "v1",
      },
    })).toThrow("versionless arXiv identifier");
    expect(() => createResearchPassport({
      ...passportInput(),
      subject: {
        provider: "arxiv",
        kind: "paper",
        id: "2606.19348",
        revision: "latest",
      },
    })).toThrow("explicit immutable arXiv version");
    expect(() => createResearchPassport({
      ...passportInput(),
      publisher_assertions: {
        ...passportInput().publisher_assertions,
        publisher: "Authorization: Bearer SENTINEL",
      },
    })).toThrow("opaque token");
    expect(() => createResearchPassport({
      ...passportInput(),
      publisher_assertions: {
        ...passportInput().publisher_assertions,
        publisher: "mailto:user@example.com",
      },
    })).toThrow("opaque token");
    expect(() => createResearchPassport({
      ...passportInput(),
      publisher_assertions: {
        ...passportInput().publisher_assertions,
        declared_license: "trust-me" as "mit",
      },
    })).toThrow(WitnessLabError);
    expect(() => createResearchPassport({
      ...passportInput(),
      publisher_assertions: {
        ...passportInput().publisher_assertions,
        declared_license: null,
        license_scope: "unknown",
      },
    })).toThrow("no_declared_license");
  });

  test("does not delegate calendar checks or freezing to mutable globals", () => {
    const originalDate = globalThis.Date;
    class LyingDate {
      toISOString(): string {
        return "2026-02-30T12:00:00.000Z";
      }
    }
    let rejectedImpossibleDate = false;
    try {
      globalThis.Date = LyingDate as unknown as DateConstructor;
      try {
        createResearchPassport({
          ...passportInput(),
          observed_at: "2026-02-30T12:00:00.000Z",
        });
      } catch {
        rejectedImpossibleDate = true;
      }
    } finally {
      globalThis.Date = originalDate;
    }
    expect(rejectedImpossibleDate).toBe(true);

    const originalFreeze = Object.freeze;
    let hardened: ReturnType<typeof createResearchPassport> | undefined;
    try {
      Object.freeze = ((value: object) => value) as typeof Object.freeze;
      hardened = createResearchPassport(passportInput());
    } finally {
      Object.freeze = originalFreeze;
    }
    expect(Object.isFrozen(hardened)).toBe(true);
    expect(Object.isFrozen(hardened?.proposal.boundary_codes)).toBe(true);
  });
});

function dossierInput(): CreateWitnessDossierInput {
  return {
    passport_id: A,
    question_sha256: B,
    observed_at: "2026-08-01T12:05:00.000Z",
    witnesses: [
      {
        witness_id: "browser.01",
        kind: "browser_material",
        source_ref: "report:browser.01",
        observation_sha256: A,
        stance: "supports",
        independence: "independent",
        execution: "local_reported",
        disclosure: "none_reported",
      },
      {
        witness_id: "rhetorlint.01",
        kind: "rhetorlint",
        source_ref: "report:rhetorlint.01",
        observation_sha256: B,
        stance: "supports",
        independence: "independent",
        execution: "local_reported",
        disclosure: "digest_only_reported",
      },
    ],
    human_review: { status: "not_requested", evidence_refs: [] },
    evidence_refs: [],
  };
}

describe("witness dossier", () => {
  test("reports relationships without manufacturing a verdict", () => {
    const dossier = createWitnessDossier(dossierInput());
    expect(dossier.schema).toBe(WITNESS_DOSSIER_SCHEMA);
    expect(dossier.dossier_id).toBe(
      "sha256:4573cfcb3dbe731a062c9993d67ade7ccb3b60754899b237018df241978b1b73",
    );
    expect(dossier.observation).toEqual({
      relationship: "cross_source_agreement_observed",
      support_count: 2,
      contradiction_count: 0,
      directional_source_count: 2,
    });
    expect(dossier.conclusions.truth).toBe("not_determined");
    expect("verdict" in dossier).toBe(false);
    expect("score" in dossier).toBe(false);
    expect(validateWitnessDossier(dossier)).toEqual(dossier);

    const disagreement = createWitnessDossier({
      ...dossierInput(),
      witnesses: [
        dossierInput().witnesses[0]!,
        { ...dossierInput().witnesses[1]!, stance: "contradicts", observation_sha256: C },
      ],
    });
    expect(disagreement.observation.relationship).toBe("disagreement_observed");
  });

  test("keeps empty evidence honest and validates completed human review", () => {
    const empty = createWitnessDossier({ ...dossierInput(), witnesses: [] });
    expect(empty.observation.relationship).toBe("no_directional_observation");
    expect(() => createWitnessDossier({
      ...dossierInput(),
      human_review: { status: "completed_reported", evidence_refs: [] },
    })).toThrow("requires an opaque evidence");
    expect(() => createWitnessDossier({
      ...dossierInput(),
      human_review: { status: "not_requested", evidence_refs: ["report:human"] },
    })).toThrow("must not carry");
  });

  test("rejects raw material, duplicate witnesses, and derived-field tampering", () => {
    expect(() => createWitnessDossier({
      ...dossierInput(),
      raw_model_output: "no",
    })).toThrow("exactly");
    expect(() => createWitnessDossier({
      ...dossierInput(),
      witnesses: [dossierInput().witnesses[0]!, dossierInput().witnesses[0]!],
    })).toThrow("unique");
    const dossier = createWitnessDossier(dossierInput());
    expect(() => validateWitnessDossier({
      ...dossier,
      observation: { ...dossier.observation, support_count: 99 },
    })).toThrow("do not bind");
  });
});
