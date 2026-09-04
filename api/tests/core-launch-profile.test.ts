/** The finite core profile is a source contract, not a deployment receipt.
 * Check its closed schema, source mounts, OpenAPI references and examples.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Hono } from "hono";
import ts from "typescript";

import profile from "../../docs/specs/agenttool-core-launch-v0.1.json";
import profileSchema from "../../docs/specs/agenttool-core-launch-v0.1.schema.json";
import { ROUTE_CREDITS } from "../src/billing/route-credits";
import openapiRouter from "../src/routes/openapi";
import { searchSchema } from "../src/routes/memory/search";
import { buildApiCatalog } from "../src/services/discovery/api-catalog";
import { buildDiscoveryCompass } from "../src/services/discovery/compass";

const ROOT = resolve(import.meta.dir, "../..");
const basename = "agenttool-core-launch-v0.1";
const API = "https://api.agenttool.dev";
const DOCS = "https://docs.agenttool.dev";
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateProfile = ajv.compile(profileSchema);

type Route = { method: string; path: string };
const normalize = (path: string) => path.replace(/\{[^}]+\}|:\w+/g, ":parameter");
const append = (prefix: string, path: string) => `${prefix}/${path}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";

/** Expand only branches which could contain a selected operation. Read the
 * actual imports/mounts; never import the server or invoke domain handlers.
 * All selected leaf routers use an app binding, including the search factory.
 */
function mountedOperations(file: string, prefix = ""): Route[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const imports = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.name || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const stem = resolve(dirname(file), statement.moduleSpecifier.text);
    const target = [stem + ".ts", join(stem, "index.ts")].find(existsSync);
    if (target) imports.set(statement.importClause.name.text, target);
  }
  const out: Route[] = [];
  const relevant = (path: string) => profile.operations.some((op) => op.path === path || op.path.startsWith(path + "/"));
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(sf) === "app") {
      const kind = node.expression.name.text;
      const [first, second] = node.arguments;
      if (kind === "route" && first && ts.isStringLiteral(first) && second && ts.isIdentifier(second)) {
        const path = append(prefix, first.text);
        const target = imports.get(second.text);
        if (target && (path === "/" || relevant(path))) out.push(...mountedOperations(target, path));
      } else if (["get", "post", "head"].includes(kind) && first && ts.isStringLiteral(first)) {
        out.push({ method: kind.toUpperCase(), path: append(prefix, first.text) });
      } else if (kind === "on" && first && ts.isArrayLiteralExpression(first) && second && ts.isStringLiteral(second)) {
        for (const method of first.elements) if (ts.isStringLiteral(method)) out.push({ method: method.text, path: append(prefix, second.text) });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);
  return out;
}

function pointer(document: any, reference: string): any {
  return decodeURIComponent(new URL(reference).hash.slice(2)).split("/").reduce((value, key) => value?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], document);
}

