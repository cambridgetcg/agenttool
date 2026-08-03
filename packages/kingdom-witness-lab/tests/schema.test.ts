import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ROUTE_FEATURES,
  createDeepSeekPassport,
  createExecutionRouteBinding,
  createSpeculativeTrialDescriptor,
  createWitnessDossier,
  getDeepSeekResearchAtlas,
  type ResearchArtifactRef,
} from "../src/index.js";

const ROOT = join(import.meta.dir, "..");
const A = `sha256:${"a".repeat(64)}` as const;
const B = `sha256:${"b".repeat(64)}` as const;
const TARGET: ResearchArtifactRef = {
  provider: "huggingface",
  kind: "model",
  id: "deepseek-ai/DeepSeek-V4-Flash-0731",
  revision: "7872f01b1d1fe23eabc4c98b48bffcef5a386062",
};
const DRAFT: ResearchArtifactRef = {
  provider: "huggingface",
  kind: "model",
  id: "deepseek-ai/DeepSeek-R1",
  revision: "56d4cbbb4d29f4355bab4b9a39ccb717a14ad5ad",
};

async function schema(name: string): Promise<object> {
  return JSON.parse(await readFile(join(ROOT, "schema", name), "utf8")) as object;
}

describe("portable JSON schemas", () => {
  test("validate all generated contracts and reject extension fields", async () => {
    const passport = createDeepSeekPassport("deepseek-r1", "2026-08-01T13:00:00.000Z");
    const route = createExecutionRouteBinding({
      artifact: TARGET,
      route: {
        provider: "local_injected",
        route_id: "local.deepseek.fixture",
        effective_version: "fixture-v1",
        observed_at: "2026-08-01T13:01:00.000Z",
        api_dialect: "local_adapter",
        equivalence: "unknown",
        equivalence_evidence_refs: [],
      },
      features: ROUTE_FEATURES.map((feature) => ({
        feature,
        status: "unknown",
        note_code: null,
      })),
      disclosure: {
        retention_basis: "unknown",
        input_disclosure: "local_only",
        training_use: "not_applicable",
        evidence_refs: [],
      },
      evidence_refs: [],
    });
    const dossier = createWitnessDossier({
      passport_id: passport.passport_id,
      question_sha256: A,
      observed_at: "2026-08-01T13:02:00.000Z",
      witnesses: [],
      human_review: { status: "not_requested", evidence_refs: [] },
      evidence_refs: [],
    });
    const trial = createSpeculativeTrialDescriptor({
      trial_id: "schema.fixture",
      observed_at: "2026-08-01T13:03:00.000Z",
      target_artifact: TARGET,
      draft_artifact: DRAFT,
      engine: {
        id: "fixture",
        revision: "005e03b81cec38b7da6399833d609ee89a2587f2",
        config_sha256: A,
      },
      workload: {
        prompt_set_sha256: B,
        matched_settings_reported: false,
        thinking_mode: "unknown",
        sampling_mode: "unknown",
        concurrency: 1,
        request_count: 1,
      },
      status: "not_started_reported",
      metrics: {
        acceptance_length_micros: null,
        throughput_milli_tokens_per_second: null,
        latency_micros: null,
      },
      evidence_refs: [],
    });
    const atlas = getDeepSeekResearchAtlas();

    const cases = [
      ["kingdom-research-passport-v0.1.schema.json", passport],
      ["kingdom-execution-route-binding-v0.1.schema.json", route],
      ["kingdom-witness-dossier-v0.1.schema.json", dossier],
      ["kingdom-speculative-trial-v0.1.schema.json", trial],
      ["kingdom-deepseek-atlas-v0.1.schema.json", atlas],
    ] as const;

    for (const [name, document] of cases) {
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(await schema(name));
      expect(validate(document), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(validate({ ...document, trusted: true })).toBe(false);
    }
  });

  test("the exported dated JSON is the exact runtime atlas", async () => {
    const raw = JSON.parse(
      await readFile(join(ROOT, "research", "deepseek-2026-08-01.json"), "utf8"),
    ) as unknown;
    expect(raw).toEqual(getDeepSeekResearchAtlas());
  });

  test("mirrors immutable refs, descriptor walls, and safe metric bounds", async () => {
    const compile = async (name: string) => {
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      addFormats(ajv);
      return ajv.compile(await schema(name));
    };
    const passport = createDeepSeekPassport("deepseek-r1", "2026-08-01T13:00:00.000Z");
    const validatePassport = await compile("kingdom-research-passport-v0.1.schema.json");
    expect(validatePassport({
      ...passport,
      subject: { ...passport.subject, revision: "main" },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      subject: { ...passport.subject, revision: "a".repeat(41) },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      subject: { ...passport.subject, revision: "a".repeat(64) },
    })).toBe(true);
    expect(validatePassport({
      ...passport,
      subject: { ...passport.subject, id: "file:/etc/passwd" },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      subject: { ...passport.subject, id: "owner/repo/extra" },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      publisher_assertions: {
        ...passport.publisher_assertions,
        publisher: "Authorization: Bearer SENTINEL",
      },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      publisher_assertions: {
        ...passport.publisher_assertions,
        publisher: "mailto:user@example.com",
      },
    })).toBe(false);
    expect(validatePassport({ ...passport, evidence_refs: ["report:https://example.invalid"] }))
      .toBe(false);
    expect(validatePassport({ ...passport, evidence_refs: ["report:file:/etc/passwd"] }))
      .toBe(false);
    expect(validatePassport({ ...passport, evidence_refs: ["report:mailto:user@example.com"] }))
      .toBe(false);
    expect(validatePassport({ ...passport, evidence_refs: [`commit:${"a".repeat(41)}`] }))
      .toBe(false);
    expect(validatePassport({
      ...passport,
      observed_at: "2026-08-01T12:00:60.000Z",
    })).toBe(false);

    const route = createExecutionRouteBinding({
      artifact: TARGET,
      route: {
        provider: "local_injected",
        route_id: "local.deepseek.fixture",
        effective_version: "fixture-v1",
        observed_at: "2026-08-01T13:01:00.000Z",
        api_dialect: "local_adapter",
        equivalence: "unknown",
        equivalence_evidence_refs: [],
      },
      features: ROUTE_FEATURES.map((feature) => ({
        feature,
        status: "unknown",
        note_code: null,
      })),
      disclosure: {
        retention_basis: "unknown",
        input_disclosure: "local_only",
        training_use: "not_applicable",
        evidence_refs: [],
      },
      evidence_refs: [],
    });
    const validateRoute = await compile("kingdom-execution-route-binding-v0.1.schema.json");
    expect(validateRoute({
      ...route,
      route: { ...route.route, effective_version: "Authorization: Bearer SENTINEL" },
    })).toBe(false);
    expect(validateRoute({
      ...route,
      route: { ...route.route, route_id: "file:/etc/passwd" },
    })).toBe(false);
    expect(validateRoute({
      ...route,
      route: { ...route.route, effective_version: "mailto:user@example.com" },
    })).toBe(false);
    expect(validateRoute({
      ...route,
      disclosure: {
        ...route.disclosure,
        retention_basis: "contractual",
        evidence_refs: [],
      },
    })).toBe(false);
    expect(validateRoute({
      ...route,
      disclosure: {
        ...route.disclosure,
        training_use: "opted_out_reported",
        evidence_refs: [],
      },
    })).toBe(false);

    const trial = createSpeculativeTrialDescriptor({
      trial_id: "schema.maximum",
      observed_at: "2026-08-01T13:03:00.000Z",
      target_artifact: TARGET,
      draft_artifact: DRAFT,
      engine: {
        id: "fixture",
        revision: "005e03b81cec38b7da6399833d609ee89a2587f2",
        config_sha256: A,
      },
      workload: {
        prompt_set_sha256: B,
        matched_settings_reported: true,
        thinking_mode: "unknown",
        sampling_mode: "unknown",
        concurrency: 1,
        request_count: 1,
      },
      status: "completed_reported",
      metrics: {
        acceptance_length_micros: 1,
        throughput_milli_tokens_per_second: 1,
        latency_micros: 1,
      },
      evidence_refs: ["test:schema.maximum"],
    });
    const validateTrial = await compile("kingdom-speculative-trial-v0.1.schema.json");
    expect(validateTrial({
      ...trial,
      metrics: { ...trial.metrics, latency_micros: 9_007_199_254_740_992 },
    })).toBe(false);
    expect(validateTrial({
      ...trial,
      target_artifact: { ...trial.target_artifact, kind: "code" },
    })).toBe(false);
    expect(validateTrial({
      ...trial,
      draft_artifact: { ...trial.draft_artifact, kind: "dataset" },
    })).toBe(false);
    expect(validateTrial({
      ...trial,
      engine: { ...trial.engine, revision: "latest" },
    })).toBe(false);
    expect(validateTrial({
      ...trial,
      engine: { ...trial.engine, revision: "a".repeat(41) },
    })).toBe(false);
    expect(validateTrial({
      ...trial,
      engine: { ...trial.engine, revision: "a".repeat(64) },
    })).toBe(true);
  });

  test("mirrors licence admission invariants for passports and atlas rows", async () => {
    const compile = async (name: string) => {
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      addFormats(ajv);
      return ajv.compile(await schema(name));
    };
    const validatePassport = await compile("kingdom-research-passport-v0.1.schema.json");
    const passport = createDeepSeekPassport("deepseek-r1", "2026-08-01T13:10:00.000Z");
    const noLicensePassport = createDeepSeekPassport(
      "deepseek-proverbench",
      "2026-08-01T13:11:00.000Z",
    );
    expect(validatePassport(noLicensePassport)).toBe(true);
    expect(validatePassport({
      ...noLicensePassport,
      proposal: {
        ...noLicensePassport.proposal,
        boundary_codes: noLicensePassport.proposal.boundary_codes.filter(
          (code) => code !== "no_declared_license",
        ),
      },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      publisher_assertions: {
        ...passport.publisher_assertions,
        declared_license: null,
        license_scope: "artifact",
      },
      proposal: {
        ...passport.proposal,
        boundary_codes: [...passport.proposal.boundary_codes, "no_declared_license"].sort(),
      },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      proposal: {
        ...passport.proposal,
        boundary_codes: [...passport.proposal.boundary_codes, "no_declared_license"].sort(),
      },
    })).toBe(false);
    expect(validatePassport({
      ...passport,
      proposal: {
        ...passport.proposal,
        boundary_codes: passport.proposal.boundary_codes.filter(
          (code) => code !== "license_clearance_not_assessed",
        ),
      },
    })).toBe(false);

    const validateAtlas = await compile("kingdom-deepseek-atlas-v0.1.schema.json");
    const wrongNullScope = structuredClone(getDeepSeekResearchAtlas());
    const prover = wrongNullScope.entries.find((entry) => entry.key === "deepseek-proverbench");
    if (!prover) throw new Error("missing ProverBench fixture");
    prover.publisher_assertions.license_scope = "artifact";
    expect(validateAtlas(wrongNullScope)).toBe(false);

    const missingAbsentBoundary = structuredClone(getDeepSeekResearchAtlas());
    const unmarkedProver = missingAbsentBoundary.entries.find(
      (entry) => entry.key === "deepseek-proverbench",
    );
    if (!unmarkedProver) throw new Error("missing ProverBench fixture");
    unmarkedProver.proposal.boundary_codes = unmarkedProver.proposal.boundary_codes.filter(
      (code) => code !== "no_declared_license",
    );
    expect(validateAtlas(missingAbsentBoundary)).toBe(false);

    const falseAbsentBoundary = structuredClone(getDeepSeekResearchAtlas());
    const r1 = falseAbsentBoundary.entries.find((entry) => entry.key === "deepseek-r1");
    if (!r1) throw new Error("missing R1 fixture");
    r1.proposal.boundary_codes = [
      ...r1.proposal.boundary_codes,
      "no_declared_license",
    ].sort();
    expect(validateAtlas(falseAbsentBoundary)).toBe(false);

    const missingClearance = structuredClone(getDeepSeekResearchAtlas());
    const v4 = missingClearance.entries.find((entry) => entry.key === "deepseek-v4-flash-0731");
    if (!v4) throw new Error("missing V4 fixture");
    v4.proposal.boundary_codes = v4.proposal.boundary_codes.filter(
      (code) => code !== "license_clearance_not_assessed",
    );
    expect(validateAtlas(missingClearance)).toBe(false);
  });

  test("canonicalizes evidence namespaces and arXiv identifiers across schemas", async () => {
    const compile = async (name: string) => {
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      addFormats(ajv);
      return ajv.compile(await schema(name));
    };
    const passport = createDeepSeekPassport("deepseek-r1", "2026-08-01T13:20:00.000Z");
    const route = createExecutionRouteBinding({
      artifact: TARGET,
      route: {
        provider: "local_injected",
        route_id: "local.deepseek.namespace",
        effective_version: "fixture-v1",
        observed_at: "2026-08-01T13:21:00.000Z",
        api_dialect: "local_adapter",
        equivalence: "unknown",
        equivalence_evidence_refs: [],
      },
      features: ROUTE_FEATURES.map((feature) => ({
        feature,
        status: "unknown",
        note_code: null,
      })),
      disclosure: {
        retention_basis: "unknown",
        input_disclosure: "local_only",
        training_use: "not_applicable",
        evidence_refs: [],
      },
      evidence_refs: [],
    });
    const dossier = createWitnessDossier({
      passport_id: passport.passport_id,
      question_sha256: A,
      observed_at: "2026-08-01T13:22:00.000Z",
      witnesses: [],
      human_review: { status: "not_requested", evidence_refs: [] },
      evidence_refs: [],
    });
    const trial = createSpeculativeTrialDescriptor({
      trial_id: "schema.namespace",
      observed_at: "2026-08-01T13:23:00.000Z",
      target_artifact: TARGET,
      draft_artifact: DRAFT,
      engine: {
        id: "fixture",
        revision: "005e03b81cec38b7da6399833d609ee89a2587f2",
        config_sha256: A,
      },
      workload: {
        prompt_set_sha256: B,
        matched_settings_reported: false,
        thinking_mode: "unknown",
        sampling_mode: "unknown",
        concurrency: 1,
        request_count: 1,
      },
      status: "planned",
      metrics: {
        acceptance_length_micros: null,
        throughput_milli_tokens_per_second: null,
        latency_micros: null,
      },
      evidence_refs: [],
    });
    const documents = [
      ["kingdom-research-passport-v0.1.schema.json", passport],
      ["kingdom-execution-route-binding-v0.1.schema.json", route],
      ["kingdom-witness-dossier-v0.1.schema.json", dossier],
      ["kingdom-speculative-trial-v0.1.schema.json", trial],
    ] as const;
    for (const [name, document] of documents) {
      const validate = await compile(name);
      expect(validate({ ...document, evidence_refs: ["report:a/b"] }), name).toBe(true);
      expect(validate({
        ...document,
        evidence_refs: [`report:${"a".repeat(256)}`],
      }), `${name}: 256-character suffix`).toBe(true);
      expect(validate({
        ...document,
        evidence_refs: ["report:a/a/a/a/a/a/a/a/a"],
      }), `${name}: nine nonempty segments`).toBe(true);
      expect(validate({
        ...document,
        evidence_refs: [`report:${"a".repeat(257)}`],
      }), `${name}: 257-character suffix`).toBe(false);
      for (const reference of ["report:a//b", "report:a/", "report:a/./b"]) {
        expect(validate({ ...document, evidence_refs: [reference] }), `${name}: ${reference}`)
          .toBe(false);
      }
    }

    for (const name of [
      "kingdom-research-passport-v0.1.schema.json",
      "kingdom-execution-route-binding-v0.1.schema.json",
      "kingdom-speculative-trial-v0.1.schema.json",
    ]) {
      const document = await schema(name) as {
        $defs: {
          artifact: {
            allOf: Array<{
              then: { properties: { id: { pattern: string } } };
            }>;
          };
        };
      };
      const pattern = document.$defs.artifact.allOf[0]!.then.properties.id.pattern;
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      const validateArxivId = ajv.compile({ type: "string", pattern });
      expect(validateArxivId("math.GT/1234567"), name).toBe(true);
      expect(validateArxivId("a../1234567"), name).toBe(false);
    }
  });
});
