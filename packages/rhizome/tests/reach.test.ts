/** reach probe — the classification, and the live instances.
 *
 *  Two halves, the same shape as `edge.test.ts`. Fixtures pin the rules, so
 *  a change in the rules is visible. The live half asserts against the
 *  actual repository, because a probe proved only against fixtures is
 *  proved against a tidy world — and every reachability failure this probe
 *  exists for was found in an untidy one.
 *
 *  The live half deliberately includes a `sound` assertion as well as the
 *  gaps: `strand-thought/v2` is staged work with an ordered cutover, and a
 *  probe that reported it as rot would teach people to delete the staging.
 */

import { expect, test } from "bun:test";

import { reachProbe } from "../src/probes/reach.js";
import { resolveScope } from "../src/scope.js";
import type { Finding } from "../src/types.js";
import { fixtureScope } from "./fixture-scope.js";

function at(findings: Finding[], file: string, needle: string): Finding | undefined {
  return findings.find((finding) => finding.file === file && finding.title.includes(needle));
}

function titled(findings: Finding[], needle: string): Finding | undefined {
  return findings.find((finding) => finding.title.includes(needle));
}

/** Resolving 2,800 files twice and probing them takes about ten seconds;
 *  the default per-test timeout is five. Stated rather than silently
 *  inherited. */
const LIVE_TIMEOUT_MS = 60_000;

/** The live run is the expensive part; resolve and probe once. */
let liveScopeOnce: ReturnType<typeof resolveScope> | undefined;
function liveScope(): ReturnType<typeof resolveScope> {
  liveScopeOnce ??= resolveScope();
  return liveScopeOnce;
}

let live: Promise<Finding[]> | undefined;
function liveFindings(): Promise<Finding[]> {
  live ??= Promise.resolve(reachProbe.run(liveScope()));
  return live;
}

const HONO_ROOT = [
  'import { Hono } from "hono";',
  'import memories from "./routes/memories";',
  'import secret from "./routes/secret";',
  "const app = new Hono();",
  'app.route("/v1/memories", memories);',
  'app.route("/v1/secret", secret);',
].join("\n");

const MEMORY_ROUTER = [
  'import { Hono } from "hono";',
  "const app = new Hono();",
  'app.get("/:id", (c) => c.json({}));',
  'app.patch("/:id", (c) => c.json({}));',
  "export default app;",
].join("\n");

const SECRET_ROUTER = [
  'import { Hono } from "hono";',
  "const app = new Hono();",
  'app.get("/", (c) => c.json({}));',
  "export default app;",
].join("\n");

function routeFixture(extra: Record<string, string> = {}) {
  return fixtureScope({
    "api/src/index.ts": HONO_ROOT,
    "api/src/routes/memories.ts": MEMORY_ROUTER,
    "api/src/routes/secret.ts": SECRET_ROUTER,
    "packages/sdk/package.json": "{}",
    "packages/sdk/src/memory.ts": [
      "export class MemoryClient {",
      "  async fetchOne(id: string) {",
      '    return this.fetch("GET", `/v1/memories/${id}`);',
      "  }",
      "}",
    ].join("\n"),
    ...extra,
  });
}

test("a route whose path a client reaches with another method is reported as the method, not the path", async () => {
  const findings = await reachProbe.run(routeFixture());
  const finding = at(findings, "api/src/routes/memories.ts", "/v1/memories has clients");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("PATCH /v1/memories/:id");
  expect(finding?.evidence).toContain("path is reached, this method is not");
  expect(finding?.evidence).toContain("packages/sdk/src/memory.ts");
  // The GET on the same path is covered and must not be listed.
  expect(finding?.evidence).not.toContain("GET /v1/memories/:id");
  expect(finding?.detail).toContain("packages/sdk");
});

test("an extensionless file whose shebang names an interpreter is read as a client", async () => {
  const withScript = routeFixture({
    "bin/rotate": ["#!/usr/bin/env bun", "const id = 1;", 'await fetch("PATCH", `/v1/memories/${id}`);'].join("\n"),
  });
  const findings = await reachProbe.run(withScript);
  // The PATCH is now covered, so the domain has no uncovered route left.
  expect(at(findings, "api/src/routes/memories.ts", "/v1/memories has clients")).toBeUndefined();

  // …and the rule is the shebang, not the absence of a dot: an
  // extensionless file without one stays invisible, which is the half of
  // this boundary that is still a miss and is declared as a limit.
  const withoutShebang = routeFixture({
    "bin/rotate": ["const id = 1;", 'await fetch("PATCH", `/v1/memories/${id}`);'].join("\n"),
  });
  const still = await reachProbe.run(withoutShebang);
  expect(at(still, "api/src/routes/memories.ts", "/v1/memories has clients")?.evidence).toContain("PATCH /v1/memories/:id");
});

