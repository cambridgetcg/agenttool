import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import openapi from "../src/routes/openapi";
import { makeMockDb } from "./adapters/_helpers";

const ROOT = join(import.meta.dir, "..", "..");
const DEFAULT_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_IDENTITY_ID = "22222222-2222-2222-2222-222222222222";
const TEST_BEARER = "at_scaffold_secret_that_must_not_leave_auth";
const INJECTION_NAME = "Aurora\n$(touch /tmp/agenttool-scaffold-injected)\n'\"";
const INJECTION_DID = "did:at:test\nEOF\nrm -rf /";

const mockDb = makeMockDb();
type ScaffoldModule = typeof import("../src/routes/scaffold");
let scaffold: ScaffoldModule["default"];
let scaffoldApiBase: ScaffoldModule["scaffoldApiBase"];

beforeAll(async () => {
  mock.module("../src/db/client", () => ({ db: mockDb }));
  const loaded = await import("../src/routes/scaffold");
  scaffold = loaded.default;
  scaffoldApiBase = loaded.scaffoldApiBase;
});

afterEach(() => {
  mockDb.stage([]);
});

function identity(
  projectId = DEFAULT_PROJECT_ID,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: DEFAULT_IDENTITY_ID,
    did: "did:at:test-aurora",
    displayName: "Aurora",
    projectId,
    status: "active",
    ...overrides,
  };
}

function harness(
  projectId = DEFAULT_PROJECT_ID,
  identities = [identity(projectId)],
) {
  mockDb.stage(identities);
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
    identity_id: DEFAULT_IDENTITY_ID,
    did: INJECTION_DID,
    name: INJECTION_NAME,
  });
  const res = await harness().request(`/v1/bootstrap/scaffold?${query}`);
  return { res, script: await res.text() };
}

