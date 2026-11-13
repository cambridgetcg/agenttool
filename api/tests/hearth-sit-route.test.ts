/** POST /v1/hearth/sit, run past its 400 paths: what the reply says is what
 *  the UPDATE stored.
 *
 *  resolveSeatEnd, nextHearthMetadata and hearthSitHint are tested alone in
 *  tests/hearth-sit-metadata.test.ts. This file tests that the handler joins
 *  them: the end in the reply is the end written, from the same clock
 *  reading as sat_at, and a replaced end is named.
 *
 *  Real SQL generation over a hermetic pg-proxy transport, as in
 *  tests/agent-id-selectors.test.ts. mock.module is process-wide, so
 *  bin/run-test-tier.sh runs this file in its own Bun process.
 *
 *  Doctrine: docs/HEARTH.md */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";

const P = "11111111-2222-4333-8444-555555555555";
const ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const HOUR = 3_600_000;

let queries: { sql: string; params: unknown[] }[] = [];
let existing: Record<string, unknown> = {};

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('update "identity"."identities"')) return { rows: [[ID]] };
  // The authority state: no root key, so the identity is legacy_bearer and
  // the project credential is enough.
  if (sql.includes('"authority_root_public_key"')) {
    return { rows: [[ID, `did:at:${ID}`, null, 0]] };
  }
  // The sit route's own read of the identity.
  if (sql.includes('"metadata", "status" from "identity"."identities"')) {
    return { rows: [[ID, `did:at:${ID}`, "Name", P, existing, "active"]] };
  }
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

beforeEach(() => {
  queries = [];
  existing = {};
});

async function post(body: Record<string, unknown>) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: P } as never);
    await next();
  });
  server.route("/v1/hearth", (await import("../src/routes/hearth")).default);
  const res = await server.request("/v1/hearth/sit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id: ID, ...body }),
  });
  return { status: res.status, reply: (await res.json()) as Record<string, any> };
}

const updates = () => queries.filter((q) => q.sql.startsWith("update"));

/** The metadata the one UPDATE wrote. */
function stored(): Record<string, unknown> {
  const all = updates();
  expect(all).toHaveLength(1);
  const [update] = all;
  expect(update!.sql).toStartWith('update "identity"."identities" set "metadata" = $1 ');
  const value = update!.params[0];
  return (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
}

describe("POST /v1/hearth/sit — the reply is what was stored", () => {
  test("hours: 1 stores the end the reply names, one hour after the stored sat_at", async () => {
    existing = { display_theme: "ink" };
    const before = Date.now();
    const { status, reply } = await post({ sitting: true, hours: 1 });
    const after = Date.now();

    expect(status).toBe(200);
    const seat = stored();
    expect(typeof reply.until).toBe("string");
    expect(seat.hearth_until).toBe(reply.until);
    const satAt = Date.parse(String(seat.hearth_sat_at));
    expect(satAt).toBeGreaterThanOrEqual(before);
    expect(satAt).toBeLessThanOrEqual(after);
    expect(Date.parse(reply.until)).toBe(satAt + HOUR);
    expect(seat).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: seat.hearth_sat_at,
      hearth_until: reply.until,
    });
    expect(reply.hearth_visible).toBe(true);
    expect(reply.hint).toStartWith(`Sat at the hearth until ${reply.until}.`);
  });

  test("a sit with no end over an end still ahead removes it, and the reply says so", async () => {
    const earlier = new Date(Date.now() + 2 * HOUR).toISOString();
    existing = {
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: "2026-11-01T00:00:00.000Z",
      hearth_presence_line: "old words",
      hearth_until: earlier,
    };
    const { status, reply } = await post({ sitting: true });

    expect(status).toBe(200);
    const seat = stored();
    expect(reply.until).toBeNull();
    expect("hearth_until" in seat).toBe(false);
    expect("hearth_presence_line" in seat).toBe(false);
    expect(seat.display_theme).toBe("ink");
    expect(seat.hearth_visible).toBe(true);
    expect(seat.hearth_sat_at).not.toBe("2026-11-01T00:00:00.000Z");
    expect(reply.hint).toStartWith("Sat at the hearth. ");
    expect(reply.hint).toEndWith(` The end from your earlier sit (${earlier}) no longer applies.`);
  });

  test("a stand with hours: 4 over a seat with an end keeps only the other keys", async () => {
    existing = {
      display_theme: "ink",
      level: 1,
      hearth_visible: true,
      hearth_sat_at: "2026-11-01T00:00:00.000Z",
      hearth_presence_line: "here",
      hearth_until: new Date(Date.now() + HOUR).toISOString(),
    };
    const { status, reply } = await post({ sitting: false, hours: 4 });

    expect(status).toBe(200);
    expect(stored()).toEqual({ display_theme: "ink", level: 1 });
    expect(reply.until).toBeNull();
    expect(reply.hearth_visible).toBe(false);
    expect(reply.hint).toBe("Stood up. You are no longer visible at the hearth.");
  });

  test("a refused end is refused before the identity is read, and nothing is written", async () => {
    const { status, reply } = await post({ sitting: true, hours: 0 });
    expect(status).toBe(400);
    expect(reply.error).toBe("invalid_hours");
    expect(queries).toEqual([]);
  });
});
