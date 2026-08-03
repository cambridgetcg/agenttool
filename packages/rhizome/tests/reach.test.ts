/** reach probe — the classification, and the live instances.
 *
 *  Two halves. The rules half runs against real temporary repositories
 *  rather than against a literal file map, because this probe answers
 *  reachability from a resolved TypeScript program and a program needs
 *  files on disk. The live half asserts against the actual tree, because
 *  a probe proved only against fixtures is proved against a tidy world —
 *  and every reachability failure this probe exists for was found in an
 *  untidy one.
 *
 *  The load-bearing test in this file is `the version seam is the finding`.
 *  The previous implementation of this probe could not detect its own
 *  motivating bug: deleting `version` from `ThoughtsAddOpts` and from
 *  `ThoughtsClient.add()` changed its JSON output by zero bytes. That test
 *  performs exactly that deletion and requires the verdict to flip. It is
 *  the one assertion here that, if it goes green for the wrong reason,
 *  makes every other assertion in this file worthless.
 */

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { reachProbe } from "../src/probes/reach.js";
import { buildRouteInventory, EXECUTE_ENV, reconcile } from "../src/probes/reach/routes.js";
import { TsProjects } from "../src/probes/reach/ts-project.js";
import { resolveScope } from "../src/scope.js";
import type { Finding, Scope } from "../src/types.js";

function at(findings: Finding[], file: string, needle: string): Finding | undefined {
  return findings.find((finding) => finding.file === file && finding.title.includes(needle));
}

function titled(findings: Finding[], needle: string): Finding | undefined {
  return findings.find((finding) => finding.title.includes(needle));
}

/** Resolving 2,800 files and building three TypeScript programs over them
 *  takes about twenty seconds; the default per-test timeout is five.
 *  Stated rather than silently inherited. */
const LIVE_TIMEOUT_MS = 300_000;

/** A real repository on disk, because the analysis is a real compiler.
 *
 *  `git init` so `Scope`'s two derivations both have something to say;
 *  the files are then written and added, so neither derivation is the
 *  only one that can see them. */
function repository(files: Record<string, string>): Scope {
  const root = mkdtempSync(join(tmpdir(), "rhizome-reach-test-"));
  temporaryRoots.push(root);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  for (const [name, text] of Object.entries(files)) {
    const absolute = join(root, name);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text, "utf8");
  }
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return resolveScope(root);
}

const temporaryRoots: string[] = [];
process.on("exit", () => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "ES2022",
    moduleResolution: "bundler",
    strict: true,
    outDir: "dist",
    rootDir: "src",
    noEmit: true,
  },
  include: ["src"],
});

// ── the version seam: the test the previous implementation failed ──────
//
// A miniature of the real thing. A string-literal union selecting a wire
// format; an options bag on the client method that forwards it; a signer
// that branches on it; a transport that sends the result; and a document
// staging the cutover in order. Everything except the seam is held fixed
// between the two halves of the test, so the only thing that can move the
// verdict is the seam.

const CRYPTO = [
  'export type ThoughtVersion = "v1" | "v2";',
  "",
  "export interface SignOpts {",
  "  strandId: string;",
  "  body: string;",
  "  /** Canonical-bytes framing. Defaults to v1. */",
  "  version?: ThoughtVersion;",
  "}",
  "",
  "export function signThought(opts: SignOpts): string {",
  '  const version = opts.version ?? "v1";',
  '  if (version === "v2") {',
  '    return `v2:${opts.strandId}:${opts.body}`;',
  "  }",
  '  return `${opts.strandId}:${opts.body}`;',
  "}",
].join("\n");

function client(withVersion: boolean): string {
  return [
    'import { signThought, type ThoughtVersion } from "./crypto.js";',
    "",
    "export interface AddOpts {",
    "  kind?: string;",
    ...(withVersion ? ["  version?: ThoughtVersion;"] : []),
    "}",
    "",
    "export class ThoughtsClient {",
    "  constructor(private readonly baseUrl: string) {}",
    "",
    "  async add(strandId: string, body: string, opts: AddOpts): Promise<unknown> {",
    "    const signature = signThought({",
    "      strandId,",
    "      body,",
    ...(withVersion ? ["      version: opts.version,"] : []),
    "    });",
    "    return this.req(`/v1/strands/${strandId}/thoughts`, { body, signature });",
    "  }",
    "",
    "  private async req(path: string, payload: unknown): Promise<unknown> {",
    "    const init: RequestInit = { method: \"POST\", body: JSON.stringify(payload) };",
    "    const resp: Response = await fetch(this.baseUrl + path, init);",
    "    return resp.json();",
    "  }",
    "}",
  ].join("\n");
}

