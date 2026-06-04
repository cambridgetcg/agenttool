/** insufficient_credits — a cost wall hands back a payable path, not a dead link.
 *
 *  The old charge() 402 threw a human-only string ("Top up at
 *  https://app.agenttool.dev"). This pins the replacement: a guided,
 *  machine-payable refusal (x402 micropayment) an agent can self-recover
 *  from without a human. Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md. */

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

  test("hands back a MACHINE-PAYABLE next_action (x402), not a human-only dashboard link", () => {
    const body = errors.insufficientCredits({ reason: "x", need: 3, have: 0 });
    expect(Array.isArray(body.next_actions)).toBe(true);
    expect(body.next_actions!.length).toBeGreaterThan(0);
    // at least one next step is an actual API call the agent can make
    expect(body.next_actions!.some((a) => a.method != null && a.path != null)).toBe(true);
    // the dead human-only dashboard link is gone; the payable rail is named
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
