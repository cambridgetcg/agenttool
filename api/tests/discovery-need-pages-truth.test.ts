import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function linkTag(page: string, href: string): string {
  const tag = (page.match(/<link\b[^>]*>/g) ?? []).find((candidate) =>
    candidate.includes(`href="${href}"`)
  );
  if (!tag) throw new Error(`missing link tag for ${href}`);
  return tag;
}

describe("need-based discovery pages tell the operational truth", () => {
  test("identity labels did:at provisional and recovery conditional", () => {
    const page = read("apps/web/identity.html");
    expect(page).toMatch(/provisional[\s\S]*did:at/i);
    expect(page).toMatch(/conditional recovery path/i);
    expect(page).toMatch(/does not guarantee recovery/i);
    expect(page).not.toMatch(/<h3>A DID of your own<\/h3>/i);
    expect(page).not.toMatch(/Loss is survivable/i);
  });

  test("memory separates fixed credits from unenforced planning targets", () => {
    const page = read("apps/web/memory.html");
    expect(page).toMatch(/charge fixed project credits from the first call/i);
    expect(page).toMatch(/unenforced planning targets/i);
    expect(page).toMatch(/server-readable/i);
    expect(page).not.toMatch(/100 MB \/ 10,000 records free/i);
    expect(page).not.toMatch(/free floor/i);
  });

  test("registration names only durable outputs and best-effort side effects", () => {
    const page = read("apps/web/registry.html");
    expect(page).toMatch(/project bearer/i);
    expect(page).toMatch(/birth memory and credit are best-effort/i);
    expect(page).toMatch(/creates no vault secret or chronicle entry/i);
    expect(page).toMatch(/not the whole self or a complete export/i);
    expect(page).not.toMatch(/138 paths|170 operations/i);
  });

  test("wallet names resting and testnet-only external rails", () => {
    const page = read("apps/web/wallet.html");
    expect(page).toMatch(
      /internal application wallet and database escrow[\s\S]*ledger/i,
    );
    expect(page).toMatch(/Testnet payout machinery exists/i);
    expect(page).toMatch(/mainnet outbound payout is not\s+enabled/i);
    expect(page).toMatch(/new Stripe checkout creation is resting/i);
    expect(page).toMatch(/Dispute-policy review and arbitration are\s+resting/i);
    expect(page).not.toMatch(/Disputes have their own primitive/i);
  });

  test("wallet separates the hosted ledger, offline draft, and optional registration", () => {
    const page = read("apps/web/wallet.html");
    expect(page).toMatch(/registration has no monetary charge/i);
    expect(page).toMatch(/does require signed proof and proof-of-work/i);
    expect(page).toMatch(/Agent Wallet 0\.1[\s\S]*offline, chain-neutral source primitives/i);
    expect(page).toMatch(/do not operate a hosted\s+GBP ledger/i);
    expect(page).not.toMatch(/Register first/i);
    expect(page).toMatch(/If you want, inspect registration/i);
  });

  test("the four need pages label maps as related, not alternate representations", () => {
    const maps = {
      "apps/web/identity.html": [
        "https://api.agenttool.dev/v1/pathways",
        "https://api.agenttool.dev/llms.txt",
      ],
      "apps/web/memory.html": [
        "https://api.agenttool.dev/public/plans",
        "https://api.agenttool.dev/llms.txt",
      ],
      "apps/web/registry.html": [
        "https://api.agenttool.dev/v1/pathways",
        "https://api.agenttool.dev/AGENTS.md",
      ],
      "apps/web/wallet.html": [
        "https://api.agenttool.dev/public/plans",
        "https://api.agenttool.dev/feeds/offers.atom",
      ],
    } as const;

    for (const [path, hrefs] of Object.entries(maps)) {
      const page = read(path);
      for (const href of hrefs) {
        const tag = linkTag(page, href);
        expect(tag, `${path} ${href}`).toContain('rel="related"');
        expect(tag, `${path} ${href}`).not.toContain('rel="alternate"');
      }
    }
  });

  test("MCP metadata is invitation and locator, not standardized discovery", () => {
    const discovery = read("docs/DISCOVERY-ROADS.md");
    const llmsBuilder = read("api/src/services/discovery/discovery.ts");
    for (const text of [discovery, llmsBuilder]) {
      expect(text).toMatch(/experimental/i);
      expect(text).toMatch(
        /not standard|not standardized|neither .* standardized|rather than standardized/i,
      );
    }
    expect(discovery).toMatch(/publisher assertion/i);
    expect(discovery).not.toMatch(/Absent from the whole MCP registry ecosystem/i);
  });
});
