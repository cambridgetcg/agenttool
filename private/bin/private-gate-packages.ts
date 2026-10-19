#!/usr/bin/env bun
/**
 * The private-only packages the merge-back gate must run. Read
 * private/README.md first.
 *
 *   bun private/bin/private-gate-packages.ts [--root <dir>]
 *
 * Prints, one per line and sorted, every package directory under packages/
 * that is outside the shared scope (the export allowlist), has a `ci`
 * script, and depends, directly or through other packages, on a shared
 * package by a `file:` dependency. A public change to a shared package can
 * break such a package although no shared test sees it, so
 * `bin/preflight.sh private` runs each one's `bun run ci`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exportMatcher, parseExportConfig } from "./shared-scope.ts";
import { ALLOWLIST_PATH, parseAllowlist } from "../../bin/project-public.ts";

type Manifest = { scripts?: Record<string, string> } & Record<string, unknown>;

export function privateGatePackages(root: string): string[] {
  const inScope = exportMatcher(parseExportConfig(parseAllowlist(readFileSync(join(root, ALLOWLIST_PATH)))));
  const manifests = new Map<string, Manifest>();
  for (const name of readdirSync(join(root, "packages")).sort()) {
    const path = join(root, "packages", name, "package.json");
    if (existsSync(path)) manifests.set(name, JSON.parse(readFileSync(path, "utf8")) as Manifest);
  }
  const shared = (name: string) => inScope(`packages/${name}/package.json`);
  const local = (manifest: Manifest): string[] => {
    const names: string[] = [];
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const spec of Object.values((manifest[field] as Record<string, string> | undefined) ?? {})) {
        const match = /^(?:file|link):\.\.\/([^/]+)\/?$/u.exec(String(spec));
        if (match !== null) names.push(match[1] as string);
      }
    }
    return names;
  };
  const reaches = new Map<string, boolean>();
  const visit = (name: string, seen: Set<string>): boolean => {
    const known = reaches.get(name);
    if (known !== undefined) return known;
    if (seen.has(name)) return false;
    seen.add(name);
    const manifest = manifests.get(name);
    const result = manifest !== undefined && local(manifest).some((dependency) => shared(dependency) || visit(dependency, seen));
    reaches.set(name, result);
    return result;
  };
  return [...manifests.keys()].filter((name) => !shared(name) && typeof manifests.get(name)?.scripts?.ci === "string" && visit(name, new Set())).sort();
}

if (import.meta.main) {
  const index = process.argv.indexOf("--root");
  const root = resolve(index >= 0 ? (process.argv[index + 1] ?? ".") : resolve(import.meta.dir, "..", ".."));
  for (const name of privateGatePackages(root)) console.log(name);
}
