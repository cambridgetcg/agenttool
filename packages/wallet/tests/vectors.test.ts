import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AGENT_WALLET_PROTOCOL,
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
