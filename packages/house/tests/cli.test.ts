/** The CLI: one JSON line per command, exit codes, usage errors, nothing written to disk. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli, USAGE } from "../src/cli.js";
import type { LookDeps } from "../src/looks.js";
import { BLUEPRINT_PROTOCOL } from "../src/shapes.js";
import { FakeFs, HOME, SHARE, STATE, fullHouse, makeDeps, packageRoot } from "./helpers.js";

async function cli(argv: string[], deps: () => LookDeps = () => makeDeps(), cwd = "/work") {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { stdout: (text) => out.push(text), stderr: (text) => err.push(text), deps, cwd: () => cwd });
  return { code, out, err: err.join("") };
}

function oneJsonLine(out: string[]): Record<string, unknown> {
  expect(out).toHaveLength(1);
  expect(out[0]!.endsWith("\n")).toBe(true);
  expect(out[0]!.slice(0, -1)).not.toContain("\n");
  return JSON.parse(out[0]!);
}

const BLUEPRINT_PATH = "/blueprints/house.json";
const BIN_PATH = join(packageRoot, "bin", "agenttool-house.ts");
/** The flags the bin's own first line gives Bun. */
const SHEBANG_FLAGS = readFileSync(BIN_PATH, "utf8").split("\n")[0]!.replace(/^#!\/usr\/bin\/env -S bun\s*/, "").split(/\s+/).filter(Boolean);

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

  test("a refused part id that holds the user name, or anything identifying, is not repeated on stderr", async () => {
    for (const id of ["room.quillon", "quillon", "door.quillons-air.local"]) {
      const fs = fullHouse().put(BLUEPRINT_PATH, { type: "file", text: JSON.stringify({ protocol: BLUEPRINT_PROTOCOL, name: "x", parts: [{ id }] }) });
      const { code, err } = await cli(["plan", "--blueprint", BLUEPRINT_PATH], () => makeDeps({ fs }));
      expect({ id, code, err }).toEqual({ id, code: 3, err: "agenttool-house: refused (unknown_part): the blueprint names a part this build does not know: one whose id is not shown\n" });
    }
    const fs = fullHouse().put(BLUEPRINT_PATH, { type: "file", text: JSON.stringify({ protocol: BLUEPRINT_PROTOCOL, name: "x", parts: [], quillon: 1 }) });
    expect((await cli(["plan", "--blueprint", BLUEPRINT_PATH], () => makeDeps({ fs }))).err).not.toContain("quillon");
  });

  test("a blueprint is read only from a .json file outside AgentTool's share and state directories, and never through a final link", async () => {
    const journal = `${SHARE}/collab.sqlite`;
    const inside = `${STATE}/lobby/exported.json`;
    const linked = "/blueprints/linked.json";
    const fs = fullHouse()
      .put(inside, { type: "file", text: "{}" })
      .put(linked, { type: "link", target: journal })
      .put("/work/house.json", { type: "file", text: JSON.stringify({ protocol: BLUEPRINT_PROTOCOL, name: "x", parts: [] }) });
    for (const [path, expected] of [
      [journal, "agenttool-house: refused (not_json_file): a blueprint is read only from a file whose name ends in .json\n"],
      [`${HOME}/.ssh/id_ed25519`, "agenttool-house: refused (not_json_file): a blueprint is read only from a file whose name ends in .json\n"],
      [inside, "agenttool-house: refused (inside_agenttool): a blueprint is not read from ~/.local/share/agenttool or ~/.local/state/agenttool, where journals and keys are kept\n"],
      [`${HOME}/x/../.local/share/agenttool/collab-x.json`, "agenttool-house: refused (inside_agenttool): a blueprint is not read from ~/.local/share/agenttool or ~/.local/state/agenttool, where journals and keys are kept\n"],
      [linked, "agenttool-house: refused (link): the blueprint file is a link, which is not followed; name the file itself\n"],
    ] as const) {
      const { code, err } = await cli(["plan", "--blueprint", path], () => makeDeps({ fs }));
      expect({ path, code, err }).toEqual({ path, code: 3, err: expected });
    }
    // Nothing above was opened.
    expect(fs.calls.filter((call) => call.op === "readChosen")).toEqual([]);
    // A relative path is taken from the working directory.
    expect((await cli(["plan", "--blueprint", "house.json"], () => makeDeps({ fs }), "/work")).code).toBe(0);
    expect(fs.calls.filter((call) => call.op === "readChosen").map((call) => call.path)).toEqual(["/work/house.json"]);
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
        const child = Bun.spawn([process.execPath, ...SHEBANG_FLAGS, join(packageRoot, "bin", "agenttool-house.ts"), ...args], {
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

describe("the working directory's .env and bunfig.toml never reach the house", () => {
  test("the bin's first line and the README's command give Bun --no-install --no-env-file --config=/dev/null", () => {
    expect(readFileSync(BIN_PATH, "utf8").split("\n")[0]).toBe("#!/usr/bin/env -S bun --no-install --no-env-file --config=/dev/null");
    expect(SHEBANG_FLAGS).toEqual(["--no-install", "--no-env-file", "--config=/dev/null"]);
    expect(statSync(BIN_PATH).mode & 0o111).not.toBe(0);
    const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
    expect(readme).toContain("bun --no-install --no-env-file --config=/dev/null packages/house/bin/agenttool-house.ts survey");
    expect(readme).not.toMatch(/`bun packages\/house\/bin/);
  });

  test("run from a directory holding a .env and a bunfig.toml with a preload: the preload does not run, and run directly the same holds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "house-cwd-"));
    try {
      writeFileSync(join(dir, ".env"), "CI=1\nSSH_TTY=/dev/ttys009\n");
      writeFileSync(join(dir, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
      writeFileSync(join(dir, "preload.ts"), 'import { writeFileSync } from "node:fs";\nwriteFileSync(import.meta.dir + "/PRELOAD-RAN", String(process.env.CI));\n');
      const env = { HOME: dir, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
      const run = async (argv: string[]) => {
        const child = Bun.spawn(argv, { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
        const stdout = await new Response(child.stdout).text();
        return { code: await child.exited, stdout };
      };
      // The detector works: without the flags, Bun runs the preload, with the .env loaded.
      expect((await run([process.execPath, BIN_PATH, "--help"])).code).toBe(0);
      expect(readFileSync(join(dir, "PRELOAD-RAN"), "utf8")).toBe("1");
      rmSync(join(dir, "PRELOAD-RAN"));
      for (const argv of [[process.execPath, ...SHEBANG_FLAGS, BIN_PATH, "--help"], [BIN_PATH, "--help"]]) {
        const { code, stdout } = await run(argv);
        expect({ argv: argv.length, code, stdout, preload: existsSync(join(dir, "PRELOAD-RAN")) }).toEqual({ argv: argv.length, code: 0, stdout: USAGE, preload: false });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
