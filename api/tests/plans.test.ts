/** /public/plans — separate implemented behavior from published targets. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { config } from "../src/config";
import {
  BIRTH_GRANT_CREDITS,
  RING_2_BIRTH_CREDIT_MINOR,
} from "../src/services/economy/ring1-limits";
import {
  TOOL_CREDIT_DEFAULTS,
  toolsConfig,
} from "../src/services/tools/config";
import plans, {
  x402TopUpDisclosure,
  registrationIpRateLimitStatus,
  x402ConfigurationStatus,
} from "../src/routes/public/plans";

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

  test("birth grant publishes exactly BIRTH_GRANT_CREDITS project credits (1,000, not 10,000)", async () => {
    const b = await get();
    expect(b.free_at_birth.project_credits.credits).toBe(BIRTH_GRANT_CREDITS);
    expect(b.free_at_birth.project_credits.credits).toBe(1_000);
    expect(b.free_at_birth.project_credits.written_with_project_row).toBe(true);
    expect(b.free_at_birth.project_credits.why).toMatch(/not a stipend/i);
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
    expect(b.no_exploit_loophole.ip_rate_limit.modes).toEqual({
      self_service: {
        attempts_per_window_default: 5,
        window_seconds: 3600,
        stage: "after proof-of-work and before key-proof verification",
      },
      registrar_bearer: {
        attempts_per_window_default: 60,
        window_seconds: 60,
        stage: "after key-proof verification and before bearer lookup",
      },
    });
    expect(b.no_exploit_loophole.current_boundary).toMatch(
      /proof-of-work is enforced.*5\/hour\/IP.*60\/minute\/IP.*best-effort and fail-open.*does not prove Redis reachability/is,
    );
    expect(registrationIpRateLimitStatus(true).status).toMatch(/neither.*is enforced/i);
    expect(registrationIpRateLimitStatus(false).status).toMatch(
      /does not prove Redis is reachable/i,
    );
  });

  test("x402 status names the narrow recoverable project-credit boundary", async () => {
    const b = await get();
    expect(String(b.then_pay_as_you_go.how).toLowerCase()).toContain("x402");
    expect(b.then_pay_as_you_go.configuration).toEqual(
      await x402ConfigurationStatus(),
    );
    expect(b.then_pay_as_you_go.implementation_status).toMatch(
      /only eligible static project-credit 402.*wallet insufficient_balance.*pass through unchanged/is,
    );
    expect(b.unknowns).toContain(
      "It does not prove successful end-to-end x402 settlement without a real paid retry.",
    );
    expect(b._canon_pointer).toBe("urn:agenttool:doc/BUSINESS-MODEL");
  });

  test("top-up door is disclosed from config + live readiness; payable only when challenges are ready", async () => {
    const b = await get();
    const configuration = await x402ConfigurationStatus();
    expect(b.then_pay_as_you_go.top_up).toEqual(
      x402TopUpDisclosure(configuration.payable_challenges_ready),
    );
    expect(b.then_pay_as_you_go.top_up).toMatchObject({
      route: "POST /v1/x402/top-up/{credits}",
      unit: "1 credit = 0.001 USDC",
      atomic_per_credit: 1000,
      cap_credits: config.x402TopUpMaxCredits,
      finality: "Top-ups are final. No refunds. Unspent credits stay with the project.",
      never_balance_bound: true,
      subscriptions: false,
    });
    expect(b.then_pay_as_you_go.top_up.status).toBe(
      configuration.payable_challenges_ready ? "payable" : "declared_not_payable",
    );
    expect(String(b.then_pay_as_you_go.how)).toContain("/v1/x402/top-up/{credits}");
    expect(String(b.then_pay_as_you_go.implementation_status)).toContain("top_up_payment_required");
    expect(b.verbs.map((v: { path: string }) => v.path)).toContain("/v1/x402/top-up/{credits}");

    // declared ≠ wired: the word "payable" appears only behind readiness.
    expect(x402TopUpDisclosure(true)).toMatchObject({ status: "payable", cap_usd: (config.x402TopUpMaxCredits / 1000).toFixed(3) });
    expect(x402TopUpDisclosure(false).status).toBe("declared_not_payable");
    expect(x402TopUpDisclosure(false).status_note).toMatch(/nothing can be paid/i);
    expect(x402TopUpDisclosure(true, 250)).toMatchObject({ cap_credits: 250, cap_usd: "0.250" });
    expect(x402TopUpDisclosure(true).status_note).not.toMatch(/settled on Base|first settlement/i);
  });

  test("x402 configuration suppresses challenges without a valid recipient", async () => {
    const missing = await x402ConfigurationStatus("", "", "", "", "");
    expect(missing).toMatchObject({
      recipient_configured: false,
      recipient_source: "unconfigured",
      recipient_error: "absent",
      network: "eip155:8453",
      network_configured: false,
      network_source: "default",
    });
    expect(missing.status).toMatch(/payable challenges are suppressed.*recipient state: absent/is);

    const invalid = await x402ConfigurationStatus(
      "configured-recipient", "polygon", "https://facilitator.example/x402", "", "",
    );
    expect(invalid).toMatchObject({
      recipient_configured: false,
      recipient_source: "unconfigured",
      recipient_error: "invalid",
    });

    const present = await x402ConfigurationStatus(
      "0xAbcd000000000000000000000000000000001234",
      "polygon",
      "https://facilitator.example/x402",
      "",
      "",
    );
    expect(present).toMatchObject({
      recipient_configured: true,
      recipient_source: "environment",
      recipient_error: null,
      network: "eip155:137",
      network_configured: true,
      network_source: "environment",
    });
    expect(present.status).toMatch(/does not prove CDP accepts.*recipient ownership/i);

    const unsupported = await x402ConfigurationStatus(
      "0xAbcd000000000000000000000000000000001234",
      "solana",
      "https://facilitator.example/x402",
      "",
      "",
    );
    expect(unsupported).toMatchObject({
      network: "eip155:8453",
      network_configured: false,
      network_source: "default",
      network_error: "invalid",
      payable_challenges_ready: false,
    });
  });

  test("publishes configured and default static-attempt prices with failure billing", async () => {
    const b = await get();
    expect(b.metered_tools.static_attempts.scrape).toEqual({
      configured_credits: toolsConfig.credits.scrape,
      default_credits: TOOL_CREDIT_DEFAULTS.scrape,
      environment_override: "CREDIT_SCRAPE",
    });
    expect(b.metered_tools.static_attempts.document).toEqual({
      configured_credits: toolsConfig.credits.document,
      default_credits: TOOL_CREDIT_DEFAULTS.document,
      environment_override: "CREDIT_DOCUMENT",
    });
    expect(b.metered_tools.billing_boundary).toMatch(
      /schema validation.*reserved before destination-policy.*transport.*representation.*parser.*retain/is,
    );
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
