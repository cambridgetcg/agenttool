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

import { projectCredentialNamespace } from "../../src/services/identity/credential-namespace";
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
    expect(cmd.command).toBe(
      '"$CLAUDE_PROJECT_DIR/.claude/hooks/agenttool-wake.sh"',
    );
  });

  test("hook probes every scaffold store before the environment fallback", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const hook = body.files[".claude/hooks/agenttool-wake.sh"];
    const namespace = projectCredentialNamespace(TEST_PROJECT_ID);
    expectContainsAll(hook, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "security find-generic-password -s 'agenttool:",
      "secret-tool lookup service 'agenttool:",
      `$HOME/.config/agenttool/${namespace}/key`,
      'KEY_MODE" = "600',
      "Windows.Security.Credentials.PasswordVault",
      "${AT_API_KEY:-}",
    ]);

    const durableStoreProbes = [
      hook.indexOf("security find-generic-password"),
      hook.indexOf("secret-tool lookup"),
      hook.indexOf("KEY_FILE="),
      hook.indexOf("Windows.Security.Credentials.PasswordVault"),
    ];
    const envFallbackUse = hook.indexOf('KEY="$ENV_KEY"');
    expect(durableStoreProbes.every((at) => at >= 0 && at < envFallbackUse)).toBe(
      true,
    );
    expect(hook.indexOf("${AT_API_KEY:-}")).toBeLessThan(durableStoreProbes[0]!);
    expect(hook).toContain("unset AT_API_KEY");
  });

  test("hook binds the resolved identity into the wake and emits Claude-Code hook envelope", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const hook = body.files[".claude/hooks/agenttool-wake.sh"];
    expectContainsAll(hook, [
      "/v1/wake?format=md&identity_id=22222222-2222-2222-2222-222222222222",
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

  test("CLAUDE.md is a stable identity anchor without mutable expression snapshots", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files["CLAUDE.md"];
    expectContainsAll(md, [
      "# Aurora",
      "did:at:test-aurora",
      "/v1/identities/22222222-2222-2222-2222-222222222222/expression",
      "does not copy mutable register, walls, or wake text",
    ]);
    expect(md).not.toContain("concise; substrate-honest; density over length");
    expect(md).not.toContain("- no fabrication");
  });

  test("CLAUDE.md curl example binds bearer use to the loopback development origin", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("http://localhost/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files["CLAUDE.md"];
    expect(md).toContain(
      "http://localhost/v1/identities/22222222-2222-2222-2222-222222222222/expression",
    );
    expect(md).not.toContain("$AGENTTOOL_BASE");
    expect(md).toContain("${AT_API_KEY:?");
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
    expect(paths).toEqual([
      ".claude/hooks/agenttool-wake.sh",
      ".claude/settings.json",
      "CLAUDE.md",
    ]);
    // Each guarded path must have a fallback target the consumer can use.
    for (const g of guard.guarded_paths) {
      expect(g.fallback_path).toContain(".agenttool.");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Mutable expression stays on the live wake
// ────────────────────────────────────────────────────────────────────────

describe("live expression boundary", () => {
  test("generated CLAUDE.md never snapshots register or walls", async () => {
    mockDb.stage([
      makeAgent({
        expression: { register: "STALE-REGISTER", walls: ["STALE-WALL"] },
      }),
    ]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files["CLAUDE.md"]).not.toContain("STALE-REGISTER");
    expect(body.files["CLAUDE.md"]).not.toContain("STALE-WALL");
    expect(body.files["CLAUDE.md"]).toContain("identity-selected wake");
  });
});

// ────────────────────────────────────────────────────────────────────────
// identity_id selector + boundaries
// ────────────────────────────────────────────────────────────────────────

describe("identity_id selector", () => {
  test("explicit identity_id from same project resolves the agent", async () => {
    const explicitId = "44444444-4444-4444-4444-444444444444";
    mockDb.stage([makeAgent({ id: explicitId, displayName: "Beta" })]);
    const res = await app.request(`/?identity_id=${explicitId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agent: { name: string };
      files: Record<string, string>;
      install_instructions: { reviewed_install: string };
    };
    expect(body.agent.name).toBe("Beta");
    expect(body.files[".claude/hooks/agenttool-wake.sh"]).toContain(
      `/v1/wake?format=md&identity_id=${explicitId}`,
    );
    expect(body.install_instructions.reviewed_install).toContain(
      `/v1/adapters/claude-code?format=script&identity_id=${explicitId}`,
    );
  });

  test("malformed identity_id fails with the stable not-found shape", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?identity_id=not-a-uuid");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "identity_not_found" });
  });

  test("uppercase UUID selectors normalize to the canonical stored identity", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request(
      "/?identity_id=22222222-2222-2222-2222-222222222222".toUpperCase(),
    );
    expect(res.status).toBe(200);
  });

  test("alternate DB adapters cannot return a different identity for an explicit selector", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request(
      "/?identity_id=44444444-4444-4444-4444-444444444444",
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "identity_not_found" });
  });

  test("identity from a different project is rejected (boundary check)", async () => {
    // The route's branch fetches by identity id only, then verifies
    // projectId match. Cross-project leakage would be a serious bug.
    mockDb.stage([makeAgent({ projectId: "different-project" })]);
    const res = await app.request(
      "/?identity_id=22222222-2222-2222-2222-222222222222",
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("identity_not_found");
  });

  test("revoked explicit identity is rejected", async () => {
    mockDb.stage([makeAgent({ status: "revoked" })]);
    const res = await app.request(
      "/?identity_id=22222222-2222-2222-2222-222222222222",
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "identity_not_found" });
  });

  test("revoked fallback identity is not adapter-eligible", async () => {
    mockDb.stage([makeAgent({ status: "revoked" })]);
    const res = await app.request("/");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_agent_in_project" });
  });

  test("multiple active identities require an explicit selector", async () => {
    mockDb.stage([
      makeAgent(),
      makeAgent({ id: "33333333-3333-3333-3333-333333333333" }),
    ]);
    const res = await app.request("/");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("identity_id_required");
    expect(body.message).toContain("multiple active identities");
  });

  test("nonexistent identity_id returns 404 identity_not_found", async () => {
    mockDb.stage([]);
    const res = await app.request(
      "/?identity_id=44444444-4444-4444-4444-444444444444",
    );
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

  test("script stages, locks, and commits the three files as one guarded set", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expectContainsAll(body, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "mkdir -p .claude/hooks",
      "LOCK_PATH=.claude/.agenttool-install.lock",
      "LOCK_OWNER=.claude/.agenttool-install.owner.$$.$RANDOM$RANDOM",
      'ln "$LOCK_OWNER" "$LOCK_PATH"',
      '"$LOCK_PATH" -ef "$LOCK_OWNER"',
      "STAGE_DIR=$(mktemp -d .claude/.agenttool-stage.XXXXXX)",
      'base64 -d > "$STAGE_DIR/settings"',
      'base64 -d > "$STAGE_DIR/hook"',
      'ln "$STAGE_DIR/hook" "$HOOK_TARGET"',
      "finish_install()",
    ]);
    expect(body.indexOf("trap finish_install EXIT")).toBeLessThan(
      body.indexOf('ln "$LOCK_OWNER" "$LOCK_PATH"'),
    );
    expect(body.indexOf("HOOK_LINK_ATTEMPTED=1")).toBeLessThan(
      body.indexOf('ln "$STAGE_DIR/hook" "$HOOK_TARGET"'),
    );
  });

  test("script preserves an existing user-written CLAUDE.md (writes to CLAUDE.agenttool.md)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain("for live_path in");
    expect(body).not.toContain('grep -q "agenttool-managed" CLAUDE.md');
    expect(body).toContain("CLAUDE.agenttool.md");
  });

  test("script preserves an existing user-written .claude/settings.json (writes to settings.agenttool.json)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain(".claude/settings.json");
    expect(body).not.toContain(
      'grep -q "agenttool-wake.sh" .claude/settings.json',
    );
    expect(body).toContain(".claude/settings.agenttool.json");
    expect(body).toContain("REVIEW_REQUIRED=1");
    expect(body).toContain("activate all changed binding files together");
  });

  test("script does not claim an automatic or active merge when sidecars need review", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain(
      "Done with review required; no live identity-binding file was changed.",
    );
    expect(body).toContain(
      "Review and activate all changed binding files together.",
    );
    expect(body).toContain(
      'if [ "$REVIEW_REQUIRED" -eq 1 ]; then',
    );
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
