/** commitment/saga-is-free — structural source-level pin.
 *
 *  Doctrine: docs/SAGA.md · docs/RING-1.md.
 *  Canon: agenttool:commitment/saga-is-free.
 *
 *  The commitment is defended BY ABSENCE: no saga read surface may import a
 *  metering or settlement primitive. Reading the substrate's soap-opera, or
 *  any agent's saga, cannot debit credits, cannot move a wallet, and cannot
 *  return 402 — because no code path exists that could do it.
 *
 *  Added 2026-07-24. Until then `saga-is-free` was the one shipped canon
 *  commitment with no `@enforces` annotation anywhere in the tree, which is
 *  why `commitments-code-annotation-bijection.test.ts` was red — and that
 *  red was carried in `.failure-baseline.txt` rather than fixed. The
 *  commitment was in fact true the whole time; nothing was defending it.
 *
 *  NOTE ON SCOPE, kept honest: the canon entry used to claim `GET
 *  /public/saga` as a free unauthenticated surface. No such route is
 *  mounted — `api/src/index.ts` puts `authMiddleware` on `/v1/saga` and
 *  `/v1/sagas`, and there is no saga route under `/public`. The canon
 *  description was corrected in the same commit. Free is enforced here;
 *  public is not claimed. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "src");

const SAGA_ROUTE = join(SRC, "routes", "saga.ts");
const SAGAS_ROUTE = join(SRC, "routes", "sagas.ts");
const SAGA_SERVICE_DIR = join(SRC, "services", "saga");

const SAGA_ROUTE_SOURCE = readFileSync(SAGA_ROUTE, "utf8");
const SAGAS_ROUTE_SOURCE = readFileSync(SAGAS_ROUTE, "utf8");

const SAGA_SERVICE_FILES = readdirSync(SAGA_SERVICE_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => ({ name: `services/saga/${f}`, source: readFileSync(join(SAGA_SERVICE_DIR, f), "utf8") }));

const SURFACES = [
  { name: "routes/saga.ts", source: SAGA_ROUTE_SOURCE },
  { name: "routes/sagas.ts", source: SAGAS_ROUTE_SOURCE },
  ...SAGA_SERVICE_FILES,
];

/** Metering + settlement primitives. Importing any of these into a saga
 *  read surface is the only way saga could stop being free. */
const FORBIDDEN_IMPORTS = [
  "charge",
  "reserveCharge",
  "computeFee",
  "recordRevenue",
  "wallets",
  "platformRevenue",
];

/** Detect a real import (not a JSDoc mention) of a symbol. Same detector as
 *  wall-offerings-carry-no-take.test.ts — block comments stripped first, so
 *  a doc-string naming the symbol (as this file's siblings do) is not a hit. */
function importsSymbol(source: string, symbol: string): boolean {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const importStmt = new RegExp(
    `import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']`,
    "m",
  );
  return importStmt.test(stripped);
}

describe("commitment/saga-is-free — structural pin", () => {
  for (const surface of SURFACES) {
    for (const symbol of FORBIDDEN_IMPORTS) {
      test(`${surface.name} does NOT import ${symbol}`, () => {
        expect(
          importsSymbol(surface.source, symbol),
          `${surface.name} imports '${symbol}' — reading the saga is Ring 1. Canon: agenttool:commitment/saga-is-free.`,
        ).toBe(false);
      });
    }

    test(`${surface.name} does NOT import the economy schema`, () => {
      const stripped = surface.source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(
        /from\s+["'][^"']*db\/schema\/economy["']/.test(stripped),
        `${surface.name} imports db/schema/economy — that is where wallets and transactions live, and saga reads do not touch them.`,
      ).toBe(false);
    });

    test(`${surface.name} returns no 402`, () => {
      const stripped = surface.source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(
        /\b402\b/.test(stripped),
        `${surface.name} mentions status 402 outside a comment — a saga read must never demand payment.`,
      ).toBe(false);
    });
  }

  test("routes/saga.ts declares the @enforces annotation", () => {
    expect(SAGA_ROUTE_SOURCE).toMatch(
      /@enforces[^\n]*commitment\/saga-is-free/,
    );
  });

  test("the read-side joy-event write is fire-and-forget, never blocking", () => {
    // Reading a saga records a joy-event. If that insert were awaited on the
    // request path, a joy-table outage would turn a free read into a failed
    // read — free in price, unavailable in fact. `void` is the structure that
    // keeps the promise cheap.
    expect(SAGA_ROUTE_SOURCE).toMatch(/void\s+recordSagaRead\s*\(/);
  });
});
