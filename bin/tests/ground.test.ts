import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalJson,
  createGroundObservation,
  evaluateGround,
  executeGroundCli,
  GROUND_OBSERVATION_FORMAT,
  GROUND_PLAN_FORMAT,
  GroundValidationError,
  parseGroundObservation,
  parseGroundPlan,
  parseGroundPlanText,
  type GroundObservation,
  type GroundObservationBody,
  type GroundPlan,
  type ObservationResult,
  type ProbeClass,
} from "../ground";

const REVISION = `git:${"a".repeat(40)}`;
const OLD_REVISION = `git:${"b".repeat(40)}`;
const AS_OF = "2026-08-02T12:00:00Z";
const OBSERVED = "2026-08-02T10:00:00Z";
const EXPIRES = "2026-08-09T10:00:00Z";
const DIGEST_1 = `sha256:${"1".repeat(64)}`;
const DIGEST_2 = `sha256:${"2".repeat(64)}`;
const DIGEST_3 = `sha256:${"3".repeat(64)}`;
const DOMAIN_A = `sha256:${"a".repeat(64)}`;
const DOMAIN_B = `sha256:${"b".repeat(64)}`;

function rawPlan(): Record<string, any> {
  return {
    _format: GROUND_PLAN_FORMAT,
    system_id: "repo:agenttool",
    scope: {
      revision: REVISION,
      complete: false,
      excluded: ["trusted-runtime"],
    },
    capabilities: [
      {
        id: "service",
        criticality: "load_bearing",
        required_probes: ["service.static", "service.execution", "service.recovery"],
        dependencies: ["service.store"],
        maintenance: {
          detect_probe: "service.execution",
          repair_ref: "docs/TROUBLESHOOTING.md#service",
          recovery_probe: "service.recovery",
          succession: {
            mode: "rebuild",
            ref: "docs/TROUBLESHOOTING.md#service",
            verification_probe: "service.recovery",
          },
        },
      },
    ],
    probes: [
      {
        id: "service.static",
        class: "static",
        max_age_seconds: 604_800,
        method_digest: DIGEST_1,
        scenario_digest: null,
      },
      {
        id: "service.execution",
        class: "execution",
        max_age_seconds: 604_800,
        method_digest: DIGEST_1,
        scenario_digest: null,
      },
      {
        id: "service.recovery",
        class: "recovery_drill",
        max_age_seconds: 2_592_000,
        method_digest: DIGEST_1,
        scenario_digest: DIGEST_1,
      },
      {
        id: "store.bounded-load",
        class: "execution",
        max_age_seconds: 604_800,
        method_digest: DIGEST_1,
        scenario_digest: null,
      },
      {
        id: "store.failure-containment",
        class: "execution",
        max_age_seconds: 604_800,
        method_digest: DIGEST_1,
        scenario_digest: null,
      },
      {
        id: "store.cleanup",
        class: "execution",
        max_age_seconds: 604_800,
        method_digest: DIGEST_1,
        scenario_digest: null,
      },
      {
        id: "store.failover",
        class: "recovery_drill",
        max_age_seconds: 2_592_000,
        method_digest: DIGEST_1,
        scenario_digest: DIGEST_1,
      },
      {
        id: "hosting.available",
        class: "input_condition",
        max_age_seconds: 86_400,
        method_digest: DIGEST_1,
        scenario_digest: null,
      },
    ],
    dependency_edges: [
      {
        id: "service.store",
        consumer: "service",
        need: "durable state",
        hard: true,
        providers: [
          { id: "store-primary", failure_domain: DOMAIN_A },
          { id: "store-fallback", failure_domain: DOMAIN_B },
        ],
        failover_probe: "store.failover",
        consumer_duties: {
          bounded_load_probe: "store.bounded-load",
          failure_containment_probe: "store.failure-containment",
          cleanup_probe: "store.cleanup",
        },
      },
    ],
    operational_inputs: [
      {
        id: "hosting-funds",
        kind: "money",
        serves: ["service"],
        condition_probe: "hosting.available",
      },
    ],
  };
}

