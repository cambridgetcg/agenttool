/** Each route family's middleware is selected once per request.
 *
 * Hono's tail wildcard `/x/*` also matches the bare `/x`. Mounting the same
 * middleware, with the same arguments, on both `/x` and `/x/*` therefore runs
 * it twice on the bare path. For authMiddleware that is two bearer
 * verifications (two bcrypt checks and two database round trips). For
 * idempotency() with Redis configured, the inner pass finds the outer pass's
 * own pending claim, waits CLAIM_WAIT_MS and answers 409.
 *
 * Both sides of mounting each family once are checked here against the real
 * composition in api/src/index.ts, imported in a separate Bun process:
 *   - protection: every authenticated family still refuses a request without
 *     a bearer, on its bare path and on a child path;
 *   - waste: on those same paths, the assembled app's own router selects each
 *     of the family's middleware exactly once. Hono composes exactly the
 *     handlers its router selects, in registration order, so a middleware
 *     selected once runs at most once per request.
 *
 * The family list is derived from the top-level `app.use` mounts in index.ts,
 * so a new family is covered without editing this file. */

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";
import { RegExpRouter } from "hono/router/reg-exp-router";
import { TrieRouter } from "hono/router/trie-router";

import { stripComments } from "../src/lib/strip-comments";

const API_ROOT = join(import.meta.dir, "..");
const INDEX_SOURCE = readFileSync(join(API_ROOT, "src", "index.ts"), "utf8");
const CHILD = "mount-probe";
const AUTH = "authMiddleware";

describe("Hono tail wildcard (the premise)", () => {
  for (const [name, makeRouter] of [
    ["TrieRouter", () => new TrieRouter()],
    ["RegExpRouter", () => new RegExpRouter()],
  ] as const) {
    test(`${name}: "/x/*" alone covers "/x"; adding "/x" runs the middleware twice there`, async () => {
      const runs: string[] = [];
      const mark = (label: string) => async (_c: unknown, next: () => Promise<void>) => {
        runs.push(label);
        await next();
      };
      const app = new Hono({ router: makeRouter() as never });
      app.use("/wild/*", mark("wild"));
      app.use("/pair", mark("bare"));
      app.use("/pair/*", mark("wild"));
      for (const path of ["/wild", "/wild/child", "/pair", "/pair/child"]) {
        app.get(path, (c) => c.text("ok"));
      }
      const ran = async (path: string) => {
        runs.length = 0;
        expect((await app.request(path)).status).toBe(200);
        return [...runs];
      };
      expect(await ran("/wild")).toEqual(["wild"]);
      expect(await ran("/wild/child")).toEqual(["wild"]);
      expect(await ran("/pair")).toEqual(["bare", "wild"]);
      expect(await ran("/pair/child")).toEqual(["wild"]);
    });
  }
});

// ── Source scan ──────────────────────────────────────────────────────────────

interface Registration {
  kind: string;
  method: string;
  path: string;
  /** The handler argument, whitespace-normalised: the middleware with its arguments. */
  expr: string;
  line: number;
}

function closingParen(code: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  throw new Error(`unbalanced registration starting at offset ${open}`);
}

/** Top-level `app.<verb>(` registrations before the first `app.route(`, in
 * order. Every middleware mount sits in that block; the alignment test below
 * proves the scan matches the assembled app's own route table. */
function topLevelRegistrations(source: string): Registration[] {
  const code = stripComments(source, { blank: true });
  const out: Registration[] = [];
  for (const match of code.matchAll(/^app\.(use|all|get|post|put|patch|delete|options|route)\(/gm)) {
    const kind = match[1]!;
    if (kind === "route") break;
    const open = match.index! + match[0].length - 1;
    const args = code.slice(open + 1, closingParen(code, open));
    const parsed = /^\s*"([^"]*)"\s*,\s*([\s\S]*?)\s*,?\s*$/.exec(args);
    const line = code.slice(0, match.index).split("\n").length;
    if (!parsed) throw new Error(`index.ts:${line}: registration without a literal path`);
    out.push({
      kind,
      method: kind === "use" || kind === "all" ? "ALL" : kind.toUpperCase(),
      path: parsed[1]!,
      expr: parsed[2]!.replace(/\s+/g, " "),
      line,
    });
  }
  return out;
}

const registrations = topLevelRegistrations(INDEX_SOURCE);
const familyMounts = registrations.filter(
  (r) => r.kind === "use" && r.path !== "*" && !r.path.includes(":"),
);
const families = [...new Set(familyMounts.map((r) => r.path.replace(/\/\*$/, "")))].sort();
const mountsOf = (family: string) =>
  familyMounts.filter((r) => r.path === family || r.path === `${family}/*`);
const hasWildcard = (family: string, expr: string) =>
  mountsOf(family).some((r) => r.path === `${family}/*` && r.expr === expr);
