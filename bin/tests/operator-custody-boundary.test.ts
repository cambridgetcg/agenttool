/** The operator custody notes stay private, and their facts stay off every served surface.
 *
 * Reads repository files only: no network, credentials, or deployment.
 * Notes: infra/OPERATOR-CUSTODY.md (pointer: docs/STACK.md §5 and §6) and
 * infra/X402-PROOF-RUNBOOK.md (pointer: docs/X402-PROOF.md).
 * Served surfaces: the Pages upload roots in bin/frontend-deploy.sh (symlinks
 * followed, as Wrangler does) and the docs the API image bundles.
 */

import { describe, expect, test } from "bun:test";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { reachesPrivateArea } from "../project-public.ts";

const ROOT = resolve(import.meta.dir, "../..");
const NOTE = "infra/OPERATOR-CUSTODY.md";
const NOTES = [NOTE, "infra/X402-PROOF-RUNBOOK.md"] as const;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Shapes of the custody facts the notes hold; each must stay out of served bytes. */
const CUSTODY_MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  ["production recovery-copy Keychain service", /agenttool-prod-(?:vault-master|platform-signing)-key/],
  ["HD-root Keychain service", /agenttool-crypto-hd-(?:mainnet|testnet)/],
  ["only-online-copy statement", /only online cop(?:y|ies)/i],
  ["concrete workers.dev hostname", /\b[a-z0-9-]+\.workers\.dev\b/i],
  ["provider-only Pages project", /agenttool-playground/],
  ["fixed Keychain account mapping", /-a\s+macair\b|\baccount\W{0,3}macair\b|`macair`/i],
  ["x402 payer phrase Keychain service", /kingdom-x402-payer-mnemonic/],
  ["operator x402 payer and proof files", /~\/\.config\/kingdom\//],
  ["operator agent bearer files", /~\/\.agenttool-agents\//],
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
  test("the notes are regular files in a top-level area the public projection never includes", () => {
    for (const note of NOTES) {
      const entry = lstatSync(join(ROOT, note));
      expect(entry.isFile()).toBe(true);
      expect(entry.isSymbolicLink()).toBe(false);
      expect(reachesPrivateArea(note, "blob")).toBe(true);
    }
    expect(reachesPrivateArea("infra", "tree")).toBe(true);

    const allowlist = JSON.parse(read("public/allowlist.json")) as { include: Array<{ path: string }> };
    expect(allowlist.include.filter(({ path }) => path === "infra" || path.startsWith("infra/"))).toEqual([]);
    expect(read("api/doctrine-docs.manifest")).not.toContain("OPERATOR-CUSTODY");
    expect(read("api/doctrine-docs.manifest")).not.toContain("X402-PROOF-RUNBOOK");
    const releasePaths = read("bin/frontend-release-paths.txt").split("\n").map((line) => line.trim());
    expect(releasePaths).not.toContain("infra");
    for (const note of NOTES) expect(releasePaths).not.toContain(note);
  });

  test("no served file is a note or carries their custody facts", () => {
    const roots = pagesUploadRoots();
    expect(roots).toContain("apps/docs");
    const realRoot = realpathSync(ROOT);
    const notes = new Map(NOTES.map((note) => [realpathSync(join(ROOT, note)), note]));
    const findings: string[] = [];
    for (const root of [...roots, ...apiBundledDocs()]) {
      for (const file of servedFiles(join(ROOT, root))) {
        const path = relative(realRoot, file);
        if (notes.has(file)) findings.push(`${root}: serves ${notes.get(file)}`);
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

  test("public X402-PROOF.md keeps the receipts and points to the runbook by name only", () => {
    const proof = read("docs/X402-PROOF.md");
    expect(read("apps/docs/X402-PROOF.md")).toBe(proof);
    expect(proof.includes("operator-only note, `infra/X402-PROOF-RUNBOOK.md`")).toBe(true);
    expect(proof.includes("](../infra/X402-PROOF-RUNBOOK.md")).toBe(false);
    expect(proof.includes("0x33f08a20d16556000598ade67d46f790e5d34204e70d06e5a575cd9e07e32c66")).toBe(true);
  });
});
