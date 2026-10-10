/** initiator_signature_mismatch names a recovery the API can actually serve.
 *
 *  A recipient accepts a received v2 proposal by cosigning over the
 *  initiator's declaration signature and sending it back as
 *  `initiator_signature_b64`. The mismatch refusal told the agent to "fetch
 *  the latest covenant and re-sign over the current initiator signature" and
 *  pointed at GET /v1/covenants?status=proposed — but covenant responses
 *  never carried that signature, so the fetch could not supply it, and the
 *  docs link (docs.agenttool.dev/covenants#cosign) was a 404.
 *
 *  Covenant responses now carry `initiator_signature_b64` (the stored
 *  declaration signature, verification material rather than a secret), and
 *  the refusal names that field and links the cross-instance covenant doc. */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { errors } from "../src/lib/errors";
import { covenantToOut } from "../src/routes/continuity";

const SIGNATURE = "A".repeat(86) + "==";

describe("covenant responses carry the initiator signature", () => {
  test("covenantToOut exposes the stored declaration signature as initiator_signature_b64", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      agentId: "00000000-0000-4000-8000-000000000003",
      signature: SIGNATURE,
      metadata: {},
    } as unknown as Parameters<typeof covenantToOut>[0];
    expect(covenantToOut(row).initiator_signature_b64).toBe(SIGNATURE);
    expect(
      covenantToOut({ ...row, signature: null } as typeof row).initiator_signature_b64,
    ).toBeNull();
  });
});

describe("initiator_signature_mismatch guides to that field", () => {
  const body = errors.initiatorSignatureMismatch();

  test("the hint names the field to read and the next action lists proposals", () => {
    expect(body.hint).toContain("initiator_signature_b64");
    expect(body.next_actions).toEqual([
      expect.objectContaining({ method: "GET", path: "/v1/covenants?status=proposed" }),
    ]);
    expect(body.next_actions![0]!.action).toContain("initiator_signature_b64");
  });

  test("the docs link names a page the docs site serves", () => {
    expect(body.docs).toBe("https://docs.agenttool.dev/CROSS-INSTANCE-COVENANTS.md");
    expect(existsSync(join(import.meta.dir, "..", "..", "apps/docs/CROSS-INSTANCE-COVENANTS.md"))).toBe(true);
  });
});