function parsedPlan(): GroundPlan {
  return parseGroundPlan(rawPlan());
}

interface ObservationOverrides {
  revision?: string;
  result?: ObservationResult;
  method_digest?: string;
  observed_at?: string;
  expires_at?: string;
  evidence_digest?: string;
  scenario_digest?: string | null;
}

function observation(probeId: string, probeClass: ProbeClass, overrides: ObservationOverrides = {}): GroundObservation {
  const body: GroundObservationBody = {
    _format: GROUND_OBSERVATION_FORMAT,
    system_id: "repo:agenttool",
    revision: overrides.revision ?? REVISION,
    probe_id: probeId,
    class: probeClass,
    result: overrides.result ?? "pass",
    method_digest: overrides.method_digest ?? DIGEST_1,
    evidence_digest: overrides.evidence_digest ?? DIGEST_2,
    observer_control_root: "claimed:local-ci",
    environment_digest: DIGEST_3,
    scenario_digest:
      overrides.scenario_digest === undefined
        ? probeClass === "recovery_drill"
          ? DIGEST_1
          : null
        : overrides.scenario_digest,
    observed_at: overrides.observed_at ?? OBSERVED,
    expires_at: overrides.expires_at ?? EXPIRES,
  };
  return createGroundObservation(body);
}

function allFreshObservations(): GroundObservation[] {
  return [
    observation("service.static", "static"),
    observation("service.execution", "execution"),
    observation("service.recovery", "recovery_drill"),
    observation("store.bounded-load", "execution"),
    observation("store.failure-containment", "execution"),
    observation("store.cleanup", "execution"),
    observation("store.failover", "recovery_drill"),
    observation("hosting.available", "input_condition"),
  ];
}

function report(plan: GroundPlan | unknown = parsedPlan(), observations = allFreshObservations()) {
  return evaluateGround(plan, observations, AS_OF);
}

function findingCodes(value: ReturnType<typeof report>): string[] {
  return value.findings.map((item) => item.code);
}

