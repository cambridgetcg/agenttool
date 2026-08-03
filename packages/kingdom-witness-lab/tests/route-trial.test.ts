import { describe, expect, test } from "bun:test";

import {
  ROUTE_FEATURES,
  createExecutionRouteBinding,
  createSpeculativeTrialDescriptor,
  validateExecutionRouteBinding,
  validateSpeculativeTrialDescriptor,
  type CreateExecutionRouteBindingInput,
  type CreateSpeculativeTrialInput,
  type ResearchArtifactRef,
  type RouteFeatureObservation,
} from "../src/index.js";

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

function featureMatrix(): RouteFeatureObservation[] {
  return ROUTE_FEATURES.map((feature) => ({ feature, status: "unknown", note_code: null }));
}

function routeInput(): CreateExecutionRouteBindingInput {
  return {
    artifact: TARGET,
    route: {
      provider: "deepseek_api",
      route_id: "deepseek.responses.v4-flash",
      effective_version: null,
      observed_at: "2026-08-01T12:10:00.000Z",
      api_dialect: "deepseek_responses",
      equivalence: "unknown",
      equivalence_evidence_refs: [],
    },
    features: featureMatrix(),
    disclosure: {
      retention_basis: "provider_policy_observed",
      input_disclosure: "remote_provider",
      training_use: "allowed_by_general_policy",
      evidence_refs: ["report:deepseek.policy.2026-08-01"],
    },
    evidence_refs: ["report:deepseek.api.2026-08-01"],
  };
}

describe("execution-route binding", () => {
  test("keeps a mutable hosted route distinct from its pinned artifact", () => {
    const binding = createExecutionRouteBinding(routeInput());
    expect(binding.binding_id).toBe(
      "sha256:6300f16bdeb39125e3e89606372c2e9984e6eb1fa8b8c1f67e15aabe3cb4ef8f",
    );
    expect(binding.boundaries).toEqual({
      artifact_route_equivalence: "unknown",
      credentials: "not_received",
      dispatch: "not_performed",
      authority: "none",
      automatic_action: false,
    });
    expect(binding.features).toHaveLength(ROUTE_FEATURES.length);
    expect(validateExecutionRouteBinding(binding)).toEqual(binding);
    expect(Object.isFrozen(binding.features)).toBe(true);
  });

  test("requires a full feature matrix and evidence for equivalence claims", () => {
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      features: featureMatrix().slice(1),
    })).toThrow("describe all");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      route: { ...routeInput().route, equivalence: "verified" },
    })).toThrow("requires an opaque evidence");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      route: {
        ...routeInput().route,
        equivalence_evidence_refs: ["report:not-compatible"],
      },
    })).toThrow("must not carry");
  });

  test("requires disclosure evidence for external policy and contract claims", () => {
    for (const retention_basis of ["contractual", "provider_policy_observed"] as const) {
      expect(() => createExecutionRouteBinding({
        ...routeInput(),
        disclosure: {
          retention_basis,
          input_disclosure: "remote_provider",
          training_use: "unknown",
          evidence_refs: [],
        },
      })).toThrow("require an opaque disclosure evidence");
    }
    for (const training_use of ["allowed_by_general_policy", "opted_out_reported"] as const) {
      expect(() => createExecutionRouteBinding({
        ...routeInput(),
        disclosure: {
          retention_basis: "unknown",
          input_disclosure: "remote_provider",
          training_use,
          evidence_refs: [],
        },
      })).toThrow("require an opaque disclosure evidence");
    }
    expect(createExecutionRouteBinding({
      ...routeInput(),
      disclosure: {
        retention_basis: "caller_reported",
        input_disclosure: "remote_provider",
        training_use: "unknown",
        evidence_refs: [],
      },
    }).disclosure.evidence_refs).toEqual([]);
  });

  test("rejects semantic erasure and remote/local disclosure contradictions", () => {
    const ignored = featureMatrix();
    ignored[0] = { ...ignored[0]!, status: "ignored", note_code: null };
    expect(() => createExecutionRouteBinding({ ...routeInput(), features: ignored }))
      .toThrow("silently_ignored");
    const semanticContradiction = featureMatrix();
    semanticContradiction[0] = {
      ...semanticContradiction[0]!,
      status: "supported",
      note_code: "silently_ignored",
    };
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      features: semanticContradiction,
    })).toThrow("valid only");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      disclosure: { ...routeInput().disclosure, input_disclosure: "local_only" },
    })).toThrow("cannot claim local-only");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      raw_request: "forbidden",
    })).toThrow("exactly");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      route: {
        ...routeInput().route,
        effective_version: "Authorization: Bearer SENTINEL",
      },
    })).toThrow("opaque revision descriptor");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      route: {
        ...routeInput().route,
        effective_version: "https://api.deepseek.example/model",
      },
    })).toThrow("opaque revision descriptor");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      route: { ...routeInput().route, route_id: "file:/etc/passwd" },
    })).toThrow("opaque token");
    expect(() => createExecutionRouteBinding({
      ...routeInput(),
      route: { ...routeInput().route, effective_version: "mailto:user@example.com" },
    })).toThrow("opaque revision descriptor");
  });
});