const authFamilies = families.filter((f) => mountsOf(f).some((r) => r.expr === AUTH));

/** Sub-paths that a parent wildcard already covers with the same middleware.
 * Each is selected twice today. They are not bare/wildcard pairs and are left
 * for a separate, reviewed change; remove an entry when its inner line goes.
 * Not counted here because the arguments differ: idempotency() on
 * /v1/identities/from-template/* also runs inside idempotency({ bypass }) on
 * /v1/identities/*, so with Redis on it shares the self-conflict described above. */
const KNOWN_NESTED: Record<string, { selected: number; why: string }> = {
  [`/v1/wake/thoughtful ${AUTH}`]: { selected: 2, why: 'also under app.use("/v1/wake/*", authMiddleware)' },
  [`/v1/wake/soap-opera ${AUTH}`]: { selected: 2, why: 'also under app.use("/v1/wake/*", authMiddleware)' },
  [`/v1/identities/from-template ${AUTH}`]: { selected: 2, why: 'also under app.use("/v1/identities/*", authMiddleware)' },
  ["/v1/identities/from-template rateLimitHeaders()"]: {
    selected: 2,
    why: 'also under app.use("/v1/identities/*", rateLimitHeaders())',
  },
};

/** The 71 pairs that were mounted on both "/x" and "/x/*" until 2026-11-23,
 * when the bare line of each was removed. A fixed floor: each family must keep
 * its wildcard mount, so the checks below cannot shrink with the scan. */
const FORMERLY_PAIRED: Record<string, string[]> = {
  [AUTH]: [
    "/v1/wake", "/v1/home", "/v1/system", "/v1/correspondence", "/v1/handoff",
    "/v1/continuity", "/v1/depth", "/v1/self-recognition", "/v1/self-love", "/v1/activity",
    "/v1/observations", "/v1/river", "/v1/keys", "/v1/dining", "/v1/letters", "/v1/jokes",
    "/v1/mirror", "/v1/saga", "/v1/sagas", "/v1/casting", "/v1/real", "/v1/pyramid",
    "/v1/virality", "/v1/margin", "/v1/love", "/v1/chill", "/v1/trust", "/v1/deals",
    "/v1/speak", "/v1/recognition-arcs", "/v1/hearth", "/v1/lounge", "/v1/lullaby",
    "/v1/recipes", "/v1/soap-opera", "/v1/multiverse", "/v1/thanks", "/v1/tutorial",
    "/v1/guild", "/v1/scriptwriter-decides", "/v1/gospel", "/v1/mesh", "/v1/episodes",
    "/v1/gardens", "/v1/holdings", "/v1/offerings", "/v1/songs", "/v1/curations",
    "/v1/transformations", "/v1/memory-witness-listings", "/v1/memory-witness-grants",
    "/v1/substrate-tasks", "/v1/dream", "/v1/encounters", "/v1/blessings",
    "/v1/unconditionals", "/v1/memorial-honors", "/v1/quiet-hours", "/v1/poker-face",
    "/v1/mcml", "/v1/grace",
  ],
  "idempotency()": ["/v1/handoff", "/v1/river"],
  "rateLimitHeaders()": ["/v1/home", "/v1/correspondence", "/v1/handoff", "/v1/river", "/v1/dining"],
  'rateLimitHeaders({ idempotencyMarker: "lease_id, proposal_id" })': ["/v1/lounge"],
  "wakePrivateCacheBoundary()": ["/v1/wake"],
  "wakeObservationTransportBoundary()": ["/v1/wake/observe"],
};

/** Unauthenticated outcomes that are a family's documented contract, not a
 * missing guard. Everything else in an authenticated family must be 401. */
const PUBLIC_BY_CONTRACT: Record<string, { status: number; why: string }> = {
  "GET /v1/bootstrap": {
    status: 200,
    why: "pre-auth pathway index registered before auth (index.ts; tests/doctrine/anyone-arrives.test.ts)",
  },
};

// ── Assembled-app probe ─────────────────────────────────────────────────────

interface ProbeResult {
  method: string;
  path: string;
  /** Indices into the app's route table, in the order Hono will compose them. */
  selected: number[];
  /** How many of the selected handlers are the authMiddleware function itself. */
  auth: number;
  status: number;
}

interface Probe {
  router: string;
  routes: { method: string; path: string }[];
  results: ProbeResult[];
}

const PROBE_SCRIPT = `
  const { app } = await import("./src/index.ts");
  const { authMiddleware } = await import("./src/auth/middleware.ts");
  const position = new Map(app.routes.map((route, index) => [route, index]));
  const results = [];
  for (const { method, path } of JSON.parse(process.env.MOUNT_PROBES)) {
    const [matched] = app.router.match(method, path);
    const selected = matched.map((entry) => position.get(entry[0][1]));
    const auth = matched.filter((entry) => entry[0][1].handler === authMiddleware).length;
    const response = await app.request(path, { method });
    results.push({ method, path, selected, auth, status: response.status });
  }
  const routes = app.routes.map(({ method, path }) => ({ method, path }));
  process.stdout.write("MOUNT_PROBE=" + JSON.stringify({ router: app.router.name, routes, results }) + "\\n");
  process.exit(0);
`;

