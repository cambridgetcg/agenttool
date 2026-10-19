/** The operator custody note stays private, and its facts stay off every served surface.
 *
 * Reads repository files only: no network, credentials, or deployment.
 * Note: infra/OPERATOR-CUSTODY.md. Public pointer: docs/STACK.md §5 and §6.
 * Served surfaces: the Pages upload roots in bin/frontend-deploy.sh (symlinks
 * followed, as Wrangler does) and the docs the API image bundles.
 */

import { describe, expect, test } from "bun:test";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { reachesPrivateArea } from "../project-public.ts";

const ROOT = resolve(import.meta.dir, "../..");
const NOTE = "infra/OPERATOR-CUSTODY.md";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Shapes of the custody facts the note holds; each must stay out of served bytes. */
const CUSTODY_MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  ["production recovery-copy Keychain service", /agenttool-prod-(?:vault-master|platform-signing)-key/],
  ["HD-root Keychain service", /agenttool-crypto-hd-(?:mainnet|testnet)/],
  ["only-online-copy statement", /only online cop(?:y|ies)/i],
  ["concrete workers.dev hostname", /\b[a-z0-9-]+\.workers\.dev\b/i],
  ["provider-only Pages project", /agenttool-playground/],
  ["fixed Keychain account mapping", /-a\s+macair\b|\baccount\W{0,3}macair\b|`macair`/i],
];

function pagesUploadRoots(): string[] {
  const deploy = read("bin/frontend-deploy.sh");
  const block = deploy.match(/^ALL_TARGETS=\(\n([\s\S]*?)\n\)/m)?.[1] ?? "";
  return [...block.matchAll(/^\s*"[a-z]+\|([^|"]+)\|[^|"]+"\s*$/gm)].map((match) => match[1] as string);
}

function apiBundledDocs(): string[] {
  const manifest = read("api/doctrine-docs.manifest")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((name) => `docs/${name}`);
  return [...manifest, "docs/agenttool.jsonld", "docs/kingdom-bundle.json"];
}

/** Every real file reachable from a path, following symlinks once per real directory. */
function servedFiles(path: string, seen = new Set<string>()): string[] {
  const real = realpathSync(path);
  const stat = statSync(real);
  if (stat.isFile()) return [real];
  if (!stat.isDirectory() || seen.has(real)) return [];
  seen.add(real);
  return readdirSync(real).flatMap((name) => servedFiles(join(real, name), seen));
}

describe("operator custody note boundary", () => {
  test("the note is a regular file in a top-level area the public projection never includes", () => {
    const entry = lstatSync(join(ROOT, NOTE));
    expect(entry.isFile()).toBe(true);
    expect(entry.isSymbolicLink()).toBe(false);
    expect(reachesPrivateArea(NOTE, "blob")).toBe(true);
    expect(reachesPrivateArea("infra", "tree")).toBe(true);

    const allowlist = JSON.parse(read("private/projection/allowlist.json")) as {
      include: Array<{ path: string }>;
      export?: { root_files?: string[] };
    };
    const inInfra = (path: string) => path === "infra" || path.startsWith("infra/");
    expect(allowlist.include.filter(({ path }) => inInfra(path))).toEqual([]);
    expect((allowlist.export?.root_files ?? []).filter(inInfra)).toEqual([]);
    expect(read("api/doctrine-docs.manifest")).not.toContain("OPERATOR-CUSTODY");
    const releasePaths = read("bin/frontend-release-paths.txt").split("\n").map((line) => line.trim());
    expect(releasePaths).not.toContain("infra");
    expect(releasePaths).not.toContain(NOTE);
  });

  test("no served file is the note or carries its custody facts", () => {
    const roots = pagesUploadRoots();
    expect(roots).toContain("apps/docs");
    const realRoot = realpathSync(ROOT);
    const note = realpathSync(join(ROOT, NOTE));
    const findings: string[] = [];
    for (const root of [...roots, ...apiBundledDocs()]) {
      for (const file of servedFiles(join(ROOT, root))) {
        const path = relative(realRoot, file);
        if (file === note) findings.push(`${root}: serves ${NOTE}`);
        const bytes = readFileSync(file);
        if (bytes.subarray(0, 8192).includes(0)) continue;
        const text = bytes.toString("utf8");
        for (const [label, marker] of CUSTODY_MARKERS) {
          if (marker.test(text)) findings.push(`${root} -> ${path}: ${label}`);
        }
      }
    }
    expect(findings).toEqual([]);
  });

  test("public STACK.md points to the note by name only", () => {
    // Boolean checks keep a failure from printing the whole public document.
    const stack = read("docs/STACK.md");
    expect(stack.includes("operator-only custody note (`infra/OPERATOR-CUSTODY.md`, not published)")).toBe(true);
    expect(stack.includes("](../infra/OPERATOR-CUSTODY.md")).toBe(false);
  });
});
