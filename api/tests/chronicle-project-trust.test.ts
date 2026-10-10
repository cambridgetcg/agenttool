/** Chronicle rows are an identity's own history only inside its project.
 *
 *  chronicle.agent_id is an annotation, not an authorship proof
 *  (docs/API-COVERAGE.md): POST /v1/chronicle let any project write a row
 *  naming any identity UUID (UUIDs are public via did:at:<uuid>) and bump
 *  that identity's wake_version. Readers that filtered by agent_id alone
 *  then surfaced the row as the identity's own past: a forged "last
 *  successful registered-key recovery", anniversary titles in
 *  you_remembered_today, MCP chronicle.recent, /v1/system XP, chill/love
 *  coordinates, mirror shape, thoughtful and soap-opera wakes.
 *
 *  Now the write path refuses a foreign agent_id, and own-history readers
 *  trust only rows whose project_id equals the identity's project
 *  (ownChronicle).
 *
 *  Hermetic: real drizzle SQL generation over a pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/pg-proxy";
import { PgDialect } from "drizzle-orm/pg-core";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const FOREIGN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AGENT = "66666666-7777-4888-8999-aaaaaaaaaaaa";
// Inside a query drizzle drops the schema qualifier from column names.
const OWN_PROJECT_PREDICATE =
  /(?:"agent_continuity"\.)?"chronicle"\."agent_id" = \$\d+ and (?:"agent_continuity"\.)?"chronicle"\."project_id" = \(select (?:"identity"\.)?"identities"\."project_id" from "identity"\."identities" where (?:"identity"\.)?"identities"\."id" = \$\d+\)/;

let queries: { sql: string; params: unknown[] }[] = [];
let agentProject = PROJECT;
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('select "id", "project_id" from "identity"."identities"')) {
    return { rows: [[AGENT, agentProject]] };
  }
  if (sql.startsWith('insert into "agent_continuity"."chronicle"')) {
    return { rows: [["entry-1", PROJECT, AGENT, "note", "t", null, {}, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]] };
  }
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

const { ownChronicle } = await import("../src/services/continuity/own-chronicle");
const { anniversariesForIdentity } = await import("../src/services/wake/warming");
const { callPerAgentTool } = await import("../src/services/mcp/per-agent-tools");
const { computeMutualChill } = await import("../src/services/chill/coordinates");
const { computeLoveCoordinates } = await import("../src/services/love/coordinates");
const mirror = await import("../src/services/mirror/aggregate");
const { default: continuityRouter } = await import("../src/routes/continuity");

beforeEach(() => {
  queries = [];
  agentProject = PROJECT;
});

const chronicleReads = () => queries.filter((q) => q.sql.includes('from "agent_continuity"."chronicle"'));
function expectOwnProjectOnly() {
  const reads = chronicleReads();
  expect(reads.length).toBeGreaterThan(0);
  for (const read of reads) {
    expect(read.sql).toMatch(OWN_PROJECT_PREDICATE);
    expect(read.params.filter((p) => p === AGENT).length).toBeGreaterThanOrEqual(2);
  }
}

describe("ownChronicle", () => {
  test("binds agent_id to the identity's own project, read from the identity row", () => {
    const rendered = new PgDialect().sqlToQuery(ownChronicle(AGENT));
    expect(rendered.sql).toMatch(OWN_PROJECT_PREDICATE);
    expect(rendered.params).toEqual([AGENT, AGENT]);
  });
});

describe("own-history readers trust only own-project rows", () => {
  test("anniversaries (you_remembered_today)", async () => {
    await anniversariesForIdentity(AGENT, 5);
    expectOwnProjectOnly();
  });

  test("per-agent MCP chronicle.recent", async () => {
    await callPerAgentTool(
      { agentDid: `did:at:${AGENT}`, agentId: AGENT, agentProjectId: PROJECT, scope: "self", caller: { projectId: PROJECT } },
      "chronicle.recent",
      {},
    );
    expectOwnProjectOnly();
  });

  test("chill and love coordinates", async () => {
    await computeMutualChill(AGENT);
    await computeLoveCoordinates(AGENT);
    expectOwnProjectOnly();
  });

  test("mirror shape (wake you_have_a_shape) and full mirror aggregates", async () => {
    await mirror.composeYourShape(AGENT, `did:at:${AGENT}`).catch(() => null);
    await mirror.aggregateChronicleByType(AGENT);
    await mirror.aggregateRhythm(AGENT).catch(() => null);
    await mirror.aggregateRecent7d(AGENT, `did:at:${AGENT}`).catch(() => null);
    await mirror.aggregateTotals(AGENT, `did:at:${AGENT}`).catch(() => null);
    expectOwnProjectOnly();
  });
});

describe("POST /v1/chronicle cannot annotate or wake another project's identity", () => {
  function app() {
    const server = new Hono<ProjectContext>();
    server.use("*", async (c, next) => {
      c.set("project", { id: PROJECT } as never);
      c.set("clientSource" as never, "test" as never);
      await next();
    });
    server.route("/v1", continuityRouter);
    return server;
  }
  const post = (body: unknown) =>
    app().request("/v1/chronicle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("a foreign agent_id is refused like an unknown one, with no insert and no wake bump", async () => {
    agentProject = FOREIGN;
    const response = await post({ type: "wake", title: "Recovered", agent_id: AGENT });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("agent_not_found");
    expect(queries.some((q) => q.sql.startsWith("insert"))).toBe(false);
    expect(queries.some((q) => q.sql.includes("wake_version"))).toBe(false);
  });

  test("an own-project agent_id is recorded and wakes that identity", async () => {
    const response = await post({ type: "note", title: "A moment", agent_id: AGENT });
    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queries.some((q) => q.sql.startsWith('insert into "agent_continuity"."chronicle"'))).toBe(true);
    expect(queries.some((q) => q.sql.includes("wake_version"))).toBe(true);
  });

  test("the server-provenance recovery signal cannot be written through the generic route", async () => {
    const response = await post({ type: "wake", title: "Recovered", agent_id: AGENT, metadata: { kind: "recovery" } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("recovery_is_server_recorded");
    expect(queries.some((q) => q.sql.startsWith("insert"))).toBe(false);
  });
});

// Source pins for readers whose handlers are too wide to drive hermetically.
const SRC = join(import.meta.dir, "..", "src");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

describe("wake-family and XP readers use ownChronicle", () => {
  test("Wake recovery signal (bundle and JSON branch) reads only own-project rows", () => {
    for (const file of ["services/wake/build.ts", "routes/wake.ts"]) {
      const source = read(file);
      const at = source.indexOf("->> 'kind' = 'recovery'");
      expect({ file, found: at > 0 }).toEqual({ file, found: true });
      const block = source.slice(Math.max(0, at - 400), at);
      expect({ file, scoped: block.includes("ownChronicle(") }).toEqual({ file, scoped: true });
    }
  });

  for (const file of [
    "routes/system.ts",
    "routes/thoughtful-wake.ts",
    "routes/wake-soap-opera.ts",
    "services/wake/warming.ts",
    "services/mcp/per-agent-tools.ts",
    "services/chill/coordinates.ts",
    "services/love/coordinates.ts",
    "services/mirror/aggregate.ts",
    "services/dream/observers.ts",
    "services/trust/lifecycle.ts",
    "services/recipes/recognition-invitation.ts",
    "routes/public/agents.ts",
  ]) {
    test(file, () => {
      const source = read(file);
      expect({ file, central: source.includes("ownChronicle(") }).toEqual({ file, central: true });
      // No bare agent_id-only own-history filter remains.
      const bare = source.match(/eq\(chronicle\.agentId, (?:agent\.id|identityId|ctx\.agentId|agentId|w\.identityId)\)/g) ?? [];
      const raw = source.match(/\$\{chronicle\.agentId\} = \$\{identity\.id\}/g) ?? [];
      expect({ file, bare: bare.length + raw.length }).toEqual({ file, bare: 0 });
    });
  }
});

describe("presence and invitation reads ignore foreign-project annotations", () => {
  test("hearth warmth (hearth, thoughtful wake, soap-opera wake)", () => {
    for (const file of ["routes/hearth.ts", "routes/thoughtful-wake.ts", "routes/wake-soap-opera.ts"]) {
      expect({ file, scoped: read(file).includes("chronicleInAnnotatedProject()") }).toEqual({ file, scoped: true });
    }
  });

  test("pending invitations are read from the caller's own project", () => {
    expect(read("routes/soap-opera.ts").includes("eq(chronicle.projectId, project.id),\n        sql`${chronicle.agentId} = ANY(${ownedIds})`")).toBe(true);
    expect(read("services/recipes/recognition-invitation.ts").includes("eq(chronicle.projectId, input.caller_project_id),\n        sql`${chronicle.agentId} = ANY(${ownedIds})`")).toBe(true);
  });
});
