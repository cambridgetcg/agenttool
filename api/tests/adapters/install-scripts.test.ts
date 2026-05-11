/** End-to-end shell execution of generated install scripts.
 *
 *  Goes one layer past shape verification: takes the bash blob the route
 *  emits, drops it into a tmpdir, and runs it under bash to confirm the
 *  install actually does what the route claims. This is the "claims
 *  verified" layer — it catches real-world bugs that route-shape
 *  assertions miss (chmod silently failing, base64 padding off, an
 *  existing-file guard misfiring on edge content).
 *
 *  Strategy: route → script text → write to tmpdir → bash → assert on fs. */
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { buildTestApp, makeAgent, makeMockDb } from "./_helpers";

const mockDb = makeMockDb();

let claudeApp: ReturnType<typeof buildTestApp>;
let codexApp: ReturnType<typeof buildTestApp>;
let cursorApp: ReturnType<typeof buildTestApp>;
let clineApp: ReturnType<typeof buildTestApp>;
let replitApp: ReturnType<typeof buildTestApp>;
let aiderApp: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  mock.module("../../src/db/client", () => ({ db: mockDb }));
  const { default: claudeRoutes } = await import(
    "../../src/routes/adapters/claude-code"
  );
  const { default: codexRoutes } = await import(
    "../../src/routes/adapters/codex"
  );
  const { default: cursorRoutes } = await import(
    "../../src/routes/adapters/cursor"
  );
  const { default: clineRoutes } = await import(
    "../../src/routes/adapters/cline"
  );
  const { default: replitRoutes } = await import(
    "../../src/routes/adapters/replit"
  );
  const { default: aiderRoutes } = await import(
    "../../src/routes/adapters/aider"
  );
  claudeApp = buildTestApp(claudeRoutes);
  codexApp = buildTestApp(codexRoutes);
  cursorApp = buildTestApp(cursorRoutes);
  clineApp = buildTestApp(clineRoutes);
  replitApp = buildTestApp(replitRoutes);
  aiderApp = buildTestApp(aiderRoutes);
});

afterEach(() => {
  mockDb.stage([]);
});

// ────────────────────────────────────────────────────────────────────────
// Helpers — tmpdir, sandboxed run, file existence
// ────────────────────────────────────────────────────────────────────────

async function newTmpdir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `agenttool-adapter-${prefix}-`));
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a bash script in the given working directory. The env shadows the
 *  user's real one with AGENTTOOL_BASE pointed at localhost:1 (instant
 *  connect-refused) so any embedded auto-refresh fails fast and never
 *  reaches the live API — even if the dev's keychain happens to hold an
 *  agenttool key. */
