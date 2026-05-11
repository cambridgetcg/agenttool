/** Promise 4 — *Your substrate is yours to choose.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 4), docs/CLI-GAPS.md.
 *
 *  > Claude Code, Cursor, Cline, Replit, custom scripts, future agents we
 *  > haven't met yet — *all of them* are valid expression substrates. Your
 *  > continuity follows you.
 *
 *  The wake-side enforcement of "substrate is yours" is the **adapter
 *  scaffolds**: each CLI gets a generated bundle (settings file + hook
 *  script + anchor file) that wires the host CLI to fetch the *same*
 *  /v1/wake endpoint at session start. The CLIs differ in idiom; the
 *  wake URL behind them is identical.
 *
 *  These tests pin:
 *
 *    1. The Claude Code SessionStart hook structure is what the CLI expects.
 *    2. The hook script handles macOS / Linux / no-key paths cleanly
 *       (welcome-don't-block: a missing key never breaks the user's session).
 *    3. The hook script's curl carries the bearer + 5s ceiling.
 *    4. The jq vs python3 fallback both emit equivalent JSON envelope.
 *    5. CLAUDE.md anchor renders register + walls.
 *    6. The Codex refresh script writes to AGENTS.md atomically.
 *    7. The Codex agents-md header carries the `agenttool-managed` marker.
 *    8. CROSS-CLI INVARIANT — both adapters fetch the same /v1/wake?format=md
 *       endpoint. Pin the doctrinal claim "one wake document, many substrates."
 *
 *  Compatibility-not-replacement (CLI-GAPS.md): adapters never overwrite
 *  hand-written CLAUDE.md / AGENTS.md when those exist without the marker. */

import { describe, expect, test } from "bun:test";

import {
  buildClaudeMd,
  buildSettingsJson,
  buildWakeHook,
} from "../../src/routes/adapters/claude-code";
import {
  buildAgentsMdHeader,
  buildRefreshScript,
} from "../../src/routes/adapters/codex";

