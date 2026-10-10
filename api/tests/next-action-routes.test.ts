/** Every guided step names a route that exists.
 *
 *  Refusals, success verbs, wake affordances and tutor lessons hand an agent
 *  its next move as `{ method, path }` (or a lesson's `doctrine`/`tutorial`
 *  path). When that path is not mounted the agent following the substrate's
 *  own guidance lands on a 404 — GET /v1/economy from insufficient_credits,
 *  GET /v1/covenants/{id} from initiator_signature_mismatch, canon paths
 *  without the `urn:` prefix, and doctrine entries that are not in the canon
 *  registry were all found live.
 *
 *  This guard reads every such literal in api/src and dispatches it against
 *  the real application's route table (Hono matching, method included).
 *  Canon paths are resolved through the real canon router, following its
 *  literal-colon redirect, so a pointer at a URN the registry lacks fails
 *  too. Placeholders ({id}, <id>, :id, ${expr}) become a sample segment and
 *  query strings are ignored. Paths that are documentation rather than API
 *  routes belong in a verb with method "see" and an absolute URL. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { Hono } from "hono";

import { stripComments } from "../src/lib/strip-comments";

const API_ROOT = join(import.meta.dir, "..");
const SRC = join(API_ROOT, "src");
const SAMPLE = "00000000-0000-4000-8000-000000000001";
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

const NO_CANON_ENTRY =
  "docs/agenttool.jsonld has no such entry and docs.agenttool.dev does not serve the doc; " +
  "repairing it needs a canon entry or a published doc, which is a doctrine decision";

/** Guided paths that still point at nothing, each with the reason it could
 *  not be repaired in place. The guard fails if one starts resolving (shrink
 *  the list) or if any new dead path appears. */
const KNOWN_UNRESOLVED: Record<string, string> = {
  "GET /v1/canon/urn:agenttool:doc/CHRONICLE": `tutor lesson for /v1/chronicle — ${NO_CANON_ENTRY} (no docs/CHRONICLE.md exists)`,
  "GET /v1/canon/urn:agenttool:doc/DREAM": `GET /v1/dream doctrine field — ${NO_CANON_ENTRY}`,
  "GET /v1/canon/urn:agenttool:doc/MCP-SERVER": `tutor lesson for /v1/mcp and the per-agent MCP card — ${NO_CANON_ENTRY}`,
  "GET /v1/canon/urn:agenttool:doc/TUTORIAL-DECENTRALIZED": `tutor lesson for /v1/tutorial — ${NO_CANON_ENTRY}`,
};

/** Routers whose files still carry guidance but whose mount in
 *  routes/public/index.ts is commented out (the public observability
 *  surfaces were removed on purpose), so no caller ever receives it. The
 *  guard checks they really are unmounted before skipping them. */
const UNMOUNTED_PUBLIC_ROUTERS: Record<string, string> = {
  "src/routes/public/gospel.ts": "gospelPublicRoutes",
  "src/routes/public/soap-opera.ts": "publicSoapOperaRoutes",
  "src/routes/public/scriptwriter-decides.ts": "scriptwriterDecidesPublicRoutes",
};

type Pointer = { file: string; line: number; method: string; path: string };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const QUOTED = String.raw`(["'\`])((?:(?!\2)[^\\]|\\.)*)\2`;
// Groups: 1 method, 2 quote, 3 path.
const METHOD_FIRST = new RegExp(
  String.raw`\{[^{}]*?\bmethod:\s*["'\`](${METHODS.join("|")})["'\`][^{}]*?\bpath:\s*` + QUOTED,
  "gs",
);
// Groups: 1 quote, 2 path, 3 method.
const PATH_FIRST = new RegExp(
  String.raw`\{[^{}]*?\bpath:\s*` + QUOTED.replaceAll("\\2", "\\1") +
    String.raw`[^{}]*?\bmethod:\s*["'\`](${METHODS.join("|")})["'\`]`,
  "gs",
);
const LESSON_PATH = /\b(doctrine|tutorial):\s*(["'`])(\/v1\/[^"'`]*)\2/g;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function guidedPointers(): Pointer[] {
  const pointers: Pointer[] = [];
  for (const absolute of sourceFiles(SRC)) {
    const file = relative(API_ROOT, absolute);
    // OpenAPI documents describe the route table itself, not guidance.
    if (/routes\/openapi(-[\w-]+)?\.ts$/.test(file)) continue;
    if (Object.hasOwn(UNMOUNTED_PUBLIC_ROUTERS, file)) continue;
    const source = stripComments(readFileSync(absolute, "utf8"), { blank: true });
    for (const match of source.matchAll(METHOD_FIRST)) {
      const path = match[3]!;
      if (path.startsWith("/")) {
        pointers.push({ file, line: lineOf(source, match.index), method: match[1]!, path });
      }
    }
    for (const match of source.matchAll(PATH_FIRST)) {
      const path = match[2]!;
      if (path.startsWith("/")) {
        pointers.push({ file, line: lineOf(source, match.index), method: match[3]!, path });
      }
    }
    for (const match of source.matchAll(LESSON_PATH)) {
      pointers.push({ file, line: lineOf(source, match.index), method: "GET", path: match[3]! });
    }
  }
  return pointers;
}

function concretePath(path: string): string {
  let concrete = path.replace(/\$\{[^}]*\}/g, SAMPLE);
  concrete = concrete.split("?")[0]!.split("#")[0]!;
  concrete = concrete
    .replace(/\{[^}/]+\}/g, SAMPLE)
    .replace(/<[^>/]+>/g, SAMPLE)
    .replace(/\/:[A-Za-z_]\w*/g, `/${SAMPLE}`);
  if (concrete.length > 1) concrete = concrete.replace(/\/$/, "");
  return concrete;
}