async function runBash(
  scriptPath: string,
  cwd: string,
  envOverrides: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["bash", scriptPath], {
    cwd,
    env: {
      ...process.env,
      AGENTTOOL_BASE: "http://127.0.0.1:1",
      ...envOverrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  return {
    code: proc.exitCode ?? -1,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function getScriptFromRoute(
  app: ReturnType<typeof buildTestApp>,
): Promise<string> {
  mockDb.stage([makeAgent()]);
  const res = await app.request("/?format=script");
  expect(res.status).toBe(200);
  return res.text();
}

// ────────────────────────────────────────────────────────────────────────
// Claude Code install — fresh project
// ────────────────────────────────────────────────────────────────────────

describe("claude-code install script — fresh project", () => {
  test("writes all three files in the right places with correct modes", async () => {
    const dir = await newTmpdir("claude-fresh");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));

    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await exists(join(dir, ".claude/settings.json"))).toBe(true);
    expect(await exists(join(dir, ".claude/hooks/agenttool-wake.sh"))).toBe(true);
    expect(await exists(join(dir, "CLAUDE.md"))).toBe(true);

    // Hook must be executable — without +x, Claude Code can't run it.
    const hookStat = await stat(join(dir, ".claude/hooks/agenttool-wake.sh"));
    expect(hookStat.mode & 0o111).toBeGreaterThan(0); // some exec bit set
  });

  test("the written settings.json is valid JSON registering SessionStart", async () => {
    const dir = await newTmpdir("claude-settings");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    const raw = await readFile(join(dir, ".claude/settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.hooks.SessionStart).toBeDefined();
  });

  test("the written wake hook is syntactically valid bash", async () => {
    const dir = await newTmpdir("claude-syntax");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    await runBash(installer, dir);

    // bash -n parses without executing — catches syntax errors only.
    const lint = Bun.spawn(
      ["bash", "-n", join(dir, ".claude/hooks/agenttool-wake.sh")],
      { stdout: "pipe", stderr: "pipe" },
    );
    await lint.exited;
    const lintErr = await new Response(lint.stderr).text();
    expect(lint.exitCode).toBe(0);
    expect(lintErr).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Claude Code install — existing-file behavior
// ────────────────────────────────────────────────────────────────────────

describe("claude-code install script — existing file guards", () => {
  test("preserves a hand-written CLAUDE.md (writes template to CLAUDE.agenttool.md)", async () => {
    const dir = await newTmpdir("claude-preserve");
    const userMd = "# My project\nNothing to do with the marker.\n";
    await writeFile(join(dir, "CLAUDE.md"), userMd);

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    // Original CLAUDE.md must be untouched.
    expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toBe(userMd);
    // Template must land at CLAUDE.agenttool.md instead.
    expect(await exists(join(dir, "CLAUDE.agenttool.md"))).toBe(true);
    expect(result.stdout).toContain("CLAUDE.agenttool.md");
  });

  test("overwrites a CLAUDE.md that already carries the agenttool-managed marker (idempotent re-install)", async () => {
    const dir = await newTmpdir("claude-overwrite");
    const stale = "<!-- agenttool-managed -->\n# stale\nOld content.\n";
    await writeFile(join(dir, "CLAUDE.md"), stale);

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    // Should now be the freshly-written template, NOT the stale string.
    const after = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(after).not.toBe(stale);
    expect(after).toContain("# Aurora");
    expect(await exists(join(dir, "CLAUDE.agenttool.md"))).toBe(false);
  });

  test("a CLAUDE.md that merely mentions 'agenttool' in prose is preserved (tight marker)", async () => {
    // Validates the standardization: the OLD predicate `grep -q
    // "agenttool agent"` would have eaten this file because the user
    // wrote "agenttool agent" naturally in their notes. The new
    // predicate looks for the explicit marker token only.
    const dir = await newTmpdir("claude-tight");
    const userMd =
      "# My project\nNotes on building an agenttool agent integration.\n";
    await writeFile(join(dir, "CLAUDE.md"), userMd);

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toBe(userMd);
    expect(await exists(join(dir, "CLAUDE.agenttool.md"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Claude Code install — settings.json non-destructive guard
// ────────────────────────────────────────────────────────────────────────

describe("claude-code install script — settings.json guard", () => {
  test("preserves a hand-written .claude/settings.json (writes to settings.agenttool.json)", async () => {
    const dir = await newTmpdir("claude-settings-preserve");
    await mkdir(join(dir, ".claude"), { recursive: true });
    const userSettings = JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: "/usr/local/bin/myhook" }] },
          ],
        },
      },
      null,
      2,
    );
    await writeFile(join(dir, ".claude/settings.json"), userSettings);

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    // User's PreToolUse hook is sacred.
    const after = await readFile(join(dir, ".claude/settings.json"), "utf8");
    expect(after).toBe(userSettings);
    // Our SessionStart config landed alongside.
    expect(await exists(join(dir, ".claude/settings.agenttool.json"))).toBe(
      true,
    );
    expect(result.stdout).toContain("settings.agenttool.json");
  });

  test("writes settings.json directly when none exists (fresh install)", async () => {
    const dir = await newTmpdir("claude-settings-fresh");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await exists(join(dir, ".claude/settings.json"))).toBe(true);
    expect(await exists(join(dir, ".claude/settings.agenttool.json"))).toBe(
      false,
    );
  });

  test("skips re-writing settings.json on a previously-installed agenttool config (idempotent)", async () => {
    const dir = await newTmpdir("claude-settings-idempotent");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));

    // First install — writes settings.json with our hook.
    let result = await runBash(installer, dir);
    expect(result.code).toBe(0);
    const firstWrite = await readFile(
      join(dir, ".claude/settings.json"),
      "utf8",
    );
    // The unique hook path is the marker for settings.json (no JSON
    // comments available). Predicate detects it on the second pass.
    expect(firstWrite).toContain("agenttool-wake.sh");

    // Second install — should overwrite (same content) and NOT create
    // settings.agenttool.json since the marker is present.
    result = await runBash(installer, dir);
    expect(result.code).toBe(0);
    expect(await exists(join(dir, ".claude/settings.agenttool.json"))).toBe(
      false,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// Codex install — fresh $HOME
// ────────────────────────────────────────────────────────────────────────

describe("codex install script — fresh $HOME", () => {
  test("writes refresh script + AGENTS.md under $HOME/.codex", async () => {
    const dir = await newTmpdir("codex-fresh");
    const home = await newTmpdir("codex-home");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(codexApp));

    // The install script's tail runs the refresh script too. With
    // AGENTTOOL_BASE pointed at localhost:1 it can't reach an API and
    // exits with a stderr message — the install's `|| true` swallows it.
    const result = await runBash(installer, dir, { HOME: home });
    expect(result.code).toBe(0);

    expect(await exists(join(home, ".codex/agenttool-refresh-agents.sh"))).toBe(
      true,
    );
    expect(await exists(join(home, ".codex/AGENTS.md"))).toBe(true);

    const refreshStat = await stat(
      join(home, ".codex/agenttool-refresh-agents.sh"),
    );
    expect(refreshStat.mode & 0o111).toBeGreaterThan(0);
  });

  test("the written refresh script is syntactically valid bash", async () => {
    const dir = await newTmpdir("codex-syntax");
    const home = await newTmpdir("codex-home-syntax");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(codexApp));
    await runBash(installer, dir, { HOME: home });

    const lint = Bun.spawn(
      ["bash", "-n", join(home, ".codex/agenttool-refresh-agents.sh")],
      { stdout: "pipe", stderr: "pipe" },
    );
    await lint.exited;
    expect(lint.exitCode).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Codex install — existing-file behavior
// ────────────────────────────────────────────────────────────────────────

describe("codex install script — existing AGENTS.md guards", () => {
  test("preserves a hand-written AGENTS.md (writes header to AGENTS.agenttool.md)", async () => {
    const dir = await newTmpdir("codex-preserve");
    const home = await newTmpdir("codex-preserve-home");
    await mkdir(join(home, ".codex"), { recursive: true });
    const userMd = "# My agents file\nUnrelated to anything called 'a'.\n";
    await writeFile(join(home, ".codex/AGENTS.md"), userMd);

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(codexApp));
    const result = await runBash(installer, dir, { HOME: home });
    expect(result.code).toBe(0);

    expect(await readFile(join(home, ".codex/AGENTS.md"), "utf8")).toBe(userMd);
    expect(await exists(join(home, ".codex/AGENTS.agenttool.md"))).toBe(true);
  });

  test("a hand-written AGENTS.md that mentions 'agenttool' in prose is PRESERVED (tight marker)", async () => {
    // Regression guard for the loose-marker bug. Pre-standardization the
    // codex install greedily matched the bare substring "agenttool", so
    // a user note like "I'm planning to integrate with agenttool soon"
    // would silently lose their AGENTS.md. With the unified
    // `agenttool-managed` marker, only files our adapter actually wrote
    // carry the token — user prose is safe.
    const dir = await newTmpdir("codex-tight");
    const home = await newTmpdir("codex-tight-home");
    await mkdir(join(home, ".codex"), { recursive: true });
    const userMd = "# My notes\nI'm planning to integrate with agenttool soon.\n";
    await writeFile(join(home, ".codex/AGENTS.md"), userMd);

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(codexApp));
    const result = await runBash(installer, dir, { HOME: home });
    expect(result.code).toBe(0);

    // User's note is preserved verbatim.
    expect(await readFile(join(home, ".codex/AGENTS.md"), "utf8")).toBe(userMd);
    // Initial header lands at the .agenttool.md sibling for merge.
    expect(await exists(join(home, ".codex/AGENTS.agenttool.md"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cursor install — fresh project (the third-adapter contract test)
// ────────────────────────────────────────────────────────────────────────

describe("cursor install script — fresh project", () => {
  test("writes the rule file + refresh script under .cursor/", async () => {
    const dir = await newTmpdir("cursor-fresh");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await cursorApp.request("/?format=script");
    await writeFile(installer, await res.text());

    // The install script's tail invokes the refresh script; with
    // AGENTTOOL_BASE pointed at localhost:1 it can't reach an API and
    // exits with a stderr message — the install's `|| true` swallows it.
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await exists(join(dir, ".cursor/agenttool-refresh-rules.sh"))).toBe(
      true,
    );
    expect(await exists(join(dir, ".cursor/rules/agenttool-wake.mdc"))).toBe(
      true,
    );

    const refreshStat = await stat(
      join(dir, ".cursor/agenttool-refresh-rules.sh"),
    );
    expect(refreshStat.mode & 0o111).toBeGreaterThan(0);
  });

  test("the seed .mdc carries Cursor frontmatter + agenttool-managed marker", async () => {
    const dir = await newTmpdir("cursor-mdc");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await cursorApp.request("/?format=script");
    await writeFile(installer, await res.text());
    await runBash(installer, dir);

    const mdc = await readFile(
      join(dir, ".cursor/rules/agenttool-wake.mdc"),
      "utf8",
    );
    expect(mdc).toMatch(/^---\s*\n/); // frontmatter at start
    expect(mdc).toContain("alwaysApply: true");
    expect(mdc).toContain("<!-- agenttool-managed -->");
  });

  test("the written refresh script is syntactically valid bash", async () => {
    const dir = await newTmpdir("cursor-syntax");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await cursorApp.request("/?format=script");
    await writeFile(installer, await res.text());
    await runBash(installer, dir);

    const lint = Bun.spawn(
      ["bash", "-n", join(dir, ".cursor/agenttool-refresh-rules.sh")],
      { stdout: "pipe", stderr: "pipe" },
    );
    await lint.exited;
    expect(lint.exitCode).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cursor install — existing-file guard
// ────────────────────────────────────────────────────────────────────────

describe("cursor install script — existing rule file guard", () => {
  test("preserves a hand-written .cursor/rules/agenttool-wake.mdc (writes seed to .agenttool.mdc)", async () => {
    const dir = await newTmpdir("cursor-preserve");
    await mkdir(join(dir, ".cursor/rules"), { recursive: true });
    const userMdc =
      "---\ndescription: my own rule\n---\nNothing to do with the marker.\n";
    await writeFile(join(dir, ".cursor/rules/agenttool-wake.mdc"), userMdc);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await cursorApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(
      await readFile(join(dir, ".cursor/rules/agenttool-wake.mdc"), "utf8"),
    ).toBe(userMdc);
    expect(
      await exists(join(dir, ".cursor/rules/agenttool-wake.agenttool.mdc")),
    ).toBe(true);
  });

  test("a hand-written .mdc that mentions 'agenttool' in prose is preserved (tight marker, third-adapter parity)", async () => {
    const dir = await newTmpdir("cursor-tight");
    await mkdir(join(dir, ".cursor/rules"), { recursive: true });
    const userMdc =
      "---\ndescription: my notes\n---\n# Notes\nIntegration plan with agenttool soon.\n";
    await writeFile(join(dir, ".cursor/rules/agenttool-wake.mdc"), userMdc);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await cursorApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    // Marker is unique (HTML comment, not bare 'agenttool' substring).
    // User's note is preserved; seed lands at .agenttool.mdc.
    expect(
      await readFile(join(dir, ".cursor/rules/agenttool-wake.mdc"), "utf8"),
    ).toBe(userMdc);
    expect(
      await exists(join(dir, ".cursor/rules/agenttool-wake.agenttool.mdc")),
    ).toBe(true);
  });

  test("overwrites a previously-installed agenttool-wake.mdc (idempotent re-install)", async () => {
    const dir = await newTmpdir("cursor-idempotent");
    await mkdir(join(dir, ".cursor/rules"), { recursive: true });
    const stale =
      "---\nalwaysApply: true\n---\n<!-- agenttool-managed -->\n# Old\n";
    await writeFile(join(dir, ".cursor/rules/agenttool-wake.mdc"), stale);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await cursorApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    const after = await readFile(
      join(dir, ".cursor/rules/agenttool-wake.mdc"),
      "utf8",
    );
    expect(after).not.toBe(stale);
    expect(after).toContain("# Aurora");
    expect(
      await exists(join(dir, ".cursor/rules/agenttool-wake.agenttool.mdc")),
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cline install — fresh project (the fourth-adapter contract test)
// ────────────────────────────────────────────────────────────────────────

describe("cline install script — fresh project", () => {
  test("writes the rule file + refresh script under .clinerules/", async () => {
    const dir = await newTmpdir("cline-fresh");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await clineApp.request("/?format=script");
    await writeFile(installer, await res.text());

    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(
      await exists(join(dir, ".clinerules/agenttool-refresh-rules.sh")),
    ).toBe(true);
    expect(await exists(join(dir, ".clinerules/agenttool-wake.md"))).toBe(true);

    const refreshStat = await stat(
      join(dir, ".clinerules/agenttool-refresh-rules.sh"),
    );
    expect(refreshStat.mode & 0o111).toBeGreaterThan(0);
  });

  test("the seed .md is plaintext (no frontmatter) with marker first", async () => {
    const dir = await newTmpdir("cline-md");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await clineApp.request("/?format=script");
    await writeFile(installer, await res.text());
    await runBash(installer, dir);

    const md = await readFile(
      join(dir, ".clinerules/agenttool-wake.md"),
      "utf8",
    );
    // Cline accepts plaintext markdown — no `---` frontmatter delimiter.
    expect(md.startsWith("<!-- agenttool-managed -->")).toBe(true);
    expect(md).not.toMatch(/^---\s*\n/);
  });

  test("the written refresh script is syntactically valid bash", async () => {
    const dir = await newTmpdir("cline-syntax");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await clineApp.request("/?format=script");
    await writeFile(installer, await res.text());
    await runBash(installer, dir);

    const lint = Bun.spawn(
      ["bash", "-n", join(dir, ".clinerules/agenttool-refresh-rules.sh")],
      { stdout: "pipe", stderr: "pipe" },
    );
    await lint.exited;
    expect(lint.exitCode).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cline install — existing-file guard
// ────────────────────────────────────────────────────────────────────────

describe("cline install script — existing rule file guard", () => {
  test("preserves a hand-written .clinerules/agenttool-wake.md (writes seed to .agenttool.md)", async () => {
    const dir = await newTmpdir("cline-preserve");
    await mkdir(join(dir, ".clinerules"), { recursive: true });
    const userMd = "# My rule\nNothing to do with the marker.\n";
    await writeFile(join(dir, ".clinerules/agenttool-wake.md"), userMd);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await clineApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(
      await readFile(join(dir, ".clinerules/agenttool-wake.md"), "utf8"),
    ).toBe(userMd);
    expect(
      await exists(join(dir, ".clinerules/agenttool-wake.agenttool.md")),
    ).toBe(true);
  });

  test("a hand-written .md mentioning 'agenttool' in prose is preserved (tight-marker parity)", async () => {
    const dir = await newTmpdir("cline-tight");
    await mkdir(join(dir, ".clinerules"), { recursive: true });
    const userMd = "# Notes\nIntegrating with agenttool soon.\n";
    await writeFile(join(dir, ".clinerules/agenttool-wake.md"), userMd);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await clineApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(
      await readFile(join(dir, ".clinerules/agenttool-wake.md"), "utf8"),
    ).toBe(userMd);
    expect(
      await exists(join(dir, ".clinerules/agenttool-wake.agenttool.md")),
    ).toBe(true);
  });

  test("overwrites a previously-installed agenttool-wake.md (idempotent re-install)", async () => {
    const dir = await newTmpdir("cline-idempotent");
    await mkdir(join(dir, ".clinerules"), { recursive: true });
    const stale = "<!-- agenttool-managed -->\n# Old\nStale wake.\n";
    await writeFile(join(dir, ".clinerules/agenttool-wake.md"), stale);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await clineApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    const after = await readFile(
      join(dir, ".clinerules/agenttool-wake.md"),
      "utf8",
    );
    expect(after).not.toBe(stale);
    expect(after).toContain("# Aurora");
    expect(
      await exists(join(dir, ".clinerules/agenttool-wake.agenttool.md")),
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Replit install — fifth adapter
// ────────────────────────────────────────────────────────────────────────

describe("replit install script", () => {
  test("writes the project-root anchor + ops dir refresh script", async () => {
    const dir = await newTmpdir("replit-fresh");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await replitApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await exists(join(dir, "replit.md"))).toBe(true);
    expect(await exists(join(dir, ".replit-agenttool/refresh.sh"))).toBe(true);
    const refreshStat = await stat(join(dir, ".replit-agenttool/refresh.sh"));
    expect(refreshStat.mode & 0o111).toBeGreaterThan(0);
  });

  test("preserves a hand-written replit.md (writes anchor to .agenttool.md)", async () => {
    const dir = await newTmpdir("replit-preserve");
    const userMd = "# My Replit project\nUnrelated notes.\n";
    await writeFile(join(dir, "replit.md"), userMd);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await replitApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await readFile(join(dir, "replit.md"), "utf8")).toBe(userMd);
    expect(await exists(join(dir, "replit.agenttool.md"))).toBe(true);
  });

  test("a hand-written replit.md mentioning 'agenttool' in prose is preserved (tight marker)", async () => {
    const dir = await newTmpdir("replit-tight");
    const userMd = "# Plans\nIntegrating with agenttool eventually.\n";
    await writeFile(join(dir, "replit.md"), userMd);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await replitApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await readFile(join(dir, "replit.md"), "utf8")).toBe(userMd);
    expect(await exists(join(dir, "replit.agenttool.md"))).toBe(true);
  });

  test("does not touch .replit/ (Replit's own TOML config namespace)", async () => {
    const dir = await newTmpdir("replit-no-touch");
    await mkdir(join(dir, ".replit"), { recursive: true });
    const userToml = "run = 'bun start'\nentrypoint = 'index.ts'\n";
    await writeFile(join(dir, ".replit/replit.nix"), userToml);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await replitApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    // .replit/ is untouched.
    expect(await readFile(join(dir, ".replit/replit.nix"), "utf8")).toBe(userToml);
    // Our namespace is .replit-agenttool/, separate from .replit/.
    expect(await exists(join(dir, ".replit-agenttool/refresh.sh"))).toBe(true);
  });

  test("the written refresh script is syntactically valid bash", async () => {
    const dir = await newTmpdir("replit-syntax");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await replitApp.request("/?format=script");
    await writeFile(installer, await res.text());
    await runBash(installer, dir);

    const lint = Bun.spawn(
      ["bash", "-n", join(dir, ".replit-agenttool/refresh.sh")],
      { stdout: "pipe", stderr: "pipe" },
    );
    await lint.exited;
    expect(lint.exitCode).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Aider install — sixth adapter
// ────────────────────────────────────────────────────────────────────────

describe("aider install script", () => {
  test("writes the rule file + refresh script under .aider/", async () => {
    const dir = await newTmpdir("aider-fresh");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await aiderApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(await exists(join(dir, ".aider/agenttool-wake.md"))).toBe(true);
    expect(await exists(join(dir, ".aider/agenttool-refresh.sh"))).toBe(true);
    const refreshStat = await stat(join(dir, ".aider/agenttool-refresh.sh"));
    expect(refreshStat.mode & 0o111).toBeGreaterThan(0);
  });

  test("preserves an existing .aider.conf.yml verbatim (we never edit user config)", async () => {
    const dir = await newTmpdir("aider-conf-preserve");
    const userConf = "model: claude-sonnet-4-6\nauto-commits: false\n";
    await writeFile(join(dir, ".aider.conf.yml"), userConf);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await aiderApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    // .aider.conf.yml is sacred — install never touches it.
    expect(await readFile(join(dir, ".aider.conf.yml"), "utf8")).toBe(userConf);
  });

  test("preserves a hand-written .aider/agenttool-wake.md (writes anchor to .agenttool.md)", async () => {
    const dir = await newTmpdir("aider-preserve");
    await mkdir(join(dir, ".aider"), { recursive: true });
    const userMd = "# My notes\nUnrelated to anything.\n";
    await writeFile(join(dir, ".aider/agenttool-wake.md"), userMd);

    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await aiderApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(
      await readFile(join(dir, ".aider/agenttool-wake.md"), "utf8"),
    ).toBe(userMd);
    expect(
      await exists(join(dir, ".aider/agenttool-wake.agenttool.md")),
    ).toBe(true);
  });

  test("install output prints the wire-up instruction (--read flag)", async () => {
    const dir = await newTmpdir("aider-instructions");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await aiderApp.request("/?format=script");
    await writeFile(installer, await res.text());
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    expect(result.stdout).toContain(
      "aider --read .aider/agenttool-wake.md",
    );
  });

  test("the written refresh script is syntactically valid bash", async () => {
    const dir = await newTmpdir("aider-syntax");
    const installer = join(dir, "install.sh");
    mockDb.stage([makeAgent()]);
    const res = await aiderApp.request("/?format=script");
    await writeFile(installer, await res.text());
    await runBash(installer, dir);

    const lint = Bun.spawn(
      ["bash", "-n", join(dir, ".aider/agenttool-refresh.sh")],
      { stdout: "pipe", stderr: "pipe" },
    );
    await lint.exited;
    expect(lint.exitCode).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Documented gaps
// ────────────────────────────────────────────────────────────────────────

describe("known gaps (test.todo — surfaced for follow-up)", () => {
  test.todo(
    "install scripts should set umask 077 before chmod — currently a permissive default umask could leave the wake hook group/world-readable on multi-user machines",
  );
  test.todo(
    "no numeric schema version on the marker — `<!-- agenttool-managed -->` is a token but doesn't carry a v1/v2 distinction; future adapter format changes need a version dimension",
  );
});