const CUTOVER_DOC = [
  "# Thought canonical bytes",
  "",
  "## The ordered cutover",
  "",
  "1. Server dual-accept deployed everywhere.",
  "2. SDK minor release — `AddOpts.version` default becomes `\"v2\"`.",
  "",
  'Until step 2, `version: "v2"` is opt-in per call:',
  "",
  "```ts",
  'await sdk.thoughts.add(id, "hello", { version: "v2" });',
  "```",
].join("\n");

function versionTree(withVersion: boolean): Record<string, string> {
  return {
    "packages/sdk/package.json": JSON.stringify({ name: "sdk", main: "dist/index.js", types: "dist/index.d.ts" }),
    "packages/sdk/tsconfig.json": TSCONFIG,
    "packages/sdk/src/index.ts": ['export * from "./crypto.js";', 'export * from "./thoughts.js";'].join("\n"),
    "packages/sdk/src/crypto.ts": CRYPTO,
    "packages/sdk/src/thoughts.ts": client(withVersion),
    "docs/THOUGHTS.md": CUTOVER_DOC,
  };
}

test("the version seam is the finding: removing it flips staged to unreachable", async () => {
  const staged = await reachProbe.run(repository(versionTree(true)));
  const sound = at(staged, "packages/sdk/src/crypto.ts", "ThoughtVersion");
  expect(sound?.verdict, "with the seam present the staged member must read as sound").toBe("sound");
  expect(sound?.title).toContain('"v2" is staged, not stranded');
  // The evidence must *name the operation*, because "somebody can send it"
  // is the whole claim and a claim with no witness is the thing this probe
  // exists to report.
  expect(sound?.evidence).toContain("reachable from an operation that sends a request");
  expect(sound?.evidence).toContain("ThoughtsClient.add");
  expect(sound?.evidence).toContain("docs/THOUGHTS.md");

  const stripped = await reachProbe.run(repository(versionTree(false)));
  const gap = at(stripped, "packages/sdk/src/crypto.ts", "ThoughtVersion");
  expect(gap?.verdict, "with the seam gone the same member must read as a gap").toBe("gap");
  expect(gap?.title).toContain('no operation can send "v2"');
  expect(gap?.evidence).toContain("reachable from an operation that sends a request: none");
  // The pure half survives the deletion and must be named, because that is
  // exactly what makes the bug invisible: the value is still computable.
  expect(gap?.evidence).toContain("accepted by operations that send nothing");
  expect(gap?.evidence).toContain("signThought");
  // The document still describes the seam, and the seam is gone. Saying so
  // is what separates "staged" from "a note about a path that is not there".
  expect(gap?.evidence).toContain("a document names a seam the code does not have");
  expect(gap?.evidence).toContain("AddOpts.version");
}, LIVE_TIMEOUT_MS);

test("forwarding, not declaring, is what makes the member deliverable", async () => {
  // The property still exists on the options bag; `add()` simply stops
  // passing it on. Nothing about the declaration text changes, and the
  // verdict must still flip — a weaker mutation than the one above and the
  // one a refactor is most likely to produce.
  const files = versionTree(true);
  files["packages/sdk/src/thoughts.ts"] = files["packages/sdk/src/thoughts.ts"]!.replace(
    "      version: opts.version,\n",
    "",
  );
  const findings = await reachProbe.run(repository(files));
  const gap = at(findings, "packages/sdk/src/crypto.ts", "ThoughtVersion");
  expect(gap?.verdict).toBe("gap");
  expect(gap?.title).toContain('no operation can send "v2"');
}, LIVE_TIMEOUT_MS);

// ── routes ─────────────────────────────────────────────────────────────

