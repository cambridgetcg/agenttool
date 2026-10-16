/** Package boundaries.
 *
 * - No network module is imported anywhere. The only HTTP path is
 *   src/hosted.ts, through an injected `fetchImpl`; only
 *   bin/agenttool-lobby.ts hands it the runtime's fetch.
 * - The only process the package starts is /usr/bin/security, from
 *   src/keychain.ts.
 * - The MCP server's import graph reaches no transport, Keychain, desk
 *   secret or signing code, and its registered tools are the documented three.
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

const SOURCES = [...sourceFiles(join(packageRoot, "src")), ...sourceFiles(join(packageRoot, "bin"))];
const rel = (path: string) => relative(packageRoot, path);

/** Every module specifier in static imports, re-exports, dynamic imports and require(). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const NETWORK_MODULE = /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|inspector)(?:\/.*)?$/;
const OTHER_TRANSPORT_MODULE = /^(?:undici|ws|node-fetch|axios|got|bun:ffi|node:child_process|child_process|worker_threads|node:worker_threads|cluster|node:cluster)$/;
/** Forbidden in every file. */
const NEVER = [
  /(?<![.\w])fetch\s*\(/,
  /\b(?:self|window)\.fetch\b/,
  /\bWebSocket\b/,
  /\bXMLHttpRequest\b/,
  /\bEventSource\b/,
  /\bBun\.(?:connect|listen|serve|udpSocket)\b/,
  /\bnavigator\.sendBeacon\b/,
];
/** Allowed in exactly one file each. */
const ONLY_IN: Array<{ pattern: RegExp; file: string }> = [
  { pattern: /\bglobalThis\.fetch\b/, file: "bin/agenttool-lobby.ts" },
  { pattern: /\bBun\.(?:spawn|spawnSync)\b/, file: "src/keychain.ts" },
  { pattern: /\bFileSecretStore\b/, file: "src/keychain.ts" },
];

function localClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiers(readFileSync(join(packageRoot, file), "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const resolved = rel(join(packageRoot, file, "..", specifier.replace(/\.js$/, ".ts")));
      pending.push(resolved);
    }
  }
  return seen;
}

describe("network and process boundary", () => {
  test("the scan sees every source file", () => {
    const names = SOURCES.map(rel).sort();
    for (const name of ["src/egress.ts", "src/mcp.ts", "src/hosted.ts", "src/keychain.ts", "bin/agenttool-lobby.ts", "bin/agenttool-lobby-mcp.ts"]) {
      expect(names).toContain(name);
    }
  });

  test("src/ and bin/ import no network, subprocess or worker module", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(readFileSync(path, "utf8"))) {
        expect({ file: rel(path), specifier, network: NETWORK_MODULE.test(specifier), transport: OTHER_TRANSPORT_MODULE.test(specifier) })
          .toEqual({ file: rel(path), specifier, network: false, transport: false });
      }
    }
  });

  test("no file calls fetch directly or opens sockets; fetch and spawn each have one home", () => {
    for (const path of SOURCES) {
      const source = readFileSync(path, "utf8");
      for (const pattern of NEVER) {
        expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) })
          .toEqual({ file: rel(path), pattern: String(pattern), found: false });
      }
      for (const { pattern, file } of ONLY_IN) {
        if (rel(path) === file) continue;
        expect({ file: rel(path), pattern: String(pattern), found: pattern.test(source) })
          .toEqual({ file: rel(path), pattern: String(pattern), found: false });
      }
    }
  });

  test("the transport takes its fetch by injection and names the pinned origin once", () => {
    const hosted = readFileSync(join(packageRoot, "src", "hosted.ts"), "utf8");
    expect(hosted).toContain("options.fetchImpl(");
    expect(hosted).not.toMatch(/\bglobalThis\b/);
    const wire = readFileSync(join(packageRoot, "src", "wire.ts"), "utf8");
    expect(wire).toContain('export const LOBBY_ORIGIN = "https://api.agenttool.dev" as const;');
    for (const path of SOURCES) {
      const source = readFileSync(path, "utf8");
      // No environment variable or flag can redirect the origin.
      expect({ file: rel(path), env: /process\.env\.[A-Z_]*(?:ORIGIN|URL|ENDPOINT|KEYCHAIN|FETCH)/.test(source) })
        .toEqual({ file: rel(path), env: false });
    }
  });

  test("the only process started is /usr/bin/security with fixed arguments", () => {
    const keychain = readFileSync(join(packageRoot, "src", "keychain.ts"), "utf8");
    expect(keychain).toContain('export const SECURITY_TOOL = "/usr/bin/security";');
    expect(keychain.match(/\bBun\.spawn\(/g)).toHaveLength(1);
    expect(keychain).toContain("Bun.spawn([SECURITY_TOOL, ...args]");
    // A secret is only ever written to the child's stdin, after "-i".
    expect(keychain).toContain('await this.run(["-i"], `add-generic-password -s ${service} -a ${account} -w ${secret}\\n`);');
    expect(keychain).toContain('stderr: "ignore"');
  });

  test("the production CLI uses the Keychain store; the file store is test-only", () => {
    const bin = readFileSync(join(packageRoot, "bin", "agenttool-lobby.ts"), "utf8");
    expect(bin).toContain("keychain: new MacKeychainStore()");
    expect(bin).not.toContain("FileSecretStore");
  });

  test("the detector itself recognises the forbidden shapes", () => {
    for (const bad of ["node:net", "net", "http", "https", "node:https", "tls", "dgram", "node:dgram", "node:http2"]) {
      expect(NETWORK_MODULE.test(bad)).toBe(true);
    }
    expect(specifiers('import { connect } from "node:net";\nconst x = await import("https");')).toEqual(["node:net", "https"]);
    expect(NEVER[0]!.test("await fetch (url)")).toBe(true);
    expect(NEVER[0]!.test("options.fetchImpl(url)")).toBe(false);
    expect(NEVER[0]!.test("x.fetch(url)")).toBe(false);
    expect(ONLY_IN[0]!.pattern.test("globalThis.fetch(url, init)")).toBe(true);
    expect(NETWORK_MODULE.test("node:fs")).toBe(false);
    expect(NETWORK_MODULE.test("node:tty")).toBe(false);
  });
});

