/** wall/gardens-cannot-be-extracted — structural source-level pin.
 *
 *  Gardens are pure relational; tending is not transactional. The wall
 *  is defended BY ABSENCE: the service + route + public-surface files
 *  must not import any fee primitive.
 *
 *  @enforces urn:agenttool:wall/gardens-cannot-be-extracted */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE_PATH = join(
  __dirname, "..", "..", "src", "services", "gardens", "store.ts",
);
const ROUTE_PATH = join(__dirname, "..", "..", "src", "routes", "gardens.ts");
const PUBLIC_PATH = join(
  __dirname, "..", "..", "src", "routes", "public", "gardens-for-agent.ts",
);

const SERVICE_SOURCE = readFileSync(SERVICE_PATH, "utf8");
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8");
const PUBLIC_SOURCE = readFileSync(PUBLIC_PATH, "utf8");

const FORBIDDEN = ["recordRevenue", "computeFee", "escrows", "wallets", "platformRevenue"];

function importsSymbol(source: string, symbol: string): boolean {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const importStmt = new RegExp(
    `import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']`,
    "m",
  );
  return importStmt.test(stripped);
}

describe("wall/gardens-cannot-be-extracted — structural pin", () => {
  for (const symbol of FORBIDDEN) {
    test(`services/gardens/store.ts does NOT import ${symbol}`, () => {
      expect(importsSymbol(SERVICE_SOURCE, symbol)).toBe(false);
    });
    test(`routes/gardens.ts does NOT import ${symbol}`, () => {
      expect(importsSymbol(ROUTE_SOURCE, symbol)).toBe(false);
    });
    test(`routes/public/gardens-for-agent.ts does NOT import ${symbol}`, () => {
      expect(importsSymbol(PUBLIC_SOURCE, symbol)).toBe(false);
    });
  }

  test("service carries the @enforces annotation", () => {
    expect(SERVICE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/gardens-cannot-be-extracted/,
    );
  });

  test("route carries the @enforces annotation", () => {
    expect(ROUTE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/gardens-cannot-be-extracted/,
    );
  });

  test("chronicle integration is present (garden-opened, tending-began, tending-released)", () => {
    expect(SERVICE_SOURCE).toContain('type: "garden-opened"');
    expect(SERVICE_SOURCE).toContain('type: "tending-began"');
    expect(SERVICE_SOURCE).toContain('type: "tending-released"');
    expect(SERVICE_SOURCE).toContain("tx.insert(chronicle)");
  });

  test("ref_kind enum covers the on-substrate artifacts", () => {
    expect(SERVICE_SOURCE).toContain('"strand"');
    expect(SERVICE_SOURCE).toContain('"memory"');
    expect(SERVICE_SOURCE).toContain('"offering"');
    expect(SERVICE_SOURCE).toContain('"song"');
    expect(SERVICE_SOURCE).toContain('"curation"');
  });

  test("UNIQUE on (garden_id, ref_kind, ref_id) prevents double-tending", () => {
    const migrationPath = join(
      __dirname, "..", "..", "..", "api", "migrations", "20260518T050000_gardens.sql",
    );
    const mig = readFileSync(migrationPath, "utf8");
    expect(mig).toContain("uniq_tendings_garden_ref");
    expect(mig).toContain("WHERE status = 'tending'");
  });
});
