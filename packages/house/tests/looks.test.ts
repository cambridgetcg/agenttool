/** Each look, present and absent, and each refusal. */
import { describe, expect, test } from "bun:test";
import {
  askHelp, askWeather, lookEntry, lookEnv, lookHook, lookLink, lookPath, lookSource, lookSystemPath, lookWrappers,
  runnableHostEntry, LookRefused,
} from "../src/looks.js";
import { installReferences } from "../src/places.js";
import { ArgvRefused, askArgv, assertAllowedArgv, childEnvironment } from "../src/run.js";
import {
  BIN, CLAUDE_SERVERS, COLLAB_NEW, COLLAB_OLD, COMMIT_NEW, FakeFs, FakeRunner, HELP_WITHOUT_WEATHER, HELP_WITH_WEATHER, HOME,
  LOBBY_COMMIT, LOBBY_VERSION, NOW, SHARE, claudeJson, claudeSettings, codexToml, fullHouse, makeDeps, weatherReceipt,
} from "./helpers.js";

const entryPath = `${SHARE}/collab/${COLLAB_NEW}/agenttool-collab-host.js`;

describe("path", () => {
  test("present: type and age from mtime, by this device's clock", () => {
    expect(lookPath(makeDeps(), "share", "collab.sqlite-wal")).toEqual({ seen: "entry", type: "file", age_seconds: 60 });
    expect(lookPath(makeDeps(), "bin", "timewitness")).toEqual({ seen: "entry", type: "link", age_seconds: 86_400 });
  });

  test("absent, and absent below a missing root", () => {
    expect(lookPath(makeDeps(), "share", "nothing-here")).toEqual({ seen: "absent" });
    expect(lookPath(makeDeps({ fs: new FakeFs() }), "state", "lobby/lobby.sqlite")).toEqual({ seen: "absent" });
  });

  test("a file time ahead of the clock gives no age", () => {
    const fs = fullHouse().put(`${SHARE}/future`, { type: "file", text: "", mtime: NOW.getTime() + 60_000 });
    expect(lookPath(makeDeps({ fs }), "share", "future")).toEqual({ seen: "entry", type: "file", age_seconds: null });
  });

  test("refused: a path outside the allowed roots, or a name in ~/.local/bin that is not a wrapper or a named command", () => {
    const deps = makeDeps();
    for (const rel of ["../../.ssh/id_ed25519", "/etc/passwd", "collab/../../x", "./collab", "", "collab//x", "a b"]) {
      expect(() => lookPath(deps, "share", rel)).toThrow(LookRefused);
    }
    for (const name of ["ls", "carry", "private-tool", "agenttool-x/../../y", "AGENTTOOL-X"]) expect(() => lookPath(deps, "bin", name)).toThrow(LookRefused);
    expect(() => lookSystemPath(deps, "/etc/passwd")).toThrow(LookRefused);
    expect(() => lookSystemPath(deps, "/opt/homebrew/bin/bun")).toThrow(LookRefused);
    expect((deps.fs as FakeFs).calls).toEqual([]);
  });

  test("a link on the way is not followed", () => {
    const fs = new FakeFs({ [`${HOME}/elsewhere/agenttool/collab.sqlite`]: { type: "file", text: "" } })
      .put(`${HOME}/.local/share/agenttool`, { type: "link", target: `${HOME}/elsewhere/agenttool` });
    const seen = lookPath(makeDeps({ fs }), "share", "collab.sqlite");
    expect(seen).toEqual({ seen: "unknown", why: "a link stands on the way to it; the link was not followed" });
    expect(fs.calls.map((call) => call.path)).not.toContain(`${HOME}/.local/share/agenttool/collab.sqlite`);
  });

  test("permission refused is unknown, with that reason", () => {
    const fs = fullHouse().put(`${HOME}/.local/state/agenttool`, { type: "denied" });
    expect(lookPath(makeDeps({ fs }), "state", "lobby/lobby.sqlite")).toEqual({ seen: "unknown", why: "it could not be looked at: permission was refused" });
  });
});

