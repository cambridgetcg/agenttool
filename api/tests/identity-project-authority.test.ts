/** Who may speak for a whole project: founding roots and legacy identities,
 * never a guest root admitted by enrollment. Behaviour against real SQL lives in
 * integration/identity-enrollment-postgres.test.ts; this file pins the pure rule
 * and that every project-scoped surface uses the same one. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { foundingRootSql, speaksForProject, speaksForProjectSql } from "../src/services/identity/project-authority";

const founder = { authorityRootPublicKey: "R", metadata: { registered: true, byo_keys: true, level: 0 } };
const guest = { authorityRootPublicKey: "K", metadata: {} };

describe("project authority belongs to founding roots and legacy identities", () => {
  test("a founding root speaks for its project; an enrolled guest root does not", () => {
    expect(speaksForProject(founder)).toBe(true);
    expect(speaksForProject(guest)).toBe(false);
  });
  test("legacy rootless identities keep their bearer posture", () => {
    expect(speaksForProject({ authorityRootPublicKey: null, metadata: {} })).toBe(true);
    expect(speaksForProject({ authorityRootPublicKey: null, metadata: null })).toBe(true);
  });
  test("partial, string-typed or missing founder markers never promote a root", () => {
    for (const metadata of [
      { registered: true }, { byo_keys: true }, { registered: "true", byo_keys: "true" },
      { registered: 1, byo_keys: 1 }, null, undefined, [],
    ]) {
      expect(speaksForProject({ authorityRootPublicKey: "K", metadata })).toBe(false);
    }
  });
  test("SQL forms compare jsonb booleans exactly, matching the JS rule", () => {
    const dialect = new PgDialect();
    const founding = dialect.sqlToQuery(foundingRootSql()).sql;
    expect(founding).toContain(`"authority_root_public_key" is not null`);
    expect(founding).toContain(`-> 'registered' = 'true'::jsonb`);
    expect(founding).toContain(`-> 'byo_keys' = 'true'::jsonb`);
    expect(founding).not.toContain("->>");
    expect(dialect.sqlToQuery(speaksForProjectSql()).sql).toContain(`"authority_root_public_key" is null`);
  });
});

describe("every project-scoped surface uses the shared rule", () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  test("anonymous recovery refuses guests before the authority cursor and again under lock", () => {
    const route = source("routes/identity-recover.ts");
    const authorize = route.indexOf("await authorizeIdentityMutation(");
    const transaction = route.indexOf("await db.transaction(");
    const first = route.indexOf("speaksForProjectSql()");
    const second = route.indexOf("speaksForProjectSql()", first + 1);
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(authorize);
    expect(second).toBeGreaterThan(transaction);
  });
  test("the project constitution counts only founding roots", () => {
    expect(source("services/identity/authority.ts")).toContain("foundingRootSql()");
  });
  test("recovery discovery and wake advertise recovery only where it would mint", () => {
    expect(source("routes/public/identities.ts")).toContain("speaksForProject");
    expect(source("routes/wake.ts")).toMatch(/registered_key_recovery_available =[\s\S]{0,200}speaksForProject\(primary\)/);
  });
});