describe("read-only MCP boundary", () => {
  test("the MCP server's import graph reaches no transport, Keychain, desk secret or act code", () => {
    const closure = localClosure("bin/agenttool-lobby-mcp.ts");
    for (const forbidden of ["src/hosted.ts", "src/keychain.ts", "src/secrets.ts", "src/ops.ts", "src/desk.ts",
      "src/hub.ts", "src/hub-access.ts", "src/talk.ts", "src/digest.ts", "src/cli.ts", "src/cli-fleet.ts",
      "src/cli-table.ts", "src/packets.ts", "src/tty.ts"]) {
      expect({ forbidden, reached: closure.has(forbidden) }).toEqual({ forbidden, reached: false });
    }
    expect(closure.has("src/fleet.ts")).toBe(true);
    expect(closure.has("src/signed.ts")).toBe(true);
    expect(closure.has("src/table.ts")).toBe(true);
  });

  test("signing helpers reachable from MCP only verify; sealDocument is never called there", () => {
    for (const file of ["mcp.ts", "fleet.ts", "table.ts", "device-terms.ts"]) {
      const source = readFileSync(join(packageRoot, "src", file), "utf8");
      expect({ file, signs: /\bsealDocument\b|\bsignBytes\b|\brecordAct\b|\binsertPinWithinAct\b|\bsendPost\b|\bprepareObservation\b/.test(source) })
        .toEqual({ file, signs: false });
    }
  });

  test("the MCP view writes nothing: no SQLite write, file write or mkdir in its own modules", () => {
    for (const file of ["mcp.ts", "table.ts", "device-terms.ts"]) {
      const source = readFileSync(join(packageRoot, "src", file), "utf8");
      expect({ file, writes: /\bLobbyStore\.open\(|writeFileSync|writeNewPrivateFile|mkdirSync|\.run\(|INSERT |UPDATE |DELETE /.test(source) })
        .toEqual({ file, writes: false });
    }
  });
});

describe("dependencies and subpaths", () => {
  test("only the documented dependencies are declared", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(manifest.private).toBe(true);
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["@modelcontextprotocol/server", "zod"]);
  });

  test("the ./egress subpath loads the pure gate and no dependency", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(manifest.exports["./egress"]).toBe("./src/egress.ts");
    const seen = new Set<string>();
    const pending = ["src/egress.ts"];
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of specifiers(readFileSync(join(packageRoot, file), "utf8"))) {
        // Only sibling modules: no SDK, zod, SQLite or Node built-ins.
        expect({ file, specifier, local: specifier.startsWith("./") }).toEqual({ file, specifier, local: true });
        pending.push(join("src", specifier.replace(/\.js$/, ".ts")));
      }
    }
    expect([...seen].sort()).toEqual(["src/egress.ts", "src/errors.ts", "src/text.ts"]);
  });

  test("the package imports nothing from the API or bin/ trees", () => {
    for (const path of SOURCES) {
      for (const specifier of specifiers(readFileSync(path, "utf8"))) {
        expect({ file: rel(path), specifier, outside: /(?:^|\/)\.\.\/\.\.\/|(?:^|\/)api\//.test(specifier) })
          .toEqual({ file: rel(path), specifier, outside: false });
      }
    }
  });
});
