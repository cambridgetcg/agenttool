/** Blueprint and plan: the round trip, one changed fact changing exactly one step, refusals, documents, and no score. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blueprintFromSurvey, parseBlueprint } from "../src/blueprint.js";
import { RefusalError } from "../src/errors.js";
import { PARTS } from "../src/parts.js";
import { plan } from "../src/plan.js";
import { BLUEPRINT_PROTOCOL, PLAN_PROTOCOL, type HouseBlueprint, type HousePlan, type HouseSurvey } from "../src/shapes.js";
import { survey } from "../src/survey.js";
import {
  CLAUDE_SERVERS, COLLAB_OLD, COMMIT_NEW, FakeFs, FakeRunner, HOME, INSTALLED_NEW, LOBBY_COMMIT, NOW, SEAT_COMMIT, SHARE,
  claudeJson, codexToml, fullHouse, makeDeps, repoRoot,
} from "./helpers.js";

async function roundTrip(): Promise<{ seen: HouseSurvey; blueprint: HouseBlueprint }> {
  const seen = await survey(makeDeps());
  return { seen, blueprint: parseBlueprint(JSON.stringify(blueprintFromSurvey(seen))) };
}

function changed(before: HousePlan, after: HousePlan): Array<[string, string]> {
  return after.steps.filter((step, index) => step.is !== before.steps[index]!.is).map((step) => [step.id, step.is]);
}

describe("blueprint --from-survey", () => {
  test("present parts with their commits and in-set switches; nothing else", async () => {
    const { blueprint } = await roundTrip();
    expect(blueprint).toEqual({
      protocol: BLUEPRINT_PROTOCOL,
      name: "this house, as it stands",
      parts: [
        { id: "ground.weather" },
        { id: "room.collab", commit: COMMIT_NEW },
        { id: "room.lobby", commit: LOBBY_COMMIT },
        { id: "room.execution-seat", commit: SEAT_COMMIT },
        { id: "door.claude-code.collab", switches: { AGENTOOL_COLLAB_TOOLS: "full" } },
        { id: "door.claude-code.lobby" },
        { id: "door.codex.collab", switches: { AGENTOOL_COLLAB_TOOLS: "notes" } },
        { id: "hand.claude-code.hooks" },
        { id: "hand.wrappers" },
        { id: "clock.witness" },
        { id: "clock.wake" },
      ],
    });
  });
});

describe("the round trip", () => {
  test("survey → blueprint --from-survey → plan against the same survey: every step as_wanted", async () => {
    const { seen, blueprint } = await roundTrip();
    const planned = plan(seen, blueprint, NOW);
    expect(planned.protocol).toBe(PLAN_PROTOCOL);
    expect(planned.steps.map((step) => step.is)).toEqual(blueprint.parts.map(() => "as_wanted"));
    for (const step of planned.steps) expect(step).toMatchObject({ whose_act: "the person", see: null });
    expect(planned.says).toContain("Nothing would change.");
  });

  test("change the current link: exactly room.collab changes, to to_build", async () => {
    const { seen, blueprint } = await roundTrip();
    const before = plan(seen, blueprint, NOW);
    const fs = fullHouse().put(`${SHARE}/collab/current`, { type: "link", target: COLLAB_OLD });
    const after = plan(await survey(makeDeps({ fs })), blueprint, NOW);
    expect(changed(before, after)).toEqual([["room.collab", "to_build"]]);
    expect(after.steps.find((step) => step.id === "room.collab")!.because).toBe(
      "The current install is commit a1b2c3d4; the blueprint wants 0f1e2d3c. No document in this repository says how yet.",
    );
  });

  test("change a switch: exactly that door changes, to to_switch, naming the document", async () => {
    const { seen, blueprint } = await roundTrip();
    const before = plan(seen, blueprint, NOW);
    const fs = fullHouse().put(`${HOME}/.codex/config.toml`, { type: "file", text: codexToml(false, "full") });
    const after = plan(await survey(makeDeps({ fs })), blueprint, NOW);
    expect(changed(before, after)).toEqual([["door.codex.collab", "to_switch"]]);
    expect(after.steps.find((step) => step.id === "door.codex.collab")).toEqual({
      id: "door.codex.collab", is: "to_switch", because: "AGENTOOL_COLLAB_TOOLS is full here; the blueprint wants notes. No document in this repository says how yet.",
      whose_act: "the person", see: null,
    });
  });

  test("a missing door: exactly that door changes, to to_build", async () => {
    const { seen, blueprint } = await roundTrip();
    const before = plan(seen, blueprint, NOW);
    const { "agenttool-lobby": _, ...rest } = CLAUDE_SERVERS;
    const fs = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson(rest) });
    const after = plan(await survey(makeDeps({ fs })), blueprint, NOW);
    expect(changed(before, after)).toEqual([["door.claude-code.lobby", "to_build"]]);
    expect(after.steps.find((step) => step.id === "door.claude-code.lobby")).toMatchObject({
      because: "Not on this device: ~/.claude.json has no agenttool-lobby entry. No document in this repository says how yet.", see: null,
    });
  });

  test("a stale entry plans to_repoint; an unknown part plans cannot_tell", async () => {
    const { blueprint } = await roundTrip();
    const servers = { ...CLAUDE_SERVERS, "agenttool-collab": { command: "bun", args: [`${SHARE}/collab/${COLLAB_OLD}/agenttool-collab-mcp.js`] } };
    const fs = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson(servers) }).put(`${HOME}/.codex/config.toml`, { type: "file", text: "[[[" });
    const steps = plan(await survey(makeDeps({ fs })), blueprint, NOW).steps;
    expect(steps.find((step) => step.id === "door.claude-code.collab")).toMatchObject({ is: "to_repoint", see: null });
    expect(steps.find((step) => step.id === "door.codex.collab")).toMatchObject({ is: "cannot_tell", see: null });
    expect(steps.find((step) => step.id === "door.codex.collab")!.because).toStartWith("Could not be told here: this build's TOML reader could not read");
  });
});

describe("on a device with nothing installed", () => {
  test("the plan lists everything as to_build, each the person's act, with a document or a plain word that none exists", async () => {
    const { blueprint } = await roundTrip();
    const empty = await survey(makeDeps({ fs: new FakeFs({ [HOME]: { type: "dir" } }), run: new FakeRunner(), env: { HOME } }));
    const planned = plan(empty, blueprint, NOW);
    for (const step of planned.steps) {
      expect({ id: step.id, is: step.is, whose_act: step.whose_act }).toEqual({ id: step.id, is: "to_build", whose_act: "the person" });
      if (step.see === null) expect(step.because).toEndWith("No document in this repository says how yet.");
    }
    expect(planned.says).toContain("Every change is the person's act; this plan runs nothing.");
  });
});

describe("refusals", () => {
  const refused = (value: unknown, code: string) => {
    try {
      parseBlueprint(typeof value === "string" ? value : JSON.stringify(value));
    } catch (error) {
      expect(error).toBeInstanceOf(RefusalError);
      expect((error as RefusalError).code).toBe(code);
      return (error as RefusalError).message;
    }
    throw new Error(`not refused: ${code}`);
  };
  const base = { protocol: BLUEPRINT_PROTOCOL, name: "a house" };

  test("a blueprint naming a part this build does not know is refused, naming the part", () => {
    expect(refused({ ...base, parts: [{ id: "room.kitchen" }] }, "unknown_part")).toBe("the blueprint names a part this build does not know: room.kitchen");
    expect(refused({ ...base, parts: [{ id: "atcm_SECRET quillon /Users/x" }] }, "unknown_part")).toBe("the blueprint names a part this build does not know: one whose id is not shown");
    // Shaped like an id but not one of this vocabulary's kinds, or holding something identifying: not shown.
    expect(refused({ ...base, parts: [{ id: "quillon" }] }, "unknown_part")).toBe("the blueprint names a part this build does not know: one whose id is not shown");
    expect(refused({ ...base, parts: [{ id: "door.quillons-laptop.local" }] }, "unknown_part")).toBe("the blueprint names a part this build does not know: one whose id is not shown");
    const hinted = () => parseBlueprint(JSON.stringify({ ...base, parts: [{ id: "room.quillon" }] }), { home: HOME, user: "quillon", host: null });
    expect(hinted).toThrow("the blueprint names a part this build does not know: one whose id is not shown");
  });

  test("an unknown key or switch is refused without being named", () => {
    for (const [value, code] of [
      [{ ...base, parts: [], quillon: 1 }, "unknown_key"],
      [{ ...base, parts: [{ id: "door.codex.collab", quillons_laptop: true }] }, "unknown_key"],
      [{ ...base, parts: [{ id: "door.codex.collab", switches: { QUILLON_TOKEN: "x" } }] }, "unknown_switch"],
    ] as const) {
      const message = refused(value, code);
      expect({ code, message, quotes: /quillon/i.test(message) }).toEqual({ code, message, quotes: false });
    }
  });

  test("both spellings of one switch in one part are refused", () => {
    expect(refused({ ...base, parts: [{ id: "door.codex.collab", switches: { AGENTOOL_COLLAB_TOOLS: "full", AGENTTOOL_COLLAB_TOOLS: "full" } }] }, "both_spellings"))
      .toBe("door.codex.collab wants AGENTOOL_COLLAB_TOOLS and AGENTTOOL_COLLAB_TOOLS, which are one switch; a blueprint names it once");
  });

  test("every other closed-schema refusal, never quoting the file", () => {
    expect(refused("{not json atcm_SECRET", "not_json")).not.toContain("atcm_");
    refused([], "not_a_blueprint");
    refused({ ...base, protocol: "agenttool.house-blueprint/2", parts: [] }, "wrong_protocol");
    refused({ ...base, parts: [], extra: 1 }, "unknown_key");
    refused({ ...base, name: "", parts: [] }, "bad_name");
    refused({ ...base, name: "two\nlines", parts: [] }, "bad_name");
    refused({ ...base, parts: [{ id: "room.collab" }, { id: "room.collab" }] }, "duplicate_part");
    refused({ ...base, parts: [{ id: "room.collab", commit: "main" }] }, "bad_commit");
    refused({ ...base, parts: [{ id: "door.codex.collab", commit: COMMIT_NEW }] }, "commit_not_wanted");
    refused({ ...base, parts: [{ id: "room.collab", switches: {} }] }, "switches_not_wanted");
    refused({ ...base, parts: [{ id: "door.codex.collab", switches: { PATH: "/x" } }] }, "unknown_switch");
    refused({ ...base, parts: [{ id: "door.codex.collab", switches: { AGENTOOL_COLLAB_TOOLS: "set to something else" } }] }, "bad_switch_value");
    refused({ ...base, parts: [{ id: "door.codex.collab", run: "rm -rf ~" }] }, "unknown_key");
  });

  test("a hand-written blueprint in the closed schema is accepted", () => {
    const text = JSON.stringify({ ...base, parts: [{ id: "room.collab", commit: "0f1e2d3c" }, { id: "door.codex.collab", switches: { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" } }] });
    expect(parseBlueprint(text).parts).toEqual([{ id: "room.collab", commit: "0f1e2d3c" }, { id: "door.codex.collab", switches: { AGENTOOL_COLLAB_CONSENT_RULE: "consent/v2" } }]);
  });
});

describe("documents", () => {
  /** Each document a step may name, and the places its part looks that the document's own recipe must name, so that
   * following it gives a house the survey recognises. A new `see` needs a row here. */
  const RECIPES: Record<string, { document: string; names: string[] }> = {
    "clock.netcheck": { document: "packages/lobby-doorbell/README.md", names: ["~/.local/bin", "lobby-netcheck"] },
  };

  test("every document a step can name exists in this repository, and its recipe names the places the part looks; a part with none says so plainly", () => {
    for (const spec of PARTS) {
      for (const see of [spec.see.build, spec.see.repoint, spec.see.switch]) {
        if (see === null) continue;
        expect({ see, exists: existsSync(join(repoRoot, see)) }).toEqual({ see, exists: true });
        const recipe = RECIPES[spec.id];
        expect({ id: spec.id, see, recipe: recipe?.document }).toEqual({ id: spec.id, see, recipe: see });
        const text = readFileSync(join(repoRoot, see), "utf8");
        for (const name of recipe!.names) expect({ see, name, named: text.includes(name) }).toEqual({ see, name, named: true });
      }
    }
  });

  test("the README's plan rule and example agree with the build: the no-commit case, and plainly invented times", () => {
    const readme = readFileSync(join(repoRoot, "packages/house/README.md"), "utf8");
    expect(readme).toContain("a present\nroom whose `SOURCE.txt` names no commit, when the blueprint wants one, plans\n`cannot_tell`");
    const times = [...readme.matchAll(/"installed":"([^"]+)"/g)].map((match) => match[1]);
    expect(times).toEqual([INSTALLED_NEW]);
  });

  test("a step never carries a command to paste", async () => {
    const empty = await survey(makeDeps({ fs: new FakeFs({ [HOME]: { type: "dir" } }), run: new FakeRunner(), env: { HOME } }));
    const { blueprint } = await roundTrip();
    const text = JSON.stringify(plan(empty, blueprint, NOW));
    expect(text).not.toMatch(/\b(?:claude mcp|ln -s|git |bun install|cp |mkdir|sudo|curl|chmod|\$\(|&&)/);
  });
});