describe("link", () => {
  test("present: version directories (those holding SOURCE.txt) and the current one", () => {
    const seen = lookLink(makeDeps(), "collab");
    expect(seen).toEqual({ seen: "tool", versions: [COLLAB_OLD, COLLAB_NEW], more: false, current: COLLAB_NEW, current_problem: null, others: ["doorbell", "install-check"] });
  });

  test("absent", () => {
    expect(lookLink(makeDeps(), "lobby-doorbell")).toEqual({ seen: "absent" });
  });

  test("refused: a current link that escapes the install directory is not followed", () => {
    for (const target of [`${HOME}/elsewhere/0.9.0`, "../other/0.9.0", "/tmp/x"]) {
      const fs = fullHouse().put(`${SHARE}/collab/current`, { type: "link", target });
      const seen = lookLink(makeDeps({ fs }), "collab");
      expect(seen.seen === "tool" && seen.current_problem).toBe("the current link leads outside the install directory; it was not followed");
    }
  });

  test("an install directory that is itself a link is not followed", () => {
    const fs = fullHouse().remove(`${SHARE}/collab`).put(`${SHARE}/collab`, { type: "link", target: `${HOME}/elsewhere` });
    expect(lookLink(makeDeps({ fs }), "collab")).toEqual({ seen: "unknown", why: "the install directory is a link; it was not followed" });
    expect(fs.calls.some((call) => call.op === "list")).toBe(false);
  });

  test("a current link naming something that is not an installed version", () => {
    const fs = fullHouse().put(`${SHARE}/collab/current`, { type: "link", target: "doorbell" });
    const seen = lookLink(makeDeps({ fs }), "collab");
    expect(seen.seen === "tool" && seen.current_problem).toBe("the current link names a directory that is not an installed version");
  });
});

describe("source", () => {
  test("only the commit and installed lines; the rest of the line after the time is dropped", () => {
    expect(lookSource(makeDeps(), "collab", COLLAB_NEW)).toEqual({ seen: "read", commit: COMMIT_NEW, installed: "2026-11-13T16:25:50Z" });
  });

  test("a SOURCE.txt with extra lines and no installed line", () => {
    expect(lookSource(makeDeps(), "lobby", LOBBY_VERSION)).toEqual({ seen: "read", commit: LOBBY_COMMIT, installed: null });
  });

  test("a commit line with anything after the hash, or a non-hex hash, is not taken", () => {
    const fs = fullHouse().put(`${SHARE}/collab/${COLLAB_NEW}/SOURCE.txt`, {
      type: "file",
      text: "commit: 0f1e2d3c (built by quillon)\ncommit: NOTHEX123\ninstalled: yesterday by quillon\n",
    });
    expect(lookSource(makeDeps({ fs }), "collab", COLLAB_NEW)).toEqual({ seen: "read", commit: null, installed: null });
  });

  test("a SOURCE.txt that is a link is not read", () => {
    const fs = fullHouse().put(`${SHARE}/collab/${COLLAB_NEW}/SOURCE.txt`, { type: "link", target: `${HOME}/.ssh/id_ed25519` });
    expect(lookSource(makeDeps({ fs }), "collab", COLLAB_NEW)).toEqual({ seen: "unknown", why: "SOURCE.txt is not a regular file; it was not read" });
    expect(fs.calls.some((call) => call.op === "readHead")).toBe(false);
  });

  test("absent", () => {
    const fs = fullHouse().remove(`${SHARE}/collab/${COLLAB_NEW}/SOURCE.txt`);
    expect(lookSource(makeDeps({ fs }), "collab", COLLAB_NEW)).toEqual({ seen: "unknown", why: "SOURCE.txt is not there" });
  });

  test("refused: current, or a version name with a slash", () => {
    expect(() => lookSource(makeDeps(), "collab", "current")).toThrow(LookRefused);
    expect(() => lookSource(makeDeps(), "collab", "../x")).toThrow(LookRefused);
  });
});

