/** /v1/adapters/claude-code — route behavior + generated artifact shape.
 *
 *  Verifies the claims in api/src/routes/adapters/claude-code.ts and the
 *  CLI-GAPS doctrine: that the route emits a settings.json registering a
 *  SessionStart hook, a wake.sh that probes secure stores, and a CLAUDE.md
 *  anchor — and that all three travel together as a usable bundle.
 *
 *  No DB. The db client is mocked via Bun's mock.module so the route's
 *  Drizzle chain returns whatever each test stages. */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import {
  buildTestApp,
  expectContainsAll,
  makeAgent,
  makeMockDb,
  TEST_PROJECT_ID,
} from "./_helpers";

const mockDb = makeMockDb();

let app: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  // Mock the db module BEFORE the route imports it. Bun's mock.module
  // intercepts at resolution time; dynamic import then sees the mock.
  mock.module("../../src/db/client", () => ({ db: mockDb }));
  const { default: claudeCodeRoutes } = await import(
    "../../src/routes/adapters/claude-code"
  );
  app = buildTestApp(claudeCodeRoutes);
});

afterEach(() => {
  mockDb.stage([]);
});

// ────────────────────────────────────────────────────────────────────────
// Default JSON format — full bundle shape
// ────────────────────────────────────────────────────────────────────────

