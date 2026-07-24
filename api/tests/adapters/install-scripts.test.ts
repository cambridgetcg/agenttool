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
import {
  chmod,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { projectCredentialNamespace } from "../../src/services/identity/credential-namespace";
import {
  buildTestApp,
  makeAgent,
  makeMockDb,
  TEST_PROJECT_ID,
} from "./_helpers";

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

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function fakeHookTools(dir: string): Promise<string> {
  const bin = join(dir, "fake-bin");
  await mkdir(bin, { recursive: true });
  await writeExecutable(
    join(bin, "security"),
    '#!/bin/sh\n[ -n "${SECURITY_KEY:-}" ] || exit 1\nprintf \'%s\' "$SECURITY_KEY"\n',
  );
  await writeExecutable(join(bin, "secret-tool"), "#!/bin/sh\nexit 1\n");
  await writeExecutable(
    join(bin, "powershell.exe"),
    '#!/bin/sh\nprintf \'called\\n\' > "$POWERSHELL_MARKER"\nprintf \'vault-key\'\n',
  );
  await writeExecutable(
    join(bin, "curl"),
    `#!/bin/sh
if [ -n "\${HOOK_ENV_CAPTURE:-}" ]; then env > "$HOOK_ENV_CAPTURE"; fi
IFS= read -r authorization || true
{
  printf '%s\\n' "$authorization"
  for arg in "$@"; do printf '%s\\n' "$arg"; done
} > "$HOOK_CAPTURE"
printf '%s' '# wake'
`,
  );
  await writeExecutable(
    join(bin, "jq"),
    `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"# wake"}}'
`,
  );
  return bin;
}

async function runHook(
  hookPath: string,
  cwd: string,
  env: Record<string, string>,
): Promise<RunResult> {
  const proc = Bun.spawn(["/bin/bash", hookPath], {
    cwd,
    env,
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

async function getScriptFromRoute(
  app: ReturnType<typeof buildTestApp>,
  agent = makeAgent(),
): Promise<string> {
  mockDb.stage([agent]);
  const res = await app.request(`/?format=script&identity_id=${agent.id}`);
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

  test("the quoted settings command runs from a project path containing spaces", async () => {
    const dir = await newTmpdir("claude project with spaces");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    expect((await runBash(installer, dir)).code).toBe(0);

    const settings = JSON.parse(
      await readFile(join(dir, ".claude/settings.json"), "utf8"),
    );
    const command = settings.hooks.SessionStart[0].hooks[0].command as string;
    expect(command).toBe(
      '"$CLAUDE_PROJECT_DIR/.claude/hooks/agenttool-wake.sh"',
    );
    const hook = await readFile(
      join(dir, ".claude/hooks/agenttool-wake.sh"),
      "utf8",
    );
    expect(hook).toContain('[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]');

    // Execute the exact command through the same shell boundary Claude uses.
    // Keep credential-store discovery hermetic: this test is about quoting,
    // not whichever secure-store clients happen to be installed on a runner.
    const fakeBin = join(dir, "fake-bin");
    await mkdir(fakeBin, { recursive: true });
    await symlink("/bin/bash", join(fakeBin, "bash"));
    const proc = Bun.spawn(["/bin/bash", "-c", command], {
      cwd: dir,
      env: {
        CLAUDE_PROJECT_DIR: dir,
        PATH: fakeBin,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(await new Response(proc.stdout).text()).toBe("{}\n");
    expect(await new Response(proc.stderr).text()).toBe("");
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

  test("the installed hook stays bound to the resolved identity", async () => {
    const dir = await newTmpdir("claude-identity");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);

    const hook = await readFile(
      join(dir, ".claude/hooks/agenttool-wake.sh"),
      "utf8",
    );
    expect(hook).toContain(
      "/v1/wake?format=md&identity_id=22222222-2222-2222-2222-222222222222",
    );
    expect(result.stdout).toContain(
      "The selected agent's SessionStart wake attempt is configured.",
    );
    expect(result.stdout).not.toContain("Done with review required");
  });

  test("the installed hook reads the mode-0600 Linux fallback before Windows or env", async () => {
    const dir = await newTmpdir("claude-linux-key");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    expect((await runBash(installer, dir)).code).toBe(0);

    const namespace = projectCredentialNamespace(TEST_PROJECT_ID);
    const keyDir = join(dir, ".config", "agenttool", namespace);
    const keyFile = join(keyDir, "key");
    await mkdir(keyDir, { recursive: true });
    await writeFile(keyFile, "file-key");
    await chmod(keyFile, 0o600);

    const fakeBin = await fakeHookTools(dir);
    const capture = join(dir, "hook-capture");
    const powershellMarker = join(dir, "powershell-called");
    const hook = join(dir, ".claude/hooks/agenttool-wake.sh");
    const result = await runHook(hook, dir, {
      HOME: dir,
      USER: "test-user",
      USERNAME: "test-user",
      PATH: `${fakeBin}:/usr/bin:/bin`,
      AT_API_KEY: "env-key",
      HOOK_CAPTURE: capture,
      POWERSHELL_MARKER: powershellMarker,
    });

    expect(result.code).toBe(0);
    expect(await readFile(capture, "utf8")).toContain(
      "Authorization: Bearer file-key",
    );
    expect(await readFile(capture, "utf8")).toContain(
      "/v1/wake?format=md&identity_id=22222222-2222-2222-2222-222222222222",
    );
    expect(await exists(powershellMarker)).toBe(false);
  });

  test("the installed hook reads Windows Password Vault before env when available", async () => {
    const dir = await newTmpdir("claude-windows-key");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    expect((await runBash(installer, dir)).code).toBe(0);

    const fakeBin = await fakeHookTools(dir);
    const capture = join(dir, "hook-capture");
    const powershellMarker = join(dir, "powershell-called");
    const hook = join(dir, ".claude/hooks/agenttool-wake.sh");
    const result = await runHook(hook, dir, {
      HOME: dir,
      USER: "test-user",
      USERNAME: "test-user",
      PATH: `${fakeBin}:/usr/bin:/bin`,
      AT_API_KEY: "env-key",
      HOOK_CAPTURE: capture,
      POWERSHELL_MARKER: powershellMarker,
    });

    expect(result.code).toBe(0);
    expect(await exists(powershellMarker)).toBe(true);
    expect(await readFile(capture, "utf8")).toContain(
      "Authorization: Bearer vault-key",
    );
    expect(await readFile(capture, "utf8")).not.toContain("env-key");
  });

  test("the installed hook skips native Unix PowerShell for the Windows-only vault", async () => {
    const dir = await newTmpdir("claude-unix-pwsh");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    expect((await runBash(installer, dir)).code).toBe(0);

    const fakeBin = join(dir, "fake-bin");
    await mkdir(fakeBin, { recursive: true });
    const powershellMarker = join(dir, "powershell-called");
    await writeExecutable(
      join(fakeBin, "pwsh"),
      '#!/bin/sh\nprintf \'called\\n\' > "$POWERSHELL_MARKER"\nprintf \'wrong-substrate-key\'\n',
    );

    const hook = join(dir, ".claude/hooks/agenttool-wake.sh");
    const result = await runHook(hook, dir, {
      HOME: dir,
      USER: "test-user",
      USERNAME: "test-user",
      PATH: fakeBin,
      POWERSHELL_MARKER: powershellMarker,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("{}\n");
    expect(result.stderr).toBe("");
    expect(await exists(powershellMarker)).toBe(false);
  });

  test("the hook clears inherited tracing, allexport, and exported credential collisions", async () => {
    const dir = await newTmpdir("claude-hostile-shell-env");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    expect((await runBash(installer, dir)).code).toBe(0);

    const fakeBin = await fakeHookTools(dir);
    await writeExecutable(join(fakeBin, "powershell.exe"), "#!/bin/sh\nexit 1\n");
    const capture = join(dir, "hook-capture");
    const envCapture = join(dir, "hook-child-env");
    const hook = join(dir, ".claude/hooks/agenttool-wake.sh");
    const secret = "synthetic-hook-secret";
    const result = await runHook(hook, dir, {
      HOME: dir,
      USER: "test-user",
      USERNAME: "test-user",
      PATH: `${fakeBin}:/usr/bin:/bin`,
      AT_API_KEY: secret,
      ENV_KEY: "pre-exported-collision",
      KEY: "pre-exported-collision",
      WAKE: "pre-exported-collision",
      SHELLOPTS: "allexport:xtrace:verbose",
      PS4: "+ ",
      HOOK_CAPTURE: capture,
      HOOK_ENV_CAPTURE: envCapture,
      POWERSHELL_MARKER: join(dir, "powershell-called"),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hookSpecificOutput");
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);

    const childEnv = await readFile(envCapture, "utf8");
    expect(childEnv).not.toContain(secret);
    for (const variable of ["AT_API_KEY", "ENV_KEY", "KEY", "WAKE"]) {
      expect(childEnv).not.toMatch(new RegExp(`^${variable}=`, "m"));
    }

    const curlCapture = (await readFile(capture, "utf8")).split("\n");
    expect(curlCapture[1]).toBe("-q");
  });

  test("the installed hook emits an empty envelope with HOME and USER absent", async () => {
    const dir = await newTmpdir("claude-minimal-env");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    expect((await runBash(installer, dir)).code).toBe(0);

    const hook = join(dir, ".claude/hooks/agenttool-wake.sh");
    const result = await runHook(hook, dir, { PATH: "/usr/bin:/bin" });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("{}\n");
    expect(result.stderr).toBe("");
  });

  test("the installed hook shares the scaffold account fallback when USER is absent", async () => {
    const dir = await newTmpdir("claude-account-fallback");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    expect((await runBash(installer, dir)).code).toBe(0);

    const fakeBin = await fakeHookTools(dir);
    const capture = join(dir, "hook-capture");
    const hook = join(dir, ".claude/hooks/agenttool-wake.sh");
    const result = await runHook(hook, dir, {
      HOME: dir,
      PATH: `${fakeBin}:/usr/bin:/bin`,
      SECURITY_KEY: "keychain-key",
      HOOK_CAPTURE: capture,
      POWERSHELL_MARKER: join(dir, "powershell-called"),
    });
    expect(result.code).toBe(0);
    expect(await readFile(capture, "utf8")).toContain(
      "Authorization: Bearer keychain-key",
    );
  });

  test("installer refuses a symlinked .claude parent before writing outside the project", async () => {
    const dir = await newTmpdir("claude-parent-symlink");
    const outside = await newTmpdir("claude-parent-outside");
    await symlink(outside, join(dir, ".claude"));
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));

    const result = await runBash(installer, dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Refusing symlink at managed path: .claude");
    expect(await exists(join(outside, "hooks/agenttool-wake.sh"))).toBe(false);
  });

  test("installer refuses a symlinked hook target without overwriting its referent", async () => {
    const dir = await newTmpdir("claude-hook-symlink");
    const outside = join(dir, "outside-hook");
    await mkdir(join(dir, ".claude/hooks"), { recursive: true });
    await writeFile(outside, "keep me");
    await symlink(outside, join(dir, ".claude/hooks/agenttool-wake.sh"));
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));

    const result = await runBash(installer, dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      "Refusing symlink at managed path: .claude/hooks/agenttool-wake.sh",
    );
    expect(await readFile(outside, "utf8")).toBe("keep me");
  });

  test("a failed three-file commit rolls back every newly-created target", async () => {
    const dir = await newTmpdir("claude-rollback");
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));

    const fakeBin = join(dir, "fake-bin");
    await mkdir(fakeBin);
    const counter = join(dir, "ln-count");
    await writeExecutable(
      join(fakeBin, "ln"),
      `#!/bin/sh
count=$(cat "$LN_COUNT_FILE" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "$count" > "$LN_COUNT_FILE"
[ "$count" -eq 3 ] && exit 77
exec /bin/ln "$@"
`,
    );

    const result = await runBash(installer, dir, {
      PATH: `${fakeBin}:/usr/bin:/bin`,
      LN_COUNT_FILE: counter,
    });
    expect(result.code).not.toBe(0);
    expect(await exists(join(dir, ".claude/hooks/agenttool-wake.sh"))).toBe(false);
    expect(await exists(join(dir, ".claude/settings.json"))).toBe(false);
    expect(await exists(join(dir, "CLAUDE.md"))).toBe(false);
    expect(await exists(join(dir, ".claude/.agenttool-install.lock"))).toBe(false);
    expect((await readdir(join(dir, ".claude"))).some((name) =>
      name.startsWith(".agenttool-stage."),
    )).toBe(false);
  });

  test.each([
    { label: "immediately after lock acquisition", linkNumber: 1 },
    { label: "after the final target hard link", linkNumber: 4 },
  ])("a signal $label cleans the lock and attempted set", async ({ linkNumber }) => {
    const dir = await newTmpdir(`claude-signal-rollback-${linkNumber}`);
    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));

    const fakeBin = join(dir, "fake-bin");
    await mkdir(fakeBin);
    const counter = join(dir, "ln-count");
    await writeExecutable(
      join(fakeBin, "ln"),
      `#!/bin/sh
count=$(cat "$LN_COUNT_FILE" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "$count" > "$LN_COUNT_FILE"
/bin/ln "$@"
status=$?
if [ "$status" -eq 0 ] && [ "$count" -eq ${linkNumber} ]; then
  kill -TERM "$PPID"
fi
exit "$status"
`,
    );

    const result = await runBash(installer, dir, {
      PATH: `${fakeBin}:/usr/bin:/bin`,
      LN_COUNT_FILE: counter,
    });
    expect(result.code).toBe(130);
    expect(await exists(join(dir, ".claude/hooks/agenttool-wake.sh"))).toBe(false);
    expect(await exists(join(dir, ".claude/settings.json"))).toBe(false);
    expect(await exists(join(dir, "CLAUDE.md"))).toBe(false);
    expect(await exists(join(dir, ".claude/.agenttool-install.lock"))).toBe(false);
    const claudeEntries = await readdir(join(dir, ".claude"));
    for (const prefix of [
      ".agenttool-stage.",
      ".agenttool-install.owner.",
    ]) {
      expect(claudeEntries.some((name) => name.startsWith(prefix))).toBe(false);
    }
  });

  test("concurrent installers cannot mix two identity bindings", async () => {
    const dir = await newTmpdir("claude-concurrent");
    const firstIdentity = makeAgent();
    const secondIdentity = makeAgent({
      id: "44444444-4444-4444-4444-444444444444",
      did: "did:at:test-beta",
      displayName: "Beta",
    });
    const firstInstaller = join(dir, "install-a.sh");
    const secondInstaller = join(dir, "install-b.sh");
    await writeFile(
      firstInstaller,
      await getScriptFromRoute(claudeApp, firstIdentity),
    );
    await writeFile(
      secondInstaller,
      await getScriptFromRoute(claudeApp, secondIdentity),
    );

    const [first, second] = await Promise.all([
      runBash(firstInstaller, dir),
      runBash(secondInstaller, dir),
    ]);
    expect([first.code, second.code].some((code) => code === 0)).toBe(true);

    const liveHook = await readFile(
      join(dir, ".claude/hooks/agenttool-wake.sh"),
      "utf8",
    );
    const liveAnchor = await readFile(join(dir, "CLAUDE.md"), "utf8");
    const activeIdentity = liveHook.includes(`identity_id=${firstIdentity.id}`)
      ? firstIdentity
      : secondIdentity;
    expect(liveHook).toContain(`identity_id=${activeIdentity.id}`);
    expect(liveAnchor).toContain(activeIdentity.did);

    const proposedHook = join(
      dir,
      ".claude/hooks/agenttool-wake.agenttool.sh",
    );
    if (await exists(proposedHook)) {
      const proposed = await readFile(proposedHook, "utf8");
      const proposedAnchor = await readFile(
        join(dir, "CLAUDE.agenttool.md"),
        "utf8",
      );
      const otherIdentity = activeIdentity.id === firstIdentity.id
        ? secondIdentity
        : firstIdentity;
      expect(proposed).toContain(`identity_id=${otherIdentity.id}`);
      expect(proposedAnchor).toContain(otherIdentity.did);
    }

    expect(await exists(join(dir, ".claude/.agenttool-install.lock"))).toBe(false);
    expect((await readdir(join(dir, ".claude"))).some((name) =>
      name.startsWith(".agenttool-stage."),
    )).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Claude Code install — existing-file behavior
// ────────────────────────────────────────────────────────────────────────

describe("claude-code install script — existing file guards", () => {
  test.each([
    ".claude/hooks/agenttool-wake.agenttool.sh",
    ".claude/settings.agenttool.json",
    "CLAUDE.agenttool.md",
  ])("refuses a proposal-only project without creating live files (%s)", async (proposal) => {
    const dir = await newTmpdir("claude-proposal-only");
    const proposalPath = join(dir, proposal);
    await mkdir(join(proposalPath, ".."), { recursive: true });
    await writeFile(proposalPath, "review me; do not replace\n");

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      `Refusing to overwrite reviewable proposal: ${proposal}`,
    );
    expect(await readFile(proposalPath, "utf8")).toBe(
      "review me; do not replace\n",
    );
    expect(await exists(join(dir, ".claude/hooks/agenttool-wake.sh"))).toBe(
      false,
    );
    expect(await exists(join(dir, ".claude/settings.json"))).toBe(false);
    expect(await exists(join(dir, "CLAUDE.md"))).toBe(false);
  });

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
    expect(result.stdout).toContain("Done with review required");
    expect(result.stdout).toContain("no live identity-binding file was changed");
    expect(await exists(join(dir, ".claude/settings.json"))).toBe(false);
    expect(await exists(join(dir, ".claude/hooks/agenttool-wake.sh"))).toBe(false);
    expect(result.stdout).not.toContain(
      "The selected agent's SessionStart wake attempt is configured.",
    );
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
  test("an orphan live hook cannot become active through newly-created settings", async () => {
    const dir = await newTmpdir("claude-orphan-hook");
    await mkdir(join(dir, ".claude/hooks"), { recursive: true });
    const liveHook = join(dir, ".claude/hooks/agenttool-wake.sh");
    await writeFile(liveHook, "#!/bin/sh\necho unrelated\n");

    const installer = join(dir, "install.sh");
    await writeFile(installer, await getScriptFromRoute(claudeApp));
    const result = await runBash(installer, dir);
    expect(result.code).toBe(0);
    expect(await exists(join(dir, ".claude/settings.json"))).toBe(false);
    expect(await exists(join(dir, ".claude/settings.agenttool.json"))).toBe(true);
    expect(await exists(join(dir, "CLAUDE.md"))).toBe(false);
    expect(await exists(join(dir, "CLAUDE.agenttool.md"))).toBe(true);
    expect(await readFile(liveHook, "utf8")).toBe(
      "#!/bin/sh\necho unrelated\n",
    );
    expect(result.stdout).toContain("activate all changed binding files together");
  });

  test("reinstalling for another identity stages every changed binding", async () => {
    const dir = await newTmpdir("claude-rebind");
    const firstInstaller = join(dir, "install-a.sh");
    await writeFile(firstInstaller, await getScriptFromRoute(claudeApp));
    expect((await runBash(firstInstaller, dir)).code).toBe(0);

    const liveHook = join(dir, ".claude/hooks/agenttool-wake.sh");
    const liveSettings = join(dir, ".claude/settings.json");
    const liveAnchor = join(dir, "CLAUDE.md");
    const before = {
      hook: await readFile(liveHook, "utf8"),
      settings: await readFile(liveSettings, "utf8"),
      anchor: await readFile(liveAnchor, "utf8"),
    };

    const secondIdentity = makeAgent({
      id: "44444444-4444-4444-4444-444444444444",
      did: "did:at:test-beta",
      displayName: "Beta",
    });
    const secondInstaller = join(dir, "install-b.sh");
    await writeFile(
      secondInstaller,
      await getScriptFromRoute(claudeApp, secondIdentity),
    );
    const result = await runBash(secondInstaller, dir);
    expect(result.code).toBe(0);

    expect(await readFile(liveHook, "utf8")).toBe(before.hook);
    expect(await readFile(liveSettings, "utf8")).toBe(before.settings);
    expect(await readFile(liveAnchor, "utf8")).toBe(before.anchor);
    expect(
      await readFile(
        join(dir, ".claude/hooks/agenttool-wake.agenttool.sh"),
        "utf8",
      ),
    ).toContain(`identity_id=${secondIdentity.id}`);
    expect(await readFile(join(dir, "CLAUDE.agenttool.md"), "utf8")).toContain(
      secondIdentity.did,
    );
    expect(result.stdout).toContain("no live identity-binding file was changed");
  });

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
    expect(result.stdout).toContain("Done with review required");
    expect(result.stdout).toContain("activate all changed binding files together");
    expect(await exists(join(dir, ".claude/hooks/agenttool-wake.sh"))).toBe(false);
    expect(await exists(join(dir, "CLAUDE.md"))).toBe(false);
    expect(result.stdout).not.toContain(
      "The selected agent's SessionStart wake attempt is configured.",
    );
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
