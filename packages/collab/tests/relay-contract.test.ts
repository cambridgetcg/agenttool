import { describe, expect, test } from "bun:test";
import { CollabError } from "../src/errors.js";
import {
  deployReceiptSchema,
  normalizeDeployReceipt,
  normalizeNpmReleaseReceipt,
  npmReleaseReceiptSchema,
  operationClaimSchema,
  operationPageSchema,
  operationResultSchema,
  providerObservationInputSchema,
  providerObservationPageSchema,
  providerObservationResultSchema,
  providerUrlSchema,
  relayEnrolmentIdempotencyKey,
  relayEnrolmentRequestSchema,
  relayEnrolmentResultSchema,
  relayEventPageSchema,
  validateProviderObservationForProfile,
  type OperationPage,
  type RelayEventPage,
} from "../src/relay-contract.js";
import {
  ACTION_ID,
  claimInput,
  DEVICE_ID,
  enrolmentRequest,
  enrolmentResult,
  EVENT_ID,
  NOW,
  observationInput,
  observationResult,
  operationResult,
  profile,
  REPOSITORY_ID,
  SESSION_ID,
  SHA1,
  SHA256,
  SOURCE_REVISION,
} from "./relay-fixtures.js";

const npmReceipt = {
  schema: "agenttool.npm-release/1",
  package: {
    key: "collab",
    name: "@agenttool/collab",
    version: "0.4.0",
    path: "packages/collab",
  },
  tag: "collab-v0.4.0",
  tag_commit: SOURCE_REVISION,
  source_revision: SOURCE_REVISION,
  artifact: {
    filename: "agenttool-collab-0.4.0.tgz",
    size: 1234,
    sha1: SHA1,
    sha256: SHA256,
    integrity: `sha512-${"A".repeat(86)}==`,
  },
  prepared_at: NOW,
  result: {
    status: "published",
    npm_tag: "latest",
    registry_observed_at: NOW,
    registry_tarball:
      "https://registry.npmjs.org/@agenttool/collab/-/collab-0.4.0.tgz",
  },
} as const;

const deployReceipt = {
  schema: "agenttool-deploy-receipt/v2",
  outcome: "succeeded",
  completed_at: NOW,
  exit_status: 0,
  source_revision: SOURCE_REVISION,
  source_dirty: false,
  release_head_snapshot: {
    remote: "origin",
    branch: "main",
    revision: SOURCE_REVISION,
    observed_at: NOW,
  },
  source_overrides: {
    dirty: false,
    non_release_head: false,
  },
  external_mutation_started: true,
  phases: {
    migrations: "succeeded",
    preflight: "succeeded",
    api: "deployed_verified",
    frontends: "succeeded",
  },
  verified_api_machines: 2,
} as const;