describe("no score", () => {
  /** Everything the house itself says. The weather's sentences are the device's readings in the collab build's words (a battery
   * at 100% is a reading, not a grade of the house), so they are left out of this check and asserted to stay in their field. */
  function houseText(value: HouseSurvey | HousePlan | HouseBlueprint): string {
    const copy = JSON.parse(JSON.stringify(value));
    if ("parts" in copy && copy.protocol === "agenttool.house-survey/1") {
      for (const part of copy.parts) if (part.id === "ground.weather") part.detail = {};
    }
    return JSON.stringify(copy);
  }

  test("no output contains a percentage, a count as a fraction of a total, or the words healthy, complete or score", async () => {
    const outputs: Array<HouseSurvey | HousePlan | HouseBlueprint> = [];
    for (const deps of [
      makeDeps(),
      makeDeps({ fs: new FakeFs({ [HOME]: { type: "dir" } }), run: new FakeRunner(), env: { HOME } }),
      makeDeps({ fs: fullHouse().put(`${SHARE}/collab/current`, { type: "link", target: COLLAB_OLD }).remove(`${HOME}/.codex`) }),
    ]) {
      const seen = await survey(deps);
      const { blueprint } = await roundTrip();
      outputs.push(seen, blueprintFromSurvey(seen), plan(seen, blueprint, NOW));
    }
    for (const output of outputs) {
      const text = houseText(output);
      expect(text).not.toMatch(/%|percent/i);
      expect(text).not.toMatch(/\b\d+\s*(?:\/|of|out of)\s*\d+\b/);
      // The spec's three words anywhere (so "incomplete" and "unhealthy" count too), and three more at a word's start.
      expect(text).not.toMatch(/health|complete|score|\bgrade|\brating|\brank/i);
    }
  });

  test("the weather's own words stay in ground.weather's detail", async () => {
    const seen = await survey(makeDeps());
    const text = JSON.stringify(seen);
    expect(text.indexOf("100%")).toBeGreaterThan(text.indexOf('"id":"ground.weather"'));
    expect(text.indexOf("100%")).toBeLessThan(text.indexOf('"id":"room.collab"'));
    expect(text.split("100%")).toHaveLength(2);
  });
});