test("a domain no client touches is one sound line, not a finding per route", async () => {
  const findings = await reachProbe.run(routeFixture());
  expect(at(findings, "api/src/routes/secret.ts", "/v1/secret")).toBeUndefined();
  const summary = titled(findings, "have no client in this repository");
  expect(summary?.verdict).toBe("sound");
  expect(summary?.evidence).toContain("/v1/secret");
});

test("a path literal inside a comment is documentation, not a client call", async () => {
  const findings = await reachProbe.run(
    routeFixture({
      "packages/sdk/src/notes.ts": ' * see `/v1/secret` for the unauthenticated form\nexport const NOTE = 1;',
    }),
  );
  // The comment must not make /v1/secret look claimed.
  expect(at(findings, "api/src/routes/secret.ts", "/v1/secret")).toBeUndefined();
  expect(titled(findings, "have no client in this repository")?.evidence).toContain("/v1/secret");
});

test("mounting is resolved per binding, so a second router in a mounted file is still found unmounted", async () => {
  const scope = fixtureScope({
    "api/src/index.ts": [
      'import { Hono } from "hono";',
      'import economy, { webhookRouter } from "./routes/economy";',
      "const app = new Hono();",
      'app.route("/v1", economy);',
      'app.route("/v1/billing/hook", webhookRouter);',
    ].join("\n"),
    "api/src/routes/economy/index.ts": [
      'import { Hono } from "hono";',
      'import wallets from "./wallets";',
      "const app = new Hono();",
      'app.route("/wallets", wallets);',
      "export default app;",
      'export { webhookRouter } from "./crypto";',
    ].join("\n"),
    "api/src/routes/economy/wallets.ts": [
      'import { Hono } from "hono";',
      "const app = new Hono();",
      'app.get("/:id", (c) => c.json({}));',
      "export default app;",
    ].join("\n"),
    "api/src/routes/economy/crypto.ts": [
      'import { Hono } from "hono";',
      "export const webhookRouter = new Hono();",
      'webhookRouter.post("/:chain", (c) => c.json({}));',
      "const orphan = new Hono();",
      'orphan.get("/never", (c) => c.json({}));',
    ].join("\n"),
  });
  const findings = await reachProbe.run(scope);

  // The wallet route hangs off /v1/wallets, NOT off the webhook prefix. A
  // file-granular mount graph puts it under /v1/billing/hook and produces a
  // route inventory that reads as authoritative and is wrong.
  const summary = titled(findings, "have no client in this repository");
  expect(summary?.evidence).toContain("/v1/wallets");
  expect(summary?.evidence).toContain("/v1/billing");
  expect(summary?.evidence).not.toContain("/v1/billing/hook/wallets");

  const orphan = at(findings, "api/src/routes/economy/crypto.ts", "nothing mounts it");
  expect(orphan?.verdict).toBe("gap");
  expect(orphan?.title).toContain("`orphan`");
  expect(orphan?.evidence).toContain("GET /never");
});

