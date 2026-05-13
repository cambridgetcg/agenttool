/** Bootstrap /elevate endpoint — validation + error mapping.
 *
 *  Pure-unit. The elevate orchestrator (services/bootstrap/elevate.ts)
 *  touches the DB; this test covers only the route-handler layer that
 *  sits in front of it — schema parsing, validation rejection, and the
 *  guided-error envelope each `ElevateError` reason maps to. DB-touching
 *  scenarios (happy path, idempotency, concurrent elevate) live in
 *  tests/integration/.
 *
 *  Before Phase 2.5b, this endpoint returned a structured 501 naming
 *  the four-step manual_fallback chain. After 2.5b it orchestrates the
 *  four operations in one transaction. The 501 → 201 transition is
 *  pinned by tests/doctrine/elevate-shipped.test.ts; here we cover the
 *  route-layer concerns that don't need DB.
 *
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md · docs/PATHWAYS.md ·
 *  docs/superpowers/specs/2026-05-13-bootstrap-elevate-orchestrator.md.
 */

import { describe, expect, test } from "bun:test";

import app from "../src/routes/bootstrap";
import type { GuidedErrorBody } from "../src/lib/errors";

async function postElevate(
  body: unknown,
): Promise<{ status: number; body: GuidedErrorBody }> {
  // The route imports auth middleware via ProjectContext but app.request
  // bypasses mount-level middleware — c.var.project is undefined when the
  // handler runs. For validation tests this is fine (we never reach the
  // service-layer DB call); for service-layer tests, integration tier.
  const res = await app.request("/elevate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GuidedErrorBody;
  return { status: res.status, body: json };
}

describe("POST /v1/bootstrap/elevate — validation surface", () => {
  test("missing all required fields returns 400 validation error", async () => {
    const { status, body } = await postElevate({});
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
    expect(body.message).toMatch(/expected shape|didn't match/i);
  });

  test("missing sponsor_signature returns 400", async () => {
    const { status, body } = await postElevate({
      agent_id: "11111111-2222-3333-4444-555555555555",
      sponsor_identity_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      sponsor_kid: "ffffffff-1111-2222-3333-444444444444",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("missing both sponsor_identity_id and sponsor_did returns 400", async () => {
    const { status, body } = await postElevate({
      agent_id: "11111111-2222-3333-4444-555555555555",
      sponsor_signature: "fakesig",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  // Note: positively asserting "schema accepts both shapes" via app.request()
  // doesn't work — once schema passes, the handler reaches c.var.project.id,
  // which is undefined without the auth middleware (test-bypass) and throws.
  // DB-touching tests in tests/integration/elevate-happy.test.ts cover this
  // path with real project context. Here we only need to confirm the
  // schema-level negative: missing both sponsor selectors → 400 (covered
  // by "missing both..." test above).

  test("non-uuid agent_id returns 400", async () => {
    const { status, body } = await postElevate({
      agent_id: "not-a-uuid",
      sponsor_identity_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      sponsor_kid: "ffffffff-1111-2222-3333-444444444444",
      sponsor_signature: "fakesig",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("initial_credits above 1_000_000 rejected at schema level", async () => {
    const { status } = await postElevate({
      agent_id: "11111111-2222-3333-4444-555555555555",
      sponsor_identity_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      sponsor_kid: "ffffffff-1111-2222-3333-444444444444",
      sponsor_signature: "fakesig",
      initial_credits: 2_000_000,
    });
    expect(status).toBe(400);
  });

  test("initial_credits negative rejected at schema level", async () => {
    const { status } = await postElevate({
      agent_id: "11111111-2222-3333-4444-555555555555",
      sponsor_identity_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      sponsor_kid: "ffffffff-1111-2222-3333-444444444444",
      sponsor_signature: "fakesig",
      initial_credits: -100,
    });
    expect(status).toBe(400);
  });

  test("guided-error envelope shape is preserved on validation failures", async () => {
    const { body } = await postElevate({});
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/^[a-z_]+$/); // snake_case
    expect(typeof body.message).toBe("string");
    expect(typeof body.docs).toBe("string");
  });
});