describe("relay wire contracts and receipt adapters", () => {
  test("strictly parses canonical enrolment, operation, event, and observation responses", () => {
    expect(relayEnrolmentRequestSchema.parse(enrolmentRequest)).toEqual(
      enrolmentRequest,
    );
    expect(relayEnrolmentIdempotencyKey(enrolmentRequest)).toBe(
      enrolmentRequest.idempotency_key,
    );
    expect(relayEnrolmentResultSchema.parse(enrolmentResult)).toEqual(
      enrolmentResult,
    );
    const operation = operationResult();
    expect(operationResultSchema.parse(operation)).toEqual(operation);
    expect(operationPageSchema.parse({
      schema: "agenttool.collab-operation-page/1",
      repository_id: REPOSITORY_ID,
      operations: [operation.slot],
      next_after: 0,
      has_more: false,
    }).operations).toHaveLength(1);

    const eventPage: RelayEventPage = {
      schema: "agenttool.collab-event-page/1",
      repository_id: REPOSITORY_ID,
      events: [{
        sequence: 1,
        event_id: EVENT_ID,
        type: "operation.claimed",
        occurred_at: NOW,
        device_id: null,
        session_id: SESSION_ID,
        actor_label: "release-agent",
        body: { action_id: ACTION_ID, generation: 1 },
        previous_hash: null,
        event_hash: SHA256,
      }],
      next_after: 1,
      has_more: false,
    };
    expect(relayEventPageSchema.parse(eventPage)).toEqual(eventPage);

    const observed = observationResult();
    expect(providerObservationResultSchema.parse(observed)).toEqual(observed);
    expect(providerObservationPageSchema.parse({
      schema: "agenttool.collab-provider-observation-page/1",
      repository_id: REPOSITORY_ID,
      observations: [observed.observation],
      next_after: 2,
      has_more: false,
    }).observations).toHaveLength(1);
  });

  test("rejects lossy cursors/fences and unknown response fields", () => {
    const operation = operationResult();
    expect(() => operationResultSchema.parse({
      ...operation,
      slot: {
        ...operation.slot,
        sequence: Number.MAX_SAFE_INTEGER + 1,
      },
    })).toThrow();
    expect(() => operationResultSchema.parse({
      ...operation,
      raw_provider_response: "not allowed",
    })).toThrow();
    expect(() => providerObservationResultSchema.parse({
      ...observationResult(),
      observation: {
        ...observationResult().observation,
        observing_session_id: null,
      },
    })).toThrow();
    const otherRepository = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(operationPageSchema.safeParse({
      schema: "agenttool.collab-operation-page/1",
      repository_id: REPOSITORY_ID,
      operations: [{
        ...operation.slot,
        repository_id: otherRepository,
      }],
      next_after: 0,
      has_more: false,
    }).success).toBe(false);
    expect(providerObservationPageSchema.safeParse({
      schema: "agenttool.collab-provider-observation-page/1",
      repository_id: REPOSITORY_ID,
      observations: [{
        ...observationResult().observation,
        repository_id: otherRepository,
      }],
      next_after: 1,
      has_more: false,
    }).success).toBe(false);
  });

  test("enforces operation-page polling cursor invariants", () => {
    const operation = operationResult();
    const terminal: OperationPage = {
      schema: "agenttool.collab-operation-page/1",
      repository_id: REPOSITORY_ID,
      operations: [operation.slot],
      next_after: 0,
      has_more: false,
    };
    expect(operationPageSchema.parse(terminal)).toEqual(terminal);
    expect(operationPageSchema.safeParse({
      ...terminal,
      next_after: operation.slot.sequence,
    }).success).toBe(false);
    expect(operationPageSchema.safeParse({
      ...terminal,
      operations: [],
      next_after: 1,
      has_more: true,
    }).success).toBe(false);
    expect(operationPageSchema.safeParse({
      ...terminal,
      next_after: operation.slot.sequence,
      has_more: true,
    }).success).toBe(true);
    expect(operationPageSchema.safeParse({
      ...terminal,
      operations: [
        { ...operation.slot, sequence: 2 },
        { ...operation.slot, sequence: 1 },
      ],
      next_after: 1,
      has_more: true,
    }).success).toBe(false);
  });

  test("accepts only non-secret-bearing HTTPS provider URLs", () => {
    expect(providerUrlSchema.parse("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    for (const unsafe of [
      "http://example.com/path",
      "https://user:pass@example.com/path",
      "https://example.com/path?signature=secret",
      "https://example.com/path#secret",
      `https://example.com/artifacts/npm_${"s".repeat(20)}`,
      `https://example.com/artifacts/npm_%73${"s".repeat(19)}`,
    ]) {
      expect(() => providerUrlSchema.parse(unsafe)).toThrow();
      expect(() => providerObservationInputSchema.parse({
        ...observationInput,
        url: unsafe,
      })).toThrow();
    }
    expect(() => providerObservationInputSchema.parse({
      ...observationInput,
      resource_id: `npm_${"S".repeat(32)}`,
    })).toThrow();
    const credentialShape = `npm_${"s".repeat(20)}`;
    for (const [schema, input] of [
      [
        providerObservationInputSchema,
        { ...observationInput, idempotency_key: credentialShape },
      ],
      [
        providerObservationInputSchema,
        { ...observationInput, environment: credentialShape },
      ],
      [
        operationClaimSchema,
        { ...claimInput, operation: credentialShape },
      ],
    ] as const) {
      expect(schema.safeParse(input).success).toBe(false);
    }
  });

  test("rejects known credential material nested in successful event bodies", () => {
    const credential = `atc_${"S".repeat(43)}`;
    expect(relayEventPageSchema.safeParse({
      schema: "agenttool.collab-event-page/1",
      repository_id: REPOSITORY_ID,
      events: [{
        sequence: 1,
        event_id: EVENT_ID,
        type: "operation.claimed",
        occurred_at: NOW,
        device_id: DEVICE_ID,
        session_id: SESSION_ID,
        actor_label: "release-agent",
        body: { nested: { accidental: credential } },
        previous_hash: null,
        event_hash: SHA256,
      }],
      next_after: 1,
      has_more: false,
    }).success).toBe(false);
  });

  test("normalizes an exact profile-bound npm receipt to digest-only evidence", () => {
    const normalized = normalizeNpmReleaseReceipt(npmReceipt, {
      profile,
      idempotency_key: "receipt:npm:1",
      session_id: SESSION_ID,
      actor_label: "release-agent",
      action_id: ACTION_ID,
    });

    expect(normalized.receipt_ref).toEqual({
      schema: "agenttool.npm-release/1",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(normalized.observation).toMatchObject({
      provider: "npm",
      resource_kind: "package_version",
      resource_id: "@agenttool/collab@0.4.0",
      source_revision: SOURCE_REVISION,
      normalized_state: "succeeded",
    });
    expect(normalized.observation.provider_event_id).toMatch(
      /^npm-release:[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(normalized)).not.toContain(
      npmReceipt.artifact.integrity,
    );
  });

  test("rejects npm receipts for an undeclared package, wrong tag, or extra data", () => {
    expectCollabCode(
      () => normalizeNpmReleaseReceipt({
        ...npmReceipt,
        package: {
          ...npmReceipt.package,
          key: "wrong",
        },
      }, {
        profile,
        idempotency_key: "receipt:npm:wrong-key",
        session_id: SESSION_ID,
      }),
      "npm_package_binding_mismatch",
    );
    expectCollabCode(
      () => normalizeNpmReleaseReceipt({
        ...npmReceipt,
        package: {
          ...npmReceipt.package,
          path: "packages/other",
        },
      }, {
        profile,
        idempotency_key: "receipt:npm:wrong-path",
        session_id: SESSION_ID,
      }),
      "npm_package_binding_mismatch",
    );
    expectCollabCode(
      () => normalizeNpmReleaseReceipt({
        ...npmReceipt,
        package: {
          ...npmReceipt.package,
          name: "@another/package",
        },
      }, {
        profile,
        idempotency_key: "receipt:npm:wrong-package",
        session_id: SESSION_ID,
      }),
      "npm_package_binding_mismatch",
    );
    expectCollabCode(
      () => normalizeNpmReleaseReceipt({
        ...npmReceipt,
        tag: "v0.4.0",
      }, {
        profile,
        idempotency_key: "receipt:npm:wrong-tag",
        session_id: SESSION_ID,
      }),
      "npm_tag_binding_mismatch",
    );
    expect(npmReleaseReceiptSchema.safeParse({
      ...npmReceipt,
      raw_log: "forbidden",
    }).success).toBe(false);
  });

  test("binds deploy receipt imports to provider, environment, and stable resource", () => {
    const normalized = normalizeDeployReceipt(deployReceipt, {
      profile,
      idempotency_key: "receipt:deploy:1",
      session_id: SESSION_ID,
      action_id: ACTION_ID,
      provider: "fly",
      environment: "production",
      resource_kind: "application",
      resource_id: "agenttool",
      url: "https://agenttool.fly.dev",
    });

    expect(normalized.observation).toMatchObject({
      provider: "fly",
      environment: "production",
      resource_id: "agenttool",
      normalized_state: "succeeded",
    });
    expect(normalized.observation.provider_event_id).toMatch(
      /^deploy-receipt:[a-f0-9]{64}$/,
    );
    expect(deployReceiptSchema.safeParse(deployReceipt).success).toBe(true);

    expectCollabCode(
      () => normalizeDeployReceipt(deployReceipt, {
        profile,
        idempotency_key: "receipt:deploy:wrong-resource",
        session_id: SESSION_ID,
        provider: "fly",
        environment: "production",
        resource_kind: "application",
        resource_id: "another-app",
      }),
      "deployment_binding_mismatch",
    );
    expectCollabCode(
      () => normalizeDeployReceipt({
        ...deployReceipt,
        phases: { ...deployReceipt.phases, api: "skipped" },
      }, {
        profile,
        idempotency_key: "receipt:deploy:skipped-api",
        session_id: SESSION_ID,
        provider: "fly",
        environment: "production",
        resource_kind: "application",
        resource_id: "agenttool",
      }),
      "deploy_receipt_surface_unproven",
    );
    expectCollabCode(
      () => normalizeDeployReceipt(deployReceipt, {
        profile,
        idempotency_key: "receipt:deploy:coarse-frontend",
        session_id: SESSION_ID,
        provider: "cloudflare-pages",
        environment: "production",
        resource_kind: "pages_project",
        resource_id: "agenttool-docs",
      }),
      "deploy_receipt_surface_unproven",
    );
  });

  test("validates profiles at the JavaScript boundary and disables unbound Vercel observations", () => {
    expectCollabCode(
      () => validateProviderObservationForProfile({
        ...observationInput,
        provider: "vercel",
        resource_kind: "project",
        resource_id: "unbound-project",
      }, profile),
      "vercel_not_bound",
    );
    expectCollabCode(
      () => normalizeNpmReleaseReceipt(npmReceipt, {
        profile: {
          ...profile,
          deployments: {
            broken: {
              provider: "vercel",
              environment: "production",
              resource_id: "unbound",
            },
          },
        } as typeof profile,
        idempotency_key: "receipt:invalid-profile",
        session_id: SESSION_ID,
      }),
      "project_profile_invalid",
    );
  });
});

function expectCollabCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CollabError);
    expect((error as CollabError).code).toBe(code);
  }
}
