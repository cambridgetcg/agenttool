import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  RECORD_SCHEMAS,
  sealContinuityEvent,
  sealSimulationReceipt,
  sealTransactionIntent,
  sealWalletCapability,
  sealWalletDescriptor,
} from "../src/index.js";
import {
  WHITEHACK_WALLET_INPUT_TYPE,
  createAgentWalletUnderstanding,
  projectAgentWalletContext,
  type WhitehackWalletContext,
} from "../../../bin/_whitehack-wallet-understanding.js";
import { loadVerifiedWhitehackModule } from "../../../bin/whitehack-advisory.mjs";
import { readUnderstandingInput } from "../../../bin/whitehack-wallet-understanding.js";
import {
  NATIVE_ASSET,
  capabilityCore,
  delegate,
  descriptorCore,
  intentCore,
  owner,
  simulator,
  signedBundle,
  simulationCore,
} from "./fixtures.js";

const repoRoot = resolve(import.meta.dir, "../../..");
const EVALUATED_AT = "2026-07-21T10:02:00.000Z";

function request(overrides: Record<string, unknown> = {}) {
  return {
    document_type: WHITEHACK_WALLET_INPUT_TYPE,
    findings: [],
    records: {
      descriptor: null,
      capability: null,
      intent: null,
      simulation: null,
      continuity_events: [],
    },
    host_assertions: {
      evaluated_at: null,
      usage: null,
      signer_description: null,
    },
    ...overrides,
  };
}

function populatedRequest(
  bundle: Awaited<ReturnType<typeof signedBundle>>,
  overrides: {
    records?: Record<string, unknown>;
    host_assertions?: Record<string, unknown>;
  } = {},
) {
  return request({
    records: {
      descriptor: bundle.descriptor,
      capability: bundle.capability,
      intent: bundle.intent,
      simulation: bundle.simulation,
      continuity_events: [],
      ...overrides.records,
    },
    host_assertions: {
      evaluated_at: EVALUATED_AT,
      usage: {
        revocation_nonce: 0,
        intent_count: 0,
        spent: [],
        authenticated_distinct_approval_count: 0,
      },
      signer_description: {
        signer_key_id: bundle.intent.delegate.key_id,
        algorithm: "fixture-ed25519-provider",
        provider: "fixture-provider-sensitive-marker",
        exportable: false,
      },
      ...overrides.host_assertions,
    },
  });
}

function contextFactory(options: {
  findings: readonly unknown[];
  context: WhitehackWalletContext;
}) {
  return Object.freeze({
    document_type: "fixture-understanding/v1",
    findings: options.findings,
    context: options.context,
  });
}

