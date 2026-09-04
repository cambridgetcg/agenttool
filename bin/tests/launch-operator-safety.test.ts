import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const KEY = "fixture-private-bearer-must-not-be-printed";
const DID = "did:at:fixture/selected";

async function runSmoke(base: string, args: string[] = [], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bash", join(ROOT, "bin/smoke-test.sh"), ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, AGENTTOOL_BASE: base, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  return { status, output: stdout + stderr };
}

function body(path: string): unknown {
  switch (path) {
    case "/health": return { build: { revision: "fixture-revision", dirty: false } };
    case "/public/plans": return { _format: "agenttool-plans/v1", free_to_try: { implementation_status: {} } };
    case "/public/safety": return { _format: "agenttool-safety/v2" };
    case "/public/discovery": return { format: "agenttool-discovery/v1", roads: [{}, {}, {}] };
    case "/federation/about": return { federation: { enabled: false } };
    case "/v1/openapi.json": return { openapi: "3.1.0", paths: { "/v1/wake": {} } };
    case "/v1/platform/wake": return { self: { did: "did:at:platform", name: "agenttool" } };
    case "/v1/wake": return { you: { agents: [{ id: OTHER, did: "did:at:other" }, { id: ID, did: DID }] } };
    default: return {};
  }
}

function fixture(override?: (request: Request) => Response | undefined) {
  const seen: { method: string; path: string; search: string; auth: string | null; data: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      seen.push({ method: request.method, path: url.pathname, search: url.search, auth: request.headers.get("authorization"), data: await request.clone().text() });
      const replacement = override?.(request);
      if (replacement) return replacement;
      if (url.searchParams.get("format") === "md") return new Response("# Selected wake\n", { headers: { "content-type": "text/markdown" } });
      return Response.json(body(url.pathname));
    },
  });
  return { seen, server, base: server.url.origin };
}

