import { describe, expect, test } from "bun:test";

import {
  TRIAL_RECEIPT_SCHEMA,
  TrialError,
  canonicalJson,
  createTrialReceipt,
  sha256Id,
  validateTrialReceipt,
  type CreateTrialReceiptInput,
} from "../src/index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;

function completedInput(): CreateTrialReceiptInput {
  return {
    trial_id: "trial.echo.v1",
    attempt_id: "attempt.0001",
    observed_at: "2026-07-30T15:00:00.000Z",
    environment: {
      kind: "synthetic",
      id: "echo_env",
      revision: "v1",
      source_digest: DIGEST_A,
    },
    subject: {
      kind: "workflow",
      id: "browser.echo",
      revision: "git-536079d1",
    },
    objective_digest: DIGEST_B,
    authority: {
      authority_ref: "authority.local.read-only",
      allowed_effects: ["observation_read"],
    },
    status: {
      dispatch: "started",
      outcome: "succeeded",
      error_code: null,
    },
    possible_effects: ["observation_read"],
    evaluation: {
      verdict: "pass",
      reward_micros: 1_000_000,
      reward_unit: "unitless_millionths",
      rubric_digest: DIGEST_A,
      checks: [
        {
          check_id: "echo.matches",
          outcome: "pass",
          evidence_refs: ["test:echo-fixture"],
        },
      ],
    },
    evidence_refs: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    parent_receipt_id: null,
  };
}