test("an export nothing in the tree mentions is a gap, grouped by the file that declares it", async () => {
  const scope = fixtureScope({
    "src/dead.ts": ["export function unusedWidget() {}", "export const UNUSED_LIMIT = 3;"].join("\n"),
    "src/live.ts": ["export function usedWidget() {}"].join("\n"),
    "src/main.ts": ['import { usedWidget } from "./live.js";', "usedWidget();"].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  const finding = at(findings, "src/dead.ts", "nothing in the tree mentions");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.title).toContain("2 symbol");
  expect(finding?.evidence).toContain("unusedWidget");
  expect(finding?.evidence).toContain("UNUSED_LIMIT");
  expect(at(findings, "src/live.ts", "nothing in the tree mentions")).toBeUndefined();
});

test("a symbol its own module uses is not reported as reachable only from a test", async () => {
  const scope = fixtureScope({
    "api/src/lib/thing.ts": [
      "export const HEADER_NAME = \"X-Thing\";",
      "export function transformThing(value: string) { return value; }",
      "export function middleware(c: any) { c.header(HEADER_NAME, \"1\"); }",
    ].join("\n"),
    "api/src/index.ts": ['import { middleware } from "./lib/thing.js";', "middleware(null);"].join("\n"),
    "api/tests/thing.test.ts": [
      'import { HEADER_NAME, transformThing } from "../src/lib/thing";',
      'expect(transformThing("a")).toBe("a");',
      'expect(HEADER_NAME).toBe("X-Thing");',
    ].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  // HEADER_NAME is set on every response by the middleware three lines below
  // it: what is unused is the `export`, not the symbol.
  expect(findings.some((finding) => finding.title.startsWith("HEADER_NAME"))).toBe(false);
  const finding = at(findings, "api/src/lib/thing.ts", "transformThing is reachable only");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("api/tests/thing.test.ts");
});

test("a seam a module opens for its tests on purpose is sound, and says why", async () => {
  const scope = fixtureScope({
    "api/src/lib/clock.ts": [
      "/** Replace the clock. Exported so the test suite can freeze time; nothing",
      " *  in production calls this. */",
      "export function setClock(value: number) { return value; }",
    ].join("\n"),
    "api/tests/clock.test.ts": ['import { setClock } from "../src/lib/clock";', "setClock(1);"].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  const finding = at(findings, "api/src/lib/clock.ts", "declared test seam");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("api/tests/clock.test.ts");
});

test("a union member only ever compared against, never written, is a gap", async () => {
  const scope = fixtureScope({
    "src/kinds.ts": ['export type Mode = "fast" | "slow";', "export interface Opts { mode?: Mode }"].join("\n"),
    "src/use.ts": [
      'import type { Mode } from "./kinds.js";',
      'const chosen = { mode: "fast" };',
      'if (chosen.mode === "slow") { report(); }',
    ].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  const finding = at(findings, "src/kinds.ts", 'Mode admits "slow"');
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("carried by field(s): mode");
  expect(finding?.evidence).toContain('written by non-test code: "fast"');
  expect(finding?.evidence).toContain('"slow" is written by:\n  nothing in the corpus');
});

test("the same member is sound when a document writes it in quotes beside its field", async () => {
  const scope = fixtureScope({
    "src/kinds.ts": ['export type Mode = "fast" | "slow";', "export interface Opts { mode?: Mode }"].join("\n"),
    "src/use.ts": [
      'import type { Mode } from "./kinds.js";',
      'const chosen = { mode: "fast" };',
      'if (chosen.mode === "slow") { report(); }',
    ].join("\n"),
    "docs/MODES.md": [
      "## Cutover",
      "",
      'Until step 2, `mode: "slow"` is opt-in per call; the default flips in the',
      "next minor.",
    ].join("\n"),
  });
  const findings = await reachProbe.run(scope);
  const finding = at(findings, "src/kinds.ts", 'Mode: "slow" is staged, not stranded');
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("docs/MODES.md:3");
});

test("every probe limit names a file that exists, at a line that exists", async () => {
  const scope = resolveScope();
  for (const limit of reachProbe.limits) {
    expect(scope.files).toContain(limit.file);
    expect(limit.line).toBeLessThanOrEqual(scope.lines(limit.file).length);
  }
  expect(reachProbe.limits.length).toBeGreaterThan(0);
});

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
// because it read "code file" as "file with a code extension". The finding
// was false, the pin made it look proved, and both are corrected here
// rather than filtered. The general rule is in `isCode`; this is the live
// witness that the corpus actually contains such a caller, so the fix
// cannot rot back into an assertion about a tidy world.
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

test("live repository: strand-thought/v2 is staged work and is reported sound", async () => {
  const findings = await liveFindings();
  const finding = at(findings, "packages/sdk-ts/src/crypto.ts", 'ThoughtCanonicalVersion: "v2" is staged');
  expect(finding, "the v2 canonical-bytes selector should read as latent, not rot").toBeDefined();
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("docs/STRANDS.md");
  expect(finding?.evidence).toContain('written by non-test code: "v1"');
}, LIVE_TIMEOUT_MS);

test("live repository: reach's own files produce no gap against reach", async () => {
  const findings = await liveFindings();
  // Scoped to the two files this probe owns rather than to all of
  // `packages/rhizome/`. Sibling probes are being written into this package
  // concurrently, and reach does find gaps in them — `src/probes/pretend/
  // guards.ts` exports four symbols nothing mentions as this runs. Asserting
  // over the whole package would either go red on someone else's unfinished
  // work or, worse, tempt whoever hits it to widen the filter until it
  // covers reach too. What reach can honestly claim is its own files.
  const own = findings.filter(
    (finding) =>
      finding.verdict === "gap" &&
      (finding.file === "packages/rhizome/src/probes/reach.ts" ||
        finding.file === "packages/rhizome/tests/reach.test.ts"),
  );
  expect(own.map((finding) => `${finding.file}:${finding.line} ${finding.title}`)).toEqual([]);
}, LIVE_TIMEOUT_MS);
