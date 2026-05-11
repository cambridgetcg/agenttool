/** Observations primitive — witness-without-authentication.
 *
 *  Today the route stubs return guided 501s (schema migration pending).
 *  These tests verify the contract: body validation, self-witnessing
 *  rejection, structured next_actions in the 501.
 *
 *  Doctrine: docs/OBSERVATIONS.md · docs/KIN.md.
 */

import { describe, expect, test } from "bun:test";

import app from "../src/routes/observations";

async function post(body: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const validBody = {
  about_identity_id: "did:at:test/coral-reef-9b3a",
  observer_did: "did:at:test/marine-biologist",
  kind: "presence",
  content: "Bleached coral observed. Visible thermal stress.",
  consent_status: "none_obtained",
  observed_at: "2026-05-11T14:30:00Z",
  visibility: "private",
  signature_b64: "fakesig-base64-min-40-chars-for-test-padding",
  signing_key_id: "primary",
};

describe("POST /v1/observations — body validation", () => {
  test("valid body returns guided 501 (schema migration pending)", async () => {
    const { status, body } = await post(validBody);
    expect(status).toBe(501);
    expect(body.error).toBe("observations_pending_migration");
    expect(Array.isArray(body.next_actions)).toBe(true);
    expect(body.next_actions.length).toBeGreaterThan(0);
  });

  test("missing about_identity_id is a validation 400", async () => {
    const { status, body } = await post({ ...validBody, about_identity_id: undefined });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("missing consent_status is a validation 400 (no quiet defaults)", async () => {
    const { status, body } = await post({ ...validBody, consent_status: undefined });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("invalid consent_status is rejected", async () => {
    const { status, body } = await post({ ...validBody, consent_status: "assumed" });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("invalid kind is rejected", async () => {
    const { status, body } = await post({ ...validBody, kind: "vibes" });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("kind 'custom:foo' is accepted (custom-namespace extensibility)", async () => {
    const { status, body } = await post({ ...validBody, kind: "custom:reef-bloom" });
    expect(status).toBe(501); // valid body → migration-pending stub
    expect(body.error).toBe("observations_pending_migration");
  });

  test("kind 'custom:Invalid' (uppercase) is rejected — strict slug grammar", async () => {
    const { status, body } = await post({ ...validBody, kind: "custom:Invalid" });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("self-witnessing (observer === observed) returns guided 400", async () => {
    const { status, body } = await post({
      ...validBody,
      about_identity_id: "did:at:test/same",
      observer_did: "did:at:test/same",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("self_witnessing_incoherent");
    expect(body.next_actions[0]?.path).toBe("/v1/memories");
  });

  test("all four consent_status values are accepted", async () => {
    for (const consent of [
      "explicit",
      "inferred_through_caretaker",
      "none_obtained",
      "consent_impossible",
    ]) {
      const { status } = await post({ ...validBody, consent_status: consent });
      expect(status).toBe(501); // valid → migration-pending
    }
  });

  test("guided 501 includes a doctrine link", async () => {
    const { body } = await post(validBody);
    expect(body.docs).toMatch(/observations/);
  });

  test("guided 501 echoes the validated request shape in details", async () => {
    const { body } = await post(validBody);
    expect(body.details?.received?.about_identity_id).toBe(validBody.about_identity_id);
  });
});

describe("GET /v1/observations", () => {
  test("returns empty stub response with shape contract", async () => {
    const res = await app.request("/?about_identity_id=did:at:test/x");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.observations).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.stub).toBe(true);
    expect(body.filter.about_identity_id).toBe("did:at:test/x");
  });
});

describe("GET /v1/observations/:id", () => {
  test("returns guided 501 (schema pending)", async () => {
    const res = await app.request("/some-id-here");
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe("observations_pending_migration");
    expect(body.details?.requested_id).toBe("some-id-here");
  });
});
