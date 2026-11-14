/** States: present, missing, unknown with a reason, and stale only for an inconsistency on this device. */
import { describe, expect, test } from "bun:test";
import { PARTS, PART_IDS } from "../src/parts.js";
import { survey, UndeclaredLook } from "../src/survey.js";
import { GOOD_FOR_SECONDS, SURVEY_PROTOCOL } from "../src/shapes.js";
import {
  BIN, COLLAB_NEW, COLLAB_OLD, COMMIT_NEW, FakeFs, FakeRunner, HELP_WITHOUT_WEATHER, HELP_WITH_WEATHER, HOME, INSTALLED_NEW, LOBBY_COMMIT, LOBBY_VERSION,
  NOW, SEAT_COMMIT, SEAT_INSTALLED, SEAT_VERSION, SHARE, STATE, CLAUDE_HOOKS, CLAUDE_SERVERS, claudeJson, claudeSettings, codexToml, fakeEnv, fullHouse,
  makeDeps, partOf, weatherReceipt,
} from "./helpers.js";

describe("a whole house", () => {
  test("every part, in table order, with its state", async () => {
    const seen = await survey(makeDeps());
    expect(seen.protocol).toBe(SURVEY_PROTOCOL);
    expect(seen.surveyed_at).toBe(NOW.toISOString());
    expect(seen.good_for_seconds).toBe(GOOD_FOR_SECONDS);
    expect(seen.parts.map((part) => [part.id, part.state])).toEqual([
      ["ground.weather", "present"],
      ["room.collab", "present"],
      ["room.lobby", "present"],
      ["room.execution-seat", "present"],
      ["door.claude-code.collab", "present"],
      ["door.claude-code.lobby", "present"],
      ["door.codex.collab", "present"],
      ["door.codex.lobby", "missing"],
      ["hand.claude-code.hooks", "present"],
      ["hand.wrappers", "present"],
      ["clock.witness", "present"],
      ["clock.netcheck", "missing"],
      ["clock.wake", "present"],
    ]);
    expect(seen.says).toBe(
      "Here: ground.weather, room.collab, room.lobby, room.execution-seat, door.claude-code.collab, door.claude-code.lobby, door.codex.collab, "
      + "hand.claude-code.hooks, hand.wrappers, clock.witness, clock.wake. Missing: door.codex.lobby, clock.netcheck. "
      + "A reading from 12:00:00Z, good for about five minutes.",
    );
  });

  test("rooms: versions, the current one, its commit and install time, and the journal, cache or ledger by lstat", async () => {
    const seen = await survey(makeDeps());
    expect(partOf(seen, "room.collab").detail).toEqual({
      versions: [COLLAB_OLD, COLLAB_NEW], current: COLLAB_NEW, commit: COMMIT_NEW, installed: INSTALLED_NEW,
      journal: { exists: true, age_seconds: 60 },
    });
    expect(partOf(seen, "room.lobby").detail).toEqual({
      versions: [LOBBY_VERSION], current: LOBBY_VERSION, commit: LOBBY_COMMIT, installed: null, cache: { exists: true, age_seconds: 3600 },
    });
    expect(partOf(seen, "room.lobby").how).toContain("at least that old");
    expect(partOf(seen, "room.execution-seat").detail).toEqual({
      versions: [SEAT_VERSION], current: SEAT_VERSION, commit: SEAT_COMMIT, installed: SEAT_INSTALLED, ledger: { exists: true, age_seconds: 300 },
    });
  });

  test("doors, hooks, wrappers, clocks and the weather carry their closed details", async () => {
    const seen = await survey(makeDeps());
    expect(partOf(seen, "door.claude-code.lobby").detail).toEqual({ entry: true, names_install: true, version: "current", names_current: true, switches: {} });
    expect(partOf(seen, "door.codex.lobby")).toMatchObject({ state: "missing", why: "~/.codex/config.toml has no agenttool-lobby entry" });
    expect(partOf(seen, "hand.claude-code.hooks").detail).toEqual({
      events: [
        { event: "SessionStart", names_install: true, installs: [{ tool: "execution-seat", version: "current", names_current: true }] },
        { event: "SessionEnd", names_install: true, installs: [{ tool: "execution-seat", version: "current", names_current: true }, { tool: "collab", version: "current", names_current: true }] },
        { event: "PostToolUse", names_install: true, installs: [{ tool: "execution-seat", version: "current", names_current: true }] },
        { event: "Stop", names_install: false, installs: [] },
      ],
    });
    expect(partOf(seen, "hand.wrappers").detail).toEqual({
      wrappers: [
        { name: "agenttool-collab-host", entry: "file", names_install: true, installs: [{ tool: "collab", version: "current", names_current: true }] },
        { name: "agenttool-lobby", entry: "file", names_install: true, installs: [{ tool: "lobby", version: "current", names_current: true }] },
      ],
    });
    expect(partOf(seen, "clock.witness").detail).toEqual({ found_in: "~/.local/bin", entry: "file", on_process_path: true, run_by_survey: false });
    expect(partOf(seen, "clock.witness").how).toContain("never runs it");
    expect(partOf(seen, "clock.wake").detail).toEqual({ awake_since: "2026-11-14T11:58:00.000Z", last_slept_at: "2026-11-14T11:30:00.000Z" });
    expect(Object.keys(partOf(seen, "ground.weather").detail)).toEqual(["says", "notes"]);
  });

  test("every unknown or stale part says why", async () => {
    const fs = fullHouse()
      .put(`${HOME}/.claude.json`, { type: "file", text: "{not json" })
      .put(`${SHARE}/execution-seat/current`, { type: "link", target: "/elsewhere" });
    const seen = await survey(makeDeps({ fs }));
    for (const part of seen.parts) {
      if (part.state === "unknown" || part.state === "stale") expect({ id: part.id, why: typeof part.why === "string" && part.why.length > 0 }).toEqual({ id: part.id, why: true });
    }
    expect(partOf(seen, "door.claude-code.collab")).toMatchObject({ state: "unknown", why: "the configuration file could not be parsed as JSON" });
    expect(partOf(seen, "room.execution-seat")).toMatchObject({ state: "unknown", why: "the current link leads outside the install directory; it was not followed" });
  });
});

