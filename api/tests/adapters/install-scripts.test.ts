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

beforeAll(async () => {
  mock.module("../../src/db/client", () => ({ db: mockDb }));
  const { default: claudeRoutes } = await import(
    "../../src/routes/adapters/claude-code"
  );
  claudeApp = buildTestApp(claudeRoutes);
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

  test("preserves a marked CLAUDE.md because the marker is not overwrite consent", async () => {
    const dir = await newTmpdir("claude-overwrite");
    const stale = "<!-- agenttool-managed -->\n# stale\nOld content.\n";
    await writeFile(join(dir, "CLAUDE.md"), stale);

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    // Preserve possible user edits even when the file started as generated.
    const after = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(after).toBe(stale);
    expect(await exists(join(dir, "CLAUDE.agenttool.md"))).toBe(true);
    expect(await readFile(join(dir, "CLAUDE.agenttool.md"), "utf8")).toContain(
      "# Aurora",
    );
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

  test("preserves previously-installed settings and writes a reviewable sibling", async () => {
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

    // Second install preserves the existing file in case it was edited and
    // writes the current generated version beside it for explicit merge.
    result = await runBash(installer, dir);
    expect(result.code).toBe(0);
    expect(await readFile(join(dir, ".claude/settings.json"), "utf8")).toBe(
      firstWrite,
    );
    expect(await exists(join(dir, ".claude/settings.agenttool.json"))).toBe(
      true,
    );
  });
});
