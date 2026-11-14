/** The real runner and the real file system, each in a fresh temporary directory (never the machine's
 * own home): the ask's time limit is a bound, flooding is cut off, the child writes nothing into the home,
 * and the file reads never follow a link or block on a pipe. Every child here is a made-up bundle. */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isFail, realFs } from "../src/fs.js";
import { askArgv, childEnvironment, KILL_GRACE_MS, processRunner, type RunResult } from "../src/run.js";

const made: string[] = [];
const pids: number[] = [];

afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, as it should be.
    }
  }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A made-up home holding one collab version whose host bundle is `source`. */
function homeWith(source: string): { home: string; entry: string } {
  const home = mkdtempSync(join(tmpdir(), "house-run-"));
  made.push(home);
  const dir = join(home, ".local", "share", "agenttool", "collab", "0.6.0-dev.0-1a2b3c4d");
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "agenttool-collab-host.js");
  writeFileSync(entry, source);
  chmodSync(entry, 0o700);
  return { home, entry };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Runs the real runner, but gives up (and says so) at a test deadline, so a runner that hangs fails the test instead of stalling it. */
async function timed(home: string, entry: string, timeoutMs: number, env = childEnvironment(home)): Promise<{ ms: number; result: RunResult | "hung" }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), 6000);
  });
  const result = await Promise.race([processRunner(home).run(askArgv(entry, "help"), { env, timeoutMs, maxBytes: 64 * 1024 }), hung]);
  clearTimeout(timer);
  return { ms: Date.now() - started, result };
}

const PID_FILE = "const { writeFileSync } = require('node:fs'); const pidFile = (name, pid) => writeFileSync(process.env.HOME + '/' + name, String(pid));";
const readPid = (home: string, name: string) => Number(readFileSync(join(home, name), "utf8"));
/** The limit, a grace for SIGTERM, one for the readers, one for the exit, and room for a loaded machine. */
const BOUND_MS = (timeoutMs: number) => timeoutMs + 3 * KILL_GRACE_MS + 1500;

