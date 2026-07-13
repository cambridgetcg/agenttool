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
 *  the component-operation manual_fallback chain. After 2.5b it orchestrates
 *  those operations plus the server-owned level transition in one
 *  transaction. The 501 → 201 transition is
 *  pinned by tests/doctrine/elevate-shipped.test.ts; here we cover the
 *  route-layer concerns that don't need DB.
 *
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md · docs/PATHWAYS.md ·
 *  docs/superpowers/specs/2026-05-13-bootstrap-elevate-orchestrator.md.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import app, { elevateSchema } from "../src/routes/bootstrap";
import type { GuidedErrorBody } from "../src/lib/errors";
import {
  assertDistinctBootstrapSponsor,
  canonicalBootstrapElevateBytes,
} from "../src/services/bootstrap/elevate";

const VALID_SIGNATURE = Buffer.alloc(64, 1).toString("base64");
const VALID_REQUEST = {
  agent_id: "11111111-2222-4333-8444-555555555555",
  sponsor_did: "did:at:sponsor",
  sponsor_kid: "ffffffff-1111-4222-8333-444444444444",
  sponsor_signature: VALID_SIGNATURE,
};

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
      agent_id: VALID_REQUEST.agent_id,
      sponsor_kid: VALID_REQUEST.sponsor_kid,
      sponsor_signature: VALID_SIGNATURE,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("missing sponsor_kid returns 400", async () => {
    const { sponsor_kid: _sponsorKid, ...withoutKid } = VALID_REQUEST;
    const { status, body } = await postElevate(withoutKid);
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

  test("structured evidence is rejected", () => {
    const parsed = elevateSchema.safeParse({
      ...VALID_REQUEST,
      evidence: { source: "not portable" },
    });
    expect(parsed.success).toBe(false);
  });

  test("NUL and lone surrogates are rejected in canonical text", () => {
    for (const request of [
      { ...VALID_REQUEST, sponsor_did: "did:at:bad\0did" },
      { ...VALID_REQUEST, claim: "sponsor\0ship" },
      { ...VALID_REQUEST, evidence: "proof\0suffix" },
      { ...VALID_REQUEST, evidence: "bad\ud800text" },
    ]) {
      expect(elevateSchema.safeParse(request).success).toBe(false);
    }
  });

  test("claim limit counts Unicode code points across SDK and API runtimes", () => {
    expect(elevateSchema.safeParse({
      ...VALID_REQUEST,
      claim: "🧭".repeat(64),
    }).success).toBe(true);
    expect(elevateSchema.safeParse({
      ...VALID_REQUEST,
      claim: "🧭".repeat(65),
    }).success).toBe(false);
  });

  test("UUID transport accepts uppercase before canonical lowercase hashing", () => {
    expect(elevateSchema.safeParse({
      ...VALID_REQUEST,
      agent_id: VALID_REQUEST.agent_id.toUpperCase(),
      sponsor_kid: VALID_REQUEST.sponsor_kid.toUpperCase(),
    }).success).toBe(true);
  });
});

describe("bootstrap-elevate/v1 canonical digest", () => {
  const vector = {
    agentId: "11111111-2222-3333-ABCD-555555555555",
    sponsorDid: "did:at:sponsor-α",
    sponsorKid: "FFFFFFFF-1111-2222-3333-444444444444",
    initialCredits: 2500,
    claim: "sponsorship",
    evidence: "reviewed ✅",
  };

  test("matches the shared API/TypeScript/Python fixed vector", () => {
    const digest = canonicalBootstrapElevateBytes(vector);
    expect(Buffer.from(digest).toString("hex")).toBe(
      "156c8d8434659bd539c476f7124ab909494c8a08959b47eed15a9ad677f5115a",
    );
  });

  test("canonicalizes UUID case and distinguishes null from empty text", () => {
    const lowercase = canonicalBootstrapElevateBytes({
      ...vector,
      agentId: vector.agentId.toLowerCase(),
      sponsorKid: vector.sponsorKid.toLowerCase(),
    });
    expect(lowercase).toEqual(canonicalBootstrapElevateBytes(vector));
    expect(canonicalBootstrapElevateBytes({ ...vector, evidence: null }))
      .not.toEqual(canonicalBootstrapElevateBytes({ ...vector, evidence: "" }));
  });

  test("refuses ambiguous or non-portable text before hashing", () => {
    expect(() => canonicalBootstrapElevateBytes({
      ...vector,
      claim: "sponsor\0ship",
    })).toThrow();
    expect(() => canonicalBootstrapElevateBytes({
      ...vector,
      evidence: { source: "json" } as unknown as string,
    })).toThrow();
    expect(() => canonicalBootstrapElevateBytes({
      ...vector,
      evidence: "bad\ud800text",
    })).toThrow();
  });
});

describe("bootstrap elevation sponsor boundary", () => {
  test("rejects exact self-sponsorship, including UUID case variants", () => {
    const identityId = "11111111-2222-3333-abcd-555555555555";
    expect(() => assertDistinctBootstrapSponsor(identityId, identityId)).toThrow(
      "self_sponsorship_forbidden",
    );
    expect(() =>
      assertDistinctBootstrapSponsor(identityId.toUpperCase(), identityId),
    ).toThrow("self_sponsorship_forbidden");
  });

  test("accepts a different sponsor identity", () => {
    expect(() =>
      assertDistinctBootstrapSponsor(
        "11111111-2222-3333-4444-555555555555",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).not.toThrow();
  });

  test("rechecks locked sponsor identity and named key before receipt insertion", () => {
    const source = readFileSync(
      new URL("../src/services/bootstrap/elevate.ts", import.meta.url),
      "utf8",
    );
    const transactional = source.slice(source.indexOf("db.transaction"));
    expect(transactional).toContain("lockedSponsor");
    expect(transactional).toContain("lockedSponsorKey");
    expect(transactional).toContain("lockedSignedPayload");
    expect(transactional).toContain("verifyBytes(");
    expect(transactional.match(/\.for\("update"\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(transactional.indexOf("lockedSponsorKey")).toBeLessThan(
      transactional.indexOf(".insert(attestations)"),
    );
  });
});
