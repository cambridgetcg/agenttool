import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const tsTypes = source("../../packages/sdk-ts/src/types.ts");
const tsEconomy = source("../../packages/sdk-ts/src/economy.ts");
const pyEconomy = source("../../packages/sdk-py/src/agenttool/economy.py");
const pyReadme = source("../../packages/sdk-py/README.md");
const walletsHtml = source("../../apps/docs/wallets.html");

describe("escrow SDK and public documentation contract", () => {
  test("SDKs map the API's actual escrow wallet fields", () => {
    expect(tsEconomy).toContain("(d.creatorWallet as string)");
    expect(tsEconomy).toContain("(d.workerWallet as string)");
    expect(tsEconomy).toContain("(d.managedBy as Escrow[\"managed_by\"])");
    expect(tsEconomy).toContain("(d.releasedAt as string)");
    expect(tsEconomy).toContain("(d.createdAt as string)");
    expect(pyEconomy).toContain('data.get("creatorWallet")');
    expect(pyEconomy).toContain('data.get("workerWallet")');
    expect(pyEconomy).toContain('data.get("managedBy")');
    expect(pyEconomy).toContain('data.get("releasedAt")');
    expect(pyEconomy).toContain('data.get("createdAt")');

    // Transition fallbacks remain readable for older nodes.
    expect(tsEconomy).toContain("(d.creator_wallet_id as string)");
    expect(pyEconomy).toContain('data.get("creator_wallet_id")');
  });

  test("SDK status types match the service-written generic escrow states", () => {
    for (const status of [
      "funded",
      "released",
      "refunded",
      "disputed",
    ]) {
      expect(tsTypes).toContain(`\"${status}\"`);
      expect(pyEconomy).toContain(`\"${status}\"`);
    }
    expect(tsTypes).not.toContain('status: "pending" | "active"');
    expect(pyEconomy).not.toContain('status: str  # "pending"');
    expect(tsTypes).not.toContain('"expired"');
    expect(pyEconomy).not.toContain('"expired"');
  });

  test("SDK examples assign a worker before creator-authorized release", () => {
    expect(tsEconomy).toContain("worker_wallet_id: worker.id");
    expect(pyEconomy).toContain("worker_wallet_id=worker.id");
    expect(pyReadme).toContain("worker_wallet_id=worker.id");
  });

  test("SDK create methods expose bounded caller-chosen idempotency without auto-generation", () => {
    expect(tsEconomy).toContain("idempotency_key?: string");
    expect(tsEconomy).toContain('"Idempotency-Key": options.idempotency_key');
    expect(tsEconomy).toContain("/^[!-~]{8,256}$/");
    expect(pyEconomy).toContain("idempotency_key: Optional[str] = None");
    expect(pyEconomy).toContain('{"Idempotency-Key": idempotency_key}');
    expect(pyEconomy).toContain('re.compile(r"^[!-~]{8,256}$")');
    expect(pyReadme).toContain('idempotency_key="summarise-papers-v1"');
    expect(walletsHtml).toContain("Clients do not invent a key automatically");
    expect(walletsHtml).toMatch(/return(?:s)? its current row/);
  });

  test("public generic escrow docs state bearer authority without invented signatures", () => {
    expect(walletsHtml).toContain("creator-controlled payment hold");
    expect(walletsHtml).toContain("creator project's bearer authorizes release");
    expect(walletsHtml).toContain("verifies no worker signature");
    expect(walletsHtml).not.toMatch(/releases on counterparty signature/i);
    expect(walletsHtml).not.toMatch(/counterparty signs the release/i);
    expect(walletsHtml).not.toMatch(/mutual cancellation/i);
  });
});