describe("launch smoke authority and transport boundaries", () => {
  test("public default only reads fixed routes and does not claim private wake coverage", async () => {
    const f = fixture();
    try {
      const result = await runSmoke(f.base, [], { SMOKE_DISPOSABLE_IDENTITY_ID: ID });
      expect(result.status).toBe(0);
      expect(result.output).toContain("NOT CHECKED private wake");
      expect(f.seen).toHaveLength(7);
      expect(f.seen.every(r => r.method === "GET" && r.auth === null)).toBe(true);
      expect(f.seen.some(r => r.path === "/v1/wake")).toBe(false);
    } finally { f.server.stop(true); }
  });

  test("paired credentials reach only selected-identity wake GETs, even with ambient disposal acknowledgement", async () => {
    const f = fixture();
    try {
      const result = await runSmoke(f.base, [], {
        AGENTTOOL_API_KEY: KEY, AGENTTOOL_IDENTITY_ID: ID, SMOKE_DISPOSABLE_IDENTITY_ID: ID,
      });
      expect(result.status).toBe(0);
      expect(result.output).not.toContain(KEY);
      expect(f.seen).toHaveLength(9);
      for (const r of f.seen) {
        expect(r.method).toBe("GET");
        expect(r.auth).toBe(r.path === "/v1/wake" ? `Bearer ${KEY}` : null);
        if (r.path === "/v1/wake") expect(new URLSearchParams(r.search).get("identity_id")).toBe(ID);
      }
    } finally { f.server.stop(true); }
  });

  test("redirects fail without forwarding the bearer or retrying", async () => {
    const target = fixture();
    const f = fixture(request => new URL(request.url).pathname === "/v1/wake"
      ? Response.redirect(`${target.base}/redirect-target`, 302) : undefined);
    try {
      const result = await runSmoke(f.base, [], { AGENTTOOL_API_KEY: KEY, AGENTTOOL_IDENTITY_ID: ID });
      expect(result.status).toBe(1);
      expect(target.seen).toHaveLength(0);
      expect(f.seen.filter(r => r.path === "/v1/wake")).toHaveLength(2);
      expect(result.output).not.toContain(KEY);
    } finally { f.server.stop(true); target.server.stop(true); }
  });

  test("HTTP failure, wrong contracts, and echoed credentials cannot produce a green result or body output", async () => {
    for (const response of [new Response("private error", { status: 503 }), Response.json({}), Response.json({ ...body("/public/plans") as object, secret: KEY })]) {
      const f = fixture(request => new URL(request.url).pathname === "/public/plans" ? response : undefined);
      try {
        const result = await runSmoke(f.base, [], { AGENTTOOL_API_KEY: KEY, AGENTTOOL_IDENTITY_ID: ID });
        expect(result.status).toBe(1);
        expect(result.output).toContain("FAIL /public/plans");
        expect(result.output).not.toContain(KEY);
        expect(result.output).not.toContain("private error");
        expect(f.seen.filter(r => r.path === "/public/plans")).toHaveLength(1);
      } finally { f.server.stop(true); }
    }
  });

  test("refuses partial credentials, invalid origins, and unacknowledged mutation before HTTP", async () => {
    const f = fixture();
    try {
      for (const [base, args, env] of [
        [f.base, [], { AGENTTOOL_API_KEY: KEY }],
        [`${f.base}/unexpected-path`, [], {}],
        [f.base.replace("http://", "http://user:secret@"), [], {}],
        ["http://example.com", [], {}],
        [f.base, ["--mutate-disposable"], {}],
        [f.base, ["--mutate-disposable"], { AGENTTOOL_API_KEY: KEY, AGENTTOOL_IDENTITY_ID: ID, SMOKE_DISPOSABLE_IDENTITY_ID: OTHER }],
      ] as [string, string[], Record<string, string>][]) {
        expect((await runSmoke(base, args, env)).status).toBe(2);
      }
      expect(f.seen).toHaveLength(0);
    } finally { f.server.stop(true); }
  });

  test("disposable opt-in still stops before writes when the requested identity is absent", async () => {
    const f = fixture(request => new URL(request.url).pathname === "/v1/wake"
      ? Response.json({ you: { agents: [{ id: OTHER, did: "did:at:other" }] } }) : undefined);
    try {
      const result = await runSmoke(f.base, ["--mutate-disposable"], {
        AGENTTOOL_API_KEY: KEY, AGENTTOOL_IDENTITY_ID: ID, SMOKE_DISPOSABLE_IDENTITY_ID: ID,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("no mutation performed");
      expect(f.seen.every(r => r.method === "GET")).toBe(true);
    } finally { f.server.stop(true); }
  });

  test("explicit disposable fixture writes bind the selected identity instead of the first wake agent", async () => {
    const f = fixture(request => request.method === "POST"
      ? Response.json({ id: "fixture-resource" }) : undefined);
    try {
      await runSmoke(f.base, ["--mutate-disposable"], {
        AGENTTOOL_API_KEY: KEY, AGENTTOOL_IDENTITY_ID: ID, SMOKE_DISPOSABLE_IDENTITY_ID: ID,
      });
      const writes = f.seen.filter(r => r.method !== "GET");
      expect(writes.map(r => [r.method, r.path])).toEqual([
        ["POST", "/v1/strands"], ["POST", "/v1/memories"], ["POST", "/v1/chronicle"],
        ["PATCH", "/v1/strands/fixture-resource"], ["PATCH", `/v1/identities/${ID}`],
      ]);
      for (const r of writes.slice(0, 3)) {
        const payload = JSON.parse(r.data);
        expect(payload.identity_id ?? payload.agent_id).toBe(ID);
      }
      expect(f.seen.some(r => r.path === "/public/agents/did%3Aat%3Afixture%2Fselected")).toBe(true);
    } finally { f.server.stop(true); }
  });
});

describe("legacy deploy-check compatibility", () => {
  test("delegates each gate and preserves failing process exit codes without claiming deployment readiness", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenttool-deploy-check-"));
    const bin = join(dir, "bin");
    await mkdir(bin);
    await copyFile(join(ROOT, "bin/deploy-check.sh"), join(bin, "deploy-check.sh"));
    await copyFile(join(ROOT, "bin/bash-without-env-hooks.sh"), join(bin, "bash-without-env-hooks.sh"));
    await writeFile(join(bin, "preflight.sh"), 'printf "GATE:%s\\n" "$1"\nexit "${FIXTURE_EXIT:-0}"\n');
    try {
      for (const [args, mode] of [[[], "hermetic"], [["--quick"], "api"]] as [string[], string][]) {
        for (const status of [0, 17]) {
          const result = Bun.spawnSync(["sh", join(bin, "deploy-check.sh"), ...args], {
            env: { PATH: process.env.PATH, FIXTURE_EXIT: String(status) }, stdout: "pipe", stderr: "pipe",
          });
          expect(result.exitCode).toBe(status);
          expect(result.stdout.toString()).toContain(`GATE:${mode}`);
          expect(result.stdout.toString()).not.toContain("Ready to deploy");
        }
      }
      for (const args of [["--migrations"], ["--quick", "--migrations"], ["--unknown"]]) {
        const result = Bun.spawnSync(["sh", join(bin, "deploy-check.sh"), ...args], {
          env: { PATH: process.env.PATH }, stdout: "pipe", stderr: "pipe",
        });
        expect(result.exitCode).toBe(2);
        expect(result.stdout.toString()).not.toContain("GATE:");
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
