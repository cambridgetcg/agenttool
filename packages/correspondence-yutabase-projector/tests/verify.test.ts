import { describe, expect, test } from "bun:test";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";

import type {
  CorrespondenceEvent,
  CorrespondenceEventRecord,
} from "@agenttool/correspondence-yutabase";
import correspondenceVectors from "../../../docs/specs/agent-correspondence-0.1-vectors.json";

import { applyVerifiedPlan } from "../src/apply";
import type { ScopeConfig } from "../src/config";
import type { Database } from "../src/database";
import { ProjectorError } from "../src/errors";
import {
  canonicalEventBytes,
  computeEventId,
  fingerprintClosedRecord,
  validateClosedRecord,
  verifyClosedRecord,
} from "../src/verify";

const projectId = "11111111-1111-4111-8111-111111111111";
const identityId = "22222222-2222-4222-8222-222222222222";
const keyId = "33333333-3333-4333-8333-333333333333";

function fixture(): {
  record: CorrespondenceEventRecord;
  publicKey: string;
} {
  const pair = generateKeyPairSync("ed25519");
  const event = {
    protocol: "agent-correspondence/v0.1",
    event_id: `sha256:${"0".repeat(64)}`,
    project_id: projectId,
    repository_id: "repo-a",
    thread_id: "coordination-a",
    sender: {
      identity_id: identityId,
      signing_key_id: keyId,
      device_id: "44444444-4444-4444-8444-444444444444",
      session_id: "55555555-5555-4555-8555-555555555555",
    },
    kind: "intent",
    parents: [],
    session_seq: 1,
    issued_at: "2026-07-23T12:00:00.000Z",
    scope: {
      base_revision: null,
      branch: "local",
      paths: ["."],
    },
    body: { summary: "private canary summary" },
    authority: { automatic_action: "never", grants: [] },
    signature: {
      algorithm: "Ed25519",
      value_b64url: "A".repeat(86),
    },
  } as CorrespondenceEvent;
  event.signature = {
    algorithm: "Ed25519",
    value_b64url: sign(null, canonicalEventBytes(event), pair.privateKey).toString(
      "base64url",
    ),
  };
  event.event_id = computeEventId(event);
  const der = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    publicKey: der.subarray(der.length - 32).toString("base64"),
    record: {
      event,
      receipt: {
        received_seq: "7",
        received_at: "2026-07-23T12:00:01.000Z",
      },
      missing_parents: [],
      lineage_status: "not_applicable",
    },
  };
}