describe("stale only for an inconsistency on this device", () => {
  test("an entry naming a version that is not current", async () => {
    const servers = { ...CLAUDE_SERVERS, "agenttool-collab": { command: "/opt/homebrew/bin/bun", args: [`${SHARE}/collab/${COLLAB_OLD}/agenttool-collab-mcp.js`] } };
    const fs = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson(servers) });
    const door = partOf(await survey(makeDeps({ fs })), "door.claude-code.collab");
    expect(door.state).toBe("stale");
    expect(door.why).toBe(`the entry: it names collab ${COLLAB_OLD}, but the current collab install is ${COLLAB_NEW}`);
    expect(door.detail).toMatchObject({ names_install: true, version: COLLAB_OLD, names_current: false });
  });

  test("an entry naming the current version by name is present, not stale", async () => {
    const servers = { ...CLAUDE_SERVERS, "agenttool-collab": { command: "bun", args: [`${SHARE}/collab/${COLLAB_NEW}/agenttool-collab-mcp.js`] } };
    const fs = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson(servers) });
    expect(partOf(await survey(makeDeps({ fs })), "door.claude-code.collab")).toMatchObject({ state: "present", detail: { version: COLLAB_NEW, names_current: true } });
  });

  test("a hook or wrapper naming an older install, or one not on this device", async () => {
    const fs = fullHouse()
      .put(`${HOME}/.claude/settings.json`, { type: "file", text: claudeSettings({ SessionEnd: [{ hooks: [{ type: "command", command: `bun ${SHARE}/collab/0.4.0-gone/agenttool-collab-host.js end` }] }] }) })
      .put(`${BIN}/agenttool-collab-host`, { type: "file", text: `exec bun ${SHARE}/collab/${COLLAB_OLD}/agenttool-collab-host.js "$@"` });
    const seen = await survey(makeDeps({ fs }));
    expect(partOf(seen, "hand.claude-code.hooks")).toMatchObject({
      state: "stale", why: "a SessionEnd hook: it names a collab directory that is not installed on this device",
      detail: { events: [{ event: "SessionEnd", names_install: true, installs: [{ tool: "collab", version: null, names_current: false }] }] },
    });
    expect(partOf(seen, "hand.wrappers")).toMatchObject({ state: "stale", why: `agenttool-collab-host: it names collab ${COLLAB_OLD}, but the current collab install is ${COLLAB_NEW}` });
  });

  test("a path in the install area that is not an install (the doorbell's state) is ignored, not stale", async () => {
    const fs = fullHouse().put(`${BIN}/agenttool-collab-doorbell`, { type: "file", text: `exec bun ${SHARE}/collab/doorbell/watch.ts` });
    const seen = await survey(makeDeps({ fs }));
    expect(partOf(seen, "hand.wrappers").state).toBe("present");
    // Not one of AgentTool's own command names, so its name is not printed either.
    expect((partOf(seen, "hand.wrappers").detail.wrappers as unknown[])[0]).toEqual({ name: null, entry: "file", names_install: false, installs: [] });
  });

  test("a newer release elsewhere is never stale: the survey has no network", async () => {
    const seen = await survey(makeDeps());
    expect(JSON.stringify(seen)).not.toMatch(/newer|latest|outdated|update available/i);
  });
});

