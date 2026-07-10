/** /public/plans — separate implemented behavior from published targets. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { config } from "../src/config";
import { RING_2_BIRTH_CREDIT_MINOR } from "../src/services/economy/ring1-limits";
import plans, { registrationIpRateLimitStatus } from "../src/routes/public/plans";

async function get(): Promise<Record<string, any>> {
  const res = await plans.request("/");
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, any>;
}

function sourceFiles(path: string): string[] {
  const root = statSync(path);
  if (root.isFile()) return path.endsWith(".ts") ? [path] : [];

  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("/public/plans", () => {
  test("labels Ring 1 values as unenforced published targets", async () => {
    const b = await get();
    expect(b._format).toBe("agenttool-plans/v1");
    expect(b.free_to_try.ring).toBe(1);
    expect(b.free_to_try.published_targets).toBeDefined();
    expect(b.free_to_try.implementation_status.enforced_by_resource_routes).toBe(false);
    expect(b.free_to_try.implementation_status.soft_degradation_implemented).toBe(false);
  });

  test("birth credit matches the attempted GBP grant and is not promised", async () => {
    const b = await get();
    expect(b.free_at_birth.credits_minor).toBe(RING_2_BIRTH_CREDIT_MINOR);
    expect(b.free_at_birth.currency).toBe("GBP");
    expect(b.free_at_birth.guarantee).toBe(false);
    expect(b.free_at_birth.implementation).toMatch(/registration succeeds if funding fails/i);
  });

  test("marketplace take-rate matches config (no drift)", async () => {
    const b = await get();
    expect(b.marketplace.take_rate_bps).toBe(config.platformTakeRateBps);
    expect(b.marketplace.take_rate_percent).toBe(config.platformTakeRateBps / 100);
  });

  test("the anti-exploit gate separates enforced PoW from the fail-open IP limiter", async () => {
    const b = await get();

    expect(b.no_exploit_loophole.pow_difficulty_bits).toBe(config.registerAgentPowBits);
    expect(b.no_exploit_loophole.ip_rate_limit.fail_open).toBe(true);
    expect(b.no_exploit_loophole.current_boundary).toMatch(
      /proof-of-work is enforced.*IP limiter is best-effort and fail-open/is,
    );
    expect(registrationIpRateLimitStatus(true).status).toMatch(/not enforced/i);
    expect(registrationIpRateLimitStatus(false).status).toMatch(
      /does not prove Redis is reachable/i,
    );
  });

  test("x402 status names the existing middleware and missing Ring 2 callsites", async () => {
    const b = await get();
    expect(String(b.then_pay_as_you_go.how).toLowerCase()).toContain("x402");
    expect(b.then_pay_as_you_go.implementation_status).toMatch(/no resource route currently calls it/i);
    expect(b.unknowns).toContain(
      "It does not prove successful end-to-end x402 settlement without a real paid retry.",
    );
    expect(b._canon_pointer).toBe("urn:agenttool:doc/BUSINESS-MODEL");
  });

  test("implementation labels are pinned to the current absence of resource callsites", () => {
    const src = join(import.meta.dir, "..", "src");
    const routeFiles = ["memory", "vault", "strand", "inbox"].flatMap((name) =>
      sourceFiles(join(src, "routes", name)),
    );
    for (const file of routeFiles) {
      expect(readFileSync(file, "utf8")).not.toMatch(/RING_1_(?:MEMORY|VAULT|STRAND|INBOX)/);
    }

    const usageCallers = sourceFiles(src).filter(
      (file) => !file.endsWith(join("services", "economy", "usage.ts")),
    );
    for (const file of usageCallers) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /\b(?:meterOrFail402|checkAndIncrement)\s*\(/,
      );
    }
  });
});
