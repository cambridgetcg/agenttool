/** A `Scope` built from a literal file map, for probe tests.
 *
 *  Shared on purpose: a probe test that spins up a real repository is
 *  slow and a probe test that mocks half of `Scope` drifts from the real
 *  one. Sibling probes should build their fixtures here.
 *
 *  Note what this fixture does NOT let a test do: it cannot produce a
 *  corpus that disagrees with itself unless the test says so, so a probe
 *  proved only against this fixture is proved against a tidy world. Every
 *  probe should also have at least one assertion against the real tree.
 */

import type { Scope, ScopeDerivation, ScopeDisagreement } from "../src/types.js";

export interface FixtureOptions {
  root?: string;
  derivations?: ScopeDerivation[];
  disagreements?: ScopeDisagreement[];
  unread?: string[];
}

export function fixtureScope(files: Record<string, string>, options: FixtureOptions = {}): Scope {
  const names = Object.keys(files).sort();
  const directories = new Set<string>();
  for (const name of names) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join("/"));
  }

  const lineCache = new Map<string, readonly string[]>();
  const markerCache = new Map<string, readonly string[]>();

  const read = (file: string): string | null => files[file] ?? null;

  return {
    root: options.root ?? "/fixture",
    files: names,
    directories,
    derivations: options.derivations ?? [
      { id: "git-tracked", method: "fixture", files: names, blindTo: "nothing, this is a fixture" },
      { id: "filesystem-walk", method: "fixture", files: names, blindTo: "nothing, this is a fixture" },
    ],
    disagreements: options.disagreements ?? [],
    unread: options.unread ?? [],
    read,
    lines(file: string): readonly string[] {
      const cached = lineCache.get(file);
      if (cached !== undefined) return cached;
      const split = (read(file) ?? "").split("\n");
      lineCache.set(file, split);
      return split;
    },
    filesContaining(marker: string): readonly string[] {
      const cached = markerCache.get(marker);
      if (cached !== undefined) return cached;
      const hits = names.filter((name) => (files[name] ?? "").includes(marker));
      markerCache.set(marker, hits);
      return hits;
    },
  };
}