describe("missing and unknown", () => {
  test("a build without weather: ground.weather and clock.wake missing with that reason", async () => {
    const seen = await survey(makeDeps({ run: new FakeRunner({ help: HELP_WITHOUT_WEATHER }) }));
    expect(partOf(seen, "ground.weather")).toMatchObject({ state: "missing", why: "the installed collab build has no weather command" });
    expect(partOf(seen, "clock.wake")).toMatchObject({ state: "missing", why: "there is no weather reading to take wake times from: the installed collab build has no weather command" });
    expect(seen.place.has_battery).toBeNull();
  });

  test("an ask that fails: ground.weather and clock.wake unknown with the reason; weather is asked once", async () => {
    const run = new FakeRunner({ help: HELP_WITH_WEATHER, weather: { timedOut: true, exitCode: null } });
    const seen = await survey(makeDeps({ run }));
    expect(partOf(seen, "ground.weather")).toMatchObject({ state: "unknown", why: "the collab host did not answer within 8 seconds" });
    expect(partOf(seen, "clock.wake")).toMatchObject({ state: "unknown" });
    expect(run.calls.map((call) => call.argv.at(-1))).toEqual(["--help", "weather"]);
  });

  test("versions with no current link are unknown, not present", async () => {
    const fs = fullHouse().remove(`${SHARE}/collab/current`);
    const seen = await survey(makeDeps({ fs }));
    expect(partOf(seen, "room.collab")).toMatchObject({ state: "unknown", why: "versions are installed, but no current link says which is in use" });
    expect(partOf(seen, "door.claude-code.collab")).toMatchObject({ state: "stale", why: "the entry: it follows the collab current link, but there is none" });
    expect(partOf(seen, "ground.weather")).toMatchObject({ state: "unknown" });
  });

  test("timewitness in a system command directory; not on this process's PATH", async () => {
    const fs = fullHouse().remove(`${BIN}/timewitness`).put("/usr/local/bin/timewitness", { type: "file", text: "" });
    const seen = await survey(makeDeps({ fs, env: { HOME, PATH: "/usr/bin:/bin" } }));
    expect(partOf(seen, "clock.witness").detail).toEqual({ found_in: "/usr/local/bin", entry: "file", on_process_path: false, run_by_survey: false });
  });

  test("the doorbell's netcheck, found by its wrapper (a link beside it is not counted)", async () => {
    const fs = fullHouse().put(`${BIN}/lobby-netcheck`, { type: "link", target: "agenttool-lobby-doorbell" }).put(`${BIN}/agenttool-lobby-doorbell`, { type: "file", text: "" });
    expect(partOf(await survey(makeDeps({ fs })), "clock.netcheck")).toMatchObject({
      state: "present", detail: { found: ["~/.local/bin/agenttool-lobby-doorbell"], current: null, run_by_survey: false },
    });
  });

  test("the doorbell not found: missing, saying only that it was not found in those places", async () => {
    expect(partOf(await survey(makeDeps()), "clock.netcheck")).toMatchObject({ state: "missing", why: "the doorbell's netcheck was not found in those places" });
  });

  test("place on Linux: a container marker; CI from the environment", async () => {
    const fs = fullHouse().put("/.dockerenv", { type: "file", text: "" });
    const seen = await survey(makeDeps({ fs, platform: "linux", env: { HOME, CI: "1" } }));
    expect(seen.place).toEqual({ platform: "linux", has_battery: true, container: true, ci: true, over_ssh: false });
    const bare = await survey(makeDeps({ platform: "plan9", env: { HOME } }));
    expect(bare.place).toMatchObject({ platform: "other", container: null });
  });
});

