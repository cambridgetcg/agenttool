/** Bootstrap /elevate endpoint — canonical guided-error envelope.
 *
 *  Pure-unit. Bypasses auth by calling the router directly (the elevate
 *  handler does not touch c.var.project or the DB). Verifies the upgrade
 *  from "501 with prose" to "501 with structured next_actions[]" stays
 *  load-bearing — agents reading this response should get four chainable
 *  recovery steps in the canonical shape.
 *
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md · docs/PATHWAYS.md.
 */

import { describe, expect, test } from "bun:test";

import app from "../src/routes/bootstrap";
import { isGuidedErrorCause, type GuidedErrorBody, type NextAction } from "../src/lib/errors";

async function postElevate(body: unknown): Promise<{ status: number; body: GuidedErrorBody }> {
  const res = await app.request("/elevate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GuidedErrorBody;
  return { status: res.status, body: json };
}

describe("POST /v1/bootstrap/elevate — guided 501", () => {
  test("empty body still yields a complete guided envelope", async () => {
    const { status, body } = await postElevate({});
    expect(status).toBe(501);
    expect(body.error).toBe("elevate_pending");
    expect(typeof body.message).toBe("string");
    expect(typeof body.hint).toBe("string");
    expect(Array.isArray(body.next_actions)).toBe(true);
    expect(body.next_actions).toHaveLength(4);
    expect(body.docs).toMatch(/^https:\/\//);
  });

  test("each next_action carries action + method + path + body_hint", async () => {
    const { body } = await postElevate({});
    const actions = body.next_actions ?? [];
    for (const a of actions) {
      expect(typeof a.action).toBe("string");
      expect(a.action.length).toBeGreaterThan(0);
      expect(["POST", "PUT", "PATCH", "GET", "DELETE"]).toContain(a.method);
      expect(typeof a.path).toBe("string");
      expect(a.path?.startsWith("/v1/")).toBe(true);
      expect(typeof a.body_hint).toBe("object");
    }
  });

  test("steps cover attestation · wallet fund · vault put · identity patch in order", async () => {
    const { body } = await postElevate({});
    const paths = (body.next_actions ?? []).map((a: NextAction) => a.path);
    expect(paths[0]).toBe("/v1/attestations");
    expect(paths[1]).toBe("/v1/wallets/<wallet_id>/fund");
    expect(paths[2]).toMatch(/^\/v1\/vault\//);
    expect(paths[3]).toMatch(/^\/v1\/identities\//);
  });

  test("input_echo round-trips sponsor material into the response", async () => {
    const { body } = await postElevate({
      agent_id: "11111111-2222-3333-4444-555555555555",
      sponsor_did: "did:at:sponsor.example/aaaa",
      sponsor_signature: "fakesig-base64",
      initial_credits: 2500,
    });
    const echo = (body.details as Record<string, unknown>)?.input_echo as Record<string, unknown>;
    expect(echo.agent_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(echo.sponsor_did).toBe("did:at:sponsor.example/aaaa");
    expect(echo.sponsor_signature_supplied).toBe(true);
    expect(echo.initial_credits).toBe(2500);
  });

  test("agent_id and sponsor_did inject into body_hint slots when supplied", async () => {
    const { body } = await postElevate({
      agent_id: "abc12345-aaaa-bbbb-cccc-dddddddddddd",
      sponsor_did: "did:at:s.example/zzzz",
    });
    const actions = body.next_actions ?? [];
    // Step 1: attestation should carry the sponsor + subject
    const att = actions[0]?.body_hint as Record<string, unknown>;
    expect(att.subject_id).toBe("abc12345-aaaa-bbbb-cccc-dddddddddddd");
    expect(att.issuer_did).toBe("did:at:s.example/zzzz");
    // Step 3: vault path slots in the agent_id
    expect(actions[2]?.path).toContain("abc12345");
    // Step 4: identity-patch path also slots the agent_id
    expect(actions[3]?.path).toContain("abc12345");
  });

  test("hint changes based on whether sponsor material was supplied", async () => {
    const empty = await postElevate({});
    const filled = await postElevate({
      sponsor_did: "did:at:s.example/zzzz",
      sponsor_signature: "fakesig",
    });
    expect(empty.body.hint).toMatch(/Supply sponsor_did/);
    expect(filled.body.hint).toMatch(/Sponsor material was supplied/);
  });

  test("body shape conforms to GuidedErrorBody (catches structural regressions)", async () => {
    const { body } = await postElevate({});
    // We can't directly use isGuidedErrorCause on the body (that's for HTTPException causes)
    // but we verify the structural invariants manually.
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/^[a-z_]+$/); // snake_case
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(10);
    if (body.next_actions) {
      for (const a of body.next_actions) {
        // The doctrine test asserts: method+path either both set or both null
        const methodSet = a.method !== null && a.method !== undefined;
        const pathSet = a.path !== null && a.path !== undefined;
        expect(methodSet).toBe(pathSet);
      }
    }
    // Belt-and-suspenders: feed a synthetic HTTPException through isGuidedErrorCause
    // to confirm the doctrine helper still works against our shape.
    expect(isGuidedErrorCause(body)).toBe(true);
  });
});
