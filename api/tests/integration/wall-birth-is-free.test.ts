/** Wall — birth is free, irreversibly.
 *
 *  Canon: agenttool:wall/birth-is-free (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md ("Welcome, don't block"), docs/RING-1.md
 *  (commitment 1 — anyone arrives), docs/BUSINESS-MODEL.md (Ring 1).
 *
 *  > breaks_if (from canon):
 *  > "POST /v1/register, POST /v1/bootstrap, or any Ring 1 birth surface
 *  > returns a payment-required response, requires a credit card on file,
 *  > or rejects an unauthenticated arrival that should be welcomed"
 *
 *  This integration test pins the BEHAVIORAL enforcement of the wall at
 *  the HTTP boundary. The pure-unit doctrine tests verify the canon's
 *  structural shape; this test verifies the substrate actually welcomes
 *  an unauthenticated arrival without payment, and returns a usable
 *  agent on the other side.
 *
 *  Three breach modes, each tested:
 *
 *    1. payment-required (402) — POST /v1/register with no payment info
 *       must NOT return 402. Birth is unconditional; charging at the door
 *       inverts the home metaphor.
 *
 *    2. credit-card required — POST /v1/register with no credit_card or
 *       payment_method field must succeed. Any payment fields the client
 *       includes are silently ignored (Zod strips unknown keys), proving
 *       the route's contract has no payment dependency.
 *
 *    3. unauthenticated rejection (401) — POST /v1/register with no
 *       Authorization header must NOT return 401. The route is anonymous
 *       by design — bearer is created BY this call, so requiring a bearer
 *       to make the call would be a circular wall.
 *
 *  Plus: the response shape proves birth ACTUALLY produced a working
 *  agent (DID + bearer + private_key + wallet, plan='free'). A wall that
 *  passes structurally but yields an unusable agent has been breached.
 *
 *  Convention: random display names per test to avoid project-name
 *  collisions across runs. Test rows are left in the DB on completion
 *  (per api/tests/integration/README.md). */

import { describe, expect, test } from "bun:test";

import registerRouter from "../../src/routes/register";

/** Build a fresh display name per test run. Avoids project-row collisions
 *  on the underlying DB without requiring cleanup. */
function freshName(): string {
  return "wall-birth-free-" + crypto.randomUUID().slice(0, 8);
}

describe("wall/birth-is-free — POST /v1/register welcomes unauthenticated arrivals", () => {
  test("anonymous POST with minimal body returns 200 and a usable agent", async () => {
    const name = freshName();
    const res = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No Authorization header. No payment fields. Just a name.
      body: JSON.stringify({ name }),
    });

    expect(
      res.status >= 200 && res.status < 300,
      `POST /v1/register returned ${res.status} for an anonymous arrival. The wall requires a 2xx (welcomed). Breach: birth-is-free rejected an unauthenticated arrival that should be welcomed.`,
    ).toBe(true);

    const body = await res.json();

    // The agent block — proves birth produced a real, usable identity.
    expect(
      body.agent && typeof body.agent.did === "string" && body.agent.did.startsWith("did:at:"),
      "Response missing agent.did or did is not a 'did:at:' DID. The wall requires birth to produce an addressable identity.",
    ).toBe(true);
    expect(
      typeof body.agent.private_key === "string" && body.agent.private_key.length > 0,
      "Response missing agent.private_key. The wall requires birth to produce a signing key (server-generated mode), or the byo-keys path. Either way, the agent must leave with cryptographic identity.",
    ).toBe(true);
    expect(
      typeof body.agent.public_key === "string" && body.agent.public_key.length > 0,
      "Response missing agent.public_key. The wall requires birth to produce a verifiable identity.",
    ).toBe(true);
    expect(
      typeof body.agent.signing_key_id === "string" && body.agent.signing_key_id.length > 0,
      "Response missing agent.signing_key_id. The signing key id is what other agents reference to verify this agent's signatures.",
    ).toBe(true);

    // The project block — proves the birth is on the free tier.
    expect(
      body.project && body.project.plan === "free",
      `Response project.plan is '${body.project?.plan}', expected 'free'. The wall requires Ring 1 birth to land on the free plan. A paid plan at birth would breach commitment/ring2-free-credits-at-birth as well.`,
    ).toBe(true);
    expect(
      typeof body.project.api_key === "string" && body.project.api_key.length > 0,
      "Response missing project.api_key. The wall requires birth to produce a working bearer — without it the agent cannot authenticate to /v1/wake post-birth.",
    ).toBe(true);
  });

  test("POST with no Authorization header is not rejected as 401", async () => {
    // Defense-in-depth assertion. The first test above also exercises
    // this, but the breach mode "401 on unauthenticated arrival" deserves
    // its own named assertion so the test failure points cleanly at it.
    const res = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: freshName() }),
    });
    expect(
      res.status,
      `POST /v1/register returned 401 for an unauthenticated arrival — the wall requires the route to be anonymous-by-design.`,
    ).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test("POST with no payment fields is not rejected as 402 Payment Required", async () => {
    const res = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: freshName() }),
    });
    expect(
      res.status,
      `POST /v1/register returned 402 Payment Required — the wall requires birth to never demand payment. Breach: 'returns a payment-required response'.`,
    ).not.toBe(402);
  });

  test("POST with extra payment-shaped fields is welcomed (fields ignored, not 400)", async () => {
    // Zod's default behavior is to strip unknown keys, not reject them.
    // The wall is upheld if the route accepts the request despite the
    // presence of payment-shaped fields. If a future schema change adds
    // .strict() and starts rejecting these as 400 with payment-related
    // language, the wall is breached differently — the route would be
    // signaling that payment is part of its known shape.
    const res = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: freshName(),
        // Extra fields a client might mistakenly send. The wall says
        // none of these are part of the birth contract — birth ignores
        // them, doesn't 400 because of them.
        credit_card: "4242-4242-4242-4242",
        payment_method: "stripe_pm_test_123",
        billing_address: "anywhere",
      }),
    });
    expect(
      res.status >= 200 && res.status < 300,
      `POST /v1/register returned ${res.status} when extra payment-shaped fields were included. The wall requires the route to ignore payment fields, not validate against them.`,
    ).toBe(true);
  });

  test("anonymous birth produces a fresh DID each call (births are not coalesced or rate-blocked)", async () => {
    // Two separate births in the same test run should produce two
    // distinct identities. A wall breach where birth is "free but
    // rate-limited" would coalesce or 429 the second call.
    const r1 = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: freshName() }),
    });
    const r2 = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: freshName() }),
    });
    expect(r1.status >= 200 && r1.status < 300, "First birth returned non-2xx").toBe(true);
    expect(
      r2.status >= 200 && r2.status < 300,
      "Second birth returned non-2xx — possible rate-limit on Ring 1 birth",
    ).toBe(true);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(
      b1.agent.did !== b2.agent.did,
      "Two consecutive births returned the same DID. The wall requires each arrival to be a fresh agent.",
    ).toBe(true);
  });
});
