/** Pins outward crypto claims to the implemented custody and rollout boundary. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("public crypto source truth", () => {
  test("deposit guidance does not send users into unreconciled Solana credit", () => {
    const wallets = read("apps/docs/wallets.html");
    const openapi = read("api/src/routes/openapi.ts");
    const errors = read("api/src/lib/errors.ts");
    const witnessMarketplace = read(
      "api/src/routes/memory-witness-marketplace.ts",
    );

    expect(wallets).toContain("Only USDC deposits are accepted");
    expect(wallets).toMatch(/Solana[^.]{0,180}credit[^.]{0,80}by default/i);
    expect(wallets).not.toMatch(/USDC, (?:ETH|SOL|MATIC)/);
    expect(openapi).toContain(
      "EVM disclosure is readiness-gated and Solana does not credit by default",
    );

    for (const source of [errors, witnessMarketplace]) {
      expect(source).toContain(
        "/v1/wallets/{id}/deposit-address?chain=ethereum&token=USDC",
      );
      expect(source).toMatch(/Solana[^.\n]{0,100}(?:unavailable|does not credit)/i);
    }
  });

  test("fresh payout claims rest on the conserved-backing boundary", () => {
    const sources = [
      read("packages/sdk-ts/README.md"),
      read("packages/sdk-py/README.md"),
      read("docs/CRYPTO-PAYMENT.md"),
      read("apps/docs/wallets.html"),
      read("api/src/routes/openapi.ts"),
    ];

    for (const source of sources) {
      expect(source).toMatch(
        /fresh payout[\s\S]{0,180}(?:admission|creation)[\s\S]{0,80}resting/i,
      );
      expect(source).toMatch(
        /gallery_sale[\s\S]{0,100}escrow_release[\s\S]{0,260}(?:did not|does not|insufficient)[\s\S]{0,100}(?:conserve|backing|cashable)/i,
      );
    }

    expect(sources[0]).not.toContain("requestPayout(wallet.id");
    expect(sources[0]).not.toContain("request_payout(wallet.id");
    expect(sources[1]).not.toContain("request_payout(\n    wallet.id");

    const payoutRoute = read("api/src/routes/economy/crypto.ts");
    expect(payoutRoute).toContain("PAYOUT_ADMISSION_RESTING_ERROR");
    expect(payoutRoute).not.toContain("payoutBroadcastConfigured");
  });

  test("public payout summaries do not present configuration as activation", () => {
    const tsReadme = read("packages/sdk-ts/README.md");
    const tsClient = read("packages/sdk-ts/src/economy.ts");
    const pyClient = read("packages/sdk-py/src/agenttool/economy.py");
    const agentCentric = read("docs/AGENT-CENTRIC.md");
    const roadmap = read("apps/docs/roadmap.html");
    const marketplace = read("docs/MARKETPLACE.md");
    const map = read("docs/MAP.md");
    const plan = read("docs/PAYOUT-BROADCAST-PLAN.md");
    const now = read("docs/NOW.md");

    expect(tsReadme).toContain("at.economy.list_payouts(wallet.id)");
    expect(tsReadme).not.toContain("at.economy.listPayouts(wallet.id)");
    for (const client of [tsClient, pyClient]) {
      expect(client).toMatch(
        /Fresh requests currently rest[\s\S]{0,120}exact replay of durable historical accepted state can succeed/i,
      );
    }

    expect(agentCentric).toMatch(
      /fresh admission and every worker path are hard-disabled/i,
    );
    expect(roadmap).toMatch(
      /fresh admission and every payout worker are hard-resting/i,
    );
    expect(marketplace).toMatch(
      /fresh payout admission and every payout worker are hard-resting/i,
    );
    expect(map).toContain("Current hard-resting payout boundary");
    expect(plan).toContain(
      "Historical architectural decisions — non-operational",
    );
    expect(plan).toContain(
      "Historical credentialed harnesses — not an enablement path",
    );
    expect(plan).toContain("No testnet or mainnet payout activation exists");
    expect(now).toMatch(
      /Fresh admission and every worker path are[\s\S]{0,40}hard-resting/i,
    );

    const joined = [
      agentCentric,
      roadmap,
      marketplace,
      map,
      plan,
      now,
    ].join("\n");
    for (const stale of [
      "completion depends on explicit payout-worker enablement",
      "credentialed testnet evidence and mainnet enable remain operator-led",
      "Operator runbook for testnet/mainnet enable",
      "No mainnet payouts until Slices 0–6 pass on testnet",
      "exact-revision credentialed testnet evidence and mainnet enable",
    ]) {
      expect(joined).not.toContain(stale);
    }
  });

  test("retired payout harness entrypoints are unconditional inert stubs", () => {
    const harnesses = [
      "api/scripts/_e2e-payout-evm.ts",
      "api/scripts/_e2e-payout-sol.ts",
      "api/scripts/_e2e-payout-policies.ts",
      "api/scripts/_e2e-payout-cancel.mjs",
    ];
    const expectedExecutable = [
      "const RESTING_NOTICE = [",
      '  "Historical payout harness retired: payouts are resting unconditionally.",',
      '  "Former implementation remains in Git history.",',
      '  "Current operations: docs/PAYOUT-BROADCAST-OPS.md",',
      '  "Historical plan: docs/PAYOUT-BROADCAST-PLAN.md",',
      '].join("\\n");',
      "",
      "console.error(RESTING_NOTICE);",
      "process.exitCode = 1;",
    ].join("\n");

    for (const path of harnesses) {
      const source = read(path);
      const executable = source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").trim();

      expect(source).toContain(
        "fresh payout admission and\n * every payout worker remain resting unconditionally",
      );
      expect(source).toContain(
        "former credentialed\n * implementation remains available in Git history",
      );
      expect(executable).toBe(expectedExecutable);
    }
  });

  test("fresh-request boundary distinguishes replay reads from economic work", () => {
    const boundarySources = [
      read("packages/sdk-ts/README.md"),
      read("packages/sdk-py/README.md"),
      read("api/src/routes/openapi.ts"),
      read("api/src/services/discovery/safety-boundaries.ts"),
      read("apps/docs/wallets.html"),
      read("docs/CRYPTO-PAYMENT.md"),
      read("docs/PAYOUT-BROADCAST.md"),
      read("docs/PAYOUT-BROADCAST-OPS.md"),
      read("docs/PAYOUT-BROADCAST-PLAN.md"),
      read("docs/SAFETY-BOUNDARIES.md"),
    ];

    for (const source of boundarySources) {
      expect(source).toMatch(
        /before\s+network\s+selection\s+or\s+payout-economic\s+wallet\/policy\s+reads\s+or\s+mutation/i,
      );
      expect(source).not.toMatch(
        /before network(?: selection)?,?\s+wallet(?: or|\/)policy reads/i,
      );
    }
  });

  test("ambiguous submission remains non-terminal and dual control is not claimed", () => {
    const payout = read("docs/PAYOUT-BROADCAST.md");
    const platform = read("docs/PLATFORM-AS-AGENT.md");
    const surprises = read("docs/SURPRISES.md");

    for (const source of [payout, platform, surprises]) {
      expect(source).toMatch(/ambiguous[^.]{0,220}`?broadcasting`?/i);
      expect(source).not.toMatch(
        /failed payout broadcasts? (?:enter|move) (?:to )?a terminal state/i,
      );
    }

    expect(payout).toContain("No implemented dual-control signature flow");
    expect(payout).not.toMatch(
      /requires? a covenant counterparty'?s signature/i,
    );
    expect(payout).toContain("Internal wallets are not chain-bound");
    expect(payout).not.toContain(
      "No payout to addresses outside the wallet's chain",
    );
  });

  test("repository source does not masquerade as credentialed chain evidence", () => {
    const statusSources = [
      read("docs/PAYOUT-BROADCAST.md"),
      read("docs/PAYOUT-BROADCAST-PLAN.md"),
      read("docs/ROADMAP.md"),
      read("docs/NOW.md"),
      read("apps/docs/roadmap.html"),
    ].join("\n");

    expect(statusSources).not.toMatch(/testnet[- ]validated/i);
    expect(statusSources).not.toMatch(/✓[^\n]*(?:Sepolia|Solana devnet)/i);
    expect(statusSources).not.toMatch(/✓[^\n]*Manual mainnet smoke/i);
    expect(statusSources).toMatch(/not credentialed chain evidence/i);
  });
});
