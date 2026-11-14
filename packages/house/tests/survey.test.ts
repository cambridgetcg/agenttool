/** States: present, missing, unknown with a reason, and stale only for an inconsistency on this device. */
import { describe, expect, test } from "bun:test";
import { PARTS, PART_IDS } from "../src/parts.js";
import { survey, UndeclaredLook } from "../src/survey.js";
import { GOOD_FOR_SECONDS, SURVEY_PROTOCOL } from "../src/shapes.js";
import {
  BIN, COLLAB_NEW, COLLAB_OLD, COMMIT_NEW, FakeFs, FakeRunner, HELP_WITHOUT_WEATHER, HELP_WITH_WEATHER, HOME, LOBBY_COMMIT, LOBBY_VERSION,
  NOW, SEAT_COMMIT, SEAT_VERSION, SHARE, CLAUDE_SERVERS, claudeJson, claudeSettings, fullHouse, makeDeps, partOf, weatherReceipt,
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
      versions: [COLLAB_OLD, COLLAB_NEW], current: COLLAB_NEW, commit: COMMIT_NEW, installed: "2026-11-13T16:25:50Z",
      journal: { exists: true, age_seconds: 60 },
    });
    expect(partOf(seen, "room.lobby").detail).toEqual({
      versions: [LOBBY_VERSION], current: LOBBY_VERSION, commit: LOBBY_COMMIT, installed: null, cache: { exists: true, age_seconds: 3600 },
    });
    expect(partOf(seen, "room.lobby").how).toContain("at least that old");
    expect(partOf(seen, "room.execution-seat").detail).toEqual({
      versions: [SEAT_VERSION], current: SEAT_VERSION, commit: SEAT_COMMIT, installed: "2026-11-13T14:18:37Z", ledger: { exists: true, age_seconds: 300 },
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
    expect(partOf(seen, "clock.witness").detail).toEqual({ found_in: "~/.local/bin", entry: "link", on_process_path: true, run_by_survey: false });
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
    expect(partOf(seen, "hand.claude-code.hooks")).toMatchObject({ state: "stale", why: "a SessionEnd hook: it names collab 0.4.0-gone, which is not installed on this device" });
    expect(partOf(seen, "hand.wrappers")).toMatchObject({ state: "stale", why: `agenttool-collab-host: it names collab ${COLLAB_OLD}, but the current collab install is ${COLLAB_NEW}` });
  });

  test("a path in the install area that is not an install (the doorbell's state) is ignored, not stale", async () => {
    const fs = fullHouse().put(`${BIN}/agenttool-collab-doorbell`, { type: "file", text: `exec bun ${SHARE}/collab/doorbell/watch.ts` });
    const seen = await survey(makeDeps({ fs }));
    expect(partOf(seen, "hand.wrappers").state).toBe("present");
    expect((partOf(seen, "hand.wrappers").detail.wrappers as unknown[])[0]).toEqual({ name: "agenttool-collab-doorbell", entry: "file", names_install: false, installs: [] });
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

  test("the doorbell's netcheck, found by its wrapper", async () => {
    const fs = fullHouse().put(`${BIN}/lobby-netcheck`, { type: "link", target: "agenttool-lobby-doorbell" }).put(`${BIN}/agenttool-lobby-doorbell`, { type: "file", text: "" });
    expect(partOf(await survey(makeDeps({ fs })), "clock.netcheck")).toMatchObject({
      state: "present", detail: { found: ["~/.local/bin/agenttool-lobby-doorbell", "~/.local/bin/lobby-netcheck"], current: null, run_by_survey: false },
    });
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