describe("an empty device", () => {
  test("every part missing or unknown; nothing thrown; nothing run", async () => {
    const run = new FakeRunner();
    const seen = await survey(makeDeps({ fs: new FakeFs({ [HOME]: { type: "dir" } }), run, env: { HOME } }));
    for (const part of seen.parts) expect({ id: part.id, state: part.state }).toEqual({ id: part.id, state: "missing" });
    expect(run.calls).toEqual([]);
    expect(seen.place).toEqual({ platform: "darwin", has_battery: null, container: false, ci: false, over_ssh: false });
    expect(seen.says).toStartWith("Missing: ground.weather, room.collab");
  });

  test("a home that cannot be read: unknown with a reason, nothing thrown", async () => {
    const seen = await survey(makeDeps({ fs: new FakeFs({ [HOME]: { type: "denied" } }), run: new FakeRunner(), env: { HOME } }));
    for (const part of seen.parts) expect(["missing", "unknown"]).toContain(part.state);
    expect(partOf(seen, "room.collab")).toMatchObject({ state: "unknown", why: "it could not be looked at: permission was refused" });
  });
});

describe("the parts table", () => {
  test("is the closed list this build knows, and each row's looks bind its reader", async () => {
    expect(PART_IDS).toEqual([
      "ground.weather", "room.collab", "room.lobby", "room.execution-seat",
      "door.claude-code.collab", "door.claude-code.lobby", "door.codex.collab", "door.codex.lobby",
      "hand.claude-code.hooks", "hand.wrappers", "clock.witness", "clock.netcheck", "clock.wake",
    ]);
    const spec = PARTS.find((part) => part.id === "door.codex.collab")!;
    const original = spec.looks;
    (spec as { looks: readonly string[] }).looks = ["link"];
    try {
      await expect(survey(makeDeps())).rejects.toThrow(UndeclaredLook);
    } finally {
      (spec as { looks: readonly string[] }).looks = original;
    }
  });
});

test("the weather text is the build's own words, passed through only in ground.weather", async () => {
  const seen = await survey(makeDeps({ run: new FakeRunner({ help: HELP_WITH_WEATHER, weather: { stdout: weatherReceipt() } }) }));
  expect(partOf(seen, "ground.weather").detail.says).toStartWith("On mains power, battery full at 100%");
});