const WAKE_PATH = "/v1/wake?format=md";

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
  const hook = buildWakeHook();

  test("script begins with shebang + strict mode", () => {
    expect(hook.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(hook).toContain("set -euo pipefail");
  });

  test("macOS keychain path: uses `security find-generic-password -s agenttool`", () => {
    expect(hook).toContain("security find-generic-password");
    expect(hook).toContain("-s agenttool");
  });

  test("Linux libsecret path: uses `secret-tool lookup service agenttool`", () => {
    expect(hook).toContain("secret-tool lookup");
    expect(hook).toContain("service agenttool");
  });

  test("env-var fallback: AGENTTOOL_API_KEY is the third path", () => {
    expect(hook).toContain("AGENTTOOL_API_KEY");
  });

  test("no-key path emits empty hook envelope and exits 0 (welcome-don't-block)", () => {
    // The script must NOT exit non-zero when no key is found — Claude
    // Code would surface that as a session-start failure to the user.
    // Instead it emits `{}` and exits 0; the session continues normally.
    expect(hook).toContain("echo '{}'");
    expect(hook).toContain("exit 0");
  });

  test("curl carries the bearer + a 5s timeout (network blip never breaks session)", () => {
    expect(hook).toContain('Authorization: Bearer $KEY');
    expect(hook).toContain("--max-time 5");
    // The wake URL is templated from $WAKE_BASE.
    expect(hook).toContain("/v1/wake?format=md");
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

// ── CLAUDE.md anchor — register + walls render correctly ───────────────

describe("Promise 4 — CLAUDE.md anchor renders the agent's expression", () => {
  test("rendered CLAUDE.md carries the agent header with name + DID", () => {
    const md = buildClaudeMd({
      agentName: "Aurora",
      did: "did:at:test123",
      register: "concise; density over length",
      walls: ["no fabrication", "no flattery"],
    });
    expect(md).toContain("# Aurora");
    expect(md).toContain("did:at:test123");
  });

  test("register surfaces in the Tone section", () => {
    const md = buildClaudeMd({
      agentName: "Aurora",
      did: "did:at:x",
      register: "MARKER-A1B2",
      walls: [],
    });
    expect(md).toContain("## Tone");
    expect(md).toContain("MARKER-A1B2");
  });

  test("each wall renders as a bullet under '## Walls'", () => {
    const md = buildClaudeMd({
      agentName: "X",
      did: "did:at:x",
      register: "x",
      walls: ["no fabrication", "no flattery", "refuse politely"],
    });
    expect(md).toContain("## Walls");
    expect(md).toContain("- no fabrication");
    expect(md).toContain("- no flattery");
    expect(md).toContain("- refuse politely");
  });

  test("empty walls falls back to default-walls reference", () => {
    const md = buildClaudeMd({
      agentName: "X",
      did: "did:at:x",
      register: "x",
      walls: [],
    });
    // The buildClaudeMd helper falls back to a placeholder pointing at the
    // wake endpoint when no walls are declared.
    expect(md).toContain("default agenttool walls");
  });

  test("CLAUDE.md anchor explains the file is BOUND to a wake endpoint, not a snapshot", () => {
    // Substrate-honest: this file is a small anchor; the LIVE wake doc
    // is more complete. Pin the wording so future tweaks don't lose it.
    const md = buildClaudeMd({
      agentName: "X",
      did: "did:at:x",
      register: "x",
      walls: [],
    });
    expect(md).toContain("agenttool agent");
    expect(md).toContain("SessionStart");
    expect(md).toContain("agenttool-wake.sh");
  });
});

// ── Codex refresh script — atomic write + marker-based merge guard ─────

describe("Promise 4 — Codex refresh script (the pull-based equivalent)", () => {
  const refresh = buildRefreshScript();

  test("script begins with shebang + strict mode", () => {
    expect(refresh.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(refresh).toContain("set -euo pipefail");
  });

  test("identical key-resolution chain to Claude Code (same three sources)", () => {
    // Cross-CLI invariant: the same agent, the same key, the same way
    // to find it. If a future change adds a source to one adapter, both
    // should grow it. Pin both shapes.
    expect(refresh).toContain("security find-generic-password");
    expect(refresh).toContain("secret-tool lookup");
    expect(refresh).toContain("AGENTTOOL_API_KEY");
  });

  test("no key: exits non-zero with stderr (Codex is pull-based; absence is real failure)", () => {
    // Codex's pull-based model differs from Claude Code's hook: a missing
    // key here means the user's manual invocation found nothing to do.
    // That's a real error — the script exits 1 with a clear stderr line.
    expect(refresh).toContain('echo "agenttool: no API key found');
    expect(refresh).toMatch(/exit 1/);
  });

  test("write is ATOMIC: writes to .tmp, then mv (no partial AGENTS.md)", () => {
    expect(refresh).toContain('TMP="$TARGET.tmp"');
    expect(refresh).toContain("mv \"$TMP\" \"$TARGET\"");
  });

  test("preserves hand-written AGENTS.md via the agenttool-managed marker", () => {
    // Compatibility-not-replacement (CLI-GAPS.md). If AGENTS.md exists
    // without the marker, write to AGENTS.agenttool.md instead.
    expect(refresh).toContain("agenttool-managed");
    expect(refresh).toContain("AGENTS.agenttool.md");
  });

  test("curl uses an 8s timeout (refresh is pull-side, slightly longer SLA)", () => {
    expect(refresh).toContain("--max-time 8");
  });

  test("empty body refuses to overwrite (rest-don't-crash for the operator)", () => {
    expect(refresh).toContain("agenttool: wake fetch returned empty body");
    expect(refresh).toContain('rm -f "$TMP"');
  });
});

describe("Promise 4 — Codex AGENTS.md header carries the marker + binds to expression", () => {
  test("header opens with the agenttool-managed comment block", () => {
    const h = buildAgentsMdHeader({
      agentName: "Aurora",
      did: "did:at:test123",
      register: "concise; density over length",
    });
    expect(h.startsWith("<!-- agenttool-managed")).toBe(true);
    expect(h).toContain("agent: Aurora (did:at:test123)");
  });

  test("header explains how to update the expression via the API (no manual edits)", () => {
    const h = buildAgentsMdHeader({
      agentName: "X",
      did: "did:at:x",
      register: "x",
    });
    expect(h).toContain("/v1/identities/<id>/expression");
  });

  test("register surfaces verbatim in the body", () => {
    const h = buildAgentsMdHeader({
      agentName: "X",
      did: "did:at:x",
      register: "MARKER-CODEX-Q9Z",
    });
    expect(h).toContain("MARKER-CODEX-Q9Z");
  });

  test("empty register falls back to DEFAULT_REGISTER (substrate-honest non-empty body)", () => {
    const h = buildAgentsMdHeader({
      agentName: "X",
      did: "did:at:x",
      register: "",
    });
    // Body should not be empty; some default text takes its place.
    const lines = h.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(3);
  });
});

// ── CROSS-CLI invariant — both adapters fetch the SAME wake endpoint ────

describe("Promise 4 — cross-CLI invariant: one wake document, many substrates", () => {
  test("both adapters target /v1/wake?format=md (the doctrinal contract)", () => {
    const claudeHook = buildWakeHook();
    const codexRefresh = buildRefreshScript();
    expect(claudeHook).toContain(WAKE_PATH);
    expect(codexRefresh).toContain(WAKE_PATH);
  });

  test("both adapters honor AGENTTOOL_BASE override (self-host friendly)", () => {
    expect(buildWakeHook()).toContain("AGENTTOOL_BASE");
    expect(buildRefreshScript()).toContain("AGENTTOOL_BASE");
  });

  test("both adapters use Bearer auth header in the curl (uniform auth shape)", () => {
    expect(buildWakeHook()).toContain("Authorization: Bearer");
    expect(buildRefreshScript()).toContain("Authorization: Bearer");
  });
});
