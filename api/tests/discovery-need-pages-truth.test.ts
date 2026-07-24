import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
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