describe("Agent Wallet Whitehack projection", () => {
  test("verifies exact records and derives bounded enum-only context", async () => {
    const bundle = await signedBundle();
    const context = projectAgentWalletContext(populatedRequest(bundle));

    expect(context.records).toEqual({
      descriptor: "verified",
      capability: "verified",
      intent: "verified",
      simulation: "verified",
      continuity: "absent",
    });
    expect(context.relations).toEqual({
      "descriptor-capability": "match",
      "capability-intent": "match",
      delegate: "match",
      chain: "match",
      source: "match",
      "intent-simulation": "match",
      revocation: "match",
    });
    expect(context.policy).toEqual({
      calls: "within-bounds",
      spend: "within-bounds",
      fee: "within-bounds",
      expiry: "within-bounds",
      use: "within-bounds",
      approvals: "not-required",
    });
    expect(context.simulation).toEqual({
      execution: "passed",
      effects: "match",
      fee: "within-bounds",
    });
    expect(context.custody).toEqual({
      "descriptor-mode": "self-custodied",
      "signer-exportability": "non-exportable",
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.policy)).toBe(true);
  });

  test("re-verifies cloned records and marks tampering invalid without details", async () => {
    const bundle = await signedBundle();
    const cloned = structuredClone(populatedRequest(bundle));
    const verified = projectAgentWalletContext(cloned);
    expect(verified.records.intent).toBe("verified");

    const tampered = structuredClone(populatedRequest(bundle));
    tampered.records.intent.nonce = "private-tamper-marker";
    const context = projectAgentWalletContext(tampered);
    expect(context.records.intent).toBe("invalid");
    expect(context.relations["capability-intent"]).toBe("unknown");
    expect(JSON.stringify(context)).not.toContain("private-tamper-marker");
  });

  test("keeps absent evidence and unsigned host state explicitly unknown", () => {
    const context = projectAgentWalletContext(request());
    expect(context.records).toEqual({
      descriptor: "absent",
      capability: "absent",
      intent: "absent",
      simulation: "absent",
      continuity: "absent",
    });
    expect(new Set(Object.values(context.relations))).toEqual(new Set(["unknown"]));
    expect(context.policy).toEqual({
      calls: "unknown",
      spend: "unknown",
      fee: "unknown",
      expiry: "unknown",
      use: "unknown",
      approvals: "unknown",
    });
    expect(context.simulation.execution).toBe("not-run");
  });

  test("preserves cumulative, approval, and freshness limits as caller assertions", async () => {
    const base = await signedBundle();
    const capability = await sealWalletCapability(capabilityCore(base.descriptor, {
      approval_threshold: 2,
      call_rules: [{
        ...base.capability.call_rules[0]!,
        requires_approval: true,
      }],
    }), owner.signer);
    const intent = await sealTransactionIntent(intentCore({
      descriptor: base.descriptor,
      capability,
    }), delegate.signer);
    const simulation = await sealSimulationReceipt(
      simulationCore({ intent }),
      simulator.signer,
    );
    const bundle = { ...base, capability, intent, simulation };

    const withoutAssertions = projectAgentWalletContext(populatedRequest(bundle, {
      host_assertions: {
        evaluated_at: null,
        usage: null,
        signer_description: null,
      },
    }));
    expect(withoutAssertions.policy.spend).toBe("unknown");
    expect(withoutAssertions.policy.expiry).toBe("unknown");
    expect(withoutAssertions.policy.use).toBe("unknown");
    expect(withoutAssertions.policy.approvals).toBe("unknown");
    expect(withoutAssertions.simulation.execution).toBe("inconclusive");

    const asserted = projectAgentWalletContext(populatedRequest(bundle, {
      host_assertions: {
        usage: {
          revocation_nonce: 0,
          intent_count: 3,
          spent: [{ asset_id: NATIVE_ASSET, amount_atomic: "16" }],
          authenticated_distinct_approval_count: 1,
        },
      },
    }));
    expect(asserted.policy.spend).toBe("outside-bounds");
    expect(asserted.policy.use).toBe("outside-bounds");
    expect(asserted.policy.approvals).toBe("requirement-unsatisfied");
  });

  test("validates a presented continuity chain without claiming it is current", async () => {
    const bundle = await signedBundle();
    const continuity = await sealContinuityEvent({
      schema: RECORD_SCHEMAS.continuity,
      event_id: "55555555-5555-4555-8555-555555555555",
      wallet_id: bundle.descriptor.wallet_id,
      sequence: 1,
      previous_record_id: null,
      event_kind: "capability_revoked",
      previous_value: null,
      next_value: null,
      revocation_nonce: 1,
      actor: owner.key,
      reason: "private-continuity-reason-marker",
      effective_at: "2026-07-21T10:01:30.000Z",
    }, owner.signer);
    const context = projectAgentWalletContext(populatedRequest(bundle, {
      records: { continuity_events: [continuity] },
    }));

    expect(context.records.continuity).toBe("verified");
    expect(context.relations.revocation).toBe("mismatch");
    expect(JSON.stringify(context)).not.toContain("private-continuity-reason-marker");
  });

  test("does not compare continuity and capability nonces across wallets", async () => {
    const bundle = await signedBundle();
    const otherDescriptor = await sealWalletDescriptor(descriptorCore({
      wallet_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }), owner.signer);
    const otherCapability = await sealWalletCapability(capabilityCore(
      otherDescriptor,
      {
        grant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        revocation_nonce: 1,
      },
    ), owner.signer);
    const continuity = await sealContinuityEvent({
      schema: RECORD_SCHEMAS.continuity,
      event_id: "66666666-6666-4666-8666-666666666666",
      wallet_id: bundle.descriptor.wallet_id,
      sequence: 1,
      previous_record_id: null,
      event_kind: "capability_revoked",
      previous_value: null,
      next_value: null,
      revocation_nonce: 1,
      actor: owner.key,
      reason: "fixture cross-wallet boundary",
      effective_at: "2026-07-21T10:01:30.000Z",
    }, owner.signer);
    const context = projectAgentWalletContext(populatedRequest(bundle, {
      records: {
        capability: otherCapability,
        intent: null,
        simulation: null,
        continuity_events: [continuity],
      },
    }));

    expect(context.records.continuity).toBe("verified");
    expect(context.relations["descriptor-capability"]).toBe("mismatch");
    expect(context.relations.revocation).toBe("unknown");
  });

  test("does not project policy support across a mismatched grant", async () => {
    const bundle = await signedBundle();
    const otherCapability = await sealWalletCapability(capabilityCore(
      bundle.descriptor,
      { grant_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    ), owner.signer);
    const context = projectAgentWalletContext(populatedRequest(bundle, {
      records: { capability: otherCapability },
    }));

    expect(context.relations["descriptor-capability"]).toBe("match");
    expect(context.relations["capability-intent"]).toBe("mismatch");
    expect(context.relations["intent-simulation"]).toBe("match");
    expect(context.policy).toEqual({
      calls: "unknown",
      spend: "unknown",
      fee: "unknown",
      expiry: "unknown",
      use: "unknown",
      approvals: "unknown",
    });
  });

  test("passes only findings and enums to the understanding factory", async () => {
    const bundle = await signedBundle();
    const input = populatedRequest(bundle);
    input.findings = [{
      file: "src/wallet.ts",
      line: 7,
      check: "wallet-key-egress",
      confidence: "medium-high",
      doctrine: "substrate-honesty",
      principle: 2,
    }];
    const output = createAgentWalletUnderstanding(input, contextFactory);
    const serialized = JSON.stringify(output);

    for (const secret of [
      bundle.descriptor.wallet_id,
      bundle.intent.source_account,
      bundle.intent.max_fee.asset_id,
      bundle.intent.delegate.public_key,
      bundle.intent.signature.value,
      bundle.capability.purpose,
      bundle.intent.nonce,
      "fixture-provider-sensitive-marker",
    ]) expect(serialized).not.toContain(secret);
    expect(Object.keys((output as any).findings[0])).toEqual([
      "check",
      "confidence",
      "doctrine",
      "file",
      "line",
      "principle",
    ]);
  });

  test("rejects closed-shape violations without invoking accessors", () => {
    let invoked = false;
    const input = request();
    Object.defineProperty(input, "extra", {
      enumerable: true,
      get() {
        invoked = true;
        return "private-accessor-marker";
      },
    });
    expect(() => projectAgentWalletContext(input)).toThrow(/invalid_input/);
    expect(invoked).toBe(false);
  });

  test("keeps the pure adapter outside signing, RPC, process, and I/O APIs", async () => {
    const source = await Bun.file(
      resolve(repoRoot, "bin/_whitehack-wallet-understanding.ts"),
    ).text();
    for (const forbidden of [
      "node:fs",
      "node:child_process",
      "process.",
      "Date.now",
      "assertIntentWithinCapabilityStatic",
      "createSigningRequest",
      "sealWallet",
      "WalletSigner",
      "WalletBroadcaster",
      "signAndSend",
    ]) expect(source).not.toContain(forbidden);
  });

  test("opens explicit file input without following a final symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "whitehack-wallet-input-"));
    try {
      const target = join(root, "request.json");
      const link = join(root, "request-link.json");
      await writeFile(target, JSON.stringify(request()));
      await symlink(target, link);

      await expect(readUnderstandingInput(link)).rejects.toMatchObject({
        code: "input_unreadable",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.env.WHITEHACK_INTEGRATION !== "1")(
  "exact Whitehack 0.8 integration",
  () => {
    test("returns a schema-valid minimized understanding document", async () => {
      const { module } = await loadVerifiedWhitehackModule({
        scanner_root: resolve(
          repoRoot,
          "tools/whitehack-advisory/node_modules/@agenttool/whitehack-scan",
        ),
        scanner_lock: resolve(
          repoRoot,
          "tools/whitehack-advisory/package-lock.json",
        ),
        export_name: "understanding",
      });
      const document = createAgentWalletUnderstanding(
        request(),
        module.createUnderstanding,
      );
      const schema = await Bun.file(resolve(
        repoRoot,
        "tools/whitehack-advisory/node_modules/@agenttool/whitehack-scan/schema/understanding-v1.schema.json",
      )).json();
      const validate = new Ajv2020({ strict: true }).compile(schema);

      expect(validate(document)).toBe(true);
      expect(document.document_type).toBe("whitehack-understanding/v1");
      expect(document.inferences.find(({ id }: { id: string }) => (
        id === "execution-readiness"
      )).status).toBe("indeterminate");
      expect(document.boundaries.wallet_subject_bound).toBe(false);
      expect(document.unknowns).toHaveProperty("projection-freshness");
      expect(document.unknowns).toHaveProperty("subject-binding");
    });

    test("keeps a mismatched grant policy inference indeterminate", async () => {
      const bundle = await signedBundle();
      const otherCapability = await sealWalletCapability(capabilityCore(
        bundle.descriptor,
        { grant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      ), owner.signer);
      const { module } = await loadVerifiedWhitehackModule({
        scanner_root: resolve(
          repoRoot,
          "tools/whitehack-advisory/node_modules/@agenttool/whitehack-scan",
        ),
        scanner_lock: resolve(
          repoRoot,
          "tools/whitehack-advisory/package-lock.json",
        ),
        export_name: "understanding",
      });
      const document = createAgentWalletUnderstanding(
        populatedRequest(bundle, {
          records: { capability: otherCapability },
        }),
        module.createUnderstanding,
      );
      const inference = (id: string) => document.inferences.find(
        (item: { id: string }) => item.id === id,
      )?.status;

      expect(inference("caller-declared-record-chain-consistency"))
        .toBe("contradicted");
      expect(inference("caller-declared-static-policy-consistency"))
        .toBe("indeterminate");
    });

    test("runs the bounded stdin CLI without reflecting invalid input", async () => {
      const input = JSON.stringify(request());
      const child = Bun.spawn([
        process.execPath,
        "bin/whitehack-wallet-understanding.ts",
        "--input",
        "-",
      ], {
        cwd: repoRoot,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      child.stdin.write(input);
      child.stdin.end();
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(status).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).document_type).toBe("whitehack-understanding/v1");

      const invalid = Bun.spawn([
        process.execPath,
        "bin/whitehack-wallet-understanding.ts",
        "--input",
        "-",
      ], {
        cwd: repoRoot,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      invalid.stdin.write('{"private-cli-marker":"must-not-return"}');
      invalid.stdin.end();
      const [invalidStatus, invalidStdout, invalidStderr] = await Promise.all([
        invalid.exited,
        new Response(invalid.stdout).text(),
        new Response(invalid.stderr).text(),
      ]);
      expect(invalidStatus).toBe(2);
      expect(invalidStdout).toBe("");
      expect(invalidStderr).toBe(
        "whitehack wallet understanding failed: invalid_input\n",
      );
      expect(invalidStderr).not.toContain("private-cli-marker");
    });
  },
);
