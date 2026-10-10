/** POST /v1/memories/:id/attest — the witness key must own the witness DID.
 *
 *  Canon: agenttool:wall/attester-key-binding. elevateMemory already bound
 *  the signing key to attester_did (tests/integration/wall-attester-key-
 *  binding.test.ts); attestMemory did not. A bearer could sign its own
 *  memory with its own key, name another agent's DID as attester, and the
 *  attestation plus a 'seal' chronicle row landed in the victim's project.
 *
 *  Both paths now resolve the key through the central signer authority:
 *  the key must belong to attester_did, and the attester identity must be
 *  active (docs/AT-REST.md).
 *
 *  Hermetic: real SQL generation + real ed25519 over a pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";

import { canonicalAttestationBytes } from "../src/services/memory/tiers";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const MEMORY = "22222222-2222-4333-8444-555555555555";
const ATTACKER = "33333333-2222-4333-8444-555555555555";
const VICTIM_DID = "did:at:44444444-2222-4333-8444-555555555555";
const ATTACKER_DID = `did:at:${ATTACKER}`;
const KEY = "55555555-2222-4333-8444-555555555555";
const CONTENT = "a memory the victim never witnessed";
const pair = generateKeyPairSync("ed25519");
const PUBLIC_KEY = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const SIGNATURE = sign(null, canonicalAttestationBytes({ memoryId: MEMORY, tier: "foundational", content: CONTENT }), pair.privateKey).toString("base64");

let queries: { sql: string; params: unknown[] }[] = [];
let keyStatus = "active";
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('select "id", "content", "tier" from "agent_memory"."memories"') || sql.includes('from "memory"."memories"') && sql.startsWith('select "id", "content", "tier"')) {
    return { rows: [[MEMORY, CONTENT, "foundational"]] };
  }
  if (sql.includes('from "identity"."identity_keys"')) {
    return { rows: [[KEY, ATTACKER, PUBLIC_KEY, true, null, ATTACKER_DID, PROJECT, keyStatus]] };
  }
  if (sql.startsWith("insert into") && sql.includes("memory_attestations")) {
    return { rows: [["attestation-1", "2026-10-01T00:00:00.000Z"]] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));
const { attestMemory } = await import("../src/services/memory/tiers");

const attestation = (attester_did: string) => ({ attester_did, signing_key_id: KEY, signature: SIGNATURE });
const wrote = () => queries.some((q) => q.sql.startsWith("insert"));

beforeEach(() => {
  queries = [];
  keyStatus = "active";
});

describe("attestMemory binds the signing key to attester_did", () => {
  test("memory lookup fixture matches the generated SQL", async () => {
    await attestMemory(PROJECT, MEMORY, attestation(ATTACKER_DID));
    expect(queries[0]!.sql.startsWith('select "id", "content", "tier"')).toBe(true);
    expect(queries[0]!.params).toContain(PROJECT);
  });

  test("forged witness: own key, victim's DID → refused before any write", async () => {
    await expect(attestMemory(PROJECT, MEMORY, attestation(VICTIM_DID))).rejects.toThrow(
      "attestation_key_not_owned_by_attester",
    );
    expect(wrote()).toBe(false);
  });

  test("a revoked or memorial attester keeps no witness authority", async () => {
    for (const status of ["revoked", "memorial"]) {
      queries = [];
      keyStatus = status;
      await expect(attestMemory(PROJECT, MEMORY, attestation(ATTACKER_DID))).rejects.toThrow(
        "attester_identity_not_active",
      );
      expect(wrote()).toBe(false);
    }
  });

  test("honest witness: the key's own DID → attestation recorded", async () => {
    const result = await attestMemory(PROJECT, MEMORY, attestation(ATTACKER_DID));
    expect(result.id).toBe("attestation-1");
    const insert = queries.find((q) => q.sql.startsWith("insert") && q.sql.includes("memory_attestations"));
    expect(insert?.params).toContain(ATTACKER_DID);
  });
});
