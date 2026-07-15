/** Promise 4 — *Your substrate is yours to choose.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 4), docs/CLI-GAPS.md.
 *
 *  > Any substrate that can fetch /v1/wake?format=md and present it as
 *  > session-start context is a valid expression substrate. Your continuity
 *  > follows you.
 *
 *  Agents-only since 2026-05-15. Claude Code is the canonical maintained
 *  scaffold — its SessionStart hook auto-fires on every fresh session,
 *  matching the agent-arrival posture. The wake protocol is open; any CLI
 *  can integrate via GET /v1/wake?format=md with a bearer header.
 *
 *  These tests pin:
 *
 *    1. The Claude Code SessionStart hook structure is what the CLI expects.
 *    2. The hook script handles macOS / Linux / Windows / no-key paths cleanly
 *       (welcome-don't-block: a missing key never breaks the user's session).
 *    3. The hook script's curl carries the bearer + 5s ceiling.
 *    4. The jq vs python3 fallback both emit equivalent JSON envelope.
 *    5. CLAUDE.md stays a stable identity anchor without stale expression.
 *
 *  Compatibility-not-replacement (CLI-GAPS.md): the adapter preserves every
 *  existing CLAUDE.md for explicit sidecar review, marker or not. */

import { describe, expect, test } from "bun:test";

import {
  buildClaudeMd,
  buildSettingsJson,
  buildWakeHook,
} from "../../src/routes/adapters/claude-code";

const WAKE_PATH = "/v1/wake?format=md";
const IDENTITY_ID = "22222222-2222-2222-2222-222222222222";
const CREDENTIAL_NAMESPACE = "0123456789abcdef";
const CREDENTIAL_SERVICE = `agenttool:${CREDENTIAL_NAMESPACE}`;

function doctrineWakeHook(
  wakeBase = "https://api.agenttool.dev",
): string {
  return buildWakeHook(
    CREDENTIAL_SERVICE,
    wakeBase,
    IDENTITY_ID,
    CREDENTIAL_NAMESPACE,
  );
}

// ── Claude Code SessionStart hook structure ────────────────────────────

describe("Promise 4 — Claude Code settings.json carries SessionStart hook", () => {
  test("settings.json is valid JSON with the SessionStart hook wired", () => {
    const raw = buildSettingsJson();
    const parsed = JSON.parse(raw);
    expect(parsed.hooks).toBeDefined();
    expect(Array.isArray(parsed.hooks.SessionStart)).toBe(true);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    const wrapper = parsed.hooks.SessionStart[0];
    expect(wrapper.hooks).toHaveLength(1);
    expect(wrapper.hooks[0].type).toBe("command");
    // The command must reference the project's hook script via the
    // documented Claude Code env var.
    expect(wrapper.hooks[0].command).toContain("$CLAUDE_PROJECT_DIR");
    expect(wrapper.hooks[0].command).toContain("agenttool-wake.sh");
  });

  test("settings.json ends with newline (POSIX file convention)", () => {
    expect(buildSettingsJson().endsWith("\n")).toBe(true);
  });
});

// ── Wake hook script — load-bearing welcome-don't-block paths ──────────