describe("the real runner", () => {
  test("a child that answers is read whole, with its exit code", async () => {
    const { home, entry } = homeWith(`console.log(JSON.stringify({ protocol: "agenttool.collab-host/1", status: "help", usage: process.argv.slice(2).join(" ") }));`);
    const { result } = await timed(home, entry, 5000);
    expect(result).toEqual({ exitCode: 0, stdout: '{"protocol":"agenttool.collab-host/1","status":"help","usage":"--help"}\n', timedOut: false, truncated: false, spawnFailed: false });
  });

  test("a child that ignores SIGTERM is killed, and the runner returns within the bound", async () => {
    const { home, entry } = homeWith(`${PID_FILE} pidFile("child.pid", process.pid); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`);
    const { ms, result } = await timed(home, entry, 300);
    if (existsSync(join(home, "child.pid"))) pids.push(readPid(home, "child.pid"));
    expect(result).not.toBe("hung");
    expect(result).toMatchObject({ timedOut: true, exitCode: null, stdout: "" });
    expect(ms).toBeLessThan(BOUND_MS(300));
    expect(alive(readPid(home, "child.pid"))).toBe(false);
  }, 15_000);

  test("a grandchild left holding the output pipe does not hold the survey, and is stopped with its group", async () => {
    const { home, entry } = homeWith(
      `${PID_FILE} const { spawn } = require("node:child_process");`
      + ` const sleeper = spawn("/bin/sleep", ["30"], { stdio: ["ignore", "inherit", "inherit"] }); pidFile("grandchild.pid", sleeper.pid); sleeper.unref();`,
    );
    const { ms, result } = await timed(home, entry, 300);
    if (existsSync(join(home, "grandchild.pid"))) pids.push(readPid(home, "grandchild.pid"));
    expect(result).not.toBe("hung");
    expect(result).toMatchObject({ timedOut: true, exitCode: null });
    expect(ms).toBeLessThan(BOUND_MS(300));
    await Bun.sleep(100);
    expect(alive(readPid(home, "grandchild.pid"))).toBe(false);
  }, 15_000);

  test("a child that floods is cut off at the cap and stopped", async () => {
    const { home, entry } = homeWith(`${PID_FILE} pidFile("child.pid", process.pid); const line = "x".repeat(8192); const flood = () => { while (process.stdout.write(line)) {} process.stdout.once("drain", flood); }; flood();`);
    const { ms, result } = await timed(home, entry, 5000);
    if (existsSync(join(home, "child.pid"))) pids.push(readPid(home, "child.pid"));
    expect(result).not.toBe("hung");
    expect(result).toMatchObject({ truncated: true, timedOut: false, exitCode: null, stdout: "" });
    expect(ms).toBeLessThan(BOUND_MS(0) + 1000);
  }, 15_000);

  test("the child writes nothing into the home: no package cache for a bare import, no transpiler cache for a large bundle", async () => {
    // A registry on a closed local port: should auto-install ever come back, nothing leaves the machine.
    const offline = (home: string) => ({ ...childEnvironment(home), BUN_CONFIG_REGISTRY: "http://127.0.0.1:9/", NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/" });
    const bare = homeWith(`import "left-pad-that-does-not-exist-zzz";\nconsole.log("ran");\n`);
    const bareRun = await timed(bare.home, bare.entry, 5000, offline(bare.home));
    expect(bareRun.result).toMatchObject({ exitCode: 1, timedOut: false });
    expect(readdirSync(bare.home)).toEqual([".local"]);
    const lines = Array.from({ length: 4000 }, (_, index) => `  "padding line ${index} so that the bundle is large",`).join("\n");
    const large = homeWith(`const pad = [\n${lines}\n];\nconsole.log(JSON.stringify({ protocol: "agenttool.collab-host/1", status: "help", usage: String(pad.length) }));\n`);
    const largeRun = await timed(large.home, large.entry, 5000, offline(large.home));
    expect(largeRun.result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(readdirSync(large.home)).toEqual([".local"]);
  }, 30_000);
});

describe("the real file system", () => {
  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), "house-fs-"));
    made.push(dir);
    writeFileSync(join(dir, "file.json"), '{"a":1}');
    writeFileSync(join(dir, "long.txt"), "0123456789abcdefghij");
    symlinkSync(join(dir, "file.json"), join(dir, "link.json"));
    mkdirSync(join(dir, "dir"));
    return dir;
  }

  test("lstat names a link a link; list gives names; a missing path is absent", () => {
    const dir = scratch();
    expect(realFs.lstat(join(dir, "link.json"))).toMatchObject({ kind: "link" });
    expect(realFs.lstat(join(dir, "file.json"))).toMatchObject({ kind: "file", size: 7 });
    expect(realFs.lstat(join(dir, "nothing"))).toEqual({ fail: "absent" });
    expect(realFs.readlink(join(dir, "link.json"))).toBe(join(dir, "file.json"));
    expect((realFs.list(dir) as string[]).sort()).toEqual(["dir", "file.json", "link.json", "long.txt"]);
  });

  test("readHead and readChosen read a regular file, bounded, and never through a final link, a directory or a pipe", () => {
    const dir = scratch();
    expect(realFs.readHead(join(dir, "file.json"), 100)).toEqual({ text: '{"a":1}', truncated: false });
    expect(realFs.readHead(join(dir, "long.txt"), 10)).toEqual({ text: "0123456789", truncated: true });
    for (const read of [realFs.readHead, realFs.readChosen]) {
      expect(isFail(read(join(dir, "link.json"), 100))).toBe(true);
      expect(isFail(read(join(dir, "dir"), 100))).toBe(true);
      expect(read(join(dir, "nothing.json"), 100)).toEqual({ fail: "absent" });
    }
    const fifo = join(dir, "pipe.json");
    if (Bun.spawnSync(["/usr/bin/mkfifo", fifo]).exitCode === 0) {
      // O_NONBLOCK: opening a pipe with no writer returns at once, and it is refused for not being a regular file.
      expect(isFail(realFs.readHead(fifo, 100))).toBe(true);
      expect(isFail(realFs.readChosen(fifo, 100))).toBe(true);
    }
  });
});