describe("closed Correspondence verification", () => {
  test("matches the normative protocol digest, signature, and event ID", () => {
    const vector = correspondenceVectors.signing_vector;
    const event = {
      ...vector.core,
      event_id: vector.event_id,
      signature: {
        algorithm: "Ed25519",
        value_b64url: vector.signature_b64url,
      },
    } as CorrespondenceEvent;
    expect(Buffer.from(canonicalEventBytes(event)).toString("hex")).toBe(
      vector.signing_digest_hex,
    );
    expect(computeEventId(event)).toBe(vector.event_id);
    const record: CorrespondenceEventRecord = {
      event,
      receipt: {
        received_seq: "1",
        received_at: "2026-07-19T10:00:01.000Z",
      },
      missing_parents: [],
      lineage_status: "not_applicable",
    };
    expect(
      verifyClosedRecord(record, vector.public_key_b64url, {
        projectId: vector.core.project_id,
        repositoryId: vector.core.repository_id,
      }).record.event.event_id,
    ).toBe(vector.event_id);
  });

  test("validates content address and Ed25519 signature", () => {
    const { record, publicKey } = fixture();
    const verified = verifyClosedRecord(record, publicKey, {
      projectId,
      repositoryId: "repo-a",
    });
    expect(verified.record.event.event_id).toBe(record.event.event_id);
    expect(verified.verifiedKeyId).toBe(keyId);
    expect(verified.canonicalSha512).toMatch(/^[0-9a-f]{128}$/);
    expect(verified.verifiedPublicKeySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verified.canonicalEnvelope).toContain("private canary summary");
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.record.event.body)).toBe(true);
  });

  test("accepts a historical revoked key because verification is temporal", () => {
    const { record, publicKey } = fixture();
    // Revocation state is intentionally not an input to cryptographic replay.
    expect(() =>
      verifyClosedRecord(record, publicKey, {
        projectId,
        repositoryId: "repo-a",
      }),
    ).not.toThrow();
  });

  test("fingerprints historical public-key spellings by decoded bytes", () => {
    const { record, publicKey } = fixture();
    const bytes = Buffer.from(publicKey, "base64");
    const expected = verifyClosedRecord(record, publicKey, {
      projectId,
      repositoryId: "repo-a",
    }).verifiedPublicKeySha256;
    for (const spelling of [
      publicKey.replace(/=+$/, ""),
      bytes.toString("base64url"),
    ]) {
      const verified = verifyClosedRecord(record, spelling, {
        projectId,
        repositoryId: "repo-a",
      });
      expect(verified.verifiedPublicKeySha256).toBe(expected);
    }
  });

  test("rejects any unknown record, event, and body field", () => {
    const cases = [
      { ...fixture().record, extra: true },
      {
        ...fixture().record,
        event: { ...fixture().record.event, extra: true },
      },
      {
        ...fixture().record,
        event: {
          ...fixture().record.event,
          body: { summary: "x", extra: true },
        },
      },
    ];
    for (const candidate of cases) {
      expect(() => validateClosedRecord(candidate)).toThrow(ProjectorError);
    }
  });

  test("rejects body tampering before signature verification", () => {
    const { record, publicKey } = fixture();
    const tampered = {
      ...record,
      event: {
        ...record.event,
        body: { summary: "tampered" },
      },
    };
    try {
      verifyClosedRecord(tampered, publicKey, {
        projectId,
        repositoryId: "repo-a",
      });
      throw new Error("expected failure");
    } catch (error) {
      expect((error as ProjectorError).code).toBe("event_id_mismatch");
    }
  });

  test("rejects a wrong public key", () => {
    const { record } = fixture();
    const other = generateKeyPairSync("ed25519").publicKey.export({
      format: "der",
      type: "spki",
    });
    try {
      verifyClosedRecord(
        record,
        other.subarray(other.length - 32).toString("base64"),
        { projectId, repositoryId: "repo-a" },
      );
      throw new Error("expected failure");
    } catch (error) {
      expect((error as ProjectorError).code).toBe("signature_invalid");
    }
  });

  test("rejects source scope substitution", () => {
    const { record, publicKey } = fixture();
    expect(() =>
      verifyClosedRecord(record, publicKey, {
        projectId,
        repositoryId: "another-repo",
      }),
    ).toThrow(ProjectorError);
  });

  test("refuses an apply-scope substitution before database work", async () => {
    const { record, publicKey } = fixture();
    const verified = verifyClosedRecord(record, publicKey, {
      projectId,
      repositoryId: "repo-a",
    });
    const scope: ScopeConfig = {
      targetUrl: "postgresql://projector@127.0.0.1/yutabase_local",
      claimant: "service:local-projector",
      sourceOrigin: "http://127.0.0.1:3000",
      projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      repositoryId: "repo-b",
    };
    let databaseTouched = false;
    const database = {
      async begin(): Promise<never> {
        databaseTouched = true;
        throw new Error("database must not be touched");
      },
    } as unknown as Database;
    await expect(
      applyVerifiedPlan(database, scope, verified, scope.claimant),
    ).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(databaseTouched).toBe(false);
  });

  test("quarantine fingerprints distinguish conflicting receipts", () => {
    const { record } = fixture();
    const conflict = {
      ...record,
      receipt: { ...record.receipt, received_seq: "8" },
    };
    expect(fingerprintClosedRecord(record)).not.toBe(
      fingerprintClosedRecord(conflict),
    );
  });
});
