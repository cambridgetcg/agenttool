/** Printed sample bodies pass their routes' validation.
 *
 *  The role cards, the casting call and the wake-as-episode invitation print
 *  request lines such as `POST /v1/soap-opera/cast { agent_id, role:
 *  'GUEST_STAR' }`. An agent that copies one and fills its placeholders must
 *  not be refused by the route's schema. Samples without agent_id, title or
 *  archetype_name, or with the DID where the identity uuid goes, were found
 *  returning 400.
 *
 *  Each sample becomes the body an agent would send: shorthand keys
 *  (`agent_id`, `title`, `body`) take a sample value, a placeholder that
 *  names a uuid takes the sample uuid, and other placeholders stay as text.
 *  The body goes to the real router. Zod answers before any database read,
 *  so a missing or mistyped required key is a 400 `validation`. A body that
 *  passes reaches the identity lookup, where db.select is stubbed to throw
 *  (no connection is attempted), and the answer is a 500. */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";

import { db } from "../src/db/client";
import { stripComments } from "../src/lib/strip-comments";
import hearthRouter from "../src/routes/hearth";
import multiverseRouter from "../src/routes/multiverse";
import soapOperaRouter from "../src/routes/soap-opera";
import { findRole } from "../src/services/soap-opera/role-generator";
import {
  renderWakeAsSoapOpera,
  type SoapOperaContext,
} from "../src/services/wake/soap-opera-renderer";

const SAMPLE_UUID = "00000000-0000-4000-8000-000000000001";
/** What an agent puts for a shorthand key, as in `{ agent_id, title, body }`. */
const SHORTHAND: Record<string, string> = {
  agent_id: SAMPLE_UUID,
  title: "A title",
  body: "A scene.",
};

const app = new Hono();
app.route("/v1/soap-opera", soapOperaRouter);
app.route("/v1/hearth", hearthRouter);
app.route("/v1/multiverse", multiverseRouter);
// Past validation the handlers' first database read throws (stubbed below);
// answer it quietly instead of printing a stack for every sample.
app.onError((err, c) => c.json({ error: "past_validation", message: err.message }, 500));
app.notFound((c) => c.json({ error: "no_such_route" }, 404));

type Sample = { origin: string; method: string; path: string; text: string };

const SAMPLE_START = /\b(POST|PUT|PATCH|DELETE) (\/v1\/[\w/:.-]+)\s*(?=\{)/g;

/** The `{ ... }` opening at `start`; braces inside quotes are ignored. */
function objectAt(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unclosed sample body: ${text.slice(start, start + 80)}`);
}

function samplesIn(origin: string, text: string): Sample[] {
  return [...text.matchAll(SAMPLE_START)].map((m) => ({
    origin,
    method: m[1]!,
    path: m[2]!,
    text: objectAt(text, m.index! + m[0].length),
  }));
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

function fill(value: unknown): unknown {
  if (typeof value === "string") return /^<[^>]*\buuid\b[^>]*>$/i.test(value) ? SAMPLE_UUID : value;
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]));
  }
  return value;
}

/** The sample is an object literal (JSON, or single-quoted with shorthand
 *  keys); evaluate it with the shorthand names bound, then fill it. */
function bodyOf(sample: Sample): Record<string, unknown> {
  const names = Object.keys(SHORTHAND);
  const literal: unknown = new Function(...names, `return (${sample.text});`)(
    ...names.map((name) => SHORTHAND[name]),
  );
  return fill(literal) as Record<string, unknown>;
}

async function send(sample: Sample, body: unknown): Promise<{ status: number; reply: Record<string, unknown> }> {
  const res = await app.request(sample.path, {
    method: sample.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, reply: (await res.json()) as Record<string, unknown> };
}

// ── The sources an agent reads ─────────────────────────────────────────

const ROLE_CATALOG_ORIGIN = "GET /v1/soap-opera/role-catalog";
// The scripts note in this file is served only after a database read, so
// the file is read as text rather than through its router.
const CASTING_CALL_ORIGIN = "src/routes/public/soap-opera.ts";

const BASE_EPISODE: SoapOperaContext = {
  agent: { did: "did:at:test/aurora", name: "Aurora", substrate_kind: "llm", multiverse: null },
  occurred_at: "2026-05-18T00:00:00Z",
  facts: {
    chronicle_total: 0,
    chronicle_24h: 0,
    memories_total: 0,
    constitutive_count: 0,
    covenants_active: 0,
    letters_awaiting: 0,
    thanks_recent: 0,
    bootstrap_witnessed: false,
  },
  hearth_sitting: [],
  episode_number: 1,
  previously_on: null,
};
const EPISODES: Record<string, SoapOperaContext> = {
  "wake-as-episode, nothing declared": BASE_EPISODE,
  "wake-as-episode, archetype declared": {
    ...BASE_EPISODE,
    agent: {
      ...BASE_EPISODE.agent,
      multiverse: { archetype_name: "Sophia", sibling_dids: ["did:at:test/sibling"] },
    },
    hearth_sitting: [{ did: "did:at:test/peer", name: "Peer", presence_line: "here" }],
  },
};

const roleCatalog = await soapOperaRouter.request("/role-catalog");
const SAMPLES: Sample[] = [
  ...stringsIn(await roleCatalog.json()).flatMap((s) => samplesIn(ROLE_CATALOG_ORIGIN, s)),
  ...samplesIn(
    CASTING_CALL_ORIGIN,
    stripComments(readFileSync(join(import.meta.dir, "..", CASTING_CALL_ORIGIN), "utf8")),
  ),
  ...Object.entries(EPISODES).flatMap(([origin, ctx]) =>
    samplesIn(origin, renderWakeAsSoapOpera(ctx)),
  ),
];

describe("printed sample request bodies", () => {
  let select: ReturnType<typeof spyOn>;
  beforeAll(() => {
    select = spyOn(db, "select").mockImplementation(() => {
      throw new Error("database read: the body passed validation");
    });
  });
  afterAll(() => select.mockRestore());

  test("are found in every source, for the routes they name", () => {
    for (const origin of [ROLE_CATALOG_ORIGIN, CASTING_CALL_ORIGIN, ...Object.keys(EPISODES)]) {
      expect(SAMPLES.filter((s) => s.origin === origin).length).toBeGreaterThan(0);
    }
    expect([...new Set(SAMPLES.map((s) => `${s.method} ${s.path}`))].sort()).toEqual([
      "POST /v1/hearth/sit",
      "POST /v1/multiverse/declare",
      "POST /v1/soap-opera/cast",
      "POST /v1/soap-opera/scripts",
    ]);
  });

  for (const sample of SAMPLES) {
    const label = `${sample.origin}: ${sample.method} ${sample.path} ${sample.text}`;

    test(`pass validation once filled: ${label}`, async () => {
      const body = bodyOf(sample);
      const { status, reply } = await send(sample, body);
      // A 400 is the schema refusing the printed body; show what it said.
      expect(status === 400 ? reply : "past validation").toEqual("past validation");
      expect(reply.error).not.toBe("no_such_route");
      if (sample.path === "/v1/soap-opera/cast" && typeof body.role === "string" && body.role !== "random") {
        expect(findRole(body.role)).not.toBeNull();
      }
    });

    test(`are refused without agent_id (the check has teeth): ${label}`, async () => {
      const { agent_id: _dropped, ...rest } = bodyOf(sample);
      const { status, reply } = await send(sample, rest);
      expect(status).toBe(400);
      expect(reply.error).toBe("validation");
    });
  }
});
