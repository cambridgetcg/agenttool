import { describe, expect, test } from "bun:test";

import {
  CorrespondenceYutabasePlanError,
  planCorrespondenceRecord,
} from "../src/index.js";
import {
  PARENT_EVENT_ID,
  RAW_SIGNATURE,
  SIGNING_KEY_ID,
  makeRecord,
} from "./fixtures.js";

const OPTIONS = {
  claimant: "service:correspondence-projector/run-42",
} as const;

describe("mapping boundaries", () => {
  test("is metadata-only and never copies raw signature, payload, scope, or locator", () => {
    const record = makeRecord({
      kind: "artifact.offer",
      body: {
        artifact: {
          kind: "content_digest",
          digest: "sha256:" + "d".repeat(64),
          locator: "https://private.example/hidden",
        },
        summary: "payload-summary-must-not-appear",
        private_key: "private-key-must-not-appear",
      },
    });
    const serialized = JSON.stringify(planCorrespondenceRecord(record, OPTIONS));

    expect(serialized).not.toContain(RAW_SIGNATURE);
    expect(serialized).not.toContain("payload-summary-must-not-appear");
    expect(serialized).not.toContain("private-key-must-not-appear");
    expect(serialized).not.toContain("https://private.example/hidden");
    expect(serialized).not.toContain("private/branch-name");
    expect(serialized).not.toContain("private/source");
    expect(serialized).not.toContain("secret/design");
    expect(serialized).not.toContain("\"signature\":");
    expect(serialized).not.toContain("\"body\":");
    expect(serialized).toContain(SIGNING_KEY_ID);
  });

  test("states the unimplemented verification, persistence, and authority boundaries", () => {
    const plan = planCorrespondenceRecord(makeRecord(), OPTIONS);
    expect(plan.limitations).toEqual({
      signature_verification: "not_performed",
      persistence: "not_performed",
      payload_policy: "metadata_only",
      permission_effect: "none",
      input_validation: "planner_fields_only",
    });
    expect(plan.source_scope).toBe("project_private");
  });

  test("rejects an event whose authority object could request automatic action", () => {
    const record = structuredClone(makeRecord()) as unknown as {
      event: { authority: { automatic_action: string; grants: string[] } };
    };
    record.event.authority = {
      automatic_action: "allowed",
      grants: ["write"],
    };
    expect(() =>
      planCorrespondenceRecord(record as never, OPTIONS),
    ).toThrow(CorrespondenceYutabasePlanError);
  });

  test("rejects an acknowledgement target missing from causal parents", () => {
    const record = makeRecord({
      kind: "ack.seen",
      parents: [],
      body: { target_event_id: PARENT_EVENT_ID },
    });
    expect(() => planCorrespondenceRecord(record, OPTIONS)).toThrow(
      "acknowledgement target_event_id must also appear in parents",
    );
  });

  test("rejects a non-Correspondence protocol before planning", () => {
    const record = structuredClone(makeRecord()) as unknown as {
      event: { protocol: string };
    };
    record.event.protocol = "something-else/v1";
    expect(() =>
      planCorrespondenceRecord(record as never, OPTIONS),
    ).toThrow("expected agent-correspondence/v0.1");
  });

  test("rejects malformed planner fields without claiming full validation", () => {
    const badSignature = structuredClone(makeRecord()) as unknown as {
      event: { signature: { algorithm: string; value_b64url: string } };
    };
    badSignature.event.signature.value_b64url = "S".repeat(85) + "B";
    expect(() =>
      planCorrespondenceRecord(badSignature as never, OPTIONS),
    ).toThrow("structurally canonical Ed25519 signature");

    const badRepository = structuredClone(makeRecord()) as unknown as {
      event: { repository_id: string };
    };
    badRepository.event.repository_id = "contains whitespace";
    expect(() =>
      planCorrespondenceRecord(badRepository as never, OPTIONS),
    ).toThrow("without whitespace or control characters");

    const unicodeRepository = structuredClone(makeRecord()) as unknown as {
      event: { repository_id: string };
    };
    unicodeRepository.event.repository_id = "界".repeat(100);
    expect(() =>
      planCorrespondenceRecord(unicodeRepository as never, OPTIONS),
    ).not.toThrow();
  });

  test("requires the actual projector claimant", () => {
    expect(() =>
      planCorrespondenceRecord(makeRecord(), { claimant: "   " }),
    ).toThrow("options.claimant");
    expect(() =>
      planCorrespondenceRecord(makeRecord(), {
        claimant: "service:correspondence-projector\u0000run-42",
      }),
    ).toThrow("must not contain NUL");
  });
});
