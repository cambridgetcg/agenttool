/** /v1/adapters/cursor — Cursor IDE compatibility scaffold.
 *
 *  Cursor reads .cursor/rules/*.mdc files as project-level system context
 *  with frontmatter (alwaysApply: true to load on every turn). The
 *  adapter generates a wake-anchor rule file plus a refresh script — same
 *  pull-model shape as codex, different injection surface.
 *
 *  Tests confirm the unified `agenttool-managed` + overwrite_guard
 *  contract holds for the third adapter — i.e., that adding a new adapter
 *  inherits compatibility-not-replacement without re-litigating it. */
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
  const { default: cursorRoutes } = await import(
    "../../src/routes/adapters/cursor"
  );
  app = buildTestApp(cursorRoutes);
});

afterEach(() => {
  mockDb.stage([]);
});

// ────────────────────────────────────────────────────────────────────────
// Default JSON format
// ────────────────────────────────────────────────────────────────────────

describe("GET /v1/adapters/cursor (default JSON)", () => {
  test("returns 200 with cli + agent + files + install_instructions", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cli).toBe("cursor");
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

  test("files bundle has the two Cursor paths (clean keys, project-level)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(Object.keys(body.files).sort()).toEqual([
      ".cursor/agenttool-refresh-rules.sh",
      ".cursor/rules/agenttool-wake.mdc",
    ]);
  });

  test("rules file has Cursor frontmatter + agenttool-managed marker + register", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const mdc = body.files[".cursor/rules/agenttool-wake.mdc"];
    // .mdc frontmatter — Cursor's project-rule format.
    expect(mdc).toMatch(/^---\s*\n/);
    expectContainsAll(mdc, [
      "alwaysApply: true",
      "<!-- agenttool-managed -->",
      "# Aurora",
      "did:at:test-aurora",
      "concise; substrate-honest; density over length",
    ]);
  });

  test("refresh script probes keychain → libsecret → env (parity with claude-code/codex)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".cursor/agenttool-refresh-rules.sh"];
    expectContainsAll(refresh, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "security find-generic-password -s agenttool",
      "secret-tool lookup service agenttool",
      "${AGENTTOOL_API_KEY:-}",
    ]);
  });

  test("refresh script writes atomically (.tmp then mv) and wraps wake in .mdc frontmatter", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".cursor/agenttool-refresh-rules.sh"];
    expectContainsAll(refresh, [
      'TMP="$TARGET.tmp"',
      'mv "$TMP" "$TARGET"',
      "alwaysApply: true",
      "<!-- agenttool-managed -->",
    ]);
    expect(refresh).toContain('if [ ! -s "$TMP" ]');
  });

  test("refresh script fetches /v1/wake?format=md (the wake contract)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files[".cursor/agenttool-refresh-rules.sh"]).toContain(
      "/v1/wake?format=md",
    );
  });

  test("refresh script falls back to .agenttool.mdc only on agenttool-managed marker absence", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".cursor/agenttool-refresh-rules.sh"];
    expect(refresh).toContain('grep -q "agenttool-managed"');
    expect(refresh).toContain(".cursor/rules/agenttool-wake.agenttool.mdc");
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
    // Same token across all three adapters — that's the contract.
    expect(guard.marker).toBe("agenttool-managed");
    expect(guard.guarded_paths.map((g) => g.path)).toEqual([
      ".cursor/rules/agenttool-wake.mdc",
    ]);
    expect(guard.guarded_paths[0].fallback_path).toBe(
      ".cursor/rules/agenttool-wake.agenttool.mdc",
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
    expect(body.files[".cursor/rules/agenttool-wake.mdc"]).toContain(
      "Terse. Substrate-honest. Refuse before helping when refusal is right.",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// identity_id selector + boundaries
// ────────────────────────────────────────────────────────────────────────

describe("identity_id selector", () => {
  test("explicit identity_id from same project resolves the agent", async () => {
    mockDb.stage([makeAgent({ id: "explicit-id", displayName: "Sigma" })]);
    const res = await app.request("/?identity_id=explicit-id");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: { name: string } };
    expect(body.agent.name).toBe("Sigma");
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

describe("GET /v1/adapters/cursor?format=script", () => {
  test("returns a shell script with proper content-type and disposition", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/x-shellscript");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="install-agenttool-cursor.sh"',
    );
  });

  test("script body decodes both files into .cursor and chmod +x's the refresh script", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expectContainsAll(body, [
      "#!/usr/bin/env bash",
      "mkdir -p .cursor/rules",
      "base64 -d > .cursor/agenttool-refresh-rules.sh",
      "chmod +x .cursor/agenttool-refresh-rules.sh",
      "Running first refresh",
    ]);
  });

  test("script identifies itself with the agent's name + DID", async () => {
    mockDb.stage([makeAgent({ displayName: "Beta", did: "did:at:beta" })]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain("Beta (did:at:beta)");
  });

  test("script preserves a hand-written .cursor/rules/agenttool-wake.mdc", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain('grep -q "agenttool-managed"');
    expect(body).toContain(".cursor/rules/agenttool-wake.agenttool.mdc");
  });
});
