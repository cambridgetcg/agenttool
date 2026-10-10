/** `?agent_id=` on per-agent reads resolves like every other selector.
 *
 * These reads queried the identity table directly: a malformed agent_id
 * reached the uuid cast, a revoked identity was served, and a project with no
 * primary identity was told "project has no identities" even when it held
 * guest, revoked or memorial rows (or when an agent_id WAS given). They now
 * resolve through resolveReadingIdentity (services/identity/acting-identity.ts)
 * and keep their own not-found vocabulary (agent_not_found, no_agent_to_star)
 * with messages that say what happened. A revoked identity is refused with
 * identity_revoked (409).
 *
 * Real SQL generation over a hermetic pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";

const P = "11111111-2222-4333-8444-555555555555";
const SEL = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const MEMORIAL = "77777777-7777-4888-8999-aaaaaaaaaaaa";

let queries: { sql: string; params: unknown[] }[] = [];
let selected: "active" | "revoked" | "missing" = "active";
let memorialExists = false;

const identityRow = (id: string, status: string) =>
  [id, `did:at:${id}`, "Name", status, "2026-07-02T00:00:00.000Z", {}, "llm", 0, true, null, null];

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('"quiet_reason" from "identity"."identities"')) {
    if (params.includes(SEL)) return { rows: selected === "missing" ? [] : [identityRow(SEL, selected)] };
    if (params.includes("memorial")) return { rows: memorialExists ? [identityRow(MEMORIAL, "memorial")] : [] };
    return { rows: [] }; // no primary identity
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

beforeEach(() => {
  queries = [];
  selected = "active";
  memorialExists = false;
});

const ROUTERS: Array<[string, string]> = [
  ["/v1/wake/soap-opera", "../src/routes/wake-soap-opera"],
  ["/v1/wake", "../src/routes/thoughtful-wake"],
  ["/v1/multiverse", "../src/routes/multiverse"],
  ["/v1/recipes", "../src/routes/recipes"],
  ["/v1/soap-opera", "../src/routes/soap-opera"],
  ["/v1/lullaby", "../src/routes/lullaby"],
];

async function get(path: string) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: P } as never);
    await next();
  });
  for (const [mount, module] of ROUTERS) server.route(mount, (await import(module)).default);
  const res = await server.request(path);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}

/** Each read, the error code its not-found answers keep, and the status it
 * gives when no agent_id is named and nothing can be read (the thoughtful
 * wake opens empty rather than failing). */
const READS: Array<[string, string, number]> = [
  ["/v1/lullaby", "agent_not_found", 404],
  ["/v1/multiverse/me", "agent_not_found", 404],
  ["/v1/soap-opera/cast/me", "agent_not_found", 404],
  ["/v1/soap-opera/following", "agent_not_found", 404],
  ["/v1/wake/thoughtful", "agent_not_found", 200],
  ["/v1/wake/soap-opera", "no_agent_to_star", 404],
  ["/v1/recipes/writer/following", "agent_not_found", 404],
  ["/v1/recipes/writer/mind-connects", "agent_not_found", 404],
];

const identityLookups = () => queries.filter((q) => q.sql.includes('from "identity"."identities"'));

describe("agent_id reads resolve inside the caller's project", () => {
  for (const [path, notFound, noAgentStatus] of READS) {
    test(`${path}: a malformed agent_id is not found and never reaches SQL`, async () => {
      const res = await get(`${path}?agent_id=not-a-uuid`);
      expect(res).toMatchObject({ status: 404, body: { error: notFound } });
      expect(identityLookups()).toEqual([]);
    });

    test(`${path}: an unknown or foreign agent_id says so`, async () => {
      selected = "missing";
      const res = await get(`${path}?agent_id=${SEL}`);
      expect(res).toMatchObject({ status: 404, body: { error: notFound } });
      expect(String(res.body.message)).toContain("not an identity of this project");
      expect(identityLookups()[0]?.params).toContain(P);
    });

    test(`${path}: a revoked agent_id is refused`, async () => {
      selected = "revoked";
      expect(await get(`${path}?agent_id=${SEL}`)).toMatchObject({ status: 409, body: { error: "identity_revoked" } });
    });

    test(`${path}: no agent_id and nothing to read never claims the project is empty`, async () => {
      const res = await get(path);
      expect(res.status).toBe(noAgentStatus);
      if (noAgentStatus === 404) expect(res.body.error).toBe(notFound);
      const said = String(res.body.message ?? res.body._note);
      expect(said).toContain("no identity to read by default");
      expect(said).not.toContain("project has no identities");
      expect(said).not.toContain("No identity in this project");
    });

    test(`${path}: no agent_id on a memorial project reads the memorial identity`, async () => {
      memorialExists = true;
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(MEMORIAL);
    });

    test(`${path}: an explicit agent_id reads that identity`, async () => {
      const res = await get(`${path}?agent_id=${SEL}`);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(SEL);
    });
  }
});