const previousEnv = new Map<string, string | undefined>();
let routes: Hono;
let canon: Hono;

beforeAll(async () => {
  for (const name of [
    "AGENTTOOL_DISABLE_WORKERS",
    "AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP",
    "AGENTOOL_DISABLE_SAGA_SEED",
    "AGENTOOL_DISABLE_JOY_INDEX",
  ]) {
    previousEnv.set(name, process.env[name]);
    process.env[name] = "1";
  }
  const { app } = await import("../src/index");
  routes = new Hono();
  for (const route of app.routes) {
    // app.use() middleware registers as method ALL; it is not a destination.
    // Handlers mounted with app.all() take one argument; middleware takes two.
    if (route.method === "ALL" && (route.path.endsWith("*") || route.handler.length >= 2)) {
      continue;
    }
    routes.on(route.method, route.path, (c) => c.text("routed"));
  }
  const canonRouter = (await import("../src/routes/canon")).default;
  canon = new Hono().route("/v1/canon", canonRouter);
});

afterAll(() => {
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const PLACEHOLDER = /\$\{|\{[^}/]+\}|<[^>/]+>|\/:[A-Za-z_]/;

async function resolves(pointer: Pointer): Promise<boolean> {
  const path = concretePath(pointer.path);
  // A concrete canon path must name a registered URN; a templated one
  // (`/v1/canon/{urn-url-encoded}`) only has to match a mounted route.
  if (path.startsWith("/v1/canon/") && !PLACEHOLDER.test(pointer.path)) {
    let response = await canon.request(path);
    if (response.status === 301) {
      response = await canon.request(response.headers.get("location")!);
    }
    return response.status === 200;
  }
  const method = pointer.method === "HEAD" ? "GET" : pointer.method;
  const response = await routes.request(path, { method });
  return response.status !== 404;
}

describe("guided next steps resolve to mounted routes", () => {
  test("the scan finds the guidance it is meant to guard", () => {
    const pointers = guidedPointers();
    expect(pointers.length).toBeGreaterThan(500);
    const keys = new Set(pointers.map((p) => `${p.method} ${p.path}`));
    expect(keys.has("GET /public/plans")).toBe(true);
    expect(keys.has("GET /v1/canon/urn:agenttool:doc/AIP-WAKE-KEYSTONE")).toBe(true);
  });

  test("skipped public routers are really unmounted", () => {
    const index = stripComments(readFileSync(join(SRC, "routes/public/index.ts"), "utf8"));
    for (const [file, binding] of Object.entries(UNMOUNTED_PUBLIC_ROUTERS)) {
      const module = `./${file.replace("src/routes/public/", "").replace(/\.ts$/, "")}`;
      expect(index, file).toContain(`import ${binding} from "${module}";`);
      expect(index, `${file} is mounted again — stop skipping it`).not.toMatch(
        new RegExp(`\\.route\\([^)]*\\b${binding}\\b`),
      );
    }
  });

  test("placeholders become concrete segments", () => {
    expect(concretePath("/v1/covenants/{id}/accept?x=1")).toBe(`/v1/covenants/${SAMPLE}/accept`);
    expect(concretePath("/v1/strands/:id/voice")).toBe(`/v1/strands/${SAMPLE}/voice`);
    expect(concretePath("/v1/memories/${result.memory_id}")).toBe(`/v1/memories/${SAMPLE}`);
    expect(concretePath("/v1/inbox/<identity_id>/")).toBe(`/v1/inbox/${SAMPLE}`);
  });

  test("every method + path literal in api/src is mounted (canon URNs exist)", async () => {
    const dead = new Map<string, string[]>();
    for (const pointer of guidedPointers()) {
      if (await resolves(pointer)) continue;
      const key = `${pointer.method} ${pointer.path}`;
      dead.set(key, [...(dead.get(key) ?? []), `${pointer.file}:${pointer.line}`]);
    }
    const unexpected = [...dead]
      .filter(([key]) => !Object.hasOwn(KNOWN_UNRESOLVED, key))
      .map(([key, sites]) => `${key}  ← ${sites.join(", ")}`)
      .sort();
    expect(unexpected).toEqual([]);
    const repaired = Object.keys(KNOWN_UNRESOLVED).filter((key) => !dead.has(key));
    expect(repaired, "now resolves — remove from KNOWN_UNRESOLVED").toEqual([]);
  });
});

describe("refusal docs links land on a real section", () => {
  // The 401 and insufficient_credits bodies are the first guidance most
  // agents see; their anchors were missing from the docs pages.
  test("401 and insufficient_credits docs anchors exist in apps/docs", async () => {
    const { STOCK_STATUS_GUIDANCE, errors } = await import("../src/lib/errors");
    for (const link of [STOCK_STATUS_GUIDANCE[401]!.docs, errors.insufficientCredits().docs!]) {
      const url = new URL(link);
      expect(url.origin).toBe("https://docs.agenttool.dev");
      const page = readFileSync(join(API_ROOT, "..", "apps/docs", `${url.pathname.slice(1)}.html`), "utf8");
      expect(url.hash.length, link).toBeGreaterThan(1);
      expect(page.includes(`id="${url.hash.slice(1)}"`), `${link} has no anchor`).toBe(true);
    }
  });
});