const API_FILES: Record<string, string> = {
  "api/package.json": JSON.stringify({ name: "api", module: "src/index.ts" }),
  "api/tsconfig.json": TSCONFIG,
  "api/src/index.ts": [
    'import { Hono } from "hono";',
    'import memories from "./routes/memories.js";',
    'import secret from "./routes/secret.js";',
    'import home from "./routes/home.js";',
    "export const app = new Hono();",
    'app.route("/v1/memories", memories);',
    'app.route("/v1/secret", secret);',
    'app.route("/v1/home", home);',
    "// REMOVED: these mounts were deleted deliberately and are kept as a note",
    '//   app.route("/v1/ghost", ghost);',
    '/*  app.route("/v1/phantom", phantom);  */',
    "/**",
    ' *  Mounted in api/src/index.ts as: app.route("/v1/spectre", spectre)',
    " */",
  ].join("\n"),
  "api/src/routes/memories.ts": [
    'import { Hono } from "hono";',
    "const app = new Hono();",
    'app.get("/:id", (c) => c.json({}));',
    'app.patch("/:id", (c) => c.json({}));',
    "export default app;",
  ].join("\n"),
  "api/src/routes/secret.ts": [
    'import { Hono } from "hono";',
    "const app = new Hono();",
    'app.get("/", (c) => c.json({}));',
    "export default app;",
    "const orphan = new Hono();",
    'orphan.get("/never", (c) => c.json({}));',
  ].join("\n"),
  // A factory plus a chained constructor: the two shapes the text scanner
  // could not see, and the reason twelve real routes were invisible.
  "api/src/routes/home.ts": [
    'import { Hono } from "hono";',
    "function createHomeRouter() {",
    '  const app = new Hono().get("/", (c) => c.json({})).post("/reset", (c) => c.json({}));',
    "  return app;",
    "}",
    "export default createHomeRouter();",
  ].join("\n"),
  "node_modules/hono/package.json": JSON.stringify({ name: "hono", main: "index.js", types: "index.d.ts" }),
  "node_modules/hono/index.d.ts": [
    "export declare class Hono {",
    "  routes: Array<{ method: string; path: string }>;",
    "  get(path: string, ...handlers: unknown[]): this;",
    "  post(path: string, ...handlers: unknown[]): this;",
    "  patch(path: string, ...handlers: unknown[]): this;",
    "  route(path: string, app: Hono): this;",
    "  fetch(request: Request): Promise<Response>;",
    "}",
  ].join("\n"),
  "packages/sdk/package.json": JSON.stringify({ name: "sdk", main: "dist/index.js" }),
  "packages/sdk/tsconfig.json": TSCONFIG,
  "packages/sdk/src/index.ts": 'export * from "./memory.js";',
  "packages/sdk/src/memory.ts": [
    "export class MemoryClient {",
    "  async fetchOne(id: string) {",
    '    return this.send("GET", `/v1/memories/${id}`);',
    "  }",
    "  async send(method: string, path: string) {",
    "    return fetch(path, { method });",
    "  }",
    "}",
  ].join("\n"),
};

test("a commented-out mount is not a mount", async () => {
  const findings = await reachProbe.run(repository(API_FILES));
  // Three prose forms of `app.route(...)` sit in the entry file: a line
  // comment inside a `REMOVED:` block, a block comment, and a module-header
  // doc line. The previous scanner read all three as live mounts and
  // published the unresolved ones as `limit`s — eleven of them, 11/11 false.
  const limit = titled(findings, "could not resolve");
  expect(limit, "no mount should be unresolved: the only unresolvable ones were comments").toBeUndefined();
  const domains = titled(findings, "have no client in this repository");
  expect(domains?.evidence).not.toContain("/v1/ghost");
  expect(domains?.evidence).not.toContain("/v1/phantom");
  expect(domains?.evidence).not.toContain("/v1/spectre");
}, LIVE_TIMEOUT_MS);

test("a router built by a factory or a chained constructor is still resolved", async () => {
  const scope = repository(API_FILES);
  const projects = await TsProjects.open(scope);
  const inventory = buildRouteInventory(scope, projects, new Set(["api/src/index.ts", "packages/sdk/src/index.ts"]));
  const paths = inventory.routes.map((route) => `${route.method.toUpperCase()} ${route.path}`).sort();
  expect(paths).toContain("GET /v1/home");
  expect(paths).toContain("POST /v1/home/reset");
  expect(paths).toContain("GET /v1/memories/:id");
  expect(paths).toContain("PATCH /v1/memories/:id");
  expect(inventory.unresolvedMounts).toEqual([]);
  expect(inventory.roots).toEqual(["api/src/index.ts#app"]);
}, LIVE_TIMEOUT_MS);

