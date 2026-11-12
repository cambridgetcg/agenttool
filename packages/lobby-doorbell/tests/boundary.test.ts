/** Package boundaries (CLAUDE.md, Non-negotiables):
 *
 * - No listening socket of any kind. One socket connect: src/claude-inbox.ts,
 *   the Claude Code session inbox (node:net createConnection, nothing else).
 * - One HTTP call site: src/health.ts, through an injected fetchImpl; only the
 *   bin names the runtime's fetch; the only URL literal is the origin constant.
 * - One process module: src/run.ts, with one spawn call behind two closed argv
 *   allowlists, no shell (neither `sh -c` nor Bun.$), and the only signals
 *   (signal 0 and SIGTERM; never SIGKILL).
 * - No Keychain, no lobby secrets; in the lobby home only STOP (written and
 *   removed only as the brake) and the database file's name (only lstat'ed).
 * - Writes only in src/home.ts (state files, the brake, the log line), sync or
 *   async, plus /dev/tty in src/tty.ts; only bin/ reads the environment;
 *   nothing imported from the lobby, collab, api/ or docs/.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { packageRoot } from "./helpers.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|mts|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const SOURCES = ["src", "bin", "contract"].flatMap((directory) => sourceFiles(join(packageRoot, directory)));
const rel = (path: string) => relative(packageRoot, path);
const text = (path: string) => readFileSync(path, "utf8");

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const FORBIDDEN_MODULE = /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|inspector|child_process|worker_threads|cluster|fs\/promises)(?:\/.*)?$|^(?:undici|ws|node-fetch|axios|got|bun:ffi|bun:sqlite|bonjour|bonjour-service|mdns|multicast-dns|dns-sd)$/;
/** The one exception: the inbox module may import node:net, for createConnection only. */
const SOCKET_MODULE = { file: "src/claude-inbox.ts", specifier: "node:net" };
/** Forbidden in every file. */
const NEVER: RegExp[] = [
  /(?<![.\w])fetch\s*\(/,
  /\b(?:self|window)\.fetch\b/,
  /\bBun\.(?:listen|serve|connect|udpSocket)\b/,
  /\bcreateServer\b/,
  /\.listen\s*\(/,
  /\b(?:Socket|Server)\s*\(/,
  /\bWebSocket\b/,
  /\bXMLHttpRequest\b/,
  /\bEventSource\b/,
  /\bnavigator\.sendBeacon\b/,
  /\b(?:execSync|execFileSync|execFile|spawnSync)\b/,
  /\/bin\/(?:ba|z|da)?sh\b/,
  /["'`]-c["'`]/,
  /keychain/i,
  /\/usr\/bin\/security\b/,
  /["'`/]secrets\b/,
  /\bkill\s*\(\s*[^)]*(?:9|SIGKILL)/,
  /\bBun\.\$/,
  /\bBun\.env\b/,
  /\bimport\.meta\.env\b/,
  /\bpromises\b/,
];
/** Every way to create, change or remove a file, sync, async or callback style. */
const WRITE = new RegExp([
  String.raw`\b(?:writeFileSync|appendFileSync|writeSync|writevSync|mkdirSync|mkdtempSync|renameSync|unlinkSync|rmSync|rmdirSync`,
  String.raw`|chmodSync|fchmodSync|lchmodSync|chownSync|fchownSync|lchownSync|copyFileSync|cpSync|symlinkSync|linkSync|truncateSync`,
  String.raw`|ftruncateSync|utimesSync|futimesSync|lutimesSync|openSync|createWriteStream|O_CREAT|O_APPEND|O_WRONLY|O_RDWR|O_TRUNC`,
  String.raw`|Bun\.write|Bun\.file)\b`,
  String.raw`|(?<!process\.std(?:out|err)\.)\b(?:writeFile|appendFile|write|writev|mkdir|mkdtemp|rename|unlink|rm|rmdir|chmod|chown`,
  String.raw`|copyFile|cp|symlink|link|truncate|ftruncate|open|utimes)\s*\(`,
].join(""));
/** Allowed only in the named files. */
const ONLY_IN: Array<{ pattern: RegExp; files: string[] }> = [
  { pattern: /\bglobalThis\.fetch\b/, files: ["bin/agenttool-lobby-doorbell.ts"] },
  { pattern: /\bfetchImpl\s*\(/, files: ["src/health.ts"] },
  { pattern: /https?:\/\//, files: ["src/health.ts"] },
  { pattern: /\bBun\.spawn\b/, files: ["src/run.ts"] },
  { pattern: /\bprocess\.kill\b/, files: ["src/run.ts"] },
  { pattern: /\bcreateConnection\b/, files: ["src/claude-inbox.ts"] },
  { pattern: WRITE, files: ["src/home.ts", "src/tty.ts"] },
  { pattern: /\.sqlite\b/, files: ["src/home.ts"] },
];

describe("network, process and write boundary", () => {
  test("the scan sees every source file", () => {
    expect(SOURCES.map(rel).sort()).toEqual([
      "bin/agenttool-lobby-doorbell.ts", "contract/check.ts", "contract/lobby-contract.ts",
      "src/claude-inbox.ts", "src/cli.ts", "src/control.ts", "src/errors.ts", "src/fetcher.ts", "src/formats.ts", "src/health.ts",
      "src/home.ts", "src/hook.ts", "src/lobby-cli.ts", "src/netcheck.ts", "src/probes.ts", "src/registry.ts", "src/ring.ts",
      "src/run.ts", "src/seat-ref.ts", "src/tty.ts", "src/watcher.ts",
    ]);
  });

  test("no file imports a network, subprocess, worker, SQLite or discovery module", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(text(path))) {
        const excepted = rel(path) === SOCKET_MODULE.file && specifier === SOCKET_MODULE.specifier;
        expect({ file: rel(path), specifier, forbidden: !excepted && FORBIDDEN_MODULE.test(specifier) }).toEqual({ file: rel(path), specifier, forbidden: false });
      }
    }
  });

  test("the one socket connect is the Claude inbox, and it only connects", () => {
    const inbox = text(join(packageRoot, "src", "claude-inbox.ts"));
    expect(inbox).toContain('import { createConnection } from "node:net";');
    expect(specifiers(inbox).filter((specifier) => specifier === "node:net")).toHaveLength(1);
    expect(inbox.match(/\bcreateConnection\(/g)).toHaveLength(1);
    expect(inbox).toContain("const connection = createConnection(socket, () => {");
    expect(inbox).not.toMatch(/\b(?:createServer|listen|Server)\b|console\.|process\.std(?:out|err)|appendLogLine/);
  });

  test("nothing listens, connects, shells out, names the Keychain or lobby secrets; fetch, spawn, URLs and writes each have one home", () => {
    for (const path of SOURCES) {
      const source = text(path);
      for (const pattern of NEVER) {
        expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) }).toEqual({ file: rel(path), pattern: String(pattern), found: false });
      }
      for (const { pattern, files } of ONLY_IN) {
        if (files.includes(rel(path))) continue;
        expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) }).toEqual({ file: rel(path), pattern: String(pattern), found: false });
      }
    }
  });

  test("the one HTTP call goes through the injected fetch to the one origin constant", () => {
    const health = text(join(packageRoot, "src", "health.ts"));
    expect(health).toContain('export const LOBBY_ORIGIN = "https://api.agenttool.dev" as const;');
    expect(health.match(/https?:\/\//g)).toHaveLength(1);
    expect(health.match(/\bfetchImpl\(/g)).toHaveLength(1);
    expect(health).toContain("options.fetchImpl(`${LOBBY_ORIGIN}${HEALTH_PATH}`, {");
    expect(health).toContain('redirect: "error"');
    expect(health).not.toMatch(/\bglobalThis\b|\bprocess\.env\b|authorization|cookie/i);
  });

  test("the one process module spawns once, each caller behind its allowlist, and no shell", () => {
    const run = text(join(packageRoot, "src", "run.ts"));
    expect(run.match(/\bBun\.spawn\(/g)).toHaveLength(1);
    expect(run).toContain("function spawnChild(argv: readonly string[], env: Record<string, string>, detached: boolean) {\n  return Bun.spawn([...argv], detached");
    // spawnChild is defined once and called twice, each call right after its allowlist check.
    expect(run.match(/\bspawnChild\(/g)).toHaveLength(3);
    expect(run).toContain("      assertAllowedDetachedArgv(argv, selfEntry);\n      try {\n        const child = spawnChild(argv, env, true);");
    expect(run).toContain("      assertAllowedArgv(argv, lobbyEntry);\n      let child: ReturnType<typeof spawnChild>;\n      try {\n        child = spawnChild(argv, options.env, false);");
    expect(run).toContain('export const MULLVAD_PATHS = ["/usr/local/bin/mullvad", "/opt/homebrew/bin/mullvad"] as const;');
    expect(run).toContain('export const PS_PATH = "/bin/ps";');
    expect(run).toContain('const env: Record<string, string> = { PATH: "/usr/bin:/bin" };');
    expect(run).not.toMatch(/shell\s*:/);
    // The only signals: signal 0 (a liveness probe) and SIGTERM after a start-time match.
    expect([...run.matchAll(/\bprocess\.kill\(([^)]*)\)/g)].map((match) => match[1])).toEqual(["pid, 0", 'pid, "SIGTERM"']);
    expect(run.indexOf("if (now === null || now !== started) return false;")).toBeLessThan(run.indexOf('process.kill(pid, "SIGTERM")'));
  });

  test("the tty module opens /dev/tty only", () => {
    const tty = text(join(packageRoot, "src", "tty.ts"));
    expect(tty).toContain('export const DEV_TTY = "/dev/tty";');
    expect([...tty.matchAll(/\bopenSync\(([^,]*),/g)].map((match) => match[1])).toEqual(["DEV_TTY"]);
    expect(tty).not.toMatch(/\b(?:writeFileSync|appendFileSync|mkdirSync|renameSync|unlinkSync|rmSync|O_CREAT|home\.js)\b/);
  });

  test("only bin/ reads the process environment; library code takes it as a value", () => {
    for (const path of SOURCES.filter((file) => rel(file).startsWith("src/"))) {
      expect({ file: rel(path), env: /\bprocess\.env\b/.test(text(path)) }).toEqual({ file: rel(path), env: false });
    }
  });

  test("in the lobby home only the brake is ever written: writeStop and removeStop, through stopPath", () => {
    const home = text(join(packageRoot, "src", "home.ts"));
    expect(home).toContain("const fd = openSync(stopPath(lobbyHome), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);");
    expect(home).toContain("  removePrivateFile(stopPath(lobbyHome));");
    expect(home.match(/\bstopPath\(lobbyHome\)/g)).toHaveLength(3);
    for (const path of SOURCES.filter((file) => rel(file).startsWith("src/") && rel(file) !== "src/home.ts")) {
      expect({ file: rel(path), stop: /\b(?:writeStop|removeStop)\(/.test(text(path)) }).toEqual({ file: rel(path), stop: rel(path) === "src/control.ts" });
    }
  });

  test("inside the lobby home only STOP and the database file are named, the database only for an lstat", () => {
    for (const path of SOURCES.filter((file) => rel(file).startsWith("src/"))) {
      for (const match of text(path).matchAll(/join\(\s*lobbyHome\s*,\s*([^)]*)\)/g)) {
        expect({ file: rel(path), joined: ["STOP_FILE", "DATABASE_FILE"].includes(match[1]!.trim()) }).toEqual({ file: rel(path), joined: true });
      }
      if (rel(path) !== "src/home.ts") expect({ file: rel(path), database: /\bDATABASE_FILE\b/.test(text(path)) }).toEqual({ file: rel(path), database: false });
    }
    const home = text(join(packageRoot, "src", "home.ts"));
    expect(home).toContain('export const STOP_FILE = "STOP";');
    expect(home.match(/\.sqlite\b/g)).toEqual([".sqlite"]);
    expect(home).toContain('export const DATABASE_FILE = "lobby.sqlite";');
    expect(home.match(/\bDATABASE_FILE\b/g)).toHaveLength(2);
    expect(home).toContain("database = lstatSync(join(lobbyHome, DATABASE_FILE));");
  });

  test("the detector recognises the forbidden shapes", () => {
    expect(NEVER[0]!.test("await fetch (url)")).toBe(true);
    expect(NEVER[0]!.test("options.fetchImpl(url)")).toBe(false);
    expect(NEVER[2]!.test("Bun.listen({})")).toBe(true);
    expect(NEVER[2]!.test("Bun.serve({})")).toBe(true);
    const never = (source: string) => NEVER.some((pattern) => pattern.test(source));
    expect(never('["/bin/sh", "-c"]')).toBe(true);
    expect(never("MacKeychainStore")).toBe(true);
    expect(never("server.listen(path)")).toBe(true);
    expect(never("new Server()")).toBe(true);
    expect(never("new net.Socket()")).toBe(true);
    expect(never("process.kill(pid, 9)")).toBe(true);
    expect(never('process.kill(pid, "SIGKILL")')).toBe(true);
    expect(never("await listen(context(io, values), options)")).toBe(false);
    expect(never("await Bun.$`echo hi`")).toBe(true);
    expect(never("const home = Bun.env.HOME;")).toBe(true);
    expect(never("import.meta.env.HOME")).toBe(true);
    expect(never('import { promises } from "node:fs"; await promises.writeFile(path, text);')).toBe(true);
    expect(never("fs.promises.appendFile(path, line)")).toBe(true);
    expect(FORBIDDEN_MODULE.test("node:fs/promises")).toBe(true);
    expect(FORBIDDEN_MODULE.test("fs/promises")).toBe(true);
    for (const write of [
      'await writeFile("/tmp/x", "")', "appendFile(path, line, done)", "mkdir(dir, { recursive: true })", "rm(path, { force: true })",
      "rename(from, to)", "unlink(path)", "copyFile(from, to)", "cp(from, to)", "symlink(target, path)", "truncate(path)",
      "open(path, \"w\")", "createWriteStream(path)", "copyFileSync(from, to)", "symlinkSync(target, path)", "openSync(path, \"w\")",
      "Bun.write(path, text)", "Bun.file(path).writer()", "fs.writeFileSync(path, text)", "handle.write(text)",
    ]) expect({ write, found: WRITE.test(write) }).toEqual({ write, found: true });
    for (const read of ["process.stdout.write(text)", "process.stderr.write(text)", "readFileSync(path)", "lstatSync(path)", "writes one line", "fileOpened(path)"]) {
      expect({ read, found: WRITE.test(read) }).toEqual({ read, found: false });
    }
    expect(FORBIDDEN_MODULE.test("node:child_process")).toBe(true);
    expect(FORBIDDEN_MODULE.test("multicast-dns")).toBe(true);
    expect(FORBIDDEN_MODULE.test("node:fs")).toBe(false);
  });
});

describe("dependencies and imports", () => {
  test("no runtime dependency; the package is private", () => {
    const manifest = JSON.parse(text(join(packageRoot, "package.json")));
    expect(manifest.private).toBe(true);
    expect(manifest.dependencies).toBeUndefined();
    expect(Object.keys(manifest.devDependencies).sort()).toEqual(["@types/bun", "typescript"]);
  });

  test("nothing is imported from the lobby or collab packages, api/ or docs/; only node: built-ins and siblings", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(text(path))) {
        const local = specifier.startsWith("./") || specifier.startsWith("../src/") || specifier === "../src/cli.js";
        expect({ file: rel(path), specifier, allowed: local || specifier.startsWith("node:") })
          .toEqual({ file: rel(path), specifier, allowed: true });
        expect({ file: rel(path), specifier, lobby: /lobby\/|collab|execution-seat|@agenttool\/|(?:^|\/)api\/|(?:^|\/)docs\//.test(specifier) })
          .toEqual({ file: rel(path), specifier, lobby: false });
      }
    }
  });
});