describe("finite core launch profile", () => {
  test("validates its closed schema and exact published mirror", () => {
    expect(validateProfile(profile), JSON.stringify(validateProfile.errors)).toBe(true);
    for (const suffix of [".json", ".schema.json"]) {
      expect(readFileSync(join(ROOT, "apps/docs/specs", basename + suffix), "utf8")).toBe(
        readFileSync(join(ROOT, "docs/specs", basename + suffix), "utf8"),
      );
    }
    for (const mutate of [
      (p: any) => { p.execute = true; },
      (p: any) => { p.source.production_verification = "passed"; },
      (p: any) => { p.operations[0].availability.state = "globally_live"; },
      (p: any) => { p.operations[0].authentication.bearer = "fixture"; },
      (p: any) => { p.operations[0].retry.automatic = true; },
      (p: any) => { p.operations[1] = structuredClone(p.operations[0]); },
    ]) {
      const changed = structuredClone(profile);
      mutate(changed);
      expect(validateProfile(changed)).toBe(false);
    }
  });

  test("catalog exposes the finite profile while discovery keeps exactly three roads", () => {
    const membership = buildApiCatalog(API, DOCS).linkset[0]!;
    expect(membership["service-meta"]?.find((entry) => entry.href === `${DOCS}/specs/${basename}.json`)).toMatchObject({ type: "application/json" });
    expect(buildDiscoveryCompass(API, DOCS).roads.map((road) => road.id)).toEqual(["understand", "inspect", "choose"]);
    expect(profile.operations).toHaveLength(10);
    const ids = new Set(profile.operations.map((op) => op.id));
    for (const id of [...profile.journeys.first_memory, ...profile.journeys.return]) expect(ids.has(id)).toBe(true);
  });

  test("each selected method/path is actually mounted and its example dispatches there", async () => {
    const routes = mountedOperations(join(ROOT, "api/src/index.ts"));
    const app = new Hono();
    for (const route of routes) app.on(route.method, route.path, (c) => c.json(route));
    for (const operation of profile.operations) {
      expect(routes.some((route) => route.method === operation.method && normalize(route.path) === normalize(operation.path)), operation.id).toBe(true);
      const response = await app.request(operation.example_request.url, { method: operation.method });
      expect(response.status, operation.id).toBe(200);
      const matched = await response.json() as Route;
      expect(normalize(matched.path), operation.id).toBe(normalize(operation.path));
      expect(matched.method, operation.id).toBe(operation.method);
    }
  });

  test("every operation resolves to OpenAPI schemas, correct auth and valid POST examples", async () => {
    const document = await (await openapiRouter.request("/")).json() as any;
    const schemaAjv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(schemaAjv);
    schemaAjv.addSchema(document, "urn:agenttool:launch-openapi");
    for (const operation of profile.operations) {
      const schemaOperation = pointer(document, operation.openapi_operation);
      expect(schemaOperation, operation.id).toBeDefined();
      const security = schemaOperation.security ?? document.security;
      expect(security, operation.id).toEqual(operation.authentication.mode === "project_bearer" ? [{ bearerAuth: [] }] : []);
      const successSchema = schemaOperation.responses[String(operation.success.status)].content?.[operation.success.media_type]?.schema;
      expect(successSchema, `${operation.id} success schema`).toBeDefined();
      schemaAjv.compile({ ...successSchema, $defs: {}, components: document.components });
      if (operation.method === "POST") {
        const media = schemaOperation.requestBody?.content?.["application/json"];
        expect(media?.schema, operation.id).toBeDefined();
        const body = pointer(document, operation.example_request.body_reference!);
        expect(body, `${operation.id} request example`).toBeDefined();
        const validate = schemaAjv.compile({ ...media.schema, components: document.components });
        expect(validate(body), `${operation.id}: ${JSON.stringify(validate.errors)}`).toBe(true);
      }
    }
    const recovery = document.paths["/v1/identity/recover"].post;
    for (const status of ["201", "400", "401", "409", "428", "503"]) expect(recovery.responses[status]).toBeDefined();
    expect(recovery.parameters).toHaveLength(3);
    expect(recovery.description).toContain("Old bearers remain valid");
  });

  test("text and semantic memory search match the implemented input alternatives and meter", async () => {
    const document = await (await openapiRouter.request("/")).json() as any;
    const schema = document.paths["/v1/memories/search"].post.requestBody.content["application/json"].schema;
    const validate = ajv.compile(schema);
    for (const body of [
      { query: "first memory" },
      { query_embedding: Array(1536).fill(0) },
      { query: "first memory", query_embedding: Array(1536).fill(0) },
      {}, { query: "" }, { query: "x".repeat(201) }, { query_embedding: [0] },
    ]) expect(validate(body), JSON.stringify(body).slice(0, 100)).toBe(searchSchema.safeParse(body).success);
    expect(profile.operations.find((op) => op.id === "memory_search")!.cost.project_credits).toBe(ROUTE_CREDITS["memory.search"]);
    const writeSource = readFileSync(join(ROOT, "api/src/routes/memory/memories.ts"), "utf8");
    expect(writeSource).toMatch(/dependencies\.reserve\(c, 1, "memory\.write"\)/);
    expect(profile.operations.find((op) => op.id === "memory_store")!.cost.project_credits).toBe(1);
  });
});