describe("a version named in a configuration is printed only when it is installed here", () => {
  test("an unknown name in the version slot of an entry, a hook or a wrapper: stale, with version null, and never repeated", async () => {
    const planted = ["sk-PLANTEDTOKEN12345", "10.0.0.7", "quillons-laptop.lan", "AKIAPLANTEDKEY0001"];
    const servers = {
      ...CLAUDE_SERVERS,
      "agenttool-collab": { command: `${SHARE}/collab/${planted[0]}/agenttool-collab-mcp.js`, args: [] },
      "agenttool-lobby": { command: "bun", args: [`${SHARE}/lobby/${planted[1]}/agenttool-lobby-mcp.js`] },
    };
    const fs = fullHouse()
      .put(`${HOME}/.claude.json`, { type: "file", text: claudeJson(servers) })
      .put(`${HOME}/.codex/config.toml`, { type: "file", text: codexToml().replace(`${SHARE}/collab/current/`, `${SHARE}/collab/${planted[2]}/`) })
      .put(`${HOME}/.claude/settings.json`, { type: "file", text: claudeSettings({ SessionEnd: [{ hooks: [{ type: "command", command: `bun ${SHARE}/collab/${planted[3]}/agenttool-collab-host.js end` }] }] }) })
      .put(`${BIN}/agenttool-lobby`, { type: "file", text: `exec bun $HOME/.local/share/agenttool/lobby/${planted[1]}/agenttool-lobby.js "$@"` });
    const seen = await survey(makeDeps({ fs }));
    const text = JSON.stringify(seen);
    for (const value of planted) expect({ value, found: text.includes(value) }).toEqual({ value, found: false });
    expect(partOf(seen, "door.claude-code.collab")).toMatchObject({
      state: "stale", why: "the entry: it names a collab directory that is not installed on this device", detail: { names_install: true, version: null, names_current: false },
    });
    expect(partOf(seen, "door.claude-code.lobby")).toMatchObject({ state: "stale", detail: { version: null } });
    expect(partOf(seen, "door.codex.collab")).toMatchObject({ state: "stale", detail: { version: null } });
    expect(partOf(seen, "hand.claude-code.hooks")).toMatchObject({ state: "stale" });
    expect(partOf(seen, "hand.wrappers")).toMatchObject({ state: "stale" });
  });

  test("more than 32 versions: the current one past the cap is present, and an entry naming it by name is current, not stale", async () => {
    const fs = fullHouse();
    for (let index = 10; index < 52; index += 1) fs.put(`${SHARE}/collab/0.9.${index}-abcdef${index}/SOURCE.txt`, { type: "file", text: "commit: 1234567\n" });
    fs.put(`${SHARE}/collab/0.9.51-abcdef51/agenttool-collab-host.js`, { type: "file", text: "", mode: 0o100755 })
      .put(`${SHARE}/collab/current`, { type: "link", target: "0.9.51-abcdef51" })
      .put(`${HOME}/.claude.json`, { type: "file", text: claudeJson({ ...CLAUDE_SERVERS, "agenttool-collab": { command: "bun", args: [`${SHARE}/collab/0.9.51-abcdef51/agenttool-collab-mcp.js`] } }) });
    const seen = await survey(makeDeps({ fs }));
    expect(partOf(seen, "room.collab")).toMatchObject({ state: "present", detail: { current: "0.9.51-abcdef51", more_versions: true } });
    expect(partOf(seen, "door.claude-code.collab")).toMatchObject({ state: "present", detail: { version: "0.9.51-abcdef51", names_current: true } });
  });

  test("a current link written as ./name or with the absolute path still names the current install", async () => {
    for (const target of [`./${COLLAB_NEW}`, `${COLLAB_NEW}/`, `${SHARE}/collab/${COLLAB_NEW}`]) {
      const fs = fullHouse().put(`${SHARE}/collab/current`, { type: "link", target });
      const seen = await survey(makeDeps({ fs }));
      expect({ target, states: ["room.collab", "door.claude-code.collab", "ground.weather", "clock.wake"].map((id) => partOf(seen, id).state) })
        .toEqual({ target, states: ["present", "present", "present", "present"] });
    }
  });
});

describe("collab's switches are one name under two spellings", () => {
  const withEnv = (env: Record<string, string>) => fullHouse().put(`${HOME}/.claude.json`, {
    type: "file", text: claudeJson({ ...CLAUDE_SERVERS, "agenttool-collab": { command: "bun", args: [`${SHARE}/collab/current/x.js`], env } }),
  });

  test("two spellings set to different values: the door is unknown, since collab refuses to start", async () => {
    const door = partOf(await survey(makeDeps({ fs: withEnv({ AGENTOOL_COLLAB_TOOLS: "full", AGENTTOOL_COLLAB_TOOLS: "notes" }) })), "door.claude-code.collab");
    expect(door).toMatchObject({
      state: "unknown",
      why: "the entry sets AGENTOOL_COLLAB_TOOLS and AGENTTOOL_COLLAB_TOOLS to different values; collab reads the two spellings as one switch and refuses to start when they disagree",
    });
  });

  test("the same value under both spellings is present; an empty value is unset", async () => {
    const same = partOf(await survey(makeDeps({ fs: withEnv({ AGENTOOL_COLLAB_TOOLS: "notes", AGENTTOOL_COLLAB_TOOLS: "notes" }) })), "door.claude-code.collab");
    expect(same).toMatchObject({ state: "present", detail: { switches: { AGENTOOL_COLLAB_TOOLS: "notes", AGENTTOOL_COLLAB_TOOLS: "notes" } } });
    const empty = partOf(await survey(makeDeps({ fs: withEnv({ AGENTOOL_COLLAB_TOOLS: "", AGENTTOOL_COLLAB_TOOLS: "notes" }) })), "door.claude-code.collab");
    expect(empty).toMatchObject({ state: "present", detail: { switches: { AGENTTOOL_COLLAB_TOOLS: "notes" } } });
  });
});