describe("switches are compared as collab reads them: one switch under two spellings", () => {
  const door = (env: Record<string, string>) => fullHouse().put(`${HOME}/.claude.json`, {
    type: "file", text: claudeJson({ ...CLAUDE_SERVERS, "agenttool-collab": { command: "bun", args: [`${SHARE}/collab/current/x.js`], env } }),
  });
  const wants = (switches: Record<string, string>) => parseBlueprint(JSON.stringify({
    protocol: BLUEPRINT_PROTOCOL, name: "a house", parts: [{ id: "door.claude-code.collab", switches }],
  }));
  const stepFor = async (env: Record<string, string>, switches: Record<string, string>) =>
    plan(await survey(makeDeps({ fs: door(env) })), wants(switches), NOW).steps[0]!;

  test("disagreeing spellings: cannot_tell, never as_wanted", async () => {
    expect(await stepFor({ AGENTOOL_COLLAB_TOOLS: "full", AGENTTOOL_COLLAB_TOOLS: "notes" }, { AGENTOOL_COLLAB_TOOLS: "full" }))
      .toMatchObject({ is: "cannot_tell" });
  });

  test("the same value under the other spelling is as wanted", async () => {
    expect(await stepFor({ AGENTTOOL_COLLAB_TOOLS: "notes" }, { AGENTOOL_COLLAB_TOOLS: "notes" })).toMatchObject({ is: "as_wanted" });
  });

  test("another value under the other spelling: to_switch names the spelling set here, so the change does not add a conflict", async () => {
    expect((await stepFor({ AGENTTOOL_COLLAB_TOOLS: "notes" }, { AGENTOOL_COLLAB_TOOLS: "full" })).because).toBe(
      "AGENTTOOL_COLLAB_TOOLS is notes here; the blueprint wants full (as AGENTOOL_COLLAB_TOOLS, the same switch: change AGENTTOOL_COLLAB_TOOLS rather than adding the other spelling). "
      + "No document in this repository says how yet.",
    );
  });

  test("not set, or set empty: not set in this entry under either spelling", async () => {
    for (const env of [{}, { AGENTOOL_COLLAB_TOOLS: "" }] as Array<Record<string, string>>) {
      expect((await stepFor(env, { AGENTOOL_COLLAB_TOOLS: "full" })).because)
        .toBe("AGENTOOL_COLLAB_TOOLS is not set in this entry under either spelling; the blueprint wants full. No document in this repository says how yet.");
    }
  });

  test("blueprint --from-survey carries a switch set under both spellings once, and the plan of it is as wanted", async () => {
    const seen = await survey(makeDeps({ fs: door({ AGENTOOL_COLLAB_TOOLS: "notes", AGENTTOOL_COLLAB_TOOLS: "notes" }) }));
    const carried = parseBlueprint(JSON.stringify(blueprintFromSurvey(seen)));
    expect(carried.parts.find((part) => part.id === "door.claude-code.collab")).toEqual({ id: "door.claude-code.collab", switches: { AGENTOOL_COLLAB_TOOLS: "notes" } });
    expect(plan(seen, carried, NOW).steps.every((step) => step.is === "as_wanted")).toBe(true);
  });
});

