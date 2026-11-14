/** Blueprint and plan: the round trip, one changed fact changing exactly one step, refusals, documents, and no score. */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { blueprintFromSurvey, parseBlueprint } from "../src/blueprint.js";
import { RefusalError } from "../src/errors.js";
import { PARTS } from "../src/parts.js";
import { plan } from "../src/plan.js";
import { BLUEPRINT_PROTOCOL, PLAN_PROTOCOL, type HouseBlueprint, type HousePlan, type HouseSurvey } from "../src/shapes.js";
import { survey } from "../src/survey.js";
import {
  CLAUDE_SERVERS, COLLAB_OLD, COMMIT_NEW, FakeFs, FakeRunner, HOME, LOBBY_COMMIT, NOW, SEAT_COMMIT, SHARE,
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
      id: "door.codex.collab", is: "to_switch", because: "AGENTOOL_COLLAB_TOOLS is full here; the blueprint wants notes.",
      whose_act: "the person", see: "packages/collab/PROTOCOL.md",
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
      because: "Not on this device: ~/.claude.json has no agenttool-lobby entry.", see: "packages/lobby/README.md",
    });
  });

  test("a stale entry plans to_repoint; an unknown part plans cannot_tell", async () => {
    const { blueprint } = await roundTrip();
    const servers = { ...CLAUDE_SERVERS, "agenttool-collab": { command: "bun", args: [`${SHARE}/collab/${COLLAB_OLD}/agenttool-collab-mcp.js`] } };
    const fs = fullHouse().put(`${HOME}/.claude.json`, { type: "file", text: claudeJson(servers) }).put(`${HOME}/.codex/config.toml`, { type: "file", text: "[[[" });
    const steps = plan(await survey(makeDeps({ fs })), blueprint, NOW).steps;
    expect(steps.find((step) => step.id === "door.claude-code.collab")).toMatchObject({ is: "to_repoint", see: "packages/collab/README.md" });
    expect(steps.find((step) => step.id === "door.codex.collab")).toMatchObject({
      is: "cannot_tell", because: "Could not be told here: the configuration file could not be parsed as TOML.", see: null,
    });
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
    expect(refused({ ...base, parts: [{ id: "atcm_SECRET quillon /Users/x" }] }, "unknown_part")).toBe("the blueprint names a part this build does not know: a part id that is not well formed");
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
  test("every document a step can name exists in this repository; a part with none says so plainly", () => {
    for (const spec of PARTS) {
      for (const see of [spec.see.build, spec.see.repoint, spec.see.switch]) {
        if (see !== null) expect({ see, exists: existsSync(join(repoRoot, see)) }).toEqual({ see, exists: true });
      }
    }
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
