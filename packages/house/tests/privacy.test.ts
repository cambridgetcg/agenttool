/** Kinds, not identifiers: with a user name in every path, a host name,
 * addresses and secrets in every file the survey reads, the serialised survey,
 * blueprint and plan carry none of them, and the survey never touches the
 * places it must not (credentials, backups, the desk's keys, the journal's
 * contents, anything outside its fixed places). */
import { describe, expect, test } from "bun:test";
import { blueprintFromSurvey } from "../src/blueprint.js";
import { runCli } from "../src/cli.js";
import { plan } from "../src/plan.js";
import { looksIdentifying, outputLeak } from "../src/privacy.js";
import { survey } from "../src/survey.js";
import {
  FORBIDDEN, FakeFs, FakeRunner, HELP_WITH_WEATHER, HOME, HOST, NOW, USER,
  fullHouse, makeDeps, partOf, weatherReceipt,
} from "./helpers.js";

function expectClean(text: string): void {
  for (const word of FORBIDDEN) expect({ word, found: text.includes(word) }).toEqual({ word, found: false });
}

describe("no identifier or secret reaches an output", () => {
  test("survey, blueprint and plan of a house whose files are full of names, addresses and secrets", async () => {
    const deps = makeDeps();
    const seen = await survey(deps);
    const blueprint = blueprintFromSurvey(seen);
    const planned = plan(seen, blueprint, NOW);
    for (const output of [seen, blueprint, planned]) expectClean(JSON.stringify(output));
    // The survey did read those files: the parts are present, not silently skipped.
    expect(partOf(seen, "door.claude-code.collab").state).toBe("present");
    expect(partOf(seen, "hand.claude-code.hooks").state).toBe("present");
    expect(partOf(seen, "room.collab").detail.installed).toBe("2026-11-13T16:25:50Z");
  });

  test("the home directory is never shown except as ~", async () => {
    const text = JSON.stringify(await survey(makeDeps()));
    expect(text).not.toContain(HOME);
    expect(text).toContain("~/.local/share/agenttool");
  });

  test("no environment value appears, only closed-set switch values from the host entries", async () => {
    const seen = await survey(makeDeps());
    const text = JSON.stringify(seen);
    expect(text).not.toContain("atcm_FAKEFAKEFAKEFAKE3333");
    expect(text).not.toContain(`${HOME}/.local/share/agenttool/collab.sqlite`);
    expect(partOf(seen, "door.claude-code.collab").detail.switches).toEqual({
      AGENTOOL_COLLAB_TOOLS: "full",
      AGENTOOL_COLLAB_CONSENT_RULE: "set to something else",
    });
    expect(partOf(seen, "door.codex.collab").detail.switches).toEqual({ AGENTOOL_COLLAB_TOOLS: "notes" });
  });

  test("a hook's command and a wrapper's text never appear; only the install each names", async () => {
    const seen = await survey(makeDeps());
    const hooks = partOf(seen, "hand.claude-code.hooks");
    expect(hooks.detail.events).toContainEqual({ event: "Stop", names_install: false, installs: [] });
    expect(JSON.stringify(hooks)).not.toMatch(/bun |agenttool-execution-seat\.ts|--collab-host|Authorization/);
    const wrappers = partOf(seen, "hand.wrappers");
    expect(JSON.stringify(wrappers)).not.toMatch(/umask|exec |SECRET|#!/);
  });

  test("place carries booleans and one platform word only", async () => {
    const seen = await survey(makeDeps());
    expect(seen.place).toEqual({ platform: "darwin", has_battery: true, container: false, ci: false, over_ssh: true });
  });

  test("weather sentences that hold an identifier are withheld whole; the wake times still come through", async () => {
    for (const says of [`On battery at quillons-air`, "Wi-Fi via 192.168.7.1", `home ${HOME}/x`, "ssid quillon-net", "peer fe80::1c2b:3a4d"]) {
      const run = new FakeRunner({ help: HELP_WITH_WEATHER, weather: { stdout: weatherReceipt({ says }) } });
      const seen = await survey(makeDeps({ run }));
      const weather = partOf(seen, "ground.weather");
      expect({ says, state: weather.state }).toEqual({ says, state: "unknown" });
      expect(weather.why).toContain("looked like an identifier");
      expect(partOf(seen, "clock.wake").state).toBe("present");
      expectClean(JSON.stringify(seen));
    }
  });

  test("the CLI prints nothing when an output would still carry the user name", async () => {
    const out: string[] = [];
    const err: string[] = [];
    // A version directory whose name holds the user name: a valid name, so only the last check can stop it.
    const fs = fullHouse()
      .put(`${HOME}/.local/share/agenttool/lobby/0.2.0-quillon/SOURCE.txt`, { type: "file", text: "commit: 1234567\n" });
    const code = await runCli(["survey"], { stdout: (t) => out.push(t), stderr: (t) => err.push(t), deps: () => makeDeps({ fs }) });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("")).toContain("looked like an identifier");
    expect(err.join("")).not.toContain("quillon");
  });
});