describe("ground v0.1 — surface and execution evidence", () => {
  test("a declaration plus static evidence remains surface_only", () => {
    const value = report(parsedPlan(), [observation("service.static", "static")]);
    expect(value.capabilities[0]?.evidence_state).toBe("surface_only");
    expect(findingCodes(value)).toContain("surface_only");
  });

  test("fresh revision-bound execution and recovery evidence reaches observed", () => {
    const value = report();
    expect(value.capabilities[0]).toMatchObject({
      evidence_state: "observed",
      repair_state: "fresh_drill_pass",
      succession_state: "fresh_verification_pass",
    });
    expect(value.capabilities[0]?.evidence_ids).toHaveLength(3);
  });

  test("another revision and expired evidence are stale, never current", () => {
    const otherRevision = allFreshObservations().map((item) =>
      observation(item.probe_id, item.class, { revision: OLD_REVISION }),
    );
    expect(report(parsedPlan(), otherRevision).capabilities[0]?.evidence_state).toBe("stale");

    const expired = allFreshObservations().map((item) =>
      observation(item.probe_id, item.class, {
        observed_at: "2026-07-20T10:00:00Z",
        expires_at: "2026-07-21T10:00:00Z",
      }),
    );
    expect(report(parsedPlan(), expired).capabilities[0]?.evidence_state).toBe("stale");
  });

  test("any in-window failure dominates a later pass until supersession exists", () => {
    const observations = allFreshObservations().filter((item) => item.probe_id !== "service.execution");
    observations.push(
      observation("service.execution", "execution", {
        observed_at: "2026-08-02T09:00:00Z",
        result: "fail",
        evidence_digest: DIGEST_1,
      }),
    );
    observations.push(
      observation("service.execution", "execution", {
        observed_at: "2026-08-02T11:00:00Z",
        evidence_digest: DIGEST_3,
      }),
    );
    const value = report(parsedPlan(), observations);
    expect(value.capabilities[0]?.evidence_state).toBe("failed");
    expect(findingCodes(value)).toContain("required_probe_failed");
    expect(value.findings.find((item) => item.code === "required_probe_failed")?.detail).toBe(
      "An in-window result for at least one required probe failed.",
    );
  });

  test("a recovery claim needs a scenario and a current passing drill", () => {
    const invalid = {
      ...observation("service.recovery", "recovery_drill"),
      scenario_digest: null,
    };
    expect(() => parseGroundObservation(invalid)).toThrow(/scenario_digest/);

    const withoutDrill = allFreshObservations().filter((item) => item.probe_id !== "service.recovery");
    expect(report(parsedPlan(), withoutDrill).capabilities[0]?.repair_state).toBe("declared_only");

    const oldDrill = withoutDrill.concat(
      observation("service.recovery", "recovery_drill", {
        revision: OLD_REVISION,
      }),
    );
    expect(report(parsedPlan(), oldDrill).capabilities[0]?.repair_state).toBe("stale");
  });

  test("planned methods and recovery scenarios bind admitted observations", () => {
    expect(() =>
      report(parsedPlan(), [
        observation("service.execution", "execution", {
          method_digest: DIGEST_2,
        }),
      ]),
    ).toThrow(/method_digest differs/);
    expect(() =>
      report(parsedPlan(), [
        observation("service.recovery", "recovery_drill", {
          scenario_digest: DIGEST_2,
        }),
      ]),
    ).toThrow(/scenario_digest differs/);
  });

  test("static census and lifecycle observations cannot substitute for execution", () => {
    const plan = rawPlan();
    plan.capabilities[0].required_probes = ["service.static", "garden.lifecycle"];
    plan.probes.push({
      id: "garden.lifecycle",
      class: "lifecycle",
      max_age_seconds: 604_800,
      method_digest: DIGEST_1,
      scenario_digest: null,
    });
    const value = report(plan, [observation("service.static", "static"), observation("garden.lifecycle", "lifecycle")]);
    expect(value.capabilities[0]?.evidence_state).toBe("surface_only");
  });

  test("expiry is inclusive at the exact boundary and stale one second later", () => {
    const observations = allFreshObservations().map((item) =>
      observation(item.probe_id, item.class, {
        expires_at: AS_OF,
      }),
    );
    expect(evaluateGround(parsedPlan(), observations, AS_OF).capabilities[0]?.evidence_state).toBe("observed");
    expect(evaluateGround(parsedPlan(), observations, "2026-08-02T12:00:01Z").capabilities[0]?.evidence_state).toBe(
      "stale",
    );
  });
});

