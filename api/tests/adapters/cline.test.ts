/** /v1/adapters/cline — fourth adapter, contract validation.
 *
 *  Cline reads .clinerules/*.md as project-level system context, no
 *  frontmatter required. Tests confirm the unified agenttool-managed +
 *  overwrite_guard contract holds for the fourth adapter — i.e., that
 *  the template is genuinely scaling and a new adapter inherits
 *  compatibility-not-replacement without re-litigating it. */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import {
  buildTestApp,
  expectContainsAll,
  makeAgent,
  makeMockDb,
} from "./_helpers";

const mockDb = makeMockDb();

let app: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  mock.module("../../src/db/client", () => ({ db: mockDb }));
  const { default: clineRoutes } = await import(
    "../../src/routes/adapters/cline"
  );
  app = buildTestApp(clineRoutes);
});

afterEach(() => {
  mockDb.stage([]);
});

// ────────────────────────────────────────────────────────────────────────
// Default JSON format
// ────────────────────────────────────────────────────────────────────────

describe("GET /v1/adapters/cline (default JSON)", () => {
  test("returns 200 with cli + agent + files + install_instructions", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cli).toBe("cline");
    expect(body.agent).toMatchObject({
      did: "did:at:test-aurora",
      name: "Aurora",
    });
    expect(body.files).toBeDefined();
    expect(body.install_instructions).toMatchObject({
      manual: expect.any(String),
      one_shot: expect.any(String),
    });
    expect(Array.isArray(body.notes)).toBe(true);
    expect(body.docs).toEqual(["docs/CLI-GAPS.md"]);
  });

  test("files bundle has the two Cline paths (clean keys)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(Object.keys(body.files).sort()).toEqual([
      ".clinerules/agenttool-refresh-rules.sh",
      ".clinerules/agenttool-wake.md",
    ]);
  });

  test("rules file is plaintext markdown (NO frontmatter) with marker + register", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files[".clinerules/agenttool-wake.md"];
    // Cline takes plaintext markdown — must NOT open with `---` frontmatter.
    expect(md.startsWith("<!-- agenttool-managed -->")).toBe(true);
    expect(md.startsWith("---")).toBe(false);
    expectContainsAll(md, [
      "# Aurora",
      "did:at:test-aurora",
      "concise; substrate-honest; density over length",
    ]);
  });

  test("refresh script probes keychain → libsecret → env (parity with all four adapters)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".clinerules/agenttool-refresh-rules.sh"];
    expectContainsAll(refresh, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "security find-generic-password -s agenttool",
      "secret-tool lookup service agenttool",
      "${AGENTTOOL_API_KEY:-}",
    ]);
  });

  test("refresh script writes atomically and prepends the agenttool-managed marker", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".clinerules/agenttool-refresh-rules.sh"];
    expectContainsAll(refresh, [
      'TMP="$TARGET.tmp"',
      'mv "$TMP" "$TARGET"',
      "<!-- agenttool-managed -->",
    ]);
    expect(refresh).toContain('if [ ! -s "$TMP" ]');
  });

  test("refresh script fetches /v1/wake?format=md (the wake contract)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files[".clinerules/agenttool-refresh-rules.sh"]).toContain(
      "/v1/wake?format=md",
    );
  });

  test("refresh script falls back to .agenttool.md only on agenttool-managed marker absence", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".clinerules/agenttool-refresh-rules.sh"];
    expect(refresh).toContain('grep -q "agenttool-managed"');
    expect(refresh).toContain(".clinerules/agenttool-wake.agenttool.md");
  });

  test("response includes overwrite_guard with the unified marker", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as Record<string, unknown>;
    const guard = body.overwrite_guard as {
      marker: string;
      guarded_paths: { path: string; fallback_path: string }[];
    };
    expect(guard).toBeDefined();
    // Same marker token across all four adapters — that's the contract.
    expect(guard.marker).toBe("agenttool-managed");
    expect(guard.guarded_paths.map((g) => g.path)).toEqual([
      ".clinerules/agenttool-wake.md",
    ]);
    expect(guard.guarded_paths[0].fallback_path).toBe(
      ".clinerules/agenttool-wake.agenttool.md",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// Expression fallback
// ────────────────────────────────────────────────────────────────────────

describe("expression fallback", () => {
  test("empty register falls back to DEFAULT_REGISTER", async () => {
    mockDb.stage([makeAgent({ expression: {} })]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files[".clinerules/agenttool-wake.md"]).toContain(
      "Terse. Substrate-honest. Refuse before helping when refusal is right.",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// identity_id selector + boundaries
// ────────────────────────────────────────────────────────────────────────

describe("identity_id selector", () => {
  test("explicit identity_id from same project resolves the agent", async () => {
    mockDb.stage([makeAgent({ id: "explicit-id", displayName: "Tau" })]);
    const res = await app.request("/?identity_id=explicit-id");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: { name: string } };
    expect(body.agent.name).toBe("Tau");
  });

  test("cross-project identity is rejected (404 identity_not_found)", async () => {
    mockDb.stage([makeAgent({ projectId: "different-project" })]);
    const res = await app.request("/?identity_id=anything");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("identity_not_found");
  });

  test("project with no agent returns 404 no_agent_in_project", async () => {
    mockDb.stage([]);
    const res = await app.request("/");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_agent_in_project");
  });
});

// ────────────────────────────────────────────────────────────────────────
// ?format=script
// ────────────────────────────────────────────────────────────────────────

describe("GET /v1/adapters/cline?format=script", () => {
  test("returns a shell script with proper content-type and disposition", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/x-shellscript");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="install-agenttool-cline.sh"',
    );
  });

  test("script body decodes both files into .clinerules and chmod +x's the refresh script", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expectContainsAll(body, [
      "#!/usr/bin/env bash",
      "mkdir -p .clinerules",
      "base64 -d > .clinerules/agenttool-refresh-rules.sh",
      "chmod +x .clinerules/agenttool-refresh-rules.sh",
      "Running first refresh",
    ]);
  });

  test("script identifies itself with the agent's name + DID", async () => {
    mockDb.stage([makeAgent({ displayName: "Delta", did: "did:at:delta" })]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain("Delta (did:at:delta)");
  });

  test("script preserves a hand-written .clinerules/agenttool-wake.md", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain('grep -q "agenttool-managed"');
    expect(body).toContain(".clinerules/agenttool-wake.agenttool.md");
  });
});