describe("commits in a step's sentence", () => {
  const wanting = (commit: string) => parseBlueprint(JSON.stringify({ protocol: BLUEPRINT_PROTOCOL, name: "a house", parts: [{ id: "room.collab", commit }] }));

  test("two commits that agree for eight characters are shown to where they part, never as the same", async () => {
    const seen = await survey(makeDeps());
    expect(plan(seen, wanting("0f1e2d3c0"), NOW).steps[0]!.because)
      .toBe("The current install is commit 0f1e2d3c4; the blueprint wants 0f1e2d3c0. No document in this repository says how yet.");
    expect(plan(seen, wanting("0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d0"), NOW).steps[0]!.because)
      .toBe("The current install is commit 0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6; the blueprint wants 0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d0. No document in this repository says how yet.");
    expect(plan(seen, wanting("0f1e2d3c4"), NOW).steps[0]!.is).toBe("as_wanted");
  });

  test("a room with no commit in SOURCE.txt plans cannot_tell, naming the wanted commit whole", async () => {
    const fs = fullHouse().put(`${SHARE}/collab/${COLLAB_OLD}/SOURCE.txt`, { type: "file", text: "no commit here\n" })
      .put(`${SHARE}/collab/current`, { type: "link", target: COLLAB_OLD });
    expect(plan(await survey(makeDeps({ fs })), wanting("0f1e2d3c0"), NOW).steps[0]).toMatchObject({
      is: "cannot_tell", because: "The current install's SOURCE.txt names no commit, so whether it is 0f1e2d3c0 cannot be told.",
    });
  });
});