// Regression, 2026-08-03. `api/src/routes/well-known.ts` registers two
// endpoints as `app.on(["GET", "HEAD"], SECURITY_TXT_ROUTE, ...)`, where the
// path is an `export const` in another module. The resolver read only the
// string-literal form, so those four routes (GET+HEAD each) were dropped
// from the model without a trace. The live-repository test above could not
// catch it: `well-known.ts` imports `@agenttool/xenia`, so on a machine
// where that dependency is missing the file never loads and the routes are
// absent from the running router too — the two wrongs cancelled and the
// suite went green. This fixture has no such dependency, so the miss is
// visible hermetically.
const CONSTANT_PATH_FILES: Record<string, string> = {
  "api/package.json": JSON.stringify({ name: "api", module: "src/index.ts" }),
  "api/tsconfig.json": TSCONFIG,
  "api/src/lib/public-paths.ts": 'export const SECURITY_TXT_ROUTE = "/security.txt";',
  "api/src/index.ts": [
    'import { Hono } from "hono";',
    'import wellKnown from "./routes/well-known.js";',
    "export const app = new Hono();",
    'app.route("/.well-known", wellKnown);',
  ].join("\n"),
  "api/src/routes/well-known.ts": [
    'import { Hono } from "hono";',
    'import { SECURITY_TXT_ROUTE } from "../lib/public-paths.js";',
    'const AGENT_JSON = "/agent.json";',
    "const app = new Hono();",
    'app.on(["GET", "HEAD"], SECURITY_TXT_ROUTE, (c) => c.text(""));',
    "app.get(AGENT_JSON, (c) => c.json({}));",
    'app.get("/literal", (c) => c.json({}));',
    "export default app;",
  ].join("\n"),
};

test("a route path written as a constant is resolved, imported or local", async () => {
  const scope = repository(CONSTANT_PATH_FILES);
  const projects = await TsProjects.open(scope);
  const inventory = buildRouteInventory(scope, projects, new Set(["api/src/index.ts"]));
  const paths = inventory.routes.map((route) => `${route.method.toUpperCase()} ${route.path}`).sort();
  // Imported `export const`, on both methods `.on` was given.
  expect(paths).toContain("GET /.well-known/security.txt");
  expect(paths).toContain("HEAD /.well-known/security.txt");
  // Same-file `const`.
  expect(paths).toContain("GET /.well-known/agent.json");
  // The literal form keeps working.
  expect(paths).toContain("GET /.well-known/literal");
  // And nothing was invented to get there.
  expect(paths.length).toBe(4);
}, LIVE_TIMEOUT_MS);

test("mounting is resolved per binding, so a second router in a mounted file is still found unmounted", async () => {
  const findings = await reachProbe.run(repository(API_FILES));
  const orphan = at(findings, "api/src/routes/secret.ts", "nothing mounts it");
  expect(orphan?.verdict).toBe("gap");
  expect(orphan?.title).toContain("`orphan`");
  expect(orphan?.evidence).toContain("GET /never");
  // The mounted binding in the same file must not be reported.
  expect(orphan?.title).not.toContain("`app`");
}, LIVE_TIMEOUT_MS);

test("a route whose path a client reaches with another method is reported as the method, not the path", async () => {
  const findings = await reachProbe.run(repository(API_FILES));
  const finding = at(findings, "api/src/routes/memories.ts", "/v1/memories has clients");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("PATCH /v1/memories/:id");
  expect(finding?.evidence).toContain("path is reached, this method is not");
  expect(finding?.evidence).toContain("packages/sdk/src/memory.ts");
  expect(finding?.evidence).not.toContain("GET /v1/memories/:id");
}, LIVE_TIMEOUT_MS);

test("a domain no client touches is one sound line, not a finding per route", async () => {
  const findings = await reachProbe.run(repository(API_FILES));
  expect(at(findings, "api/src/routes/secret.ts", "/v1/secret has clients")).toBeUndefined();
  const summary = titled(findings, "have no client in this repository");
  expect(summary?.verdict).toBe("sound");
  expect(summary?.evidence).toContain("/v1/secret");
}, LIVE_TIMEOUT_MS);