describe("entry", () => {
  test("present: the installs its command and arguments name, and closed-set switches only", () => {
    expect(lookEntry(makeDeps(), "claude-code", "agenttool-collab")).toEqual({
      seen: "entry",
      references: [{ tool: "collab", version: "current" }],
      switches: { AGENTOOL_COLLAB_TOOLS: "full", AGENTOOL_COLLAB_CONSENT_RULE: "set to something else" },
    });
    expect(lookEntry(makeDeps(), "codex", "agenttool-collab")).toEqual({
      seen: "entry",
      references: [{ tool: "collab", version: "current" }],
      switches: { AGENTOOL_COLLAB_TOOLS: "notes" },
    });
  });

  test("absent: no configuration file, or no entry", () => {
    const fs = fullHouse().remove(`${HOME}/.claude.json`);
    expect(lookEntry(makeDeps({ fs }), "claude-code", "agenttool-collab")).toEqual({ seen: "no_config" });
    expect(lookEntry(makeDeps(), "codex", "agenttool-lobby")).toEqual({ seen: "no_entry" });
  });

  test("a switch set to a value outside its set reads as set to something else; both spellings are reported as spelled", () => {
    const servers = { "agenttool-collab": { command: "bun", args: [], env: { AGENTTOOL_COLLAB_TOOLS: "everything", AGENTOOL_COLLAB_WEATHER: "on", AGENTTOOL_COLLAB_WEATHER: 1 } } };
    const fs = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson(servers) });
    const seen = lookEntry(makeDeps({ fs }), "claude-code", "agenttool-collab");
    expect(seen.seen === "entry" && seen.switches).toEqual({ AGENTOOL_COLLAB_WEATHER: "on", AGENTTOOL_COLLAB_TOOLS: "set to something else", AGENTTOOL_COLLAB_WEATHER: "set to something else" });
  });

  test("a configuration that does not parse is unknown, and the parser's message (which can quote the file) is not kept", () => {
    const fs = fullHouse()
      .put(`${HOME}/.claude.json`, { type: "file", text: '{"mcpServers": {"x": "atcm_SECRET_IN_BROKEN_JSON' })
      .put(`${HOME}/.codex/config.toml`, { type: "file", text: 'token = "xoxb-SECRET\n[[[' });
    expect(lookEntry(makeDeps({ fs }), "claude-code", "agenttool-collab")).toEqual({ seen: "unknown", why: "the configuration file could not be parsed as JSON" });
    expect(lookEntry(makeDeps({ fs }), "codex", "agenttool-collab")).toEqual({ seen: "unknown", why: "the configuration file could not be parsed as TOML" });
  });

  test("a configuration file that is a link or too large is not read", () => {
    const linked = fullHouse().put(`${HOME}/.claude.json`, { type: "link", target: `${HOME}/dotfiles/claude.json` });
    expect(lookEntry(makeDeps({ fs: linked }), "claude-code", "agenttool-collab")).toEqual({ seen: "unknown", why: "the configuration file is a link; it was not followed" });
    const large = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson({ ...CLAUDE_SERVERS, pad: "x".repeat(8 * 1024 * 1024) }) });
    expect(lookEntry(makeDeps({ fs: large }), "claude-code", "agenttool-collab")).toEqual({ seen: "unknown", why: "the configuration file is larger than 8 MiB; it was not read" });
  });

  test("an entry that runs something outside the installs names none", () => {
    const fs = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson({ "agenttool-collab": { command: "bun", args: [`${HOME}/agenttool/packages/collab/dist/agenttool-collab-mcp.js`] } }) });
    expect(lookEntry(makeDeps({ fs }), "claude-code", "agenttool-collab")).toEqual({ seen: "entry", references: [], switches: {} });
  });

  test("refused: a server name that is not agenttool-*", () => {
    expect(() => lookEntry(makeDeps(), "claude-code", "other")).toThrow(LookRefused);
  });
});

describe("hook", () => {
  test("present: per event, the installs named; a hook that names none is listed as such", () => {
    expect(lookHook(makeDeps(), "claude-code")).toEqual({
      seen: "hooks",
      events: [
        { event: "SessionStart", references: [{ tool: "execution-seat", version: "current" }] },
        { event: "SessionEnd", references: [{ tool: "execution-seat", version: "current" }, { tool: "collab", version: "current" }] },
        { event: "PostToolUse", references: [{ tool: "execution-seat", version: "current" }] },
        { event: "Stop", references: [] },
      ],
    });
  });

  test("absent: no settings file; settings without hooks", () => {
    expect(lookHook(makeDeps({ fs: fullHouse().remove(`${HOME}/.claude/settings.json`) }), "claude-code")).toEqual({ seen: "no_config" });
    const fs = fullHouse().put(`${HOME}/.claude/settings.json`, { type: "file", text: JSON.stringify({ env: { TOKEN: "atcm_x" } }) });
    expect(lookHook(makeDeps({ fs }), "claude-code")).toEqual({ seen: "hooks", events: [] });
  });

  test("a hook whose command holds a token yields only the install it names", () => {
    const fs = fullHouse().put(`${HOME}/.claude/settings.json`, {
      type: "file",
      text: claudeSettings({ SessionEnd: [{ hooks: [{ type: "command", command: `AT_TOKEN=atcm_FAKE1234567890 bun ${SHARE}/collab/${COLLAB_OLD}/agenttool-collab-host.js end` }] }] }),
    });
    expect(JSON.stringify(lookHook(makeDeps({ fs }), "claude-code"))).toBe(JSON.stringify({ seen: "hooks", events: [{ event: "SessionEnd", references: [{ tool: "collab", version: COLLAB_OLD }] }] }));
  });
});

