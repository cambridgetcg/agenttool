import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import packageJson from "../package.json";
import schema from "../schema/agenttool-skills-inspection-v0.1.schema.json";
import { inspectLocalSkills } from "../src/index.js";

const NEN_SKILL_NAMES = [
  "nen-concealed-trace",
  "nen-contract-mantle",
  "nen-critical-path-forge",
  "nen-dependency-perimeter",
  "nen-godspeed-loop",
  "nen-smoke-squad",
  "nen-verification-ledger",
  "nen-vow-forge",
] as const;

test("publishes only the runtime, schema, bundled skills, and legal documentation", () => {
  expect(packageJson.name).toBe("@agenttool/skills");
  expect(packageJson.version).toBe("0.2.0");
  expect(packageJson.files).toEqual([
    "dist",
    "schema",
    "skills",
    "README.md",
    "LICENSE",
    "NOTICE",
  ]);
  expect(packageJson.files).not.toContain("tests");
  expect(packageJson.files).not.toContain("src");
  expect(packageJson.bin).toEqual({ "agenttool-skill": "dist/bin.js" });
  expect(packageJson.exports["./report.schema.json"].default).toBe(
    "./schema/agenttool-skills-inspection-v0.1.schema.json",
  );
  expect(schema.$id).toBe("urn:agenttool:skills:inspection:v0.1");
});

test("generated valid and finding reports conform to the bundled closed schema", async () => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const validReport = await inspectLocalSkills(join(import.meta.dir, "..", "..", "collab"));
  expect(validate(validReport)).toBe(true);
  const findingReport = await inspectLocalSkills(join(import.meta.dir, "definitely-absent"));
  expect(validate(findingReport)).toBe(true);
});

test("bundles Capability Conductor as a valid instruction-only skill", async () => {
  const report = await inspectLocalSkills(
    join(import.meta.dir, "..", "skills", "capability-conductor"),
  );

  expect(report.valid).toBe(true);
  expect(report.issues).toEqual([]);
  expect(report.skills.map((skill) => skill.name)).toEqual(["capability-conductor"]);
  expect(report.skills.every((skill) => skill.scripts.length === 0)).toBe(true);
  expect(report.skills.every((skill) => typeof skill.digest === "string")).toBe(true);

  const sidecar = parse(await readFile(
    join(import.meta.dir, "..", "skills", "capability-conductor", "agents", "openai.yaml"),
    "utf8",
  ));
  expect(sidecar).toEqual({
    interface: {
      display_name: "Capability Conductor · 團長",
      short_description: "Compose skills with provenance and bounded authority",
      default_prompt: "Use $capability-conductor to open a task-scoped capability book and compose the smallest safe skill workflow for this task.",
    },
  });
});

test("bundles Learn by Contact as a valid instruction-only skill", async () => {
  const skillRoot = join(import.meta.dir, "..", "skills", "learn-by-contact");
  const report = await inspectLocalSkills(
    skillRoot,
  );

  expect(report.valid).toBe(true);
  expect(report.issues).toEqual([]);
  expect(report.skills.map((skill) => skill.name)).toEqual(["learn-by-contact"]);
  expect(report.skills[0]?.scripts).toEqual([]);
  expect(report.skills[0]?.resources).toEqual(["agents/openai.yaml"]);
  expect(typeof report.skills[0]?.digest).toBe("string");

  const sidecar = parse(await readFile(
    join(skillRoot, "agents", "openai.yaml"),
    "utf8",
  ));
  expect(sidecar).toEqual({
    interface: {
      display_name: "Learn by Contact",
      short_description: "Turn direct evidence into transferable capability",
      default_prompt: "Use $learn-by-contact to trace how this works, reproduce the mechanism, and adapt it to my task.",
    },
    policy: {
      allow_implicit_invocation: false,
    },
  });
});

test("bundles the Nen operating suite as valid instruction-only skills", async () => {
  const skillsRoot = join(import.meta.dir, "..", "skills");
  const report = await inspectLocalSkills(skillsRoot);

  expect(report.valid).toBe(true);
  expect(report.issues).toEqual([]);
  expect(
    report.skills
      .map((skill) => skill.name)
      .filter((name): name is typeof NEN_SKILL_NAMES[number] => name.startsWith("nen-")),
  ).toEqual(NEN_SKILL_NAMES);

  for (const name of NEN_SKILL_NAMES) {
    const skill = report.skills.find((candidate) => candidate.name === name);
    expect(skill?.scripts).toEqual([]);
    expect(skill?.resources).toEqual(["agents/openai.yaml"]);
    expect(typeof skill?.digest).toBe("string");
    expect(Object.keys(skill?.metadataShape ?? {}).sort()).toEqual(["description", "name"]);

    const sidecar = parse(await readFile(
      join(skillsRoot, name, "agents", "openai.yaml"),
      "utf8",
    ));
    expect(Object.keys(sidecar)).toEqual(["interface"]);
    expect(typeof sidecar.interface?.display_name).toBe("string");
    expect(sidecar.interface?.short_description?.length).toBeGreaterThanOrEqual(25);
    expect(sidecar.interface?.short_description?.length).toBeLessThanOrEqual(64);
    expect(sidecar.interface?.default_prompt).toContain(`$${name}`);
  }
});