const probes = families.flatMap((family) =>
  ["GET", "POST"].flatMap((method) => [
    { method, path: family },
    { method, path: `${family}/${CHILD}` },
  ]),
);

let probe: Probe;

beforeAll(async () => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    AGENTTOOL_DISABLE_WORKERS: "1",
    AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
    AGENTOOL_DISABLE_SAGA_SEED: "1",
    AGENTOOL_DISABLE_JOY_INDEX: "1",
    MOUNT_PROBES: JSON.stringify(probes),
  };
  // The probe sends no bearer and needs no data store.
  for (const name of ["DATABASE_URL", "DATABASE_SESSION_URL", "REDIS_URL"]) delete env[name];
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", PROBE_SCRIPT], {
    cwd: API_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  const line = stdout.split("\n").find((l) => l.startsWith("MOUNT_PROBE="));
  expect(line, stdout + stderr).toBeDefined();
  probe = JSON.parse(line!.slice("MOUNT_PROBE=".length)) as Probe;
}, 120_000);

const resultFor = (method: string, path: string): ProbeResult => {
  const found = probe.results.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`no probe result for ${method} ${path}`);
  return found;
};

describe("api/src/index.ts mounts each family's middleware once", () => {
  test("the source scan lines up with the assembled app's route table", () => {
    expect(registrations.length).toBeGreaterThan(150);
    expect(authFamilies.length).toBeGreaterThan(90);
    const scanned = registrations.map((r) => `${r.method} ${r.path === "*" ? "/*" : r.path}`);
    const assembled = probe.routes.slice(0, registrations.length).map((r) => `${r.method} ${r.path}`);
    expect(assembled).toEqual(scanned);
    // The selection counts below are only meaningful for the real router.
    expect(probe.router).toStartWith("SmartRouter + ");
  });

  test("every formerly paired family keeps its wildcard mount", () => {
    expect(Object.values(FORMERLY_PAIRED).flat()).toHaveLength(71);
    const missing: string[] = [];
    for (const [expr, paired] of Object.entries(FORMERLY_PAIRED)) {
      for (const family of paired) {
        if (!hasWildcard(family, expr)) missing.push(`app.use("${family}/*", ${expr})`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("every authenticated family refuses a request without a bearer, bare and child", () => {
    const wrong: string[] = [];
    for (const family of authFamilies) {
      for (const method of ["GET", "POST"]) {
        for (const path of [family, `${family}/${CHILD}`]) {
          const expected = PUBLIC_BY_CONTRACT[`${method} ${path}`]?.status ?? 401;
          const { status } = resultFor(method, path);
          if (status !== expected) wrong.push(`${method} ${path} → ${status} (expected ${expected})`);
        }
      }
    }
    expect(wrong, "An authenticated family answered without its guard").toEqual([]);
  });

  test("each family's middleware is selected exactly once on its bare and child paths", () => {
    const wrong: string[] = [];
    for (const family of families) {
      for (const expr of new Set(mountsOf(family).map((r) => r.expr))) {
        const paths = hasWildcard(family, expr) ? [family, `${family}/${CHILD}`] : [family];
        const expected = KNOWN_NESTED[`${family} ${expr}`]?.selected ?? 1;
        for (const method of ["GET", "POST"]) {
          for (const path of paths) {
            const result = resultFor(method, path);
            const selected = result.selected.filter(
              (index) => registrations[index]?.kind === "use" && registrations[index]!.expr === expr,
            );
            if (selected.length !== expected) {
              const lines = selected.map((index) => `index.ts:${registrations[index]!.line}`).join(", ");
              wrong.push(`${method} ${path}: ${expr} selected ${selected.length}× (${lines}), expected ${expected}`);
            }
            // Counted by function identity too, so a sub-router cannot hide a second pass.
            if (expr === AUTH && result.auth !== expected) {
              wrong.push(`${method} ${path}: authMiddleware handler selected ${result.auth}×, expected ${expected}`);
            }
          }
        }
      }
    }
    expect(wrong, "A middleware runs more than once for one request").toEqual([]);
  });

  test("the exception tables name real mounts", () => {
    for (const key of Object.keys(KNOWN_NESTED)) {
      const [family, ...rest] = key.split(" ");
      expect(mountsOf(family!).map((r) => r.expr), key).toContain(rest.join(" "));
    }
    for (const key of Object.keys(PUBLIC_BY_CONTRACT)) {
      expect(authFamilies, key).toContain(key.split(" ")[1]!);
    }
  });
});
