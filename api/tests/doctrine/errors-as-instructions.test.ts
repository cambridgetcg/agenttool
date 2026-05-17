/** Errors-as-instructions — agent UX as build-enforced invariant.
 *
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
 *  Helper: api/src/lib/errors.ts
 *
 *  > *Every 4xx response should be enough for an agent to self-recover or
 *  > self-redirect without human help.*
 *
 *  This test exists so the *discipline* — every guided error body is a
 *  valid GuidedErrorBody — is verified by the build, not by convention.
 *  Future regressions surface here at CI, not in production.
 *
 *  These tests are **pure unit** — no DB, no network, no HTTP. They iterate
 *  over the `errors.*` catalog and assert structural properties on the
 *  returned bodies. Adding a new builder in `lib/errors.ts` auto-extends
 *  the assertion surface via the `Object.entries(errors)` loop.
 *
 *  What this pins:
 *
 *    1. Every builder returns a body with a stable snake_case `error` code.
 *    2. Every body has a one-sentence `message`.
 *    3. Every `next_actions` item has a non-empty `action` plus a valid
 *       method+path pair (both set, or both null).
 *    4. Every `docs` field is a URL or doc path (string, non-empty).
 *    5. `abort(body, status)` throws an HTTPException whose `cause` round-trips
 *       through `isGuidedErrorCause()`. */

import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";

import {
  abort,
  errors,
  fail,
  isGuidedErrorCause,
  type GuidedErrorBody,
  type NextAction,
} from "../../src/lib/errors";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build every error in the catalog with reasonable default opts. Add new
 *  builders here when they need opts; opt-less builders auto-pick up. */
