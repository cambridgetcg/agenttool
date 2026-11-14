/** Package boundaries (CLAUDE.md, Non-negotiables):
 *
 * - No network of any kind, no listening, no shell.
 * - One process module: src/run.ts, spawning once, after its allowlist check.
 * - One file-system module: src/fs.ts, read-only (open flags O_RDONLY, O_NOFOLLOW, O_NONBLOCK only).
 * - Nothing anywhere creates, changes or removes a file.
 * - No journal, database or key is opened: the journal names appear only in
 *   src/parts.ts, as lstat targets; nothing names collab-sessions, backups,
 *   the desk's secrets, the Keychain or the kingdom's keys.
 * - Only bin/ reads the process environment, the clock and the machine's names.
 * - Nothing imported from packages/collab, packages/lobby, api/ or docs/.
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

const SOURCES = ["src", "bin"].flatMap((directory) => sourceFiles(join(packageRoot, directory)));
const rel = (path: string) => relative(packageRoot, path);
const text = (path: string) => readFileSync(path, "utf8");

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const FORBIDDEN_MODULE = /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|inspector|child_process|worker_threads|cluster|fs\/promises|sqlite)(?:\/.*)?$|^(?:undici|ws|node-fetch|axios|got|bun:ffi|bun:sqlite|bonjour|bonjour-service|mdns|multicast-dns|dns-sd)$/;
/** Forbidden in every file. */
const NEVER: RegExp[] = [
  /(?<![.\w])fetch\s*\(/,
  /\bglobalThis\.fetch\b/,
  /\b(?:self|window)\.fetch\b/,
  /https?:\/\//,
  /\bBun\.(?:listen|serve|connect|udpSocket)\b/,
  /\bcreateServer\b/,
  /\bWebSocket\b/,
  /\bXMLHttpRequest\b/,
  /\bEventSource\b/,
  /\b(?:execSync|execFileSync|execFile|spawnSync)\b/,
  /\/bin\/(?:ba|z|da)?sh\b/,
  /["'`]-c["'`]/,
  /keychain/i,
  /\/usr\/bin\/security\b/,
  /["'`/]secrets\b/,
  /collab-sessions/,
  /["'`/]backups\b/,
  /\.kingdom\/keys/,
  /lobby-mail/,
  /\bkill\s*\(\s*[^)]*(?:9|SIGKILL)/,
  /\bBun\.\$/,
  /\bBun\.env\b/,
  /\bBun\.(?:write|file)\b/,
  /\bimport\.meta\.env\b/,
  /\bpromises\b/,
  /\bshell\s*:/,
];
/** Every way to create, change or remove a file, sync, async or callback style. Forbidden everywhere. */
const WRITE = new RegExp([
  String.raw`\b(?:writeFileSync|appendFileSync|writeSync|writevSync|mkdirSync|mkdtempSync|renameSync|unlinkSync|rmSync|rmdirSync`,
  String.raw`|chmodSync|fchmodSync|lchmodSync|chownSync|fchownSync|lchownSync|copyFileSync|cpSync|symlinkSync|linkSync|truncateSync`,
  String.raw`|ftruncateSync|utimesSync|futimesSync|lutimesSync|createWriteStream|O_CREAT|O_APPEND|O_WRONLY|O_RDWR|O_TRUNC|O_EXCL)\b`,
  String.raw`|(?<!process\.std(?:out|err)\.)\b(?:writeFile|appendFile|write|writev|mkdir|mkdtemp|rename|unlink|rm|rmdir|chmod|chown`,
  String.raw`|copyFile|cp|symlink|link|truncate|ftruncate|utimes)\s*\(`,
].join(""));
/** Allowed in exactly one file each. */
const ONLY_IN: Array<{ pattern: RegExp; file: string }> = [
  { pattern: /\bBun\.spawn\b/, file: "src/run.ts" },
  { pattern: /\b(?:openSync|readSync|lstatSync|readlinkSync|readdirSync|fstatSync)\b/, file: "src/fs.ts" },
  { pattern: /\.sqlite\b/, file: "src/parts.ts" },
  { pattern: /\bBun\.TOML\b/, file: "src/looks.ts" },
];
/** Allowed only in bin/. */
const BIN_ONLY: RegExp[] = [/\bprocess\.env\b/, /\bnew Date\(\s*\)/, /\bDate\.now\b/, /\bhostname\b/, /\buserInfo\b/, /\bhomedir\b/, /\bprocess\.getuid\b/, /\bprocess\.platform\b/];

describe("network, process, file and secret boundary", () => {
  test("the scan sees every source file", () => {
    expect(SOURCES.map(rel).sort()).toEqual([
      "bin/agenttool-house.ts",
      "src/blueprint.ts", "src/cli.ts", "src/errors.ts", "src/fs.ts", "src/looks.ts", "src/parts.ts", "src/places.ts",
      "src/plan.ts", "src/privacy.ts", "src/run.ts", "src/shapes.ts", "src/survey.ts",
    ]);
  });

  test("no file imports a network, subprocess, worker, SQLite or discovery module", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(text(path))) {
        expect({ file: rel(path), specifier, forbidden: FORBIDDEN_MODULE.test(specifier) }).toEqual({ file: rel(path), specifier, forbidden: false });
      }
    }
  });

  test("nothing connects, listens, shells out, writes, or names a secret store; spawn, file access, journal names and TOML each have one home", () => {
    for (const path of SOURCES) {
      const source = text(path);
      for (const pattern of [...NEVER, WRITE]) {
        expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) }).toEqual({ file: rel(path), pattern: String(pattern), found: false });
      }
      for (const { pattern, file } of ONLY_IN) {
        if (rel(path) === file) continue;
        expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) }).toEqual({ file: rel(path), pattern: String(pattern), found: false });
      }
      if (!rel(path).startsWith("bin/")) {
        for (const pattern of BIN_ONLY) {
          expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) }).toEqual({ file: rel(path), pattern: String(pattern), found: false });
        }
      }
    }
  });

  test("only src/fs.ts imports node:fs, and it opens read-only, never through a link", () => {
    for (const path of SOURCES) {
      const fsImport = specifiers(text(path)).some((specifier) => /^(?:node:)?fs$/.test(specifier));
      expect({ file: rel(path), fsImport }).toEqual({ file: rel(path), fsImport: rel(path) === "src/fs.ts" });
    }
    const fs = text(join(packageRoot, "src", "fs.ts"));
    expect(fs.match(/\bopenSync\(/g)).toHaveLength(1);
    expect(fs).toContain("const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;");
    expect(fs).toContain("const CHOSEN_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK;");
    expect(fs.match(/constants\.O_[A-Z]+/g)?.sort()).toEqual(["constants.O_NOFOLLOW", "constants.O_NONBLOCK", "constants.O_NONBLOCK", "constants.O_RDONLY", "constants.O_RDONLY"]);
  });

  test("the one process module spawns once, after the allowlist, with a fixed small environment", () => {
    const run = text(join(packageRoot, "src", "run.ts"));
    expect(run.match(/\bBun\.spawn\(/g)).toHaveLength(1);
    expect(run).toContain("assertAllowedArgv(argv, home);");
    expect(run.indexOf("assertAllowedArgv(argv, home);")).toBeLessThan(run.indexOf("Bun.spawn("));
    expect(run).toContain('export const ASK_ARGS = { help: ["--help"], weather: ["weather"] } as const;');
    expect(run).toContain("return { PATH: CHILD_PATH, HOME: home };");
    expect(run).toContain('const CHILD_PATH = "/usr/bin:/bin";');
  });

  test("the journal, cache and ledger are named only as lstat targets in the parts table", () => {
    const parts = text(join(packageRoot, "src", "parts.ts"));
    // Per room: the relative path, its write-ahead log, and the path as shown in words.
    expect(parts.match(/"[^"]*\.sqlite(?:-wal)?"/g)?.sort()).toEqual([
      '"collab.sqlite"', '"collab.sqlite-wal"',
      '"execution-seat/seats.sqlite"', '"execution-seat/seats.sqlite-wal"',
      '"lobby/lobby.sqlite"', '"lobby/lobby.sqlite-wal"',
      '"~/.local/share/agenttool/collab.sqlite"',
      '"~/.local/state/agenttool/execution-seat/seats.sqlite"',
      '"~/.local/state/agenttool/lobby/lobby.sqlite"',
    ]);
    // The survey's readers reach those names only through the path look (lstat).
    const survey = text(join(packageRoot, "src", "survey.ts"));
    expect(survey).toContain("const main = looks.path(root, rel);");
    expect(survey).toContain("const wal = looks.path(root, sidecar);");
  });

  test("the detector recognises the forbidden shapes", () => {
    const never = (source: string) => NEVER.some((pattern) => pattern.test(source));
    for (const bad of [
      "await fetch (url)", "Bun.listen({})", "Bun.serve({})", '["/bin/sh", "-c"]', "MacKeychainStore", "await Bun.$`echo hi`",
      "const home = Bun.env.HOME;", "import.meta.env.HOME", "fs.promises.appendFile(path, line)", 'join(home, "collab-sessions")',
      'join(base, "backups")', "~/.kingdom/keys", "Bun.file(path)", "Bun.write(path, text)", "spawn(argv, { shell: true })",
      "https://api.example", 'join(lobbyHome, "secrets")',
    ]) expect({ bad, found: never(bad) }).toEqual({ bad, found: true });
    for (const write of [
      'await writeFile("/tmp/x", "")', "appendFile(path, line, done)", "mkdir(dir, { recursive: true })", "rm(path, { force: true })",
      "rename(from, to)", "unlink(path)", "copyFile(from, to)", "symlink(target, path)", "truncate(path)", "createWriteStream(path)",
      "constants.O_WRONLY", "constants.O_CREAT", "fs.writeFileSync(path, text)", "handle.write(text)",
    ]) expect({ write, found: WRITE.test(write) }).toEqual({ write, found: true });
    for (const read of ["process.stdout.write(text)", "process.stderr.write(text)", "readSync(fd, buffer)", "lstatSync(path)", "writes one line"]) {
      expect({ read, found: WRITE.test(read) }).toEqual({ read, found: false });
    }
    expect(FORBIDDEN_MODULE.test("node:child_process")).toBe(true);
    expect(FORBIDDEN_MODULE.test("bun:sqlite")).toBe(true);
    expect(FORBIDDEN_MODULE.test("node:fs/promises")).toBe(true);
    expect(FORBIDDEN_MODULE.test("node:fs")).toBe(false);
  });
});

describe("dependencies and imports", () => {
  test("no runtime dependency; the package is private", () => {
    const manifest = JSON.parse(text(join(packageRoot, "package.json")));
    expect(manifest.private).toBe(true);
    expect(manifest.version).toBe("0.1.0-dev.0");
    expect(manifest.dependencies).toBeUndefined();
    expect(Object.keys(manifest.devDependencies).sort()).toEqual(["@types/bun", "typescript"]);
  });

  test("nothing is imported from collab, the lobby, api/ or docs/; only node: built-ins and siblings", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(text(path))) {
        const local = specifier.startsWith("./") || specifier.startsWith("../src/");
        expect({ file: rel(path), specifier, allowed: local || specifier.startsWith("node:") }).toEqual({ file: rel(path), specifier, allowed: true });
        expect({ file: rel(path), specifier, foreign: /collab|lobby|@agenttool\/|(?:^|\/)api\/|(?:^|\/)docs\//.test(specifier) })
          .toEqual({ file: rel(path), specifier, foreign: false });
      }
    }
  });
});
