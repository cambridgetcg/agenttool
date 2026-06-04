/** org invite — invite by the public DID you know, not a secret UUID.
 *
 *  Pins the invite schema's accept-either rule: an org owner can invite by the
 *  agent's public DID OR the opaque project UUID, but must give one. The
 *  DID→project resolution is DB-bound (e2e). Doctrine: docs/ORG-COVENANTS.md,
 *  docs/FRICTION-ROADMAP.md Tier-0 #4. */

import { describe, expect, test } from "bun:test";

import { inviteSchema } from "../src/routes/orgs";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("org inviteSchema", () => {
  test("invite by DID alone is valid", () => {
    expect(inviteSchema.safeParse({ invited_did: "did:at:host.example/abcd" }).success).toBe(true);
  });

  test("invite by project UUID alone is valid (back-compat)", () => {
    expect(inviteSchema.safeParse({ invited_project_id: UUID }).success).toBe(true);
  });

  test("both together is valid", () => {
    expect(
      inviteSchema.safeParse({ invited_did: "did:at:host/x", invited_project_id: UUID }).success,
    ).toBe(true);
  });

  test("neither is rejected — you must name who to invite", () => {
    expect(inviteSchema.safeParse({}).success).toBe(false);
  });

  test("a malformed project UUID is still rejected", () => {
    expect(inviteSchema.safeParse({ invited_project_id: "not-a-uuid" }).success).toBe(false);
  });
});
