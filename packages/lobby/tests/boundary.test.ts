/** Package boundaries: no network code, no subprocesses, and a read-only
 * MCP surface whose registered tools match the documented three. */
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
const NETWORK_CALL = [
  /\bfetch\s*\(/,
  /\bWebSocket\b/,
  /\bXMLHttpRequest\b/,
  /\bEventSource\b/,
  /\bBun\.(?:connect|listen|serve|udpSocket|spawn|spawnSync)\b/,
  /\bnavigator\.sendBeacon\b/,
];

describe("no network code in this package", () => {
  test("the scan sees every source file", () => {
    const names = SOURCES.map((path) => relative(packageRoot, path)).sort();
    expect(names).toContain("src/egress.ts");
    expect(names).toContain("src/mcp.ts");
    expect(names).toContain("bin/agenttool-lobby.ts");
    expect(names).toContain("bin/agenttool-lobby-mcp.ts");
  });

  test("src/ and bin/ import no fetch, http, https, net, tls, dgram or node:net", () => {
    for (const path of SOURCES) {
      const source = readFileSync(path, "utf8");
      for (const specifier of specifiers(source)) {
        expect({ file: relative(packageRoot, path), specifier, network: NETWORK_MODULE.test(specifier) })
          .toEqual({ file: relative(packageRoot, path), specifier, network: false });
        expect({ file: relative(packageRoot, path), specifier, transport: OTHER_TRANSPORT_MODULE.test(specifier) })
          .toEqual({ file: relative(packageRoot, path), specifier, transport: false });
      }
      for (const pattern of NETWORK_CALL) {
        expect({ file: relative(packageRoot, path), pattern: String(pattern), found: pattern.test(source) })
          .toEqual({ file: relative(packageRoot, path), pattern: String(pattern), found: false });
      }
    }
  });

  test("the detector itself recognises the forbidden shapes", () => {
    for (const bad of ["node:net", "net", "http", "https", "node:https", "tls", "dgram", "node:dgram", "node:http2"]) {
      expect(NETWORK_MODULE.test(bad)).toBe(true);
    }
    expect(specifiers('import { connect } from "node:net";\nconst x = await import("https");')).toEqual(["node:net", "https"]);
    expect(NETWORK_CALL[0]!.test("await fetch (url)")).toBe(true);
    expect(NETWORK_MODULE.test("node:fs")).toBe(false);
    expect(NETWORK_MODULE.test("node:tty")).toBe(false);
  });

  test("only the documented dependencies are declared", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(manifest.private).toBe(true);
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["@modelcontextprotocol/server", "zod"]);
  });
});
