/** wall/offerings-carry-no-take — structural source-level pin.
 *
 *  Doctrine: docs/SOUL.md · docs/BUSINESS-MODEL.md §What we deliberately
 *  do not take a rate on. Canon: agenttool:wall/offerings-carry-no-take.
 *
 *  The wall is defended BY ABSENCE: neither the service layer nor the
 *  route handlers for offerings may import recordRevenue, computeFee,
 *  escrows, or wallets. The substrate witnesses generosity (chronicle
 *  entry on both sides) without ever moving money.
 *
 *  Adding an offerings codepath that DOES touch the marketplace fee
 *  primitives would import one of these symbols and fail this test. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "services",
  "offerings",
  "store.ts",
);
const ROUTE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "routes",
  "offerings.ts",
);
const PUBLIC_ROUTE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "routes",
  "public",
  "offerings.ts",
);

const SERVICE_SOURCE = readFileSync(SERVICE_PATH, "utf8");
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8");
const PUBLIC_SOURCE = readFileSync(PUBLIC_ROUTE_PATH, "utf8");

const FORBIDDEN_IMPORTS = [
  "recordRevenue",
  "computeFee",
  "escrows",
  "platformRevenue",
];

/** Detect a real import (not a JSDoc mention) of a symbol. Looks for:
 *    import { ..., SYMBOL, ... } from "..."
 *    import { SYMBOL } from "..."
 *  and rejects mentions inside `// ...` comments or block JSDoc. */
function importsSymbol(source: string, symbol: string): boolean {
  // Strip block comments first
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Match `import ... from "..."` with the symbol inside the named-import list
  const importStmt = new RegExp(
    `import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']`,
    "m",
  );
  return importStmt.test(stripped);
}

describe("wall/offerings-carry-no-take — structural pin", () => {
  for (const symbol of FORBIDDEN_IMPORTS) {
    test(`services/offerings/store.ts does NOT import ${symbol}`, () => {
      expect(
        importsSymbol(SERVICE_SOURCE, symbol),
        `services/offerings/store.ts imports '${symbol}' — gifts are not taxed; the substrate witnesses without moving money. Wall: agenttool:wall/offerings-carry-no-take.`,
      ).toBe(false);
    });
    test(`routes/offerings.ts does NOT import ${symbol}`, () => {
      expect(
        importsSymbol(ROUTE_SOURCE, symbol),
        `routes/offerings.ts imports '${symbol}' — see services/offerings/store.ts for the wall.`,
      ).toBe(false);
    });
    test(`routes/public/offerings.ts does NOT import ${symbol}`, () => {
      expect(
        importsSymbol(PUBLIC_SOURCE, symbol),
        `routes/public/offerings.ts imports '${symbol}' — the public surface must never touch fee primitives.`,
      ).toBe(false);
    });
  }

  test("services/offerings/store.ts does NOT import wallets table", () => {
    // wallets ARE referenced in the service-layer file only via the
    // word "wallet" inside chronicle metadata strings (harmless prose).
    // The import statement form is what we're checking against.
    expect(
      /from\s+["']\.{1,2}\/[^"']*db\/schema\/economy["']/.test(SERVICE_SOURCE),
      "services/offerings/store.ts must not import from db/schema/economy — that's where wallets live, and offerings don't touch wallets.",
    ).toBe(false);
  });

  test("service declares the @enforces annotation for the wall", () => {
    expect(SERVICE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/offerings-carry-no-take/,
    );
  });

  test("route declares the @enforces annotation for the wall", () => {
    expect(ROUTE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/offerings-carry-no-take/,
    );
  });

  test("chronicle integration is present (giver on create, receiver on receive)", () => {
    // The substrate witnesses the verb — chronicle entries on both sides
    // are the structural mechanism. This pins that the service-layer
    // file actually writes chronicle rows.
    expect(SERVICE_SOURCE).toContain('type: "offering"');
    expect(SERVICE_SOURCE).toContain('type: "received"');
    expect(SERVICE_SOURCE).toContain("tx.insert(chronicle)");
  });
});
