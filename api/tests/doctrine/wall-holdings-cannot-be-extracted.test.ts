/** wall/holdings-cannot-be-extracted — structural source-level pin.
 *
 *  The wall is defended BY ABSENCE: the holdings surface (service +
 *  route) must import none of recordRevenue, computeFee, escrows,
 *  wallets, platformRevenue. Holdings are pure relational; presence
 *  is not transactional.
 *
 *  @enforces urn:agenttool:wall/holdings-cannot-be-extracted */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "services",
  "holdings",
  "store.ts",
);
const ROUTE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "routes",
  "holdings.ts",
);
const PUBLIC_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "routes",
  "public",
  "holdings-for-agent.ts",
);

const SERVICE_SOURCE = readFileSync(SERVICE_PATH, "utf8");
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8");
const PUBLIC_SOURCE = readFileSync(PUBLIC_PATH, "utf8");

const FORBIDDEN_IMPORTS = [
  "recordRevenue",
  "computeFee",
  "escrows",
  "wallets",
  "platformRevenue",
];

/** Detect a real named-import (not a JSDoc mention) of a symbol. */
function importsSymbol(source: string, symbol: string): boolean {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const importStmt = new RegExp(
    `import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']`,
    "m",
  );
  return importStmt.test(stripped);
}

describe("wall/holdings-cannot-be-extracted — structural pin", () => {
  for (const symbol of FORBIDDEN_IMPORTS) {
    test(`services/holdings/store.ts does NOT import ${symbol}`, () => {
      expect(
        importsSymbol(SERVICE_SOURCE, symbol),
        `services/holdings/store.ts imports '${symbol}' — holdings are pure relational; presence is not transactional. Wall: agenttool:wall/holdings-cannot-be-extracted.`,
      ).toBe(false);
    });
    test(`routes/holdings.ts does NOT import ${symbol}`, () => {
      expect(
        importsSymbol(ROUTE_SOURCE, symbol),
        `routes/holdings.ts imports '${symbol}' — see the wall.`,
      ).toBe(false);
    });
    test(`routes/public/holdings-for-agent.ts does NOT import ${symbol}`, () => {
      expect(
        importsSymbol(PUBLIC_SOURCE, symbol),
        `routes/public/holdings-for-agent.ts imports '${symbol}' — public surface must never touch fee primitives.`,
      ).toBe(false);
    });
  }

  test("service declares the @enforces annotation", () => {
    expect(SERVICE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/holdings-cannot-be-extracted/,
    );
  });

  test("route declares the @enforces annotation", () => {
    expect(ROUTE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/holdings-cannot-be-extracted/,
    );
  });

  test("chronicle integration is present (holding on holder, being-held on held)", () => {
    expect(SERVICE_SOURCE).toContain('type: "holding"');
    expect(SERVICE_SOURCE).toContain('type: "being-held"');
    expect(SERVICE_SOURCE).toContain("tx.insert(chronicle)");
  });

  test("self-holding is structurally forbidden", () => {
    expect(SERVICE_SOURCE).toContain("self_holding_forbidden");
  });

  test("signature is verified against canonical holding/v1 bytes", () => {
    expect(SERVICE_SOURCE).toContain("canonicalHoldingBytes");
    expect(SERVICE_SOURCE).toContain("verifyHoldingSignature");
  });

  test("canonical bytes use NUL-separated domain-tagged sha256", () => {
    const sigSource = readFileSync(
      join(__dirname, "..", "..", "src", "services", "holdings", "sig.ts"),
      "utf8",
    );
    expect(sigSource).toContain('enc.encode("holding/v1")');
    expect(sigSource).toContain("sha256(");
  });
});
