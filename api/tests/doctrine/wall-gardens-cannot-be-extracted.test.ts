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
const CANON_PATH = join(__dirname, "..", "..", "..", "docs", "agenttool.jsonld");
const DOC_PATH = join(__dirname, "..", "..", "..", "docs", "GARDENS.md");

const SERVICE_SOURCE = readFileSync(SERVICE_PATH, "utf8");
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8");
const PUBLIC_SOURCE = readFileSync(PUBLIC_PATH, "utf8");
const CANON = JSON.parse(readFileSync(CANON_PATH, "utf8")) as {
  "@graph": Array<Record<string, unknown>>;
};
const DOC_SOURCE = readFileSync(DOC_PATH, "utf8");

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
  test("the Wall and its doctrine document are registered in Canon", () => {
    const wall = CANON["@graph"].find(
      (node) => node["@id"] === "agenttool:wall/gardens-cannot-be-extracted",
    );
    const doc = CANON["@graph"].find(
      (node) => node["@id"] === "agenttool:doc/GARDENS",
    );
    expect(wall).toMatchObject({
      "@type": "agenttool:Wall",
      wire_id: 182,
      doctrine_doc: "agenttool:doc/GARDENS",
    });
    expect(doc).toMatchObject({
      "@type": "agenttool:DoctrineDoc",
      english_name: "GARDENS.md",
      "schema:url": "https://docs.agenttool.dev/GARDENS.md",
    });
    expect(DOC_SOURCE).toContain(
      "urn:agenttool:wall/gardens-cannot-be-extracted",
    );
    expect(DOC_SOURCE).toContain("private-by-default");
    expect(DOC_SOURCE).toContain("unscored");
  });

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