function trialInput(): CreateSpeculativeTrialInput {
  return {
    trial_id: "deepseek.deepspec.fixture.01",
    observed_at: "2026-08-01T12:15:00.000Z",
    target_artifact: TARGET,
    draft_artifact: DRAFT,
    engine: {
      id: "deepspec",
      revision: "005e03b81cec38b7da6399833d609ee89a2587f2",
      config_sha256: A,
    },
    workload: {
      prompt_set_sha256: B,
      matched_settings_reported: true,
      thinking_mode: "enabled",
      sampling_mode: "deterministic",
      concurrency: 1,
      request_count: 32,
    },
    status: "planned",
    metrics: {
      acceptance_length_micros: null,
      throughput_milli_tokens_per_second: null,
      latency_micros: null,
    },
    evidence_refs: [],
  };
}

describe("speculative-decoding trial descriptor", () => {
  test("records only digests, settings, and fixed-point reported metrics", () => {
    const planned = createSpeculativeTrialDescriptor(trialInput());
    expect(planned.descriptor_id).toBe(
      "sha256:71ddc0a5496f3642dc930f92dc46342e525779b2f5bbb480733aaf682bb400cf",
    );
    expect(planned.conclusions.performance).toBe("caller_reported_only");
    expect(planned.conclusions.automatic_retry).toBe(false);
    expect(validateSpeculativeTrialDescriptor(planned)).toEqual(planned);

    const completed = createSpeculativeTrialDescriptor({
      ...trialInput(),
      status: "completed_reported",
      metrics: {
        acceptance_length_micros: 2_500_000,
        throughput_milli_tokens_per_second: 125_000,
        latency_micros: 900_000,
      },
      evidence_refs: ["test:deepspec.synthetic.01"],
    });
    expect(completed.descriptor_id).not.toBe(planned.descriptor_id);
  });

  test("rejects raw content, same-model pairs, and impossible status/metrics", () => {
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      raw_prompts: ["never"],
    })).toThrow("exactly");
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      draft_artifact: TARGET,
    })).toThrow("must be distinct");
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      metrics: { ...trialInput().metrics, latency_micros: 1 },
    })).toThrow("must not carry");
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      status: "completed_reported",
      evidence_refs: ["test:missing-metrics"],
    })).toThrow("requires all three");
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      target_artifact: { ...TARGET, kind: "code" },
    })).toThrow("not an allowed value");
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      draft_artifact: { ...DRAFT, kind: "dataset" },
    })).toThrow("not an allowed value");
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      engine: { ...trialInput().engine, revision: "latest" },
    })).toThrow("full lowercase Git commit digest");
    expect(() => createSpeculativeTrialDescriptor({
      ...trialInput(),
      engine: { ...trialInput().engine, revision: "a".repeat(41) },
    })).toThrow("full lowercase Git commit digest");
    expect(createSpeculativeTrialDescriptor({
      ...trialInput(),
      engine: { ...trialInput().engine, revision: "a".repeat(64) },
    }).engine.revision).toBe("a".repeat(64));
  });
});
