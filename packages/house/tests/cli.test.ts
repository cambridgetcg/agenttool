/** The CLI: one JSON line per command, exit codes, usage errors, nothing written to disk. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, USAGE } from "../src/cli.js";
import type { LookDeps } from "../src/looks.js";
import { BLUEPRINT_PROTOCOL } from "../src/shapes.js";
import { FakeFs, HOME, fullHouse, makeDeps, packageRoot } from "./helpers.js";

async function cli(argv: string[], deps: () => LookDeps = () => makeDeps()) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { stdout: (text) => out.push(text), stderr: (text) => err.push(text), deps });
  return { code, out, err: err.join("") };
}

function oneJsonLine(out: string[]): Record<string, unknown> {
  expect(out).toHaveLength(1);
  expect(out[0]!.endsWith("\n")).toBe(true);
  expect(out[0]!.slice(0, -1)).not.toContain("\n");
  return JSON.parse(out[0]!);
}

const BLUEPRINT_PATH = "/blueprints/house.json";

describe("commands", () => {
  test("survey: one JSON line, exit 0", async () => {
    const { code, out, err } = await cli(["survey"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(oneJsonLine(out).protocol).toBe("agenttool.house-survey/1");
  });

  test("survey exits 0 even when every part is unknown", async () => {
    const { code, out } = await cli(["survey"], () => makeDeps({ fs: new FakeFs({ [HOME]: { type: "denied" } }) }));
    expect(code).toBe(0);
    expect(oneJsonLine(out).protocol).toBe("agenttool.house-survey/1");
  });

  test("blueprint --from-survey [--name]: one JSON line", async () => {
    const plain = await cli(["blueprint", "--from-survey"]);
    expect(plain.code).toBe(0);
    expect(oneJsonLine(plain.out)).toMatchObject({ protocol: BLUEPRINT_PROTOCOL, name: "this house, as it stands" });
    const named = await cli(["blueprint", "--from-survey", "--name", "a working desk"]);
    expect(oneJsonLine(named.out).name).toBe("a working desk");
  });

  test("plan --blueprint <path>: one JSON line, reading only the file the person named", async () => {
    const blueprint = await cli(["blueprint", "--from-survey"]);
    const fs = fullHouse().put(BLUEPRINT_PATH, { type: "file", text: blueprint.out[0]! });
    const { code, out } = await cli(["plan", "--blueprint", BLUEPRINT_PATH], () => makeDeps({ fs }));
    expect(code).toBe(0);
    const planned = oneJsonLine(out) as { protocol: string; steps: Array<{ is: string }> };
    expect(planned.protocol).toBe("agenttool.house-plan/1");
    expect(planned.steps.every((step) => step.is === "as_wanted")).toBe(true);
    expect(fs.calls.filter((call) => call.op === "readChosen").map((call) => call.path)).toEqual([BLUEPRINT_PATH]);
  });

  test("--help anywhere: the usage on stdout, exit 0, nothing looked at", async () => {
    let built = false;
    for (const argv of [["--help"], ["-h"], ["help"], ["survey", "--help"], ["plan", "--blueprint", "x", "--help"]]) {
      const { code, out } = await cli(argv, () => {
        built = true;
        return makeDeps();
      });
      expect(code).toBe(0);
      expect(out).toEqual([USAGE]);
    }
    expect(built).toBe(false);
  });
});

describe("usage errors exit 2 and quote nothing typed", () => {
  test.each([
    [[]],
    [["build"]],
    [["atcm_SECRET_COMMAND"]],
    [["survey", "--json"]],
    [["survey", "extra"]],
    [["blueprint"]],
    [["blueprint", "--name", "x"]],
    [["blueprint", "--from-survey", "--name"]],
    [["plan"]],
    [["plan", "--blueprint"]],
    [["plan", "--blueprint", ""]],
    [["plan", "--secret=atcm_SECRET_OPTION"]],
  ])("%j", async (argv) => {
    const { code, out, err } = await cli(argv);
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err).toContain("usage: agenttool-house survey");
    expect(err).not.toContain("atcm_");
  });
});

describe("refusals exit 3", () => {
  test("a blueprint naming an unknown part is refused, naming the part", async () => {
    const fs = fullHouse().put(BLUEPRINT_PATH, { type: "file", text: JSON.stringify({ protocol: BLUEPRINT_PROTOCOL, name: "x", parts: [{ id: "room.attic" }] }) });
    const { code, out, err } = await cli(["plan", "--blueprint", BLUEPRINT_PATH], () => makeDeps({ fs }));
    expect(code).toBe(3);
    expect(out).toEqual([]);
    expect(err).toBe("agenttool-house: refused (unknown_part): the blueprint names a part this build does not know: room.attic\n");
  });

  test("an unreadable or oversized blueprint file, and a bad name", async () => {
    const missing = await cli(["plan", "--blueprint", `${HOME}/nothing.json`]);
    expect(missing).toMatchObject({ code: 3, out: [], err: "agenttool-house: refused (unreadable): the blueprint file could not be read\n" });
    const fs = fullHouse().put(BLUEPRINT_PATH, { type: "file", text: "x".repeat(256 * 1024 + 1) });
    expect((await cli(["plan", "--blueprint", BLUEPRINT_PATH], () => makeDeps({ fs }))).code).toBe(3);
    expect((await cli(["blueprint", "--from-survey", "--name", "two\nlines"])).code).toBe(3);
  });
});

describe("internal errors exit 1 without echoing the error", () => {
  test("a failure outside the survey's own handling", async () => {
    const { code, out, err } = await cli(["survey"], () => {
      throw new Error(`no home: ${HOME} atcm_SECRET`);
    });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toBe("agenttool-house: internal_error: this build could not finish\n");
  });
});

describe("nothing written to disk", () => {
  test("the survey, blueprint and plan only lstat, readlink, list and read", async () => {
    const fs = fullHouse();
    const blueprint = await cli(["blueprint", "--from-survey"], () => makeDeps({ fs }));
    fs.put(BLUEPRINT_PATH, { type: "file", text: blueprint.out[0]! });
    await cli(["survey"], () => makeDeps({ fs }));
    await cli(["plan", "--blueprint", BLUEPRINT_PATH], () => makeDeps({ fs }));
    expect(new Set(fs.calls.map((call) => call.op))).toEqual(new Set(["lstat", "readlink", "list", "readHead", "readChosen"]));
  });

  test("the real bin, run for --help and a usage error in an empty directory, leaves it empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "house-cli-"));
    try {
      for (const [args, expected] of [[["--help"], 0], [["survey", "--nope"], 2]] as const) {
        const child = Bun.spawn([process.execPath, "--no-env-file", join(packageRoot, "bin", "agenttool-house.ts"), ...args], {
          cwd: dir, env: { HOME: dir, PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe",
        });
        const stdout = await new Response(child.stdout).text();
        expect(await child.exited).toBe(expected);
        if (expected === 0) expect(stdout).toBe(USAGE);
      }
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
