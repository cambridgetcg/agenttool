import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AGENT_WALLET_PROTOCOL,
  WalletProtocolError,
  assertIntentWithinCapabilityStatic,
  bytesToHex,
  signingDigest,
  unsignedRecord,
  verifyContinuityEvent,
  verifySigningReceipt,
  verifySimulationReceipt,
  verifyTransactionIntent,
  verifyWalletCapability,
  verifyWalletDescriptor,
} from "../src/index.js";

interface Vector {
  kind: string;
  domain: string;
  digest_hex: string;
  record: any;
}

const vectors = JSON.parse(await readFile(
  join(import.meta.dir, "..", "vectors", "agent-wallet-v0.1-vectors.json"),
  "utf8",
)) as { protocol: string; note: string; records: Vector[] };

interface NegativeCase {
  id: string;
  check: "record_verification" | "static_authorization";
  kind?: string;
  record?: unknown;
  records?: Record<"descriptor" | "capability" | "intent" | "simulation", string>;
  context?: any;
  reference_error_code: string;
  summary: string;
}

const negative = JSON.parse(await readFile(
  join(import.meta.dir, "..", "vectors", "agent-wallet-v0.1-negative-vectors.json"),
  "utf8",
)) as {
  protocol: string;
  note: string;
  records: Record<string, { kind: string; record: unknown }>;
  cases: NegativeCase[];
};

const verifiers: Record<string, (value: unknown) => any> = {
  descriptor: verifyWalletDescriptor,
  capability: verifyWalletCapability,
  intent: verifyTransactionIntent,
  simulation: verifySimulationReceipt,
  signing_receipt: verifySigningReceipt,
  continuity: verifyContinuityEvent,
};

describe("portable Agent Wallet vectors", () => {
  test("pins all record digests, signatures and identities", () => {
    expect(vectors.protocol).toBe(AGENT_WALLET_PROTOCOL);
    expect(vectors.records.map(({ kind }) => kind)).toEqual([
      "descriptor", "capability", "intent", "simulation", "signing_receipt", "continuity",
    ]);
    for (const vector of vectors.records) {
      const verified = verifiers[vector.kind]!(vector.record);
      expect(bytesToHex(signingDigest(vector.domain, unsignedRecord(verified))), vector.kind)
        .toBe(vector.digest_hex);
      expect(verified.record_id, vector.kind).toBe(vector.record.record_id);
    }
  });
});

// Which reference branch each case must reach; codes alone are shared by several checks.
const NEGATIVE_BRANCHES: Record<string, RegExp> = {
  "signature-s-not-reduced": /record signature is invalid/i,
  "small-order-authority": /record signature is invalid/i,
  "overlap-call-method-approval": /intent call requires more distinct host-verified approval IDs/i,
  "overlap-mixed-rule-transfer-approval": /intent call requires more distinct host-verified approval IDs/i,
  "simulation-fee-asset-mismatch": /fee exceeds or changes the intent fee bound/i,
  "watch-only-descriptor": /watch-only descriptor cannot authorize/i,
  "simulation-failed": /reverted or otherwise failed/i,
};

function refusal(run: () => unknown): WalletProtocolError {
  try {
    run();
  } catch (error) {
    if (error instanceof WalletProtocolError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("negative Agent Wallet vectors", () => {
  test("every named record verifies on its own", () => {
    expect(negative.protocol).toBe(AGENT_WALLET_PROTOCOL);
    for (const [name, entry] of Object.entries(negative.records)) {
      expect(verifiers[entry.kind]!(entry.record).record_id, name).toBe((entry.record as any).record_id);
    }
  });

  test("every case is refused at its intended check", () => {
    expect(negative.cases.map(({ id }) => id).sort()).toEqual(Object.keys(NEGATIVE_BRANCHES).sort());
    for (const vector of negative.cases) {
      const error = vector.check === "record_verification"
        ? refusal(() => verifiers[vector.kind!]!(vector.record))
        : refusal(() => {
          const named = vector.records!;
          const verify = (role: keyof typeof named) => verifiers[role]!(negative.records[named[role]]!.record);
          assertIntentWithinCapabilityStatic({
            descriptor: verify("descriptor"),
            capability: verify("capability"),
            intent: verify("intent"),
            simulation: verify("simulation"),
            context: vector.context,
          });
        });
      expect(error.code, vector.id).toBe(vector.reference_error_code as WalletProtocolError["code"]);
      expect(error.message, vector.id).toMatch(NEGATIVE_BRANCHES[vector.id]!);
    }
  });

  test("overlap cases are refused only for missing approval", () => {
    for (const id of ["overlap-call-method-approval", "overlap-mixed-rule-transfer-approval"]) {
      const vector = negative.cases.find((candidate) => candidate.id === id)!;
      const named = vector.records!;
      const verify = (role: keyof typeof named) => verifiers[role]!(negative.records[named[role]]!.record);
      const authorization = assertIntentWithinCapabilityStatic({
        descriptor: verify("descriptor"),
        capability: verify("capability"),
        intent: verify("intent"),
        simulation: verify("simulation"),
        context: {
          ...vector.context,
          usage: { ...vector.context.usage, host_verified_approval_ids: ["approval-1"] },
        },
      });
      expect(authorization.intent_record_id, id).toBe((negative.records[named.intent]!.record as any).record_id);
    }
  });
});