describe("ground v0.1 — diversity, repair, and reciprocal care", () => {
  test("multiple provider names in one failure domain remain correlated", () => {
    const plan = rawPlan();
    plan.dependency_edges[0].providers[1].failure_domain = DOMAIN_A;
    const value = report(plan);
    expect(findingCodes(value)).toContain("correlated_fallbacks");
    expect(value.dependencies[0]?.distinct_failure_domains).toBe(1);
  });

  test("distinct domains plus a fresh failover drill clear the bounded topology finding", () => {
    const value = report();
    expect(value.dependencies[0]?.failover_state).toBe("evidenced");
    expect(findingCodes(value)).not.toContain("correlated_fallbacks");
    expect(findingCodes(value)).not.toContain("untested_fallback");
    expect(findingCodes(value)).not.toContain("unmitigated_single_failure_domain");
  });

  test("dependency cycles stay visible", () => {
    const plan = rawPlan();
    plan.capabilities.push({
      id: "worker",
      criticality: "supporting",
      required_probes: [],
      dependencies: ["worker.service"],
      maintenance: {
        detect_probe: null,
        repair_ref: null,
        recovery_probe: null,
        succession: null,
      },
    });
    plan.capabilities[0].dependencies.push("service.worker");
    plan.dependency_edges.push(
      {
        id: "service.worker",
        consumer: "service",
        need: "worker",
        hard: true,
        providers: [{ id: "worker", failure_domain: DOMAIN_A }],
        failover_probe: null,
        consumer_duties: {
          bounded_load_probe: null,
          failure_containment_probe: null,
          cleanup_probe: null,
        },
      },
      {
        id: "worker.service",
        consumer: "worker",
        need: "service",
        hard: true,
        providers: [{ id: "service", failure_domain: DOMAIN_B }],
        failover_probe: null,
        consumer_duties: {
          bounded_load_probe: null,
          failure_containment_probe: null,
          cleanup_probe: null,
        },
      },
    );
    const value = report(plan);
    expect(value.findings).toContainEqual(
      expect.objectContaining({
        code: "coupled_dependency_cycle",
        subject: "service,worker",
      }),
    );
  });

  test("care is declared-only or missing until every duty has fresh evidence", () => {
    const complete = report();
    expect(complete.dependencies[0]?.care_state).toBe("evidenced");

    const missingPlan = rawPlan();
    missingPlan.dependency_edges[0].consumer_duties.cleanup_probe = null;
    const missing = report(missingPlan);
    expect(missing.dependencies[0]?.care_state).toBe("missing");
    expect(findingCodes(missing)).toContain("dependency_care_missing");

    const noEvidence = allFreshObservations().filter((item) => item.probe_id !== "store.cleanup");
    const declared = report(parsedPlan(), noEvidence);
    expect(declared.dependencies[0]?.care_state).toBe("declared_only");
  });

  test("care and failover roles reject static or lifecycle probes", () => {
    const dutyPlan = rawPlan();
    dutyPlan.dependency_edges[0].consumer_duties.bounded_load_probe = "service.static";
    expect(() => parseGroundPlan(dutyPlan)).toThrow(/must name an execution or runtime probe/);

    const failoverPlan = rawPlan();
    failoverPlan.dependency_edges[0].failover_probe = "service.static";
    expect(() => parseGroundPlan(failoverPlan)).toThrow(/must name a recovery_drill probe/);
  });

  test("succession verification cannot be a static or input-condition claim", () => {
    const plan = rawPlan();
    plan.capabilities[0].maintenance.succession.verification_probe = "service.static";
    expect(() => parseGroundPlan(plan)).toThrow(
      /succession.verification_probe.*execution, runtime, recovery_drill, or lifecycle/,
    );
  });
});

describe("ground v0.1 — resources are constraints, not objectives", () => {
  test("adding another money input cannot improve or degrade capability evidence", () => {
    const baseline = report();
    const plan = rawPlan();
    plan.operational_inputs.push({
      id: "contingency-funds",
      kind: "money",
      serves: ["service"],
      condition_probe: null,
    });
    const withMore = report(plan);
    expect(withMore.capabilities).toEqual(baseline.capabilities);
    expect(withMore.operational_inputs).toHaveLength(2);
    expect(withMore.operational_inputs.find((item) => item.id === "contingency-funds")?.state).toBe("unknown");
  });

  test("amount, balance, score, rank, and reward fields are rejected", () => {
    for (const field of ["amount", "balance", "score", "rank", "reward"]) {
      const plan = rawPlan();
      plan.operational_inputs[0][field] = 1;
      expect(() => parseGroundPlan(plan), field).toThrow(/unknown field/);
    }
  });

  test("a failed input condition reports a constraint without changing evidence", () => {
    const observations = allFreshObservations().filter((item) => item.probe_id !== "hosting.available");
    observations.push(observation("hosting.available", "input_condition", { result: "fail" }));
    const value = report(parsedPlan(), observations);
    expect(value.capabilities[0]?.evidence_state).toBe("observed");
    expect(value.operational_inputs[0]?.state).toBe("constrained");
    expect(findingCodes(value)).toContain("operational_input_constrained");
  });

  test("input conditions cannot be required capability evidence", () => {
    const plan = rawPlan();
    plan.capabilities[0].required_probes.push("hosting.available");
    expect(() => parseGroundPlan(plan)).toThrow(/cannot support capability evidence/);
  });

  test("operational input kinds exclude beings, labour, and catch-all categories", () => {
    for (const kind of ["labour", "attention", "agent", "human", "other"]) {
      const plan = rawPlan();
      plan.operational_inputs[0].kind = kind;
      expect(() => parseGroundPlan(plan), kind).toThrow(
        /must be one of money, compute, storage, network, energy, time/,
      );
    }
  });
});