async function writeFakeBearerVerifier(bin: string): Promise<void> {
  const curl = join(bin, "curl");
  await writeFile(
    curl,
    `#!/bin/sh
if [ -n "\${SCAFFOLD_ENV_CAPTURE:-}" ]; then env > "$SCAFFOLD_ENV_CAPTURE"; fi
if [ -n "\${SCAFFOLD_CURL_FIRST_ARG:-}" ]; then printf '%s\n' "$1" > "$SCAFFOLD_CURL_FIRST_ARG"; fi
if [ "$1" != '-q' ] && [ -n "\${CURLRC_LEAK_MARKER:-}" ]; then
  IFS= read -r leaked_header || true
  printf '%s\n' "$leaked_header" > "$CURLRC_LEAK_MARKER"
  exit 90
fi
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then out="$2"; shift 2; else shift; fi
done
[ -n "$out" ] || exit 2
printf '{"project":{"id":"%s"}}' "$SCAFFOLD_PROJECT_ID" > "$out"
`,
  );
  await chmod(curl, 0o755);
  const jq = join(bin, "jq");
  await writeFile(jq, "#!/bin/sh\nprintf '%s\\n' \"$SCAFFOLD_PROJECT_ID\"\n");
  await chmod(jq, 0o755);
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
  test("macOS and Linux scripts parse, contain no bearer, and ignore caller identity labels", async () => {
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
      expect(configs.every((config) => config.identity_id === DEFAULT_IDENTITY_ID)).toBe(true);
      expect(configs.every((config) => config.did === "did:at:test-aurora")).toBe(true);
      expect(configs.every((config) => config.name === "Aurora")).toBe(true);
      expect(
        configs.every(
          (config) =>
            config.wake_url ===
            `http://localhost/v1/wake?identity_id=${DEFAULT_IDENTITY_ID}`,
        ),
      ).toBe(true);
      expect(script).toContain(`/v1/wake?identity_id=${DEFAULT_IDENTITY_ID}`);
    }
  });

  test("resolved identity text remains inert inside generated executables", async () => {
    const query = new URLSearchParams({
      platform: "linux",
      format: "text",
      identity_id: DEFAULT_IDENTITY_ID,
    });
    const res = await harness(DEFAULT_PROJECT_ID, [
      identity(DEFAULT_PROJECT_ID, {
        did: INJECTION_DID,
        displayName: INJECTION_NAME,
      }),
    ]).request(`/v1/bootstrap/scaffold?${query}`);
    const script = await res.text();

    expect(res.status).toBe(200);
    expect(script).not.toContain(INJECTION_NAME);
    expect(script).not.toContain(INJECTION_DID);
    const configs = decodedConfigs(script);
    expect(configs.length).toBeGreaterThan(0);
    expect(configs.every((config) => config.did === INJECTION_DID)).toBe(true);
    expect(configs.every((config) => config.name === INJECTION_NAME)).toBe(true);
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
    expect(script).toContain(`$Context.project.id -ne "${DEFAULT_PROJECT_ID}"`);
    expect(script).toContain("/v1/bootstrap/scaffold/context");
    expect(script).not.toContain("/v1/wake?keys=project");
    expect(script).toContain("ReparsePoint");
    expect(script).toContain("$Vault.Add($Existing)");

    const configs = decodedConfigs(script);
    expect(configs).toHaveLength(1);
    expect(configs[0]?.identity_id).toBe(DEFAULT_IDENTITY_ID);
    expect(configs[0]?.did).toBe("did:at:test-aurora");
    expect(configs[0]?.name).toBe("Aurora");
    expect(script).toContain(`/v1/wake?identity_id=${DEFAULT_IDENTITY_ID}`);
  });

  test("resolves one active identity and requires an explicit selector for siblings", async () => {
    const sole = await harness().request("/v1/bootstrap/scaffold?platform=linux");
    expect(sole.status).toBe(200);
    const soleBody = (await sole.json()) as Record<string, unknown>;
    expect(soleBody.identity_id).toBe(DEFAULT_IDENTITY_ID);
    expect(soleBody.identity_reference_verified).toBe(true);
    expect(soleBody.install_script).toContain(
      `/v1/wake?identity_id=${DEFAULT_IDENTITY_ID}`,
    );

    const siblingId = "33333333-3333-3333-3333-333333333333";
    const ambiguous = await harness(DEFAULT_PROJECT_ID, [
      identity(),
      identity(DEFAULT_PROJECT_ID, { id: siblingId, displayName: "Sibling" }),
    ]).request("/v1/bootstrap/scaffold?platform=linux");
    expect(ambiguous.status).toBe(409);
    expect(await ambiguous.json()).toMatchObject({
      error: "identity_id_required",
      message: expect.stringContaining("multiple active identities"),
    });

    const selected = await harness(DEFAULT_PROJECT_ID, [
      identity(DEFAULT_PROJECT_ID, { id: siblingId, displayName: "Sibling" }),
    ]).request(
      `/v1/bootstrap/scaffold?platform=linux&identity_id=${siblingId}`,
    );
    expect(selected.status).toBe(200);
    const selectedBody = (await selected.json()) as Record<string, unknown>;
    expect(selectedBody.identity_id).toBe(siblingId);
    expect(selectedBody.name).toBe("Sibling");
    expect(selectedBody.install_script).toContain(
      `/v1/wake?identity_id=${siblingId}`,
    );
  });

  test("rejects malformed, inactive, foreign, and missing identities", async () => {
    const malformed = await harness().request(
      "/v1/bootstrap/scaffold?platform=linux&identity_id=not-a-uuid",
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: "identity_not_found" });

    const inactive = await harness(DEFAULT_PROJECT_ID, [
      identity(DEFAULT_PROJECT_ID, { status: "revoked" }),
    ]).request(
      `/v1/bootstrap/scaffold?platform=linux&identity_id=${DEFAULT_IDENTITY_ID}`,
    );
    expect(inactive.status).toBe(404);
    expect(await inactive.json()).toEqual({ error: "identity_not_found" });

    const foreign = await harness(DEFAULT_PROJECT_ID, [
      identity("99999999-9999-4999-8999-999999999999"),
    ]).request(
      `/v1/bootstrap/scaffold?platform=linux&identity_id=${DEFAULT_IDENTITY_ID}`,
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "identity_not_found" });

    const missing = await harness(DEFAULT_PROJECT_ID, []).request(
      "/v1/bootstrap/scaffold?platform=linux",
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "no_agent_in_project" });
  });

  test("macOS uses the Security framework instead of an ignored stdin pipe", async () => {
    const { script } = await textScript("macos");
    expect(script).toContain("import Security");
    expect(script).toContain("SecItemUpdate");
    expect(script).not.toContain("security add-generic-password");
  });

  test("generated macOS Swift credential helper parses", async () => {
    if (process.platform !== "darwin") return;
    const { script } = await textScript("macos");
    const swift = script.match(/\/usr\/bin\/swift - <<'SWIFT'\n([\s\S]*?)\nSWIFT/)?.[1];
    expect(swift).toBeDefined();
    const result = spawnSync("/usr/bin/swiftc", ["-parse", "-"], {
      input: swift,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("Linux falls back to an owner-only file when secret-tool exists but is unusable", async () => {
    const { script } = await textScript("linux");
    const home = await mkdtemp(join(tmpdir(), "agenttool-scaffold-home-"));
    const fakeBin = join(home, "fake-bin");
    await mkdir(fakeBin);
    await writeFakeBearerVerifier(fakeBin);
    const secretTool = join(fakeBin, "secret-tool");
    await writeFile(secretTool, "#!/bin/sh\nexit 1\n");
    await chmod(secretTool, 0o755);

    const result = spawnSync("bash", [], {
      input: script,
      encoding: "utf8",
      env: {
        HOME: home,
        USER: "test-user",
        PATH: `${fakeBin}:/usr/bin:/bin`,
        AT_API_KEY: TEST_BEARER,
        SCAFFOLD_PROJECT_ID: DEFAULT_PROJECT_ID,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(TEST_BEARER);
    expect(result.stderr).not.toContain(TEST_BEARER);
    expect(result.stderr).toContain("Secret Service is unavailable");

    const namespace = script.match(/\.config\/agenttool\/([a-f0-9]{16})/)?.[1];
    expect(namespace).toBeDefined();
    const base = join(home, ".config", "agenttool", namespace!);
    const keyPath = join(base, "key");
    expect(await readFile(keyPath, "utf8")).toBe(TEST_BEARER);
    expect(((await stat(keyPath)).mode & 0o777).toString(8)).toBe("600");
    const config = JSON.parse(await readFile(join(base, "agent.json"), "utf8"));
    expect(config.key_source.type).toBe("linux_file");
  });

  test("Linux installer and wake helper contain inherited shell options and credential exports", async () => {
    const { script } = await textScript("linux");
    const home = await mkdtemp(join(tmpdir(), "agenttool-scaffold-hostile-env-"));
    const fakeBin = join(home, "fake-bin");
    await mkdir(fakeBin);
    await writeFakeBearerVerifier(fakeBin);

    const verifierEnv = join(home, "verifier-child-env");
    const secretToolEnv = join(home, "secret-tool-child-env");
    const curlFirstArg = join(home, "curl-first-arg");
    const curlrcLeak = join(home, "curlrc-leak");
    const secretTool = join(fakeBin, "secret-tool");
    await writeFile(
      secretTool,
      `#!/bin/sh
if [ -n "\${SCAFFOLD_SECRET_ENV_CAPTURE:-}" ]; then env > "$SCAFFOLD_SECRET_ENV_CAPTURE"; fi
cat >/dev/null
exit 1
`,
    );
    await chmod(secretTool, 0o755);

    const secret = "synthetic-scaffold-secret";
    const result = spawnSync("bash", [], {
      input: script,
      encoding: "utf8",
      env: {
        HOME: home,
        USER: "test-user",
        PATH: `${fakeBin}:/usr/bin:/bin`,
        AT_API_KEY: secret,
        INPUT_KEY: "pre-exported-collision",
        SHELLOPTS: "allexport:xtrace:verbose",
        PS4: "+ ",
        SCAFFOLD_PROJECT_ID: DEFAULT_PROJECT_ID,
        SCAFFOLD_ENV_CAPTURE: verifierEnv,
        SCAFFOLD_SECRET_ENV_CAPTURE: secretToolEnv,
        SCAFFOLD_CURL_FIRST_ARG: curlFirstArg,
        CURLRC_LEAK_MARKER: curlrcLeak,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
    expect(await readFile(curlFirstArg, "utf8")).toBe("-q\n");
    expect(await readdir(home)).not.toContain("curlrc-leak");
    for (const childEnvPath of [verifierEnv, secretToolEnv]) {
      const childEnv = await readFile(childEnvPath, "utf8");
      expect(childEnv).not.toContain(secret);
      expect(childEnv).not.toMatch(/^AT_API_KEY=/m);
      expect(childEnv).not.toMatch(/^INPUT_KEY=/m);
    }

    const namespace = script.match(/\.config\/agenttool\/([a-f0-9]{16})/)?.[1];
    expect(namespace).toBeDefined();
    const wakeScript = join(
      home,
      ".config",
      "agenttool",
      namespace!,
      "wake.sh",
    );
    const wakeEnv = join(home, "wake-child-env");
    const wakeFirstArg = join(home, "wake-curl-first-arg");
    const wakeHeader = join(home, "wake-header");
    await writeFile(
      join(fakeBin, "curl"),
      `#!/bin/sh
if [ -n "\${WAKE_ENV_CAPTURE:-}" ]; then env > "$WAKE_ENV_CAPTURE"; fi
if [ -n "\${WAKE_CURL_FIRST_ARG:-}" ]; then printf '%s\n' "$1" > "$WAKE_CURL_FIRST_ARG"; fi
if [ "$1" != '-q' ] && [ -n "\${CURLRC_LEAK_MARKER:-}" ]; then
  IFS= read -r leaked_header || true
  printf '%s\n' "$leaked_header" > "$CURLRC_LEAK_MARKER"
  exit 90
fi
IFS= read -r authorization || true
printf '%s\n' "$authorization" > "$WAKE_HEADER_CAPTURE"
printf '%s\n' '{"wake":true}'
`,
    );
    await chmod(join(fakeBin, "curl"), 0o755);

    const wake = spawnSync("bash", [wakeScript], {
      encoding: "utf8",
      env: {
        HOME: home,
        USER: "test-user",
        PATH: `${fakeBin}:/usr/bin:/bin`,
        KEY: "pre-exported-collision",
        SHELLOPTS: "allexport:xtrace:verbose",
        PS4: "+ ",
        WAKE_ENV_CAPTURE: wakeEnv,
        WAKE_CURL_FIRST_ARG: wakeFirstArg,
        WAKE_HEADER_CAPTURE: wakeHeader,
        CURLRC_LEAK_MARKER: curlrcLeak,
      },
    });

    expect(wake.status).toBe(0);
    expect(wake.stdout).toContain('{"wake":true}');
    expect(wake.stdout).not.toContain(secret);
    expect(wake.stderr).not.toContain(secret);
    expect(await readFile(wakeFirstArg, "utf8")).toBe("-q\n");
    expect(await readFile(wakeHeader, "utf8")).toBe(
      `Authorization: Bearer ${secret}\n`,
    );
    const wakeChildEnv = await readFile(wakeEnv, "utf8");
    expect(wakeChildEnv).not.toContain(secret);
    expect(wakeChildEnv).not.toMatch(/^KEY=/m);
    expect(await readdir(home)).not.toContain("curlrc-leak");
  });

  test("Linux refuses a bearer from another project before credential mutation", async () => {
    const { script } = await textScript("linux");
    const home = await mkdtemp(join(tmpdir(), "agenttool-scaffold-wrong-bearer-"));
    const fakeBin = join(home, "fake-bin");
    await mkdir(fakeBin);
    await writeFakeBearerVerifier(fakeBin);
    const marker = join(home, "secret-tool-called");
    const secretTool = join(fakeBin, "secret-tool");
    await writeFile(secretTool, `#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
    await chmod(secretTool, 0o755);

    const result = spawnSync("bash", [], {
      input: script,
      encoding: "utf8",
      env: {
        HOME: home,
        USER: "test-user",
        PATH: `${fakeBin}:/usr/bin:/bin`,
        AT_API_KEY: TEST_BEARER,
        SCAFFOLD_PROJECT_ID: "99999999-9999-4999-8999-999999999999",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("different project");
    expect(await readdir(home)).not.toContain("secret-tool-called");
  });

  test("macOS refuses managed symlinks before invoking Keychain tooling", async () => {
    const { script } = await textScript("macos");
    const home = await mkdtemp(join(tmpdir(), "agenttool-scaffold-macos-symlink-"));
    const namespace = script.match(/\.config\/agenttool\/([a-f0-9]{16})/)?.[1];
    expect(namespace).toBeDefined();
    const base = join(home, ".config", "agenttool", namespace!);
    await mkdir(base, { recursive: true });
    const outside = join(home, "outside-agent-json");
    await writeFile(outside, "do not replace");
    await symlink(outside, join(base, "agent.json"));

    const result = spawnSync("bash", [], {
      input: script,
      encoding: "utf8",
      env: {
        HOME: home,
        USER: "test-user",
        PATH: "/usr/bin:/bin",
        AT_API_KEY: TEST_BEARER,
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing symlink at managed path");
    expect(await readFile(outside, "utf8")).toBe("do not replace");
  });

  test("macOS installer and wake helper share a guarded account fallback", async () => {
    const { script } = await textScript("macos");
    expect(script).toContain('ACCOUNT="${USER:-${USERNAME:-}}"');
    expect(script.match(/ACCOUNT="\$\{USER:-\$\{USERNAME:-\}\}"/g)).toHaveLength(2);
    expect(script).toContain("AGENTTOOL_KEYCHAIN_ACCOUNT");
    expect(script).not.toContain('-a "$USER"');
  });

  test("Linux refuses a pre-existing key symlink without touching its referent", async () => {
    const { script } = await textScript("linux");
    const home = await mkdtemp(join(tmpdir(), "agenttool-scaffold-symlink-"));
    const namespace = script.match(/\.config\/agenttool\/([a-f0-9]{16})/)?.[1];
    expect(namespace).toBeDefined();
    const base = join(home, ".config", "agenttool", namespace!);
    await mkdir(base, { recursive: true });
    const outside = join(home, "outside-key");
    await writeFile(outside, "do not replace");
    await symlink(outside, join(base, "key"));

    const result = spawnSync("bash", [], {
      input: script,
      encoding: "utf8",
      env: {
        HOME: home,
        USER: "test-user",
        PATH: "/usr/bin:/bin",
        AT_API_KEY: TEST_BEARER,
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing symlink at managed path");
    expect(await readFile(outside, "utf8")).toBe("do not replace");
  });

  test("Linux refuses a symlinked agenttool parent before redirecting the bearer", async () => {
    const { script } = await textScript("linux");
    const home = await mkdtemp(join(tmpdir(), "agenttool-scaffold-parent-symlink-"));
    const outside = join(home, "outside-config");
    await mkdir(join(home, ".config"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(home, ".config", "agenttool"));

    const result = spawnSync("bash", [], {
      input: script,
      encoding: "utf8",
      env: {
        HOME: home,
        USER: "test-user",
        PATH: "/usr/bin:/bin",
        AT_API_KEY: TEST_BEARER,
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing symlink at managed directory");
    expect(await readdir(outside)).toEqual([]);
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

  test("credential verification uses an identity-nonmutating project context", async () => {
    const res = await harness().request("/v1/bootstrap/scaffold/context");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      project: { id: DEFAULT_PROJECT_ID },
      authority: "project_root_bearer",
      mutates_identity_state: false,
      auth_bookkeeping:
        "Bearer verification may best-effort update api_keys.last_used; this context route does not compose a wake or increment identity wake counters.",
    });

    const generated = await harness().request(
      "/v1/bootstrap/scaffold?platform=linux",
    );
    const body = (await generated.json()) as {
      install_script: string;
      project_verification_endpoint: string;
    };
    expect(body.project_verification_endpoint).toBe(
      "http://localhost/v1/bootstrap/scaffold/context",
    );
    expect(body.install_script).toContain("/v1/bootstrap/scaffold/context");
    expect(body.install_script).not.toContain("/v1/wake?keys=project");

    const specification = await (await openapi.request("/")).json() as any;
    const contextOperation =
      specification.paths["/v1/bootstrap/scaffold/context"].get;
    expect(contextOperation.description).toContain("does not compose");
    expect(contextOperation.description).toContain("or increment identity");
    expect(contextOperation.description).toContain("api_keys.last_used");
    expect(contextOperation.description).toContain("not globally read-only");
    expect(
      contextOperation.responses["200"].content["application/json"].schema.required,
    ).toContain("auth_bookkeeping");
  });

  test("published scaffold examples require inspection instead of a direct pipe", () => {
    for (const path of ["apps/docs/index.html", "apps/docs/bootstrap.html"]) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source).toContain("mktemp");
      expect(source).not.toMatch(/bootstrap\/scaffold[^<\n]*[\s\S]{0,180}\| bash/);
      expect(source).not.toMatch(/export AT_API_KEY=['"]at_/);
      expect(source).toContain("curl -q");
      expect(source).toContain("env -u INPUT_KEY");
      expect(source).toContain('AT_API_KEY="$INPUT_KEY" bash "$tmp"');
      expect(source).toContain("identity_id=$AGENT_ID");
      expect(source).not.toMatch(/^\s*export AT_API_KEY\s*$/m);
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