describe("unknown is not present: what a link or a leftover cannot show", () => {
  test("timewitness as a link (not followed) is unknown; a regular file in a later directory still counts", async () => {
    const fs = fullHouse().put(`${BIN}/timewitness`, { type: "link", target: `${HOME}/Desktop/timewitness/timewitness.py` });
    const witness = partOf(await survey(makeDeps({ fs })), "clock.witness");
    expect(witness).toMatchObject({
      state: "unknown", detail: { found_in: "~/.local/bin", entry: "link", run_by_survey: false },
      why: "~/.local/bin/timewitness is a link, which was not followed, so whether it leads to timewitness could not be told",
    });
    expect(fs.calls.some((call) => call.path.includes("Desktop"))).toBe(false);
    fs.put("/usr/local/bin/timewitness", { type: "file", text: "" });
    expect(partOf(await survey(makeDeps({ fs })), "clock.witness")).toMatchObject({ state: "present", detail: { found_in: "/usr/local/bin", entry: "file" } });
  });

  test("netcheck: a dangling link, or doorbell versions with no current link, is unknown", async () => {
    const linked = fullHouse().put(`${BIN}/lobby-netcheck`, { type: "link", target: "/nowhere/agenttool-lobby-doorbell" });
    expect(partOf(await survey(makeDeps({ fs: linked })), "clock.netcheck")).toMatchObject({
      state: "unknown", why: "~/.local/bin/lobby-netcheck is a link, which was not followed, so whether it leads to the doorbell could not be told",
    });
    const leftover = fullHouse().put(`${SHARE}/lobby-doorbell/0.1.0-dev.0-1a2b3c4d/SOURCE.txt`, { type: "file", text: "commit: 1a2b3c4d\n" });
    expect(partOf(await survey(makeDeps({ fs: leftover })), "clock.netcheck")).toMatchObject({
      state: "unknown", why: "~/.local/share/agenttool/lobby-doorbell: versions are installed, but no current link says which is in use",
    });
    const installed = leftover.put(`${SHARE}/lobby-doorbell/current`, { type: "link", target: "0.1.0-dev.0-1a2b3c4d" });
    expect(partOf(await survey(makeDeps({ fs: installed })), "clock.netcheck")).toMatchObject({ state: "present", detail: { current: "0.1.0-dev.0-1a2b3c4d" } });
  });

  test("wrappers that are all links (not followed) are unknown, not present", async () => {
    const fs = fullHouse().put(`${BIN}/agenttool-collab-host`, { type: "link", target: "/nowhere/a" }).put(`${BIN}/agenttool-lobby`, { type: "link", target: "/nowhere/b" });
    expect(partOf(await survey(makeDeps({ fs })), "hand.wrappers")).toMatchObject({
      state: "unknown", why: "no agenttool-* wrapper could be read: each is a link, which was not followed, or not a regular file that could be read",
    });
  });

  test("a link above the roots or the host configuration (~/.local, ~/.claude) is not followed: unknown", async () => {
    const fs = fullHouse().remove(`${HOME}/.local`).remove(`${HOME}/.claude`)
      .put(`${HOME}/outside/local/share/agenttool/collab/${COLLAB_NEW}/SOURCE.txt`, { type: "file", text: `commit: ${COMMIT_NEW}\n` })
      .put(`${HOME}/outside/local/share/agenttool/collab/current`, { type: "link", target: COLLAB_NEW })
      .put(`${HOME}/outside/claude/settings.json`, { type: "file", text: claudeSettings(CLAUDE_HOOKS) })
      .put(`${HOME}/.local`, { type: "link", target: `${HOME}/outside/local` })
      .put(`${HOME}/.claude`, { type: "link", target: `${HOME}/outside/claude` });
    const seen = await survey(makeDeps({ fs, run: new FakeRunner() }));
    expect(partOf(seen, "room.collab")).toMatchObject({ state: "unknown", why: "a link stands on the way to it; the link was not followed" });
    expect(partOf(seen, "hand.claude-code.hooks")).toMatchObject({
      state: "unknown", why: "the configuration file could not be looked at: a link stands on the way to it; the link was not followed",
    });
    expect(partOf(seen, "hand.wrappers").state).toBe("unknown");
    expect(fs.calls.some((call) => call.path.startsWith(`${HOME}/outside`))).toBe(false);
    expect(fs.calls.filter((call) => call.op === "readHead" || call.op === "list").map((call) => call.path.replace(HOME, "~")).sort())
      .toEqual(["~/.claude.json", "~/.claude.json", "~/.codex/config.toml", "~/.codex/config.toml"]);
  });
});

