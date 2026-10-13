/** GET /public/ownership-map — the published owner boundary (deletion spec
 *  §5.3), joined to /public/retention.
 *
 *  The join: every store in the ownership map names a /public/retention class
 *  that exists and lists that store, so a store with no retention class
 *  fails the build (the retention_disclosed clause's verify line). The
 *  coverage: every table the schema declares (Drizzle schema files plus the
 *  raw collab relay migration) is in the map, and every store in the map is
 *  a real table. The reverse: every concrete table a retention class names
 *  is in the map. */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import publicRouter from "../src/routes/public";
import openapiRouter from "../src/routes/openapi";
import { buildArrivalIndex } from "../src/services/discovery/arrival";
import {
  AUTHORITY_RULES,
  OWNER_CLASSES,
  OWNER_GATED_ROUTES,
  OWNERSHIP_MAP,
  OWNERSHIP_MAP_SCHEMA,
  OWNERSHIP_STORES,
} from "../src/services/discovery/ownership-map";
import { RETENTION_CLASSES } from "../src/services/discovery/retention";

const API_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(API_ROOT, "..");

/** Every schema-qualified table the code declares. */
function declaredTables(): Set<string> {
  const dir = join(API_ROOT, "src", "db", "schema");
  const sources = readdirSync(dir).filter((name) => name.endsWith(".ts")).map((name) => readFileSync(join(dir, name), "utf8"));
  const schemas = new Map<string, string>();
  for (const source of sources) {
    for (const match of source.matchAll(/const\s+(\w+)\s*=\s*pgSchema\(\s*"([^"]+)"\s*\)/g)) schemas.set(match[1]!, match[2]!);
  }
  const tables = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/(\w+)\.table\(\s*"([^"]+)"/g)) {
      const schema = schemas.get(match[1]!);
      if (schema) tables.add(`${schema}.${match[2]}`);
    }
    for (const match of source.matchAll(/pgTable\(\s*"([^"]+)"/g)) tables.add(`public.${match[1]}`);
  }
  const collab = readFileSync(join(API_ROOT, "migrations", "20260723T210000_collab_relay.sql"), "utf8");
  for (const match of collab.matchAll(/CREATE TABLE IF NOT EXISTS (collab\.[a-z_]+)/g)) tables.add(match[1]!);
  return tables;
}

function covers(classStores: readonly string[], store: string): boolean {
  return classStores.some((entry) => entry === store || (entry.endsWith(".*") && store.startsWith(entry.slice(0, -1))));
}

