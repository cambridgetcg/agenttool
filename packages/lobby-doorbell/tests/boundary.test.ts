/** Package boundaries (CLAUDE.md, Non-negotiables):
 *
 * - No listening socket of any kind, and no socket connect at all in PR 1.
 * - One HTTP call site: src/health.ts, through an injected fetchImpl; only the
 *   bin names the runtime's fetch; the only URL literal is the origin constant.
 * - One process module: src/run.ts, with no shell.
 * - No Keychain, no lobby secrets, no lobby database; in the lobby home only STOP.
 * - Writes only in src/home.ts (the log line); nothing imported from the lobby, api/ or docs/.
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

const FORBIDDEN_MODULE = /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|inspector|child_process|worker_threads|cluster)(?:\/.*)?$|^(?:undici|ws|node-fetch|axios|got|bun:ffi|bun:sqlite|bonjour|bonjour-service|mdns|multicast-dns|dns-sd)$/;
/** Forbidden in every file. */
const NEVER: RegExp[] = [
  /(?<![.\w])fetch\s*\(/,
  /\b(?:self|window)\.fetch\b/,
  /\bBun\.(?:listen|serve|connect|udpSocket)\b/,
  /\bcreateServer\b/,
  /\bWebSocket\b/,
  /\bXMLHttpRequest\b/,
  /\bEventSource\b/,
  /\bnavigator\.sendBeacon\b/,
  /\b(?:execSync|execFileSync|execFile|spawnSync)\b/,
  /\/bin\/(?:ba|z|da)?sh\b/,
  /["'`]-c["'`]/,
  /keychain/i,
  /\/usr\/bin\/security\b/,
  /\.sqlite\b/,
  /["'`/]secrets\b/,
  /\bkill\s*\(\s*[^)]*(?:9|SIGKILL)/,
];
/** Allowed in exactly one file each. */
const ONLY_IN: Array<{ pattern: RegExp; file: string }> = [
  { pattern: /\bglobalThis\.fetch\b/, file: "bin/agenttool-lobby-doorbell.ts" },
  { pattern: /\bfetchImpl\s*\(/, file: "src/health.ts" },
  { pattern: /https?:\/\//, file: "src/health.ts" },
  { pattern: /\bBun\.spawn\b/, file: "src/run.ts" },
  { pattern: /\b(?:writeFileSync|appendFileSync|writeSync|mkdirSync|renameSync|unlinkSync|rmSync|rmdirSync|chmodSync|O_CREAT|O_APPEND|Bun\.write)\b/, file: "src/home.ts" },
];

describe("network, process and write boundary", () => {
  test("the scan sees every source file", () => {
    expect(SOURCES.map(rel).sort()).toEqual([
      "bin/agenttool-lobby-doorbell.ts", "contract/check.ts", "contract/lobby-contract.ts",
      "src/cli.ts", "src/errors.ts", "src/health.ts", "src/home.ts", "src/lobby-cli.ts", "src/netcheck.ts", "src/probes.ts", "src/run.ts",
    ]);
  });

  test("no file imports a network, subprocess, worker, SQLite or discovery module", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(text(path))) {
        expect({ file: rel(path), specifier, forbidden: FORBIDDEN_MODULE.test(specifier) }).toEqual({ file: rel(path), specifier, forbidden: false });
      }
    }
  });

  test("nothing listens, connects, shells out, names the Keychain or lobby secrets; fetch, spawn, URLs and writes each have one home", () => {
    for (const path of SOURCES) {
      const source = text(path);
      for (const pattern of NEVER) {
        expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) }).toEqual({ file: rel(path), pattern: String(pattern), found: false });
      }
      for (const { pattern, file } of ONLY_IN) {
        if (rel(path) === file) continue;
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

  test("the one process module spawns once, with an allowlist and no shell", () => {
    const run = text(join(packageRoot, "src", "run.ts"));
    expect(run.match(/\bBun\.spawn\(/g)).toHaveLength(1);
    expect(run).toContain("assertAllowedArgv(argv, lobbyEntry);");
    expect(run.indexOf("assertAllowedArgv(argv, lobbyEntry);")).toBeLessThan(run.indexOf("Bun.spawn("));
    expect(run).toContain('export const MULLVAD_PATHS = ["/usr/local/bin/mullvad", "/opt/homebrew/bin/mullvad"] as const;');
    expect(run).toContain('export const PS_PATH = "/bin/ps";');
    expect(run).toContain('const env: Record<string, string> = { PATH: "/usr/bin:/bin" };');
    expect(run).not.toMatch(/shell\s*:/);
  });

  test("only bin/ reads the process environment; library code takes it as a value", () => {
    for (const path of SOURCES.filter((file) => rel(file).startsWith("src/"))) {
      expect({ file: rel(path), env: /\bprocess\.env\b/.test(text(path)) }).toEqual({ file: rel(path), env: false });
    }
  });

  test("inside the lobby home only STOP is named", () => {
    for (const path of SOURCES.filter((file) => rel(file).startsWith("src/"))) {
      for (const match of text(path).matchAll(/join\(\s*lobbyHome\s*,\s*([^)]*)\)/g)) {
        expect({ file: rel(path), joined: match[1]!.trim() }).toEqual({ file: rel(path), joined: "STOP_FILE" });
      }
    }
    expect(text(join(packageRoot, "src", "home.ts"))).toContain('export const STOP_FILE = "STOP";');
  });

  test("the detector recognises the forbidden shapes", () => {
    expect(NEVER[0]!.test("await fetch (url)")).toBe(true);
    expect(NEVER[0]!.test("options.fetchImpl(url)")).toBe(false);
    expect(NEVER[2]!.test("Bun.listen({})")).toBe(true);
    expect(NEVER[2]!.test("Bun.serve({})")).toBe(true);
    expect(NEVER[9]!.test('["/bin/sh", "-c"]')).toBe(true);
    expect(NEVER[11]!.test("MacKeychainStore")).toBe(true);
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

  test("nothing is imported from the lobby package, api/ or docs/; only node: built-ins and siblings", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(text(path))) {
        const local = specifier.startsWith("./") || specifier.startsWith("../src/") || specifier === "../src/cli.js";
        expect({ file: rel(path), specifier, allowed: local || specifier.startsWith("node:") })
          .toEqual({ file: rel(path), specifier, allowed: true });
        expect({ file: rel(path), specifier, lobby: /lobby\/|@agenttool\/|(?:^|\/)api\/|(?:^|\/)docs\//.test(specifier) })
          .toEqual({ file: rel(path), specifier, lobby: false });
      }
    }
  });
});