describe("a variable that moves a place makes what is there unknown; the default place is not read", () => {
  test("CODEX_HOME and CLAUDE_CONFIG_DIR: the doors and hooks are unknown, and their files are not read", async () => {
    const deps = makeDeps({ env: fakeEnv({ CODEX_HOME: "/srv/codex", CLAUDE_CONFIG_DIR: "/srv/claude" }) });
    const seen = await survey(deps);
    for (const id of ["door.codex.collab", "door.codex.lobby"]) {
      expect(partOf(seen, id)).toMatchObject({ state: "unknown", why: "CODEX_HOME is set in this process's environment to another place, so which configuration this host reads here could not be told" });
    }
    for (const id of ["door.claude-code.collab", "door.claude-code.lobby"]) expect(partOf(seen, id)).toMatchObject({ state: "unknown" });
    expect(partOf(seen, "hand.claude-code.hooks")).toMatchObject({ state: "unknown" });
    const reads = (deps.fs as FakeFs).calls.filter((call) => call.op === "readHead").map((call) => call.path);
    expect(reads.some((path) => /\.claude|\.codex/.test(path))).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("/srv/");
  });

  test("XDG_DATA_HOME, AGENTOOL_COLLAB_DB, XDG_STATE_HOME, AGENTTOOL_LOBBY_HOME: the state file's facts are null, and its default place is not looked at", async () => {
    for (const [env, id, label, path] of [
      [{ XDG_DATA_HOME: "/srv/data" }, "room.collab", "journal", `${SHARE}/collab.sqlite`],
      [{ AGENTOOL_COLLAB_DB: "/srv/journal.sqlite" }, "room.collab", "journal", `${SHARE}/collab.sqlite`],
      [{ AGENTTOOL_LOBBY_HOME: "/srv/lobby" }, "room.lobby", "cache", `${STATE}/lobby/lobby.sqlite`],
      [{ XDG_STATE_HOME: "/srv/state" }, "room.execution-seat", "ledger", `${STATE}/execution-seat/seats.sqlite`],
    ] as const) {
      const deps = makeDeps({ env: fakeEnv(env) });
      const room = partOf(await survey(deps), id);
      expect({ id, state: room.state, facts: room.detail[label] }).toEqual({ id, state: "present", facts: { exists: null, age_seconds: null } });
      expect(room.how).toContain("was not looked at");
      expect((deps.fs as FakeFs).calls.some((call) => call.path === path)).toBe(false);
    }
    // Set to the default itself: nothing moved.
    const same = partOf(await survey(makeDeps({ env: fakeEnv({ XDG_DATA_HOME: `${HOME}/.local/share` }) })), "room.collab");
    expect(same.detail.journal).toEqual({ exists: true, age_seconds: 60 });
  });
});

test("a Codex configuration holding a TOML datetime: unknown, and the reason does not call valid TOML broken", async () => {
  const fs = fullHouse().put(`${HOME}/.codex/config.toml`, { type: "file", text: `${codexToml()}\n[projects.example]\ntrusted_at = 2026-11-14T12:00:00Z\n` });
  const door = partOf(await survey(makeDeps({ fs })), "door.codex.collab");
  expect(door.state).toBe("unknown");
  expect(door.why).toStartWith("this build's TOML reader could not read the configuration file");
});
