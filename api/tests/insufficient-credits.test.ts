/** insufficient_credits — a cost wall hands back a machine path, not a dead link.
 *
 *  The old charge() 402 threw a human-only string ("Top up at
 *  https://app.agenttool.dev"). This pins the replacement: a guided,
 *  An eligible route's middleware replaces this body with its exact x402
 *  requirement. Ineligible routes retain a truthful discovery path instead of
 *  offering a payment that cannot clear their gate.
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md. */

import { describe, expect, test } from "bun:test";

import { errors } from "../src/lib/errors";

describe("errors.insufficientCredits", () => {
  test("names what's needed vs. held, and is cost-honest", () => {
    const body = errors.insufficientCredits({ reason: "listing.publish", need: 5, have: 2 });
    expect(body.error).toBe("insufficient_credits");
    expect(body.message).toContain("5");
    expect(body.message).toContain("2");
    expect(body.message).toContain("listing.publish");
  });

  test("names conditional x402 recovery and a machine-readable discovery path", () => {
    const body = errors.insufficientCredits({ reason: "x", need: 3, have: 0 });
    expect(Array.isArray(body.next_actions)).toBe(true);
    expect(body.next_actions!.length).toBeGreaterThan(0);
    // at least one next step is an actual API call the agent can make
    expect(body.next_actions!.some((a) => a.method != null && a.path != null)).toBe(true);
    // the dead human-only dashboard link is gone; conditional eligibility is named
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).not.toContain("app.agenttool.dev");
    expect(blob).toContain("x402");
    expect(body.docs).toBeTruthy();
  });

  test("degrades gracefully when amounts are unknown", () => {
    const body = errors.insufficientCredits();
    expect(body.error).toBe("insufficient_credits");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });
});