describe("wrapper (agenttool-* in ~/.local/bin)", () => {
  test("present: each wrapper's name and the install it names; other commands are never looked at", () => {
    const deps = makeDeps();
    expect(lookWrappers(deps)).toEqual({
      seen: "wrappers",
      wrappers: [
        { name: "agenttool-collab-host", entry: "file", references: [{ tool: "collab", version: "current" }] },
        { name: "agenttool-lobby", entry: "file", references: [{ tool: "lobby", version: "current" }] },
      ],
      more: false,
    });
    expect((deps.fs as FakeFs).calls.some((call) => /carry|private-tool|timewitness/.test(call.path))).toBe(false);
  });

  test("absent", () => {
    expect(lookWrappers(makeDeps({ fs: fullHouse().remove(BIN) }))).toEqual({ seen: "absent" });
  });

  test("a wrapper that is a link is not followed", () => {
    const fs = fullHouse().put(`${BIN}/agenttool-lobby`, { type: "link", target: `${HOME}/scripts/lobby.sh` });
    const seen = lookWrappers(makeDeps({ fs }));
    expect(seen.seen === "wrappers" && seen.wrappers[1]).toEqual({ name: "agenttool-lobby", entry: "link", references: null });
    expect(fs.calls.some((call) => call.op === "readHead" && call.path.endsWith("agenttool-lobby"))).toBe(false);
  });
});

describe("ask", () => {
  test("present: help says whether weather exists; weather gives says, notes, wake times and the battery", async () => {
    expect(await askHelp(makeDeps(), entryPath)).toEqual({ seen: "answer", has_weather: true });
    expect(await askHelp(makeDeps({ run: new FakeRunner({ help: HELP_WITHOUT_WEATHER }) }), entryPath)).toEqual({ seen: "answer", has_weather: false });
    const weather = await askWeather(makeDeps(), entryPath);
    expect(weather.seen === "answer" && { ...weather, says: weather.says?.slice(0, 14) }).toEqual({
      seen: "answer", says: "On mains power", notes: [expect.stringContaining("This device woke")], withheld: false,
      awake_since: "2026-11-14T11:58:00.000Z", last_slept_at: "2026-11-14T11:30:00.000Z", battery: true,
    });
  });

  test("the child gets a fixed argv, a fixed small environment, a timeout and a cap", async () => {
    const run = new FakeRunner({ help: HELP_WITH_WEATHER, weather: { stdout: weatherReceipt() } });
    await askHelp(makeDeps({ run }), entryPath);
    await askWeather(makeDeps({ run }), entryPath);
    expect(run.calls.map((call) => call.argv)).toEqual([
      [process.execPath, "--no-env-file", "--config=/dev/null", entryPath, "--help"],
      [process.execPath, "--no-env-file", "--config=/dev/null", entryPath, "weather"],
    ]);
    for (const call of run.calls) {
      expect(call.options.env).toEqual({ PATH: "/usr/bin:/bin", HOME });
      expect(call.options.timeoutMs).toBeLessThanOrEqual(8000);
      expect(call.options.maxBytes).toBe(64 * 1024);
    }
  });

  test("refused before anything runs: any argv off the allowlist", () => {
    const allowed = askArgv(entryPath, "help");
    expect(() => assertAllowedArgv(allowed, HOME)).not.toThrow();
    for (const argv of [
      [process.execPath, "--no-env-file", "--config=/dev/null", entryPath, "end", "--session-file", "x"],
      [process.execPath, "--no-env-file", "--config=/dev/null", entryPath, "weather", "--db", "x"],
      [process.execPath, "--no-env-file", "--config=/dev/null", `${SHARE}/collab/current/agenttool-collab-host.js`, "weather"],
      [process.execPath, "--no-env-file", "--config=/dev/null", `${SHARE}/collab/${COLLAB_NEW}/agenttool-collab-mcp.js`, "--help"],
      [process.execPath, "--no-env-file", "--config=/dev/null", `${SHARE}/collab/../../../evil/agenttool-collab-host.js`, "weather"],
      [process.execPath, entryPath, "weather"],
      ["/bin/sh", "-c", "agenttool-collab-host weather"],
      ["/opt/homebrew/bin/bun", "--no-env-file", "--config=/dev/null", entryPath, "weather"],
    ]) expect(() => assertAllowedArgv(argv, HOME)).toThrow(ArgvRefused);
    expect(childEnvironment(HOME)).toEqual({ PATH: "/usr/bin:/bin", HOME });
  });

  test("slow, flooding, failing, two-line, non-JSON, foreign or unstartable answers are unknown with the reason", async () => {
    const cases: Array<[Partial<import("../src/run.js").RunResult>, string]> = [
      [{ timedOut: true, exitCode: null }, "the collab host did not answer within 5 seconds"],
      [{ truncated: true, exitCode: null }, "the collab host printed more than 64 KiB"],
      [{ exitCode: 1, stdout: '{"protocol":"agenttool.collab-host/1","status":"error"}\n' }, "the collab host exited with an error"],
      [{ stdout: `${HELP_WITH_WEATHER.stdout}${HELP_WITH_WEATHER.stdout}` }, "the collab host did not print exactly one line"],
      [{ stdout: "usage: atcm_SECRET quillon\n" }, "the collab host's line was not JSON"],
      [{ stdout: '{"protocol":"something/else","status":"help","usage":"x"}\n' }, "the collab host's line was not a collab-host receipt"],
      [{ spawnFailed: true, exitCode: null }, "the collab host could not be started"],
    ];
    for (const [answer, why] of cases) {
      const seen = await askHelp(makeDeps({ run: new FakeRunner({ help: answer }) }), entryPath);
      expect(seen).toEqual({ seen: "unknown", why });
    }
  });

  test("weather keeps only named fields and caps its text", async () => {
    const long = "x".repeat(601);
    const run = new FakeRunner({ weather: { stdout: weatherReceipt({ says: long, notes: [long, 7, "Low Power Mode is on: the person has asked this device to be frugal."] }) } });
    const seen = await askWeather(makeDeps({ run }), entryPath);
    expect(seen.seen === "answer" && [seen.says, seen.notes]).toEqual([null, ["Low Power Mode is on: the person has asked this device to be frugal."]]);
  });

  test("the bundle is run only when it and its directory are this user's alone to change", () => {
    expect(runnableHostEntry(makeDeps(), COLLAB_NEW)).toEqual({ entry: entryPath });
    const writable = fullHouse().put(entryPath, { type: "file", text: "", mode: 0o100777 });
    expect(runnableHostEntry(makeDeps({ fs: writable }), COLLAB_NEW)).toEqual({ why: "the host bundle or its directory is not this user's alone to change, so it was not run" });
    const foreign = fullHouse().put(entryPath, { type: "file", text: "", uid: 0, mode: 0o100755 });
    expect("why" in runnableHostEntry(makeDeps({ fs: foreign }), COLLAB_NEW)).toBe(true);
    const linked = fullHouse().put(entryPath, { type: "link", target: "/tmp/evil.js" });
    expect(runnableHostEntry(makeDeps({ fs: linked }), COLLAB_NEW)).toEqual({ why: "the host bundle is not a regular file, so it was not run" });
  });
});