describe("agenttool-trial-receipt/0.1", () => {
  test("creates deterministic, deeply frozen content-addressed receipts", () => {
    const first = createTrialReceipt(completedInput());
    const reordered = createTrialReceipt({
      ...completedInput(),
      environment: {
        source_digest: DIGEST_A,
        revision: "v1",
        id: "echo_env",
        kind: "synthetic",
      },
    });

    expect(first.schema).toBe(TRIAL_RECEIPT_SCHEMA);
    expect(first.receipt_id).toBe(
      "sha256:e69d1632f0d6c8bb0b89ab63ee5f5b495fd92b650b164249a552acd9a842a077",
    );
    expect(first.receipt_id).toBe(reordered.receipt_id);
    expect(first.authority_assessment).toBe("within_reported_bounds");
    expect(first.retry_advice).toBe("do_not_automatically_retry");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.environment)).toBe(true);
    expect(validateTrialReceipt(first)).toEqual(first);
  });

  test("binds every admitted body field", () => {
    const original = createTrialReceipt(completedInput());
    const changed = createTrialReceipt({
      ...completedInput(),
      objective_digest: sha256Id("different objective"),
    });
    expect(changed.receipt_id).not.toBe(original.receipt_id);

    expect(() =>
      validateTrialReceipt({
        ...original,
        subject: { ...original.subject, revision: "git-deadbeef" },
      })).toThrow("receipt_id does not bind");
  });

  test("changes identity across every input region", () => {
    const base = completedInput();
    const variants: CreateTrialReceiptInput[] = [
      { ...base, trial_id: "trial.echo.v2" },
      { ...base, attempt_id: "attempt.0002" },
      { ...base, observed_at: "2026-07-30T15:00:01.000Z" },
      {
        ...base,
        environment: { ...base.environment, kind: "openenv" },
      },
      {
        ...base,
        environment: { ...base.environment, id: "echo_env_2" },
      },
      {
        ...base,
        environment: { ...base.environment, revision: "v2" },
      },
      {
        ...base,
        environment: { ...base.environment, source_digest: DIGEST_B },
      },
      { ...base, subject: { ...base.subject, kind: "agent" } },
      { ...base, subject: { ...base.subject, id: "agent.echo" } },
      { ...base, subject: { ...base.subject, revision: "git-deadbeef" } },
      { ...base, objective_digest: sha256Id("different objective") },
      {
        ...base,
        authority: { ...base.authority, authority_ref: null },
      },
      {
        ...base,
        authority: {
          ...base.authority,
          allowed_effects: ["observation_read", "remote_compute"],
        },
      },
      {
        ...base,
        possible_effects: ["observation_read", "remote_compute"],
      },
      {
        ...base,
        evaluation: { ...base.evaluation, reward_micros: 999_999 },
      },
      {
        ...base,
        evaluation: { ...base.evaluation, rubric_digest: DIGEST_B },
      },
      {
        ...base,
        evaluation: {
          ...base.evaluation,
          checks: [{
            ...base.evaluation.checks[0]!,
            check_id: "echo.matches.v2",
          }],
        },
      },
      { ...base, evidence_refs: [DIGEST_B] },
      { ...base, parent_receipt_id: DIGEST_A },
    ];
    const ids = [
      createTrialReceipt(base).receipt_id,
      ...variants.map((variant) => createTrialReceipt(variant).receipt_id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("keeps reported non-dispatch conservative and effect-free", () => {
    const receipt = createTrialReceipt({
      ...completedInput(),
      status: {
        dispatch: "not_started_reported",
        outcome: "rejected",
        error_code: "authority_denied",
      },
      possible_effects: [],
      evaluation: {
        verdict: "not_evaluated",
        reward_micros: null,
        reward_unit: "unitless_millionths",
        rubric_digest: null,
        checks: [],
      },
    });
    expect(receipt.retry_advice).toBe("replan_before_retry");
  });

  test("pins unknown started outcomes to no automatic retry", () => {
    const receipt = createTrialReceipt({
      ...completedInput(),
      status: {
        dispatch: "started",
        outcome: "unknown",
        error_code: "timeout",
      },
      possible_effects: ["remote_compute", "unknown_external_effect"],
      evaluation: {
        verdict: "inconclusive",
        reward_micros: null,
        reward_unit: "unitless_millionths",
        rubric_digest: DIGEST_A,
        checks: [
          {
            check_id: "provider.result",
            outcome: "unknown",
            evidence_refs: ["test:timeout-cutpoint"],
          },
        ],
      },
    });
    expect(receipt.retry_advice).toBe("do_not_automatically_retry");
    expect(receipt.authority_assessment).toBe("unknown");

    expect(() =>
      createTrialReceipt({
        ...completedInput(),
        status: {
          dispatch: "started",
          outcome: "unknown",
          error_code: "timeout",
        },
        possible_effects: ["remote_compute"],
        evaluation: {
          verdict: "inconclusive",
          reward_micros: null,
          reward_unit: "unitless_millionths",
          rubric_digest: DIGEST_A,
          checks: [],
        },
      })).toThrow("must include unknown_external_effect");
  });

  test("rejects raw escape fields, paths, URLs, and unsorted evidence", () => {
    expect(() =>
      createTrialReceipt({
        ...completedInput(),
        raw_prompt: "do not serialize me",
      })).toThrow("must contain exactly");
    expect(() =>
      createTrialReceipt({
        ...completedInput(),
        evidence_refs: ["/Users/yu/private.txt"],
      })).toThrow("must be an opaque");
    expect(() =>
      createTrialReceipt({
        ...completedInput(),
        evidence_refs: ["https://example.invalid/signed?token=no"],
      })).toThrow("must be an opaque");
    expect(() =>
      createTrialReceipt({
        ...completedInput(),
        evidence_refs: ["test:z", "test:a"],
      })).toThrow("canonically sorted");
  });

  test("rejects accessors, cycles, floats, and non-canonical time", () => {
    const withGetter = completedInput() as CreateTrialReceiptInput & {
      raw?: string;
    };
    Object.defineProperty(withGetter, "raw", {
      enumerable: true,
      get() {
        return "secret";
      },
    });
    expect(() => createTrialReceipt(withGetter)).toThrow(TrialError);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("contains a cycle");

    expect(() => canonicalJson({ score: 0.5 })).toThrow("safe integer");
    expect(() =>
      createTrialReceipt({
        ...completedInput(),
        observed_at: "2026-07-30T15:00:00Z",
      })).toThrow("millisecond precision");
    expect(() =>
      createTrialReceipt({
        ...completedInput(),
        observed_at: "9999-99-99T99:99:99.999Z",
      })).toThrow(TrialError);
  });

  test("collapses hostile proxy inspection failures without reflecting values", () => {
    const sentinel = "SENSITIVE_PROXY_CANARY";
    const hostile = new Proxy(completedInput(), {
      ownKeys() {
        throw new Error(sentinel);
      },
    });

    for (const operation of [
      () => createTrialReceipt(hostile),
      () => validateTrialReceipt(hostile),
      () => canonicalJson(hostile),
    ]) {
      let caught: unknown;
      try {
        operation();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TrialError);
      expect(String(caught)).not.toContain(sentinel);
    }
  });
});
