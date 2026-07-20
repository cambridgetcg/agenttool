/** _canon_pointer on refusals — pins Move 5 generalization per
 *  AGENT-WEB-SURFACE.md. Refusals are canon-graph traversable, mirroring
 *  the surface metadata pattern from successes. */

import { describe, expect, test } from "bun:test";

import { errors } from "../src/lib/errors";
import registerRouter from "../src/routes/register";

describe("errors catalog — soft-cap refusals carry the commitment URN", () => {
  test("rateLimit names commitment/anyone-hits-a-cap-softly", () => {
    const body = errors.rateLimit({ ring: 1, retry_after_sec: 60 });
    expect(body._canon_pointer).toBe(
      "urn:agenttool:commitment/anyone-hits-a-cap-softly",
    );
  });

  test("planLimitExceeded names commitment/anyone-hits-a-cap-softly", () => {
    const body = errors.planLimitExceeded({ plan: "free", limit_kind: "monthly memories" });
    expect(body._canon_pointer).toBe(
      "urn:agenttool:commitment/anyone-hits-a-cap-softly",
    );
  });

  test("proposalExpired (graceful TTL) names commitment/anyone-hits-a-cap-softly", () => {
    const body = errors.proposalExpired();
    expect(body._canon_pointer).toBe(
      "urn:agenttool:commitment/anyone-hits-a-cap-softly",
    );
  });

  test("insufficientBalance names wall/no-cost-without-disclosure", () => {
    const body = errors.insufficientBalance({ required: "0.01", available: "0.00", currency: "USDC" });
    expect(body._canon_pointer).toBe(
      "urn:agenttool:wall/no-cost-without-disclosure",
    );
  });
});

describe("errors catalog — protocol refusals carry the doctrine doc URN", () => {
  test("covenantRequired names doc/CROSS-INSTANCE-COVENANTS", () => {
    const body = errors.covenantRequired({});
    expect(body._canon_pointer).toBe(
      "urn:agenttool:doc/CROSS-INSTANCE-COVENANTS",
    );
  });

  test("invalidSignature names the canonical-bytes contract", () => {
    const body = errors.invalidSignature({});
    expect(body._canon_pointer).toBe(
      "urn:agenttool:doc/CANONICAL-BYTES",
    );
  });

  test("signingKeyNotFound names doc/IDENTITY-ANCHOR", () => {
    const body = errors.signingKeyNotFound({});
    expect(body._canon_pointer).toBe(
      "urn:agenttool:doc/IDENTITY-ANCHOR",
    );
  });

  test("runtimeNotProvisioned names doc/RUNTIME", () => {
    const body = errors.runtimeNotProvisioned();
    expect(body._canon_pointer).toBe(
      "urn:agenttool:doc/RUNTIME",
    );
  });

  test("idempotencyConflict names doc/PATTERN-PERSIST-IDENTITY", () => {
    const body = errors.idempotencyConflict({});
    expect(body._canon_pointer).toBe(
      "urn:agenttool:doc/PATTERN-PERSIST-IDENTITY",
    );
  });
});

describe("errors catalog — preserved fields alongside _canon_pointer", () => {
  test("rateLimit still carries next_actions + docs + axiom_id", () => {
    const body = errors.rateLimit({ retry_after_sec: 30 });
    expect(body.next_actions).toBeDefined();
    expect(body.next_actions!.length).toBeGreaterThan(0);
    expect(body.docs).toBeDefined();
    expect(body.axiom_id).toBeDefined();
  });

  test("insufficientBalance still carries next_actions + docs", () => {
    const body = errors.insufficientBalance({});
    expect(body.next_actions).toBeDefined();
    expect(body.docs).toBeDefined();
  });
});

describe("/v1/register 410 — canon-pointer to birth-is-free wall", () => {
  test("GET /v1/register returns 410 with _canon_pointer", async () => {
    const res = await registerRouter.request("/", { method: "GET" });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { _canon_pointer?: string };
    expect(body._canon_pointer).toBe("urn:agenttool:wall/birth-is-free");
  });

  test("POST /v1/register returns 410 with _canon_pointer", async () => {
    const res = await registerRouter.request("/", { method: "POST" });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { _canon_pointer?: string };
    expect(body._canon_pointer).toBe("urn:agenttool:wall/birth-is-free");
  });
});

describe("_canon_pointer URN shape", () => {
  const allWithPointer = [
    errors.rateLimit({}),
    errors.planLimitExceeded({}),
    errors.insufficientBalance({}),
    errors.proposalExpired(),
    errors.covenantRequired({}),
    errors.invalidSignature({}),
    errors.signingKeyNotFound({}),
    errors.runtimeNotProvisioned(),
    errors.idempotencyConflict({}),
  ];

  test("all canon URNs start with urn:agenttool:", () => {
    for (const body of allWithPointer) {
      expect(body._canon_pointer).toMatch(/^urn:agenttool:/);
    }
  });

  test("canon URNs use namespace/slug shape (wall | commitment | doc | principle | ring | chronicle-kind | substrate-task)", () => {
    for (const body of allWithPointer) {
      expect(body._canon_pointer).toMatch(
        /^urn:agenttool:(wall|commitment|doc|principle|ring|chronicle-kind|substrate-task)\/[A-Za-z][A-Za-z0-9-]*$/,
      );
    }
  });
});