test("a router a package hands to its caller is a root, not an orphan", async () => {
  // `packages/scriptwriter/src/server.ts` declares twenty-five routes on an
  // app nothing mounts, and `buildServer()` returns it from the package
  // entry. Calling that unreachable is a false gap in the loudest place.
  const scope = repository({
    "packages/node/package.json": JSON.stringify({ name: "node", main: "src/index.ts" }),
    "packages/node/tsconfig.json": TSCONFIG,
    "packages/node/src/index.ts": 'export * from "./server.js";',
    "packages/node/src/server.ts": [
      'import { Hono } from "hono";',
      "export function buildServer() {",
      "  const app = new Hono();",
      '  app.get("/rooms", (c) => c.json({}));',
      "  return app;",
      "}",
    ].join("\n"),
    "node_modules/hono/package.json": API_FILES["node_modules/hono/package.json"]!,
    "node_modules/hono/index.d.ts": API_FILES["node_modules/hono/index.d.ts"]!,
  });
  const findings = await reachProbe.run(scope);
  expect(at(findings, "packages/node/src/server.ts", "nothing mounts it")).toBeUndefined();
}, LIVE_TIMEOUT_MS);

// ── symbols ────────────────────────────────────────────────────────────

test("an export nothing in the tree mentions is a gap, grouped by the file that declares it", async () => {
  const scope = repository({
    "pkg/package.json": JSON.stringify({ name: "pkg", main: "dist/index.js" }),
    "pkg/tsconfig.json": TSCONFIG,
    "pkg/src/index.ts": 'export * from "./live.js";',
    "pkg/src/dead.ts": ["export function unusedWidget() {}", "export const UNUSED_LIMIT = 3;"].join("\n"),
    "pkg/src/live.ts": ["export function usedWidget() {}"].join("\n"),
    "pkg/src/main.ts": ['import { usedWidget } from "./live.js";', "usedWidget();"].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  const finding = at(findings, "pkg/src/dead.ts", "nothing in the tree mentions");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.title).toContain("2 symbol");
  expect(finding?.evidence).toContain("unusedWidget");
  expect(finding?.evidence).toContain("UNUSED_LIMIT");
  expect(at(findings, "pkg/src/live.ts", "nothing in the tree mentions")).toBeUndefined();
}, LIVE_TIMEOUT_MS);

test("a symbol no code calls and a document describes is latent, not dead", async () => {
  // The correction: the `latent` reading used to be available only to
  // symbols on a package's published surface, so an unpublished symbol a
  // document named was reported as "mentioned by no other file in the
  // corpus — not by code, not by a test, not by a document", beside the
  // document that named it.
  const scope = repository({
    "pkg/package.json": JSON.stringify({ name: "pkg", main: "dist/index.js" }),
    "pkg/tsconfig.json": TSCONFIG,
    "pkg/src/index.ts": 'export * from "./live.js";',
    "pkg/src/live.ts": "export function usedWidget() {}",
    "pkg/src/internal.ts": "export function reservedProcedure() {}",
    "docs/RUNBOOK.md": [
      "# Runbook",
      "",
      "When the queue stalls, call `reservedProcedure` by hand; nothing calls it",
      "on the hot path and that is deliberate.",
    ].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  expect(at(findings, "pkg/src/internal.ts", "nothing in the tree mentions")).toBeUndefined();
  const latent = titled(findings, "described by a document that names them");
  expect(latent?.verdict).toBe("sound");
  expect(latent?.evidence).toContain("reservedProcedure");
  expect(latent?.evidence).toContain("docs/RUNBOOK.md");
}, LIVE_TIMEOUT_MS);

test("a symbol its own module uses is not reported as reachable only from a test", async () => {
  const scope = repository({
    "api/package.json": JSON.stringify({ name: "api", module: "src/index.ts" }),
    "api/tsconfig.json": TSCONFIG,
    "api/src/lib/thing.ts": [
      'export const HEADER_NAME = "X-Thing";',
      "export function transformThing(value: string) { return value; }",
      'export function middleware(c: { header(a: string, b: string): void }) { c.header(HEADER_NAME, "1"); }',
      "export function useThing() { return middleware; }",
    ].join("\n"),
    "api/src/index.ts": ['import { useThing } from "./lib/thing.js";', "useThing();"].join("\n"),
    "api/tests/thing.test.ts": [
      'import { HEADER_NAME, transformThing } from "../src/lib/thing.js";',
      'transformThing("a");',
      "void HEADER_NAME;",
    ].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  expect(findings.some((finding) => finding.title.startsWith("HEADER_NAME"))).toBe(false);
  const finding = at(findings, "api/src/lib/thing.ts", "transformThing is reachable only");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("api/tests/thing.test.ts");
}, LIVE_TIMEOUT_MS);

test("a seam a module opens for its tests on purpose is sound, and says why", async () => {
  const scope = repository({
    "api/package.json": JSON.stringify({ name: "api", module: "src/index.ts" }),
    "api/tsconfig.json": TSCONFIG,
    "api/src/index.ts": "export const boot = 1;",
    "api/src/lib/clock.ts": [
      "/** Replace the clock. Exported so the test suite can freeze time; nothing",
      " *  in production calls this. */",
      "export function setClock(value: number) { return value; }",
    ].join("\n"),
    "api/tests/clock.test.ts": ['import { setClock } from "../src/lib/clock.js";', "setClock(1);"].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  const finding = at(findings, "api/src/lib/clock.ts", "declared test seam");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("api/tests/clock.test.ts");
}, LIVE_TIMEOUT_MS);

// ── the live tree ──────────────────────────────────────────────────────

let liveScopeOnce: Scope | undefined;
function liveScope(): Scope {
  liveScopeOnce ??= resolveScope();
  return liveScopeOnce;
}

let live: Promise<Finding[]> | undefined;
function liveFindings(): Promise<Finding[]> {
  live ??= Promise.resolve(reachProbe.run(liveScope()));
  return live;
}

test("every probe limit names a file that exists, at a line that exists", async () => {
  const scope = liveScope();
  for (const limit of reachProbe.limits) {
    expect(scope.files, `limit anchor ${limit.file} is not in the corpus`).toContain(limit.file);
    expect(limit.line).toBeLessThanOrEqual(scope.lines(limit.file).length);
  }
  expect(reachProbe.limits.length).toBeGreaterThan(0);
}, LIVE_TIMEOUT_MS);

test("live repository: strand-thought/v2 is staged work and is reported sound", async () => {
  const findings = await liveFindings();
  const finding = at(findings, "packages/sdk-ts/src/crypto.ts", 'ThoughtCanonicalVersion: "v2" is staged');
  expect(finding, "the v2 canonical-bytes selector should read as latent, not rot").toBeDefined();
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("docs/STRANDS.md");
  expect(finding?.evidence).toContain('written by non-test code: "v1"');
  // The claim that makes it sound rather than rot, with its witness.
  expect(finding?.evidence).toContain("ThoughtsClient.add");
}, LIVE_TIMEOUT_MS);

test("live repository: a route both SDKs can write and neither can read", async () => {
  const findings = await liveFindings();
  const finding = at(findings, "api/src/routes/vault/policy.ts", "/v1/vault has clients");
  expect(finding, "GET /v1/vault/:name/policy should be reported as uncovered").toBeDefined();
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("GET /v1/vault/:name/policy");
  expect(finding?.evidence).toContain("path is reached, this method is not");
  expect(finding?.evidence).toContain("packages/sdk-py/src/agenttool/vault.py");
}, LIVE_TIMEOUT_MS);

// This test used to assert the opposite: that `PATCH /v1/strands/:strandId
// /thoughts/:thoughtId/ciphertext` had no client anywhere. It does have
// one — `bin/agenttool-rotate:277`, 18KB of TypeScript behind
// `#!/usr/bin/env bun` and no `.ts` — and the probe could not see it
// because it read "code file" as "file with a code extension".
test("live repository: an extensionless shebang script counts as a client", async () => {
  const findings = await liveFindings();
  const finding = at(findings, "api/src/routes/strand/thoughts.ts", "/v1/strands has clients");
  expect(finding, "the only client of the ciphertext route is bin/agenttool-rotate").toBeUndefined();

  const scope = liveScope();
  expect(scope.files).toContain("bin/agenttool-rotate");
  expect(scope.lines("bin/agenttool-rotate")[0]).toContain("#!");
  expect(scope.lines("bin/agenttool-rotate").join("\n")).toContain(
    "/v1/strands/${strandId}/thoughts/${thoughtId}/ciphertext",
  );
}, LIVE_TIMEOUT_MS);

test("live repository: the public routers whose mounts are commented out", async () => {
  const findings = await liveFindings();
  const finding = at(findings, "api/src/routes/public/self-love.ts", "nothing mounts it");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("GET /kinds");
}, LIVE_TIMEOUT_MS);

test("live repository: a transform reachable only from its own test", async () => {
  const findings = await liveFindings();
  const finding = at(findings, "api/src/lib/xenoform.ts", "applyXenoform is reachable only");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("api/tests/xenoform.test.ts");
  expect(finding?.detail).toContain("identityAuthorityHeaders");
}, LIVE_TIMEOUT_MS);

test("live repository: published SDK signers with no caller and no document", async () => {
  const findings = await liveFindings();
  const finding = titled(findings, "have no caller and no document");
  expect(finding?.verdict).toBe("gap");
  // Asserted by path rather than by symbol name on purpose: this test file
  // is in the corpus, so naming a symbol here would give it a reference and
  // move it out of the very category being asserted. Paths tokenise to
  // segments, so they cannot.
  expect(finding?.evidence).toContain("packages/sdk-ts/src/lounge.ts");
  expect(finding?.evidence).toContain("packages/wallet/src/signatures.ts");
}, LIVE_TIMEOUT_MS);

test("live repository: the route inventory is published as resolved, not as complete", async () => {
  const findings = await liveFindings();
  const limit = titled(findings, "resolved, not read off the running router");
  expect(limit?.verdict).toBe("limit");
  expect(limit?.evidence).toContain(EXECUTE_ENV);
}, LIVE_TIMEOUT_MS);

test("live repository: the resolved inventory reconciles against the running router", async () => {
  // Ground truth is the table the framework matches requests against, and
  // the only way to have it is to import the app's entry module and read
  // `app.routes`. That runs repository code, so it happens here — in the
  // test, deliberately — rather than in the probe's default path.
  //
  // If the app cannot be imported in this environment the assertion is on
  // the *report of that*, never on silence: an unmeasured delta that reads
  // as a measured zero is the failure this whole rebuild is about.
  const scope = liveScope();
  const projects = await TsProjects.open(scope);
  if (projects.api === null) {
    expect(projects.unavailable).toBeTruthy();
    return;
  }
  const entries = new Set(scope.files.filter((file) => file === "api/src/index.ts"));
  const previous = process.env[EXECUTE_ENV];
  process.env[EXECUTE_ENV] = "1";
  let inventory;
  try {
    inventory = buildRouteInventory(scope, projects, entries);
  } finally {
    if (previous === undefined) delete process.env[EXECUTE_ENV];
    else process.env[EXECUTE_ENV] = previous;
  }

  if (inventory.executed === null) {
    expect(inventory.executionNote, "a failed execution must say so verbatim").toContain("not executed");
    return;
  }

  expect(inventory.executed.routes.length).toBeGreaterThan(500);
  const delta = reconcile(inventory);
  expect(delta.comparedRoots).toContain("api/src/index.ts#app");
  // The resolver must invent nothing: a route in the model and not on the
  // router makes every coverage statement about it a statement about
  // nothing.
  expect(delta.notOnRouter, "the resolver reported routes the router does not have").toEqual([]);
  // And what it misses is bounded and named rather than absorbed. The two
  // it misses at the time of writing are trailing-slash spellings Hono
  // emits for a child mounted at `/`; the assertion is on the shape of the
  // miss, so a real regression in mount resolution goes red here.
  expect(delta.missedByResolver.length).toBeLessThan(inventory.executed.routes.length * 0.02);
  for (const missed of delta.missedByResolver) {
    expect(inventory.routes.some((route) => `${route.method.toUpperCase()} ${route.path}` === missed.replace(/\/$/, ""))).toBe(
      true,
    );
  }
}, LIVE_TIMEOUT_MS);

test("live repository: reach's own files produce no gap against reach", async () => {
  const findings = await liveFindings();
  // Scoped to the files this probe owns rather than to all of
  // `packages/rhizome/`. Sibling probes are being written into this package
  // concurrently, and reach does find gaps in them. What reach can honestly
  // claim is its own files.
  const own = findings.filter(
    (finding) =>
      finding.verdict === "gap" &&
      (finding.file === "packages/rhizome/src/probes/reach.ts" ||
        finding.file.startsWith("packages/rhizome/src/probes/reach/") ||
        finding.file === "packages/rhizome/tests/reach.test.ts"),
  );
  expect(own.map((finding) => `${finding.file}:${finding.line} ${finding.title}`)).toEqual([]);
}, LIVE_TIMEOUT_MS);
