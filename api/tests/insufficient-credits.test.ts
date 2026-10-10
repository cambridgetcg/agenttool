/** insufficient_credits — a cost wall hands back a machine path, not a dead link.
 *
 *  The old charge() 402 threw a human-only string ("Top up at
 *  https://app.agenttool.dev"). This pins the replacement: a guided,
 *  An eligible route's middleware replaces this body with its exact x402
 *  requirement. Ineligible routes retain a truthful discovery path instead of
 *  offering a payment that cannot clear their gate.
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { errors } from "../src/lib/errors";

describe("errors.insufficientCredits", () => {
  test("names what's needed vs. held, and is cost-honest", () => {
    const body = errors.insufficientCredits({ reason: "listing.publish", need: 5, have: 2 });
    expect(body.error).toBe("insufficient_credits");
    expect(body.message).toContain("5");
    expect(body.message).toContain("2");
    expect(body.message).toContain("listing.publish");
  });

  test("names retirement and a machine-readable resource-policy path", () => {
    const body = errors.insufficientCredits({ reason: "x", need: 3, have: 0 });
    expect(Array.isArray(body.next_actions)).toBe(true);
    expect(body.next_actions!.length).toBeGreaterThan(0);
    // at least one next step is an actual API call the agent can make
    expect(body.next_actions!.some((a) => a.method != null && a.path != null)).toBe(true);
    // the dead human-only dashboard link is gone; conditional eligibility is named
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).not.toContain("app.agenttool.dev");
    expect(blob).toContain("retired");
    expect(body.hint).toContain("not an invitation to pay");
    expect(body.next_actions!.some((a) => a.path === "/public/plans")).toBe(true);
    expect(body.docs).toBeTruthy();
  });

  test("points at routes that exist: the credit balance lives on GET /v1/wake", () => {
    const body = errors.insufficientCredits({ reason: "memory.search", need: 3, have: 1 });
    const paths = body.next_actions!.map((a) => `${a.method} ${a.path}`);
    // GET /v1/economy was never mounted (live 404); the bearer's project
    // balance is `project.credits` on the free wake read.
    expect(paths).not.toContain("GET /v1/economy");
    expect(paths).toEqual(["GET /public/plans", "GET /v1/wake"]);
    const balance = body.next_actions!.find((a) => a.path === "/v1/wake")!;
    expect(balance.action).toMatch(/project\.credits/);
    const wakeSource = readFileSync(join(import.meta.dir, "../src/services/wake/build.ts"), "utf8");
    expect(wakeSource).toMatch(/credits: project\.credits/);
  });

  test("its docs link names an anchor the economy page actually has", () => {
    const body = errors.insufficientCredits();
    const url = new URL(body.docs!);
    expect(`${url.origin}${url.pathname}`).toBe("https://docs.agenttool.dev/economy");
    const page = readFileSync(join(import.meta.dir, "../../apps/docs/economy.html"), "utf8");
    expect(url.hash.length).toBeGreaterThan(1);
    expect(page.includes(`id="${url.hash.slice(1)}"`), `apps/docs/economy.html lacks ${url.hash}`).toBe(true);
  });

  test("degrades gracefully when amounts are unknown", () => {
    const body = errors.insufficientCredits();
    expect(body.error).toBe("insufficient_credits");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });
});