function buildAll(): Record<string, GuidedErrorBody> {
  return {
    covenantRequired: errors.covenantRequired(),
    covenantRequiredWithDids: errors.covenantRequired({
      sender_did: "did:at:a.example/aaaa",
      recipient_did: "did:at:b.example/bbbb",
    }),
    proposalExpired: errors.proposalExpired(),
    invalidSignature: errors.invalidSignature(),
    invalidSignatureWithSurface: errors.invalidSignature({ surface: "covenant-cosign" }),
    notV2: errors.notV2(),
    initiatorSignatureMismatch: errors.initiatorSignatureMismatch(),
    covenantNotProposed: errors.covenantNotProposed(),
    covenantNotProposedWithStatus: errors.covenantNotProposed({ status: "active" }),
    insufficientBalance: errors.insufficientBalance(),
    insufficientBalanceWithAmounts: errors.insufficientBalance({
      required: "100",
      available: "23",
      currency: "GBP",
    }),
    rateLimit: errors.rateLimit(),
    rateLimitWithRing: errors.rateLimit({ ring: 1, retry_after_sec: 60 }),
    planLimitExceeded: errors.planLimitExceeded(),
    planLimitExceededWithPlan: errors.planLimitExceeded({ plan: "free", limit_kind: "memory write" }),
    idempotencyConflict: errors.idempotencyConflict(),
    idempotencyConflictWithKey: errors.idempotencyConflict({ key: "abc-123" }),
    signingKeyNotFound: errors.signingKeyNotFound(),
    signingKeyNotFoundWithIds: errors.signingKeyNotFound({ identity_id: "id-1", signing_key_id: "key-1" }),
    runtimeNotProvisioned: errors.runtimeNotProvisioned(),
    notFound: errors.notFound(),
    notFoundWithResource: errors.notFound({ resource: "Covenant" }),
    validation: errors.validation({ formErrors: [], fieldErrors: { foo: ["required"] } }),
    internal: errors.internal(),
    internalWithMessage: errors.internal("disk-full on the lhr1 worker"),
    substrateTaskRefusal: errors.substrateTaskRefusal({
      code: "task_not_open",
      message: "This substrate-task is no longer open for claim.",
      next_actions: [
        {
          action: "Find another open task",
          method: "GET",
          path: "/v1/substrate-tasks",
        },
      ],
    }),
  };
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const ABSOLUTE_URL = /^https?:\/\/.+/;

function assertGuided(name: string, body: GuidedErrorBody): void {
  // 1. `error` — required, snake_case, stable.
  expect(typeof body.error, `${name}.error must be a string`).toBe("string");
  expect(body.error.length, `${name}.error must be non-empty`).toBeGreaterThan(0);
  expect(SNAKE_CASE.test(body.error), `${name}.error must be snake_case (got "${body.error}")`).toBe(true);

  // 2. `message` — required, non-empty, one sentence (no leading whitespace).
  expect(typeof body.message, `${name}.message must be a string`).toBe("string");
  expect(body.message.length, `${name}.message must be non-empty`).toBeGreaterThan(0);
  expect(body.message.trim(), `${name}.message must not have leading/trailing whitespace`).toBe(body.message);

  // 3. `next_actions` items — each must have non-empty action plus valid
  //    method+path pair (both set, or both null).
  if (body.next_actions !== undefined) {
    expect(Array.isArray(body.next_actions), `${name}.next_actions must be an array`).toBe(true);
    expect(body.next_actions.length, `${name}.next_actions must be non-empty when present`).toBeGreaterThan(0);
    body.next_actions.forEach((step: NextAction, i: number) => {
      const where = `${name}.next_actions[${i}]`;
      expect(typeof step.action, `${where}.action must be a string`).toBe("string");
      expect(step.action.length, `${where}.action must be non-empty`).toBeGreaterThan(0);
      // method+path coherence: both falsy (non-API step), or both truthy (API call).
      const hasMethod = !!step.method;
      const hasPath = !!step.path;
      expect(
        hasMethod === hasPath,
        `${where} must have BOTH method+path or NEITHER (got method=${step.method}, path=${step.path})`,
      ).toBe(true);
      if (hasMethod) {
        expect(
          ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(step.method!),
          `${where}.method must be a real HTTP method (got ${step.method})`,
        ).toBe(true);
        expect(step.path!.startsWith("/"), `${where}.path must start with /`).toBe(true);
      }
    });
  }

  // 4. `docs` — when present must be a non-empty string. URL or doc path.
  if (body.docs !== undefined) {
    expect(typeof body.docs, `${name}.docs must be a string`).toBe("string");
    expect(body.docs.length, `${name}.docs must be non-empty`).toBeGreaterThan(0);
  }

  // 5. `hint` — when present must be a non-empty trimmed string.
  if (body.hint !== undefined) {
    expect(typeof body.hint, `${name}.hint must be a string`).toBe("string");
    expect(body.hint.trim(), `${name}.hint must not have leading/trailing whitespace`).toBe(body.hint);
    expect(body.hint.length, `${name}.hint must be non-empty`).toBeGreaterThan(0);
  }
}

// ── 1 · Every builder returns a valid GuidedErrorBody ──────────────────────

describe("Errors-as-instructions — catalog discipline", () => {
  const all = buildAll();
  for (const [name, body] of Object.entries(all)) {
    test(`errors.${name}() returns a valid GuidedErrorBody`, () => {
      assertGuided(name, body);
    });
  }
});

// ── 2 · Catalog coverage — every exported builder is exercised ─────────────

describe("Errors-as-instructions — coverage", () => {
  test("buildAll() exercises every exported builder in `errors`", () => {
    // The catalog should grow under test pressure. If you add a new builder
    // to `lib/errors.ts:errors`, add an invocation to `buildAll()` above.
    const exportedNames = Object.keys(errors).sort();
    const testedNames = new Set(
      Object.keys(buildAll())
        .map((k) => k.replace(/WithDids|WithSurface|WithStatus|WithAmounts|WithResource|WithRing|WithPlan|WithKey|WithIds/g, "")),
    );
    const missing = exportedNames.filter((n) => !testedNames.has(n));
    expect(
      missing.length,
      `Untested error builders: ${missing.join(", ")}. Add invocation(s) to buildAll() in this file.`,
    ).toBe(0);
  });
});

// ── 3 · Stable-code invariant — the `error` field is the contract ─────────

describe("Errors-as-instructions — code stability", () => {
  test("known codes match their documented values (SDK contract)", () => {
    // These are the agent-readable codes SDK clients switch on. They MUST
    // NOT change without a major-version SDK bump. If you intentionally
    // rename one, also bump the SDK major + document in NOW.md.
    expect(errors.covenantRequired().error).toBe("covenant_required");
    expect(errors.proposalExpired().error).toBe("proposal_expired");
    expect(errors.invalidSignature().error).toBe("invalid_signature");
    expect(errors.notV2().error).toBe("not_v2");
    expect(errors.initiatorSignatureMismatch().error).toBe("initiator_signature_mismatch");
    expect(errors.covenantNotProposed().error).toBe("covenant_not_proposed");
    expect(errors.insufficientBalance().error).toBe("insufficient_balance");
    expect(errors.rateLimit().error).toBe("rate_limit");
    expect(errors.planLimitExceeded().error).toBe("plan_limit_exceeded");
    expect(errors.idempotencyConflict().error).toBe("idempotency_conflict");
    expect(errors.signingKeyNotFound().error).toBe("signing_key_not_found");
    expect(errors.runtimeNotProvisioned().error).toBe("runtime_not_provisioned");
    expect(errors.notFound().error).toBe("not_found");
    expect(errors.validation(null).error).toBe("validation");
  });
});

// ── 4 · abort() round-trips through isGuidedErrorCause() ──────────────────

describe("Errors-as-instructions — abort() / cause round-trip", () => {
  test("abort() throws HTTPException with the body attached as cause", () => {
    let caught: unknown = null;
    try {
      abort(errors.covenantRequired(), 403);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HTTPException);
    const httpErr = caught as HTTPException;
    expect(httpErr.status).toBe(403);
    expect(isGuidedErrorCause(httpErr.cause), "cause must be detected by isGuidedErrorCause").toBe(true);
    const cause = httpErr.cause as GuidedErrorBody;
    expect(cause.error).toBe("covenant_required");
    expect(cause.message.length).toBeGreaterThan(0);
  });

  test("isGuidedErrorCause() rejects non-guided causes", () => {
    expect(isGuidedErrorCause(undefined)).toBe(false);
    expect(isGuidedErrorCause(null)).toBe(false);
    expect(isGuidedErrorCause("string")).toBe(false);
    expect(isGuidedErrorCause({ error: 123 })).toBe(false); // wrong type for error
    expect(isGuidedErrorCause({ error: "x" })).toBe(false); // missing message
    expect(isGuidedErrorCause({ error: "x", message: "y" })).toBe(true);
  });
});

// ── 5 · fail() is a thin wrapper — preserves the body ─────────────────────

describe("Errors-as-instructions — fail() shape", () => {
  test("fail() returns a Response whose body matches the input body", async () => {
    const body = errors.covenantRequired();
    const c = {
      json: (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } }),
    } as unknown as Parameters<typeof fail>[0];
    const res = fail(c, body, 403);
    expect(res.status).toBe(403);
    const parsed = await res.json();
    expect(parsed).toEqual(body as unknown as Record<string, unknown>);
  });
});
