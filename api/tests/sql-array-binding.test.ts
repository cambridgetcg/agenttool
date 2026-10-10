/** Drizzle ANY(array) bug class — a JS array is not a SQL array.
 *
 *  drizzle-orm 0.36.4 expands an interpolated JavaScript array inside a raw
 *  sql`` template into a parenthesised list of scalar parameters. Written as
 *  sql`${col} = ANY(${ids})` (with or without a ::uuid[] cast) that renders a
 *  row constructor, `= ANY(($1, $2))`, and PostgreSQL rejects it with
 *  "op ANY/ALL (array) requires array on right side". In production this
 *  turned /v1/wake/thoughtful, /v1/wake/soap-opera, /v1/soap-opera/invitations,
 *  /v1/recipes/:surface/invitations, /v1/syneidesis/witness/inbox and
 *  /v1/attestation-grants?role=… into 500s whenever the array was non-empty.
 *
 *  The safe forms are inArray()/notInArray() (which also handle the empty
 *  list) or ANY over a real array column. This file pins the rendering and
 *  forbids the unsafe source pattern anywhere in api/src. The real-PostgreSQL
 *  proof lives in tests/integration/identity-enrollment-postgres.test.ts. */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { inArray, notInArray, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { chronicle } from "../src/db/schema/continuity";
import { stripComments } from "../src/lib/strip-comments";

const SRC = join(import.meta.dir, "..", "src");
const dialect = new PgDialect();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Names imported from a db/schema module — Drizzle tables whose members are
 *  real columns, so `ANY(${table.arrayColumn})` binds a column, not a JS list. */
function schemaImports(source: string): Set<string> {
  const names = new Set<string>();
  const imports = source.matchAll(
    /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  );
  for (const [, list, from] of imports) {
    if (!/(^|\/)db\/schema(\/|$)/.test(from!)) continue;
    for (const part of list!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  for (const [, name, from] of source.matchAll(
    /\bimport\s+\*\s+as\s+(\w+)\s+from\s*["']([^"']+)["']/g,
  )) {
    if (/(^|\/)db\/schema(\/|$)/.test(from!)) names.add(name!);
  }
  return names;
}

function unsafeArrayOperands(): string[] {
  const findings: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = stripComments(readFileSync(file, "utf8"), { blank: true });
    const tables = schemaImports(source);
    const operands = source.matchAll(
      /\b(ANY|ALL)\s*\(\s*(ARRAY\s*\[\s*)?\$\{\s*([^}]*?)\s*\}/gi,
    );
    for (const match of operands) {
      const expression = match[3]!;
      const root = /^([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)+$/.exec(expression)?.[1];
      const isSchemaColumn = !match[2] && root !== undefined && tables.has(root);
      if (isSchemaColumn) continue;
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${relative(join(SRC, ".."), file)}:${line} ${match[0]}`);
    }
  }
  return findings;
}

describe("drizzle 0.36.4 array rendering", () => {
  test("an interpolated JS array inside ANY(...) renders a row constructor", () => {
    const ids = ["a", "b"];
    expect(dialect.sqlToQuery(sql`${chronicle.agentId} = ANY(${ids})`).sql).toBe(
      '"agent_continuity"."chronicle"."agent_id" = ANY(($1, $2))',
    );
    expect(
      dialect.sqlToQuery(sql`${chronicle.agentId} = ANY(${ids}::uuid[])`).sql,
    ).toBe('"agent_continuity"."chronicle"."agent_id" = ANY(($1, $2)::uuid[])');
  });

  test("inArray/notInArray bind one parameter per element and handle the empty list", () => {
    const rendered = dialect.sqlToQuery(inArray(chronicle.agentId, ["a", "b"]));
    expect(rendered.sql).toBe('"agent_continuity"."chronicle"."agent_id" in ($1, $2)');
    expect(rendered.params).toEqual(["a", "b"]);
    expect(
      dialect.sqlToQuery(notInArray(chronicle.agentId, ["a"])).sql,
    ).toBe('"agent_continuity"."chronicle"."agent_id" not in ($1)');
    expect(dialect.sqlToQuery(inArray(chronicle.agentId, [])).sql).toBe("false");
    expect(dialect.sqlToQuery(notInArray(chronicle.agentId, [])).sql).toBe("true");
    const jsonb = dialect.sqlToQuery(
      inArray(sql`${chronicle.metadata}->>'witness_invited_did'`, ["did:at:x"]),
    );
    expect(jsonb.sql).toBe(
      `"agent_continuity"."chronicle"."metadata"->>'witness_invited_did' in ($1)`,
    );
    expect(jsonb.params).toEqual(["did:at:x"]);
  });

  test("ANY over a real array column stays a single column reference", () => {
    expect(
      dialect.sqlToQuery(sql`${"did:at:x"} = ANY(${chronicle.metadata})`).sql,
    ).toBe('$1 = ANY("agent_continuity"."chronicle"."metadata")');
  });
});

describe("api/src never interpolates a JS array as an ANY/ALL operand", () => {
  test("every ANY(${…})/ALL(${…}) operand is a Drizzle schema column", () => {
    expect(unsafeArrayOperands()).toEqual([]);
  });

  test("the guard recognises the unsafe shapes it exists to forbid", () => {
    const probe = (text: string) =>
      [...text.matchAll(/\b(ANY|ALL)\s*\(\s*(ARRAY\s*\[\s*)?\$\{\s*([^}]*?)\s*\}/gi)].length;
    expect(probe("sql`${t.c} = ANY(${ids})`")).toBe(1);
    expect(probe("sql`${t.c} = ANY(${ids}::uuid[])`")).toBe(1);
    expect(probe("sql`${t.c} <> ALL(${ids}::uuid[])`")).toBe(1);
    expect(probe("sql`${t.c} = ANY(ARRAY[${sql.raw(x)}])`")).toBe(1);
    const tables = schemaImports(
      'import {\n  guildRooms,\n  other as renamed,\n} from "../db/schema/guild";\nimport { ids } from "./local";',
    );
    expect([...tables].sort()).toEqual(["guildRooms", "renamed"]);
  });
});