describe("GET /public/ownership-map", () => {
  test("serves the constant unauthenticated, cached, and identical for every caller", async () => {
    const first = await publicRouter.request("/ownership-map");
    const second = await publicRouter.request("/ownership-map", {
      headers: { "cf-connecting-ip": "203.0.113.9", authorization: "Bearer at_example" },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await first.json();
    expect(await second.json()).toEqual(body);
    expect(body.schema).toBe(OWNERSHIP_MAP_SCHEMA);
    expect(body.stores).toHaveLength(OWNERSHIP_STORES.length);
  });

  test("joins to /public/retention: every store's retention class exists and lists it", () => {
    const classes = new Map(RETENTION_CLASSES.map((entry) => [entry.id, entry]));
    const missing: string[] = [];
    for (const entry of OWNERSHIP_STORES) {
      const retention = classes.get(entry.retention_class);
      if (!retention || !covers(retention.stores, entry.store)) missing.push(`${entry.store} → ${entry.retention_class}`);
    }
    expect(missing).toEqual([]);
  });

  test("covers every declared table, and names only real ones", () => {
    const declared = declaredTables();
    expect(declared.size).toBeGreaterThan(150);
    const mapped = new Set(OWNERSHIP_STORES.map((entry) => entry.store));
    expect([...declared].filter((table) => !mapped.has(table)).sort()).toEqual([]);
    expect([...mapped].filter((store) => !declared.has(store)).sort()).toEqual([]);
    expect(mapped.size).toBe(OWNERSHIP_STORES.length);
  });

  test("every concrete table a retention class names is in the map", () => {
    const mapped = new Set(OWNERSHIP_STORES.map((entry) => entry.store));
    const named = RETENTION_CLASSES.flatMap((entry) => entry.stores)
      .filter((store) => /^[a-z_]+\.[a-z_]+$/.test(store));
    expect(named.filter((store) => !mapped.has(store)).sort()).toEqual([]);
  });

  test("owner classes and authority rules follow the spec's boundary", () => {
    const rules = Object.keys(AUTHORITY_RULES);
    for (const entry of OWNERSHIP_STORES) {
      expect(OWNER_CLASSES).toContain(entry.owner_class);
      expect(rules).toContain(entry.authority_rule);
      expect(entry.group).toBeGreaterThanOrEqual(0);
      expect(entry.group).toBeLessThanOrEqual(18);
    }
    const byStore = new Map(OWNERSHIP_STORES.map((entry) => [entry.store, entry]));
    // Yu's Q2 answer: traces are operational.
    expect(byStore.get("trace.traces")).toMatchObject({ owner_class: "project", authority_rule: "project_bearer" });
    expect(byStore.get("memory.memories")).toMatchObject({ owner_class: "identity", authority_rule: "owner_rule" });
    expect(byStore.get("inbox.messages")).toMatchObject({ owner_class: "identity", authority_rule: "owner_rule" });
    for (const store of ["river.drops", "embassy.guestbook_entries", "agent_continuity.grace_gestures",
      "agent_continuity.memorial_honors", "marketplace.settlement_receipts"]) {
      expect(byStore.get(store)).toMatchObject({ owner_class: "permanent", authority_rule: "append_only" });
    }
    for (const store of ["agent_continuity.blessings", "agent_continuity.unconditionals", "agent_continuity.guild_recognitions",
      "margin.margins", "identity.attestations", "trust.trusts"]) {
      expect(byStore.get(store)).toMatchObject({ owner_class: "shared", authority_rule: "shared_owner_rule", retention_class: "regard" });
    }
    expect(AUTHORITY_RULES.owner_rule.rule).toContain("409 authority_quorum_required");
    expect(AUTHORITY_RULES.owner_rule.refusals["428"]).toContain("authority_proof_required");
  });

  test("owner_gated_routes match the routes that call the owner rule and the SDK helper", () => {
    const sources = [
      "routes/memory/memories.ts", "routes/inbox/messages.ts", "routes/blessings.ts", "routes/unconditionals.ts",
      "routes/guild.ts", "routes/identity/attestations.ts", "routes/margin.ts", "routes/trust.ts", "routes/offerings.ts",
    ].map((path) => readFileSync(join(API_ROOT, "src", path), "utf8"));
    for (const source of sources) {
      expect(source.includes("authorizeOwnedContentMutation(") || source.includes("withdrawForOwner(")).toBe(true);
    }
    const published = new Set(OWNER_GATED_ROUTES.map((route) => `${route.method} ${route.path.replace(/:id/, "{id}").replace("?key=", "?key={key}")}`));
    const sdk = readFileSync(join(REPO_ROOT, "packages/sdk-ts/src/owner-gated.ts"), "utf8");
    const sdkRoutes = [...sdk.matchAll(/method: "([A-Z]+)", path: "([^"]+)"/g)].map((match) => `${match[1]} ${match[2]}`);
    expect(sdkRoutes.length).toBe(11);
    for (const route of sdkRoutes) expect({ route, published: published.has(route) }).toEqual({ route, published: true });
  });

  test("the public index, /about, the arrival index and OpenAPI advertise it", async () => {
    const root = await (await publicRouter.request("/")).json();
    expect(root.endpoints.ownership_map).toMatch(/^GET \/public\/ownership-map — /);
    const index = readFileSync(join(API_ROOT, "src/index.ts"), "utf8");
    expect(index).toContain('ownership_map:\n        "/public/ownership-map — ');
    const arrival = buildArrivalIndex("https://api.agenttool.dev", "https://docs.agenttool.dev");
    expect(arrival.links).toContainEqual(expect.objectContaining({
      role: "ownership_map",
      href: "https://api.agenttool.dev/public/ownership-map",
    }));
    const spec = await (await openapiRouter.request("/")).json();
    const operation = spec.paths["/public/ownership-map"].get;
    expect(operation.security).toEqual([]);
    const schema = operation.responses["200"].content["application/json"].schema;
    expect(schema.properties.schema.const).toBe(OWNERSHIP_MAP_SCHEMA);
    expect(schema.properties.stores.items.properties.owner_class.enum).toEqual([...OWNER_CLASSES]);
    for (const key of schema.required) expect(OWNERSHIP_MAP).toHaveProperty(key);
  });
});