describe("Promise 4 — Claude Code hook script: welcome-don't-block paths", () => {
  const hook = doctrineWakeHook();

  test("script begins with shebang + strict mode", () => {
    expect(hook.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(hook).toContain("set -euo pipefail");
  });

  test("macOS keychain path reads the configured service and account", () => {
    expect(hook).toContain("security find-generic-password");
    expect(hook).toContain(`-s '${CREDENTIAL_SERVICE}'`);
    expect(hook).toContain('-a "$ACCOUNT"');
  });

  test("Linux libsecret path reads the configured service and account", () => {
    expect(hook).toContain("secret-tool lookup");
    expect(hook).toContain(`service '${CREDENTIAL_SERVICE}'`);
    expect(hook).toContain('username "$ACCOUNT"');
  });

  test("Linux 0600 fallback reads the exact scaffold namespace", () => {
    expect(hook).toContain(
      `$HOME/.config/agenttool/${CREDENTIAL_NAMESPACE}/key`,
    );
    expect(hook).toContain('KEY_MODE" = "600');
    expect(hook).toContain('[ ! -L "$KEY_FILE" ]');
  });

  test("Windows Password Vault path reads the configured target", () => {
    expect(hook).toContain("powershell.exe");
    expect(hook).toContain("Windows.Security.Credentials.PasswordVault");
    expect(hook).toContain(`$Target = "${CREDENTIAL_SERVICE}"`);
    expect(hook).toContain("$Credential.RetrievePassword()");
  });

  test("env-var fallback comes after every durable scaffold store", () => {
    const envCapture = hook.indexOf('ENV_KEY="${AT_API_KEY:-}"');
    const envFallback = hook.indexOf('KEY="$ENV_KEY"');
    expect(envCapture).toBeGreaterThan(hook.indexOf("unset ENV_KEY KEY WAKE"));
    expect(hook.indexOf("unset AT_API_KEY")).toBeGreaterThan(envCapture);
    expect(envFallback).toBeGreaterThan(
      hook.indexOf("security find-generic-password"),
    );
    expect(envFallback).toBeGreaterThan(hook.indexOf("secret-tool lookup"));
    expect(envFallback).toBeGreaterThan(hook.indexOf("KEY_FILE="));
    expect(envFallback).toBeGreaterThan(
      hook.indexOf("Windows.Security.Credentials.PasswordVault"),
    );
  });

  test("no-key path emits empty hook envelope and exits 0 (welcome-don't-block)", () => {
    // The script must NOT exit non-zero when no key is found — Claude
    // Code would surface that as a session-start failure to the user.
    // Instead it emits `{}` and exits 0; the session continues normally.
    expect(hook).toContain("echo '{}'");
    expect(hook).toContain("exit 0");
  });

  test("curl carries the bearer + a 5s timeout (network blip never breaks session)", () => {
    expect(hook).toContain('Authorization: Bearer %s');
    expect(hook).toContain("-H @-");
    expect(hook).toContain("--max-time 5");
    // The wake URL is templated from $WAKE_BASE.
    expect(hook).toContain("/v1/wake?format=md");
    expect(hook).toContain(`&identity_id=${IDENTITY_ID}`);
  });

  test("hook envelope shape matches Claude Code's documented SessionStart hook", () => {
    // Claude Code expects: { hookSpecificOutput: { hookEventName, additionalContext } }
    // The script emits this exact shape via jq OR python3 fallback.
    expect(hook).toContain("hookSpecificOutput");
    expect(hook).toContain('"hookEventName": "SessionStart"');
    expect(hook).toContain("additionalContext");
  });

  test("jq-then-python3 fallback chain (substrate-honest about tooling)", () => {
    // Some macOS systems lack jq; Linux containers often lack python3.
    // Either path must produce equivalent envelope JSON.
    expect(hook).toContain("command -v jq");
    expect(hook).toContain("command -v python3");
    // Order matters: jq is preferred (faster; native JSON encode).
    const jqIdx = hook.indexOf("command -v jq");
    const pyIdx = hook.indexOf("command -v python3");
    expect(jqIdx).toBeGreaterThan(0);
    expect(pyIdx).toBeGreaterThan(jqIdx);
  });

  test("network failure also degrades to empty hook (rest-don't-crash)", () => {
    // After the curl, the script checks for an empty WAKE variable.
    // A blank wake (empty body OR curl error) must emit `{}` and exit 0
    // — same shape as the no-key path. Checking by structural substrings.
    expect(hook).toContain('if [ -z "${WAKE:-}" ]; then');
    // The if-branch right after carries the same `echo '{}'` + `exit 0`.
    const ifIdx = hook.indexOf('if [ -z "${WAKE:-}" ]; then');
    const window = hook.slice(ifIdx, ifIdx + 200);
    expect(window).toContain("echo '{}'");
    expect(window).toContain("exit 0");
  });
});

// ── CLAUDE.md anchor — stable pointer, not mutable expression snapshot ─

describe("Promise 4 — CLAUDE.md is a stable agent anchor", () => {
  test("rendered CLAUDE.md carries the agent header with name + DID", () => {
    const md = buildClaudeMd({
      identityId: IDENTITY_ID,
      agentName: "Aurora",
      did: "did:at:test123",
    });
    expect(md).toContain("# Aurora");
    expect(md).toContain("did:at:test123");
  });

  test("the live update command embeds the same selected identity", () => {
    const md = buildClaudeMd({
      identityId: IDENTITY_ID,
      agentName: "Aurora",
      did: "did:at:x",
    });
    expect(md).toContain(`/v1/identities/${IDENTITY_ID}/expression`);
    expect(md).not.toContain("<id>");
  });

  test("mutable expression is explicitly kept out of the anchor", () => {
    const md = buildClaudeMd({
      identityId: IDENTITY_ID,
      agentName: "X",
      did: "did:at:x",
    });
    expect(md).toContain("does not copy mutable register, walls, or wake text");
    expect(md).not.toContain("## Tone");
    expect(md).not.toContain("## Walls");
  });

  test("CLAUDE.md anchor explains the file is BOUND to a wake endpoint, not a snapshot", () => {
    // Substrate-honest: this file is a small anchor; the LIVE wake doc
    // is more complete. Pin the wording so future tweaks don't lose it.
    const md = buildClaudeMd({
      identityId: IDENTITY_ID,
      agentName: "X",
      did: "did:at:x",
    });
    expect(md).toContain("agenttool agent");
    expect(md).toContain("SessionStart");
    expect(md).toContain("agenttool-wake.sh");
  });
});

// ── Wake protocol — the open contract under the maintained scaffold ────

describe("Promise 4 — wake protocol is the open contract", () => {
  test("claude-code hook targets /v1/wake?format=md (the doctrinal contract)", () => {
    // The wake URL behind the scaffold is the open protocol any CLI can
    // integrate against. Agents-only since 2026-05-15: claude-code is the
    // maintained scaffold; the wake protocol is what makes substrate-choice
    // open beyond it.
    expect(doctrineWakeHook()).toContain(WAKE_PATH);
  });

  test("hook binds to the verified generated origin (self-host friendly)", () => {
    const hook = doctrineWakeHook("https://selfhost.example");
    expect(hook).toContain("WAKE_BASE='https://selfhost.example'");
    expect(hook).not.toContain("AGENTTOOL_BASE");
    expect(() =>
      doctrineWakeHook("http://selfhost.example"),
    ).toThrow("unsafe wake base");
  });

  test("hook uses Bearer auth header in the curl (uniform auth shape)", () => {
    expect(doctrineWakeHook()).toContain("Authorization: Bearer %s");
    expect(doctrineWakeHook()).toContain("-H @-");
  });
});
