import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import scaffold, { scaffoldApiBase } from "../src/routes/scaffold";

const ROOT = join(import.meta.dir, "..", "..");
const TEST_BEARER = "at_scaffold_secret_that_must_not_leave_auth";
const INJECTION_NAME = "Aurora\n$(touch /tmp/agenttool-scaffold-injected)\n'\"";
const INJECTION_DID = "did:at:test\nEOF\nrm -rf /";

function harness(projectId = "00000000-0000-0000-0000-000000000001") {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId, name: "test-project" } as never);
    c.set("bearerToken", TEST_BEARER);
    await next();
  });
  app.route("/v1/bootstrap/scaffold", scaffold);
  return app;
}

async function textScript(platform: "macos" | "linux" | "windows") {
  const query = new URLSearchParams({
    platform,
    format: "text",
    did: INJECTION_DID,
    name: INJECTION_NAME,
  });
  const res = await harness().request(`/v1/bootstrap/scaffold?${query}`);
  return { res, script: await res.text() };
}

function decodedConfigs(script: string): Array<Record<string, unknown>> {
  const candidates = script.match(/[A-Za-z0-9+/]{80,}={0,2}/g) ?? [];
  return candidates.flatMap((candidate) => {
    try {
      const parsed = JSON.parse(Buffer.from(candidate, "base64").toString("utf8"));
      return [parsed as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

describe("scaffold executable-response boundary", () => {
  test("macOS and Linux scripts parse, contain no bearer, and encode query data as inert config", async () => {
    for (const platform of ["macos", "linux"] as const) {
      const { res, script } = await textScript(platform);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(script).toContain("AT_API_KEY");
      expect(script).not.toContain(TEST_BEARER);
      expect(script).not.toContain(INJECTION_NAME);
      expect(script).not.toContain(INJECTION_DID);
      expect(script).not.toContain('-H "Authorization: Bearer $KEY"');
      expect(script).toContain("-H @-");

      const syntax = spawnSync("bash", ["-n"], {
        input: script,
        encoding: "utf8",
      });
      expect(syntax.status).toBe(0);

      const configs = decodedConfigs(script);
      expect(configs.length).toBeGreaterThan(0);
      expect(configs.every((config) => config.did === INJECTION_DID)).toBe(true);
      expect(configs.every((config) => config.name === INJECTION_NAME)).toBe(true);
    }
  });

  test("Windows script keeps bearer and hostile query text out of the response", async () => {
    const { res, script } = await textScript("windows");
    expect(res.status).toBe(200);
    expect(script).toContain("$env:AT_API_KEY");
    expect(script).not.toContain(TEST_BEARER);
    expect(script).not.toContain(INJECTION_NAME);
    expect(script).not.toContain(INJECTION_DID);
    expect(script).not.toContain("cmdkey");
    expect(script).toContain("PasswordVault");
    expect(script).toContain("-MaximumRedirection 0");

    const configs = decodedConfigs(script);
    expect(configs).toHaveLength(1);
    expect(configs[0]?.did).toBe(INJECTION_DID);
    expect(configs[0]?.name).toBe(INJECTION_NAME);
  });

  test("macOS uses the Security framework instead of an ignored stdin pipe", async () => {
    const { script } = await textScript("macos");
    expect(script).toContain("import Security");
    expect(script).toContain("SecItemUpdate");
    expect(script).not.toContain("security add-generic-password");
  });

  test("different projects receive different credential and config namespaces", async () => {
    const first = await harness("project-one").request(
      "/v1/bootstrap/scaffold?platform=linux",
    );
    const second = await harness("project-two").request(
      "/v1/bootstrap/scaffold?platform=linux",
    );
    const firstBody = (await first.json()) as Record<string, unknown>;
    const secondBody = (await second.json()) as Record<string, unknown>;

    expect(firstBody.credential_namespace).not.toBe(secondBody.credential_namespace);
    expect(firstBody.credential_service).not.toBe(secondBody.credential_service);
    expect(firstBody.install_script).toContain(
      `.config/agenttool/${firstBody.credential_namespace}`,
    );
    expect(secondBody.install_script).toContain(
      `.config/agenttool/${secondBody.credential_namespace}`,
    );
  });

  test("requires an explicit remote API origin and permits loopback development", async () => {
    expect(scaffoldApiBase("http://selfhost.example/v1/bootstrap/scaffold")).toBeNull();
    expect(scaffoldApiBase("https://selfhost.example/v1/bootstrap/scaffold")).toBeNull();
    expect(scaffoldApiBase("http://127.0.0.1:3000/v1/bootstrap/scaffold")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(
      scaffoldApiBase(
        "https://untrusted.example/v1/bootstrap/scaffold",
        "https://selfhost.example/a/path?ignored=1",
      ),
    ).toBe("https://selfhost.example");
    expect(
      scaffoldApiBase("http://localhost/", "http://selfhost.example"),
    ).toBeNull();
    expect(
      scaffoldApiBase("http://localhost/", "https://user:secret@selfhost.example"),
    ).toBeNull();

    const res = await harness().request(
      "https://selfhost.example/v1/bootstrap/scaffold?platform=linux",
    );
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(503);
    expect(body.error).toBe("unsafe_scaffold_api_base");
  });

  test("JSON variants explicitly state that no credential is embedded", async () => {
    for (const path of [
      "/v1/bootstrap/scaffold?platform=macos",
      "/v1/bootstrap/scaffold",
    ]) {
      const res = await harness().request(path);
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(body.credential_embedded_in_response).toBe(false);
      expect(JSON.stringify(body)).not.toContain(TEST_BEARER);
    }
  });

  test("published scaffold examples require inspection instead of a direct pipe", () => {
    for (const path of ["apps/docs/index.html", "apps/docs/bootstrap.html"]) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source).toContain("mktemp");
      expect(source).not.toMatch(/bootstrap\/scaffold[^<\n]*[\s\S]{0,180}\| bash/);
    }
  });

  test("the literal scaffold route mounts before bootstrap's parameter route", () => {
    const source = readFileSync(join(ROOT, "api/src/index.ts"), "utf8");
    const scaffoldAt = source.indexOf(
      'app.route("/v1/bootstrap/scaffold", scaffoldRouter)',
    );
    const bootstrapAt = source.indexOf(
      'app.route("/v1/bootstrap", bootstrapRouter)',
    );

    expect(scaffoldAt).toBeGreaterThan(-1);
    expect(bootstrapAt).toBeGreaterThan(scaffoldAt);
  });
});
