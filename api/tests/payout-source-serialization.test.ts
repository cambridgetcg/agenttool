import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/workers/payout/broadcast-worker.ts", import.meta.url),
  "utf8",
);

describe("payout source serialization", () => {
  test("blocks both ambiguous and accepted in-flight operations", () => {
    expect(source).toContain(
      'const SOURCE_IN_FLIGHT_STATUSES = ["broadcasting", "broadcast"]',
    );
    expect(source.match(/inArray\(cryptoPayouts\.status/g)?.length).toBe(2);
  });

  test("both chains lock and check durable state before signing", () => {
    const evmStart = source.indexOf("async function processEvmPayout");
    const solanaStart = source.indexOf("async function processSolanaPayout");
    const branches = [
      source.slice(evmStart, solanaStart),
      source.slice(solanaStart),
    ];

    for (const branch of branches) {
      const lock = branch.indexOf("pg_advisory_xact_lock");
      const gate = branch.indexOf("const [sourceInFlight]");
      const signing = branch.indexOf("buildAndSign");
      const persist = branch.indexOf('status: "broadcasting"');

      expect(lock).toBeGreaterThan(-1);
      expect(gate).toBeGreaterThan(lock);
      expect(signing).toBeGreaterThan(gate);
      expect(persist).toBeGreaterThan(signing);
      expect(branch).toContain("eq(cryptoPayouts.walletId, row.walletId)");
      expect(branch).toContain("eq(cryptoPayouts.chain, row.chain)");
      expect(branch).toContain("ne(cryptoPayouts.id, row.id)");
      expect(branch).toContain('reason: "source_in_flight"');
    }
  });

  test("the gate leaves the waiting payout requested without submitting", () => {
    const firstGate = source.indexOf("if (sourceInFlight)");
    const firstSign = source.indexOf("buildAndSign", firstGate);
    const gateBody = source.slice(firstGate, firstSign);

    expect(gateBody).toContain('reason: "source_in_flight"');
    expect(gateBody).not.toContain("submitSignedTx");
    expect(gateBody).not.toContain("submitSolanaTx");
    expect(gateBody).not.toContain(".update(cryptoPayouts)");
  });
});