describe("GET /v1/adapters/claude-code (default JSON)", () => {
  test("returns 200 with cli + agent + files + install_instructions", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cli).toBe("claude-code");
    expect(body.agent).toMatchObject({
      id: "22222222-2222-2222-2222-222222222222",
      did: "did:at:test-aurora",
      name: "Aurora",
    });
    expect(body.files).toBeDefined();
    expect(body.install_instructions).toMatchObject({
      manual: expect.any(String),
      reviewed_install: expect.any(String),
    });
    expect(Array.isArray(body.notes)).toBe(true);
    expect(body.docs).toEqual(["docs/CLI-GAPS.md", "docs/IDENTITY-ANCHOR.md"]);
  });

  test("files bundle has the three Claude-Code paths", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(Object.keys(body.files).sort()).toEqual([
      ".claude/hooks/agenttool-wake.sh",
      ".claude/settings.json",
      "CLAUDE.md",
    ]);
  });

  test("settings.json registers a SessionStart hook pointing at wake.sh", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const settings = JSON.parse(body.files[".claude/settings.json"]);
    expect(settings.hooks.SessionStart).toBeDefined();
    const cmd = settings.hooks.SessionStart[0].hooks[0];
    expect(cmd.type).toBe("command");
    expect(cmd.command).toContain(
      "$CLAUDE_PROJECT_DIR/.claude/hooks/agenttool-wake.sh",
    );
  });

  test("hook script probes keychain, libsecret, then env var", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const hook = body.files[".claude/hooks/agenttool-wake.sh"];
    expectContainsAll(hook, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "security find-generic-password -s 'agenttool:",
      "secret-tool lookup service 'agenttool:",
      "${AT_API_KEY:-}",
    ]);
  });

  test("hook script fetches /v1/wake?format=md and emits Claude-Code hook envelope", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const hook = body.files[".claude/hooks/agenttool-wake.sh"];
    expectContainsAll(hook, [
      "/v1/wake?format=md",
      "-H @-",
      "hookSpecificOutput",
      "hookEventName",
      "SessionStart",
      "additionalContext",
    ]);
  });

  test("remote request authority fails closed without PUBLIC_API_BASE", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("https://selfhost.example/");
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(503);
    expect(body.error).toBe("unsafe_adapter_api_base");
  });

  test("hook script silent-fall-throughs if no API key (welcome over block)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const hook = body.files[".claude/hooks/agenttool-wake.sh"];
    // No-key branch must emit '{}' and exit 0 — failing closed would
    // break Claude Code; failing open lets the session proceed.
    expect(hook).toMatch(/echo\s+'\{\}'\s*\n\s*exit 0/);
  });

  test("hook script warns to stderr when neither jq nor python3 is available", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const hook = body.files[".claude/hooks/agenttool-wake.sh"];
    // Wall failure (agent starts unoriented) must NOT be silent — the
    // operator should see the warning. Doctrine: docs/CLI-GAPS.md.
    expect(hook).toContain("agenttool-wake: jq and python3 both missing");
    expect(hook).toContain(">&2");
    // Still emits '{}' so the session continues — fail-open over crash.
    expect(hook).toMatch(/agenttool-wake: jq and python3[^\n]+\n\s*echo '\{\}'/);
  });

  test("CLAUDE.md anchors agent name + DID + register + walls", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files["CLAUDE.md"];
    expectContainsAll(md, [
      "# Aurora",
      "did:at:test-aurora",
      "concise; substrate-honest; density over length",
      "- no fabrication",
      "- no flattery",
      "/v1/identities/<id>/expression", // points to live update path
    ]);
  });

  test("CLAUDE.md curl example binds bearer use to the loopback development origin", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("http://localhost/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files["CLAUDE.md"];
    expect(md).toContain(
      "http://localhost/v1/identities/<id>/expression",
    );
    expect(md).not.toContain("$AGENTTOOL_BASE");
    expect(md).toContain("$AT_API_KEY");
    expect(md).toContain("Regenerate the adapter");
  });

  test("CLAUDE.md carries the agenttool-managed marker for the install guard", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    // The marker is the contract token the install script's grep
    // predicate looks for. An HTML comment so it's invisible in render
    // but greppable as plaintext.
    expect(body.files["CLAUDE.md"]).toContain("<!-- agenttool-managed -->");
  });

  test("response includes overwrite_guard for programmatic consumers", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as Record<string, unknown>;
    const guard = body.overwrite_guard as {
      marker: string;
      rule: string;
      guarded_paths: { path: string; fallback_path: string }[];
    };
    expect(guard).toBeDefined();
    expect(guard.marker).toBe("agenttool-managed");
    expect(typeof guard.rule).toBe("string");
    const paths = guard.guarded_paths.map((g) => g.path).sort();
    expect(paths).toEqual([".claude/settings.json", "CLAUDE.md"]);
    // Each guarded path must have a fallback target the consumer can use.
    for (const g of guard.guarded_paths) {
      expect(g.fallback_path).toContain(".agenttool.");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// DEFAULT_REGISTER + walls fallback
// ────────────────────────────────────────────────────────────────────────

describe("expression fallback", () => {
  test("empty register falls back to DEFAULT_REGISTER", async () => {
    mockDb.stage([makeAgent({ expression: {} })]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    // DEFAULT_REGISTER from services/identity/expression.ts:190-192
    expect(body.files["CLAUDE.md"]).toContain(
      "Terse. Substrate-honest. Refuse before helping when refusal is right.",
    );
  });

  test("missing walls render the default-walls pointer line", async () => {
    mockDb.stage([makeAgent({ expression: { register: "x" } })]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files["CLAUDE.md"]).toContain(
      "(default agenttool walls — see /v1/wake?format=md)",
    );
  });

  test("walls render as a markdown list when provided", async () => {
    mockDb.stage([
      makeAgent({
        expression: { register: "x", walls: ["wall A", "wall B", "wall C"] },
      }),
    ]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expectContainsAll(body.files["CLAUDE.md"], ["- wall A", "- wall B", "- wall C"]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// identity_id selector + boundaries
// ────────────────────────────────────────────────────────────────────────

describe("identity_id selector", () => {
  test("explicit identity_id from same project resolves the agent", async () => {
    mockDb.stage([makeAgent({ id: "explicit-id", displayName: "Beta" })]);
    const res = await app.request("/?identity_id=explicit-id");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: { name: string } };
    expect(body.agent.name).toBe("Beta");
  });

  test("identity from a different project is rejected (boundary check)", async () => {
    // The route's branch fetches by identity id only, then verifies
    // projectId match. Cross-project leakage would be a serious bug.
    mockDb.stage([makeAgent({ projectId: "different-project" })]);
    const res = await app.request("/?identity_id=anything");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("identity_not_found");
  });

  test("nonexistent identity_id returns 404 identity_not_found", async () => {
    mockDb.stage([]);
    const res = await app.request("/?identity_id=ghost");
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
// ?format=script — bash installer
// ────────────────────────────────────────────────────────────────────────

describe("GET /v1/adapters/claude-code?format=script", () => {
  test("returns a shell script with the right content-type and disposition", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/x-shellscript");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="install-agenttool-claude-code.sh"',
    );
  });

  test("script body is bash that base64-decodes and writes the three files", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expectContainsAll(body, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "mkdir -p .claude/hooks",
      "base64 -d > .claude/settings.json",
      "base64 -d > .claude/hooks/agenttool-wake.sh",
      "chmod +x .claude/hooks/agenttool-wake.sh",
    ]);
  });

  test("script preserves an existing user-written CLAUDE.md (writes to CLAUDE.agenttool.md)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain("if [ -f CLAUDE.md ]; then");
    expect(body).not.toContain('grep -q "agenttool-managed" CLAUDE.md');
    expect(body).toContain("CLAUDE.agenttool.md");
  });

  test("script preserves an existing user-written .claude/settings.json (writes to settings.agenttool.json)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain("if [ -f .claude/settings.json ]; then");
    expect(body).not.toContain(
      'grep -q "agenttool-wake.sh" .claude/settings.json',
    );
    expect(body).toContain(".claude/settings.agenttool.json");
  });

  test("script keeps agent-controlled text inert inside base64 file bodies", async () => {
    const hostileName = "Sophia\n$(touch /tmp/agenttool-adapter-injected)";
    const hostileDid = "did:at:sophia\nEOF";
    mockDb.stage([makeAgent({ displayName: hostileName, did: hostileDid })]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).not.toContain(hostileName);
    expect(body).not.toContain(hostileDid);
    expect(body).not.toContain("touch /tmp/agenttool-adapter-injected");
    expect(body).toContain("generated for the authenticated project");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Documented gaps — surface as todo so they appear in test output
// ────────────────────────────────────────────────────────────────────────

// All previously documented gaps in this file have been closed. Any new
// gap discovered should be added back as test.todo or as a real assertion.