describe("env", () => {
  test("booleans only, from the closed set", () => {
    const deps = makeDeps({ env: { HOME, PATH: `${HOME}/.local/bin:/usr/bin`, CI: "true", SSH_TTY: "/dev/ttys001", container: "podman" } });
    expect(lookEnv(deps, "ci")).toBe(true);
    expect(lookEnv(deps, "over_ssh")).toBe(true);
    expect(lookEnv(deps, "container")).toBe(true);
    expect(lookEnv(deps, { path_has: "~/.local/bin" })).toBe(true);
    expect(lookEnv(deps, { path_has: "/opt/homebrew/bin" })).toBe(false);
    const quiet = makeDeps({ env: { HOME, CI: "false", SSH_CONNECTION: "" } });
    expect([lookEnv(quiet, "ci"), lookEnv(quiet, "over_ssh"), lookEnv(quiet, "container"), lookEnv(quiet, { path_has: "~/.local/bin" })]).toEqual([false, false, false, false]);
  });
});

describe("the install matcher", () => {
  test("absolute home, $HOME, ${HOME} and ~ forms; known tools and well-formed versions only", () => {
    const text = [
      `${HOME}/.local/share/agenttool/collab/0.6.0-dev.0-0f1e2d3c/agenttool-collab-host.js`,
      "$HOME/.local/share/agenttool/lobby/current/agenttool-lobby.js",
      "${HOME}/.local/share/agenttool/execution-seat/main-9a8b7c6d/bin/x.ts",
      "~/.local/share/agenttool/house/current/bin",
      "/Users/someone-else/.local/share/agenttool/collab/9.9.9/x",
      `${HOME}/.local/share/agenttool/unknown-tool/1.0/x`,
      `${HOME}/.local/share/agenttool/collab.sqlite`,
    ].join(" ");
    expect(installReferences(text, HOME)).toEqual([
      { tool: "collab", version: "0.6.0-dev.0-0f1e2d3c" },
      { tool: "lobby", version: "current" },
      { tool: "execution-seat", version: "main-9a8b7c6d" },
      { tool: "house", version: "current" },
    ]);
  });
});