describe("the survey touches only its fixed places", () => {
  test("never credentials, backups, the desk's keys, the carried packets, the person's other files, or a journal's contents", async () => {
    const deps = makeDeps();
    await survey(deps);
    const calls = (deps.fs as FakeFs).calls;
    for (const call of calls) {
      expect({ call, touched: /collab-sessions|backups|secrets|lobby-mail|Desktop|\.env|\.kingdom|private-tool|carry/.test(call.path) })
        .toEqual({ call, touched: false });
    }
    // A runbook beside the lobby's versions is lstat'ed (to tell it is not a version) and never read.
    expect(calls.filter((call) => call.path.includes("RUNBOOK")).map((call) => call.op)).toEqual(["lstat"]);
    const reads = calls.filter((call) => call.op === "readHead" || call.op === "readChosen").map((call) => call.path.replace(HOME, "~"));
    expect(reads.sort()).toEqual([
      "~/.claude.json",
      "~/.claude.json",
      "~/.claude/settings.json",
      "~/.codex/config.toml",
      "~/.codex/config.toml",
      "~/.local/bin/agenttool-collab-host",
      "~/.local/bin/agenttool-lobby",
      `~/.local/share/agenttool/collab/0.6.0-dev.0-0f1e2d3c/SOURCE.txt`,
      `~/.local/share/agenttool/execution-seat/main-9a8b7c6d/SOURCE.txt`,
      `~/.local/share/agenttool/lobby/0.1.0-dev.0-5e6f7a8b/SOURCE.txt`,
    ]);
    const listed = [...new Set(calls.filter((call) => call.op === "list").map((call) => call.path.replace(HOME, "~")))].sort();
    expect(listed).toEqual([
      "~/.local/bin",
      "~/.local/share/agenttool/collab",
      "~/.local/share/agenttool/execution-seat",
      "~/.local/share/agenttool/lobby",
    ]);
    // Outside the home directory: nothing here (timewitness is found in ~/.local/bin first; no container marker on macOS).
    expect(calls.filter((call) => !call.path.startsWith(`${HOME}/`))).toEqual([]);
  });

  test("outside the home directory, only the named commands' fixed directories and, on Linux, the two container markers", async () => {
    const fs = fullHouse().remove(`${HOME}/.local/bin/timewitness`);
    const deps = makeDeps({ fs, platform: "linux" });
    await survey(deps);
    const outside = [...new Set(fs.calls.filter((call) => !call.path.startsWith(`${HOME}/`)).map((call) => call.path))].sort();
    expect(outside).toEqual(["/.dockerenv", "/opt/homebrew/bin/timewitness", "/run/.containerenv", "/usr/local/bin/timewitness"]);
    expect(fs.calls.filter((call) => !call.path.startsWith(`${HOME}/`)).every((call) => call.op === "lstat")).toBe(true);
  });

  test("the home directory itself is never listed", async () => {
    const deps = makeDeps();
    await survey(deps);
    const calls = (deps.fs as FakeFs).calls;
    for (const path of [HOME, `${HOME}/.local`, `${HOME}/.local/share`, `${HOME}/.local/state`, `${HOME}/.claude`, `${HOME}/.codex`]) {
      expect({ path, listed: calls.some((call) => call.op === "list" && call.path === path) }).toEqual({ path, listed: false });
    }
  });
});

describe("the guards themselves", () => {
  const hints = { home: HOME, user: USER, host: HOST };

  test("looksIdentifying recognises names, addresses, home paths and tokens, and passes the weather's ordinary words", () => {
    for (const text of [
      "quillon", "Quillon's", "quillons-air", "quillons-air.local", "192.168.1.20", "fe80::1", "aa:bb:cc:dd:ee:ff", "2001:db8:0:0:1:0:0:1",
      "me@example.org", "/Users/someone", "~/x", "$HOME/x", "printer.lan", "atcm_abcdefgh", "ghp_abcdefgh",
      "QmFzZTY0IGtleS1saWtlIHJ1biBvZiBjaGFyYWN0ZXJz",
    ]) expect({ text, flagged: looksIdentifying(text, hints) }).toEqual({ text, flagged: true });
    for (const text of [
      "On mains power, battery full at 100%; load 2.1 on 8 cores. Read 11:59:58Z; good for about a minute.",
      "This device woke 120 seconds ago from a sleep that began at 2026-11-14T11:30:00.000Z.",
      "Memory pressure is warn: more parallel processes will be slow for everyone on this device.",
      "A graphics device is 85% busy: a local model or render started now shares it.",
    ]) expect({ text, flagged: looksIdentifying(text, hints) }).toEqual({ text, flagged: false });
  });

  test("outputLeak flags the home path and whole-word names only", () => {
    expect(outputLeak(`{"x":"${HOME}/y"}`, hints)).toBe(true);
    expect(outputLeak('{"x":"/home/someone"}', hints)).toBe(true);
    expect(outputLeak('{"x":"quillons-air"}', hints)).toBe(true);
    expect(outputLeak('{"x":"room.collab door.codex.lobby ~/.local/bin"}', hints)).toBe(false);
  });
});