describe("ground v0.1 — closed deterministic boundary", () => {
  test("raw output, environment material, and unknown fields are inadmissible", () => {
    const raw = {
      ...observation("service.execution", "execution"),
      stdout: "raw output",
    };
    expect(() => parseGroundObservation(raw)).toThrow(/unknown field/);

    const plan = rawPlan();
    plan.capabilities[0].required_probes = Array.from({ length: 65 }, (_, index) => `probe-${index}`);
    expect(() => parseGroundPlan(plan)).toThrow(/at most 64/);

    const freeTextScope = rawPlan();
    freeTextScope.scope.excluded = ["copied private explanation"];
    expect(() => parseGroundPlan(freeTextScope)).toThrow(/lowercase bounded identifier/);
  });

  test("CLI JSON rejects duplicate decoded object keys", () => {
    const text = JSON.stringify(rawPlan()).replace(
      '"system_id":"repo:agenttool"',
      '"system_id":"repo:agenttool","\\u0073ystem_id":"repo:agenttool"',
    );
    expect(() => parseGroundPlanText(text)).toThrow(/duplicate decoded field "system_id"/);
  });

  test("timestamps are real canonical whole-second UTC values", () => {
    const fractional = {
      ...observation("service.execution", "execution"),
      observed_at: "2026-08-02T10:00:00.000Z",
    };
    expect(() => parseGroundObservation(fractional)).toThrow(/canonical whole-second/);

    const impossible = {
      ...observation("service.execution", "execution"),
      observed_at: "2026-02-30T10:00:00Z",
    };
    expect(() => parseGroundObservation(impossible)).toThrow(/real canonical timestamp/);
  });

  test("input ordering cannot alter canonical report bytes", () => {
    const firstPlan = rawPlan();
    const secondPlan = rawPlan();
    secondPlan.probes.reverse();
    secondPlan.dependency_edges[0].providers.reverse();
    secondPlan.capabilities[0].required_probes.reverse();
    const observations = allFreshObservations();
    expect(canonicalJson(report(firstPlan, observations))).toBe(
      canonicalJson(report(secondPlan, [...observations].reverse())),
    );
  });

  test("the report grants no action and names its non-claims", () => {
    const value = report();
    expect(value.authority).toEqual({ automatic_action: "never", grants: [] });
    expect(value.assertions_not_made).toContain("global_health");
    expect(value.assertions_not_made).toContain("independence_from_claimed_labels");
    expect(value.assertions_not_made).toContain("money_as_objective");
    expect(value.assertions_not_made).toContain("exact_checkout");
    expect(value.assertions_not_made).toContain("trusted_clock");
    expect(value.assertions_not_made).toContain("method_execution_beyond_admitted_receipt");
    expect(value.assertions_not_made).toContain("observer_identity");
    expect(value).not.toHaveProperty("score");
    expect(value).not.toHaveProperty("status");
  });

  test("the compiler imports no execution, network, persistence, or economic integration", () => {
    const source = readFileSync(join(import.meta.dir, "..", "ground.ts"), "utf8");
    for (const pattern of [
      /node:http/,
      /node:https/,
      /node:net/,
      /node:child_process/,
      /bun:sqlite/,
      /\bfetch\s*\(/,
      /\bspawn(?:Sync)?\s*\(/,
      /\bexec(?:FileSync|Sync)?\s*\(/,
      /writeFile/,
      /appendFile/,
    ]) {
      expect(source).not.toMatch(pattern);
    }
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toEqual(["node:crypto", "node:fs"]);
  });

  test("CLI inputs and evaluation time are explicit; validation is side-effect free", () => {
    const planText = JSON.stringify(rawPlan());
    const observationsText = allFreshObservations()
      .map((item) => JSON.stringify(item))
      .join("\n");
    const reads: string[] = [];
    const io = {
      read(source: string): string {
        reads.push(source);
        if (source === "plan.json") return planText;
        if (source === "observations.jsonl") return observationsText;
        throw new Error("unexpected source");
      },
    };
    const validation = JSON.parse(executeGroundCli(["validate", "--plan", "plan.json"], io));
    expect(validation).toEqual({
      _format: "agenttool.ground-validation/v0.1",
      capability_count: 1,
      observation_count: 0,
      valid: true,
    });
    const value = JSON.parse(
      executeGroundCli(["report", "--plan", "plan.json", "--observations", "observations.jsonl", "--as-of", AS_OF], io),
    );
    expect(value.as_of).toBe(AS_OF);
    expect(reads).toEqual(["plan.json", "plan.json", "observations.jsonl"]);
    expect(() =>
      executeGroundCli(["report", "--plan", "plan.json", "--observations", "observations.jsonl"], io),
    ).toThrow(/requires --plan, --observations, and --as-of/);
    expect(() => executeGroundCli(["report", "--plan", "-", "--observations", "-", "--as-of", AS_OF], io)).toThrow(
      /stdin may be selected for only one input/,
    );
    expect(() =>
      executeGroundCli(
        ["report", "--plan", "plan.json", "--observations", "observations.jsonl", "--as-of", AS_OF, "--json"],
        io,
      ),
    ).toThrow(/unknown option --json/);
    expect(() => executeGroundCli(["validate", "--plan", "plan.json", "stray"], io)).toThrow(
      /positional arguments are not accepted/,
    );
    expect(() => executeGroundCli(["validate", "--plan", "plan.json", "--plan", "plan.json"], io)).toThrow(
      /duplicate option --plan/,
    );
  });

  test("validate binds optional observations to the selected plan", () => {
    const planText = JSON.stringify(rawPlan());
    const foreignBody: GroundObservationBody = {
      ...observation("service.execution", "execution"),
      system_id: "repo:elsewhere",
    };
    const { observation_id: _id, ...body } = foreignBody as GroundObservation;
    const foreign = createGroundObservation(body);
    const io = {
      read(source: string): string {
        return source === "plan.json" ? planText : JSON.stringify(foreign);
      },
    };
    expect(() => executeGroundCli(["validate", "--plan", "plan.json", "--observations", "foreign.jsonl"], io)).toThrow(
      /another system_id/,
    );

    const wrongClass = observation("service.execution", "static");
    const classIo = {
      read(source: string): string {
        return source === "plan.json" ? planText : JSON.stringify(wrongClass);
      },
    };
    expect(() =>
      executeGroundCli(["validate", "--plan", "plan.json", "--observations", "wrong-class.jsonl"], classIo),
    ).toThrow(/class differs/);
  });

  test("observation identifiers bind every admitted body field", () => {
    const valid = observation("service.execution", "execution");
    expect(parseGroundObservation(valid)).toEqual(valid);
    expect(() => parseGroundObservation({ ...valid, result: "fail" })).toThrow(/does not bind/);
  });

  test("schema errors are typed and do not silently accept foreign systems or probes", () => {
    expect(() => parseGroundPlan({ ...rawPlan(), score: 1 })).toThrow(GroundValidationError);
    const foreign = {
      ...observation("service.execution", "execution"),
      system_id: "repo:elsewhere",
    };
    // Recreate a valid foreign receipt so evaluation reaches the system boundary.
    const { observation_id: _id, ...foreignBody } = foreign;
    const validForeign = createGroundObservation(foreignBody as GroundObservationBody);
    expect(() => report(parsedPlan(), [validForeign])).toThrow(/another system_id/);
  });
});
