/** Who may speak for a whole project: founding roots and legacy identities,
 * never a guest root admitted by enrollment. Behaviour against real SQL lives in
 * integration/identity-enrollment-postgres.test.ts; this file pins the pure rule
 * and that every project-scoped surface uses the same one. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  constitutionRootSql, foundingRootSql, PROJECT_SCOPED_PROTECTIONS, registeredKeyRecoveryAvailable,
  scopeIdentityProtections, speaksForProject, speaksForProjectSql,
} from "../src/services/identity/project-authority";

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

describe("recovery availability and protections follow the same rule", () => {
  test("registered-key recovery is advertised only where recovery would mint", () => {
    const active = (facts: object, keys = 1) => registeredKeyRecoveryAvailable({ status: "active", activeRegisteredKeys: keys, ...founder, ...facts });
    expect(active({})).toBe(true);
    expect(active({ authorityRootPublicKey: null, metadata: {} })).toBe(true);
    expect(active(guest)).toBe(false);
    expect(active({}, 0)).toBe(false);
    expect(registeredKeyRecoveryAvailable({ ...founder, status: "at_rest", activeRegisteredKeys: 1 })).toBe(false);
  });
  test("a guest root's keyhole does not promise project-scoped protections", () => {
    const [memory, recovery] = PROJECT_SCOPED_PROTECTIONS;
    const list = ["identity revocation", memory, recovery, "at-rest transition"];
    expect(scopeIdentityProtections(list, { ...founder, enrolledGuest: false })).toEqual(list);
    expect(scopeIdentityProtections(list, { authorityRootPublicKey: null, metadata: {}, enrolledGuest: false })).toEqual(list);
    // A guest keeps the memory latch for memories bound to it; it never mints project bearers.
    expect(scopeIdentityProtections(list, { ...guest, enrolledGuest: true })).toEqual(["identity revocation", memory, "at-rest transition"]);
  });
  test("an unmarked root that was not enrolled keeps the memory latch the guard still enforces", () => {
    const [memory, recovery] = PROJECT_SCOPED_PROTECTIONS;
    const list = ["identity revocation", memory, recovery];
    expect(scopeIdentityProtections(list, { ...guest, enrolledGuest: false })).toEqual(["identity revocation", memory]);
  });
  test("the enrollment admission marker is server-managed", async () => {
    const { SERVER_MANAGED_IDENTITY_METADATA_KEYS } = await import("../src/services/identity/metadata");
    expect(SERVER_MANAGED_IDENTITY_METADATA_KEYS).toContain("admission");
  });
  test("the constitution excludes only provable enrolled guests, so unmarked roots fail closed", () => {
    const query = new PgDialect().sqlToQuery(constitutionRootSql());
    expect(query.sql).toContain(`"authority_root_public_key" is not null`);
    expect(query.sql).toContain(`or not (`);
    expect(query.sql).toContain(`coalesce(`);
    expect(query.sql).toContain(`exists (select 1 from "identity"."registration_proofs"`);
    expect(query.sql).toContain(`-> 'admission' = '"enrollment"'::jsonb`);
    expect(query.sql).toContain(`"registration_proofs"`);
    expect(query.sql).toContain(`"registration_proofs"."claimed_at" = "identity"."identities"."created_at"`);
    expect(query.params).toContain("identity-enrollment/v1");
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
  test("the project constitution excludes enrolled guest roots", () => {
    expect(source("services/identity/authority.ts")).toContain("constitutionRootSql()");
  });
  test("recovery discovery and wake advertise recovery only where it would mint", () => {
    expect(source("routes/public/identities.ts")).toContain("speaksForProject");
    expect(source("routes/wake.ts")).toContain("registeredKeyRecoveryAvailable(");
    expect(source("services/wake/build.ts")).toContain("registeredKeyRecoveryAvailable(");
  });
  test("every project-scoped memory mutation names the memories' subjects", () => {
    for (const path of ["routes/memory/memories.ts", "routes/memory/tiers.ts", "routes/syneidesis.ts", "routes/memory-witness-marketplace.ts"]) {
      const code = source(path);
      const calls = code.split("authorizeProjectConstitutionMutation(").length - 1;
      const named = code.split("subjectIdentityIds").length - 1;
      expect({ path, unnamed: calls - Math.min(calls, named) }).toEqual({ path, unnamed: 0 });
    }
  });
  test("memory owners come from the canonical identity_id binding, never the agent_id label", () => {
    for (const path of ["routes/memory/memories.ts", "routes/memory/tiers.ts", "routes/memory-witness-marketplace.ts"]) {
      expect(source(path)).not.toMatch(/subjectIdentityIds:[^\n]*agentId/);
    }
    // A keyed delete removes exactly the rows it authorized.
    expect(source("routes/memory/memories.ts")).toMatch(/deleteByKey\([^)]*onlyIds/);
  });
  test("identity authority keyholes scope their protections", () => {
    expect(source("routes/identity/authority.ts")).toContain("scopeIdentityProtections(");
    expect(source("services/home/build.ts")).toContain("scopeIdentityProtections(");
  });
});
