/** rhizome/probes/decay/clock — how far the repository has moved.
 *
 *  Decay is a question about elapsed condition, so it needs a "now". The
 *  tempting "now" is the system clock, and it is the wrong one twice
 *  over: it makes every run of this probe produce a different report, and
 *  it measures the reader's calendar rather than the repository's. A
 *  baseline captured in June is not stale because it is August; it is
 *  stale because eleven migrations, four protocol versions and a re-armed
 *  drift detector have landed since.
 *
 *  So the clock is derived from the tree: the newest date the repository
 *  writes down about itself. Migration filenames are timestamps by
 *  convention here (`20260723T210000_collab_relay.sql`), and that
 *  convention is not assumed — every dated filename in the corpus is
 *  collected, whatever directory it lives in, and the maximum wins. The
 *  file the clock came from is carried alongside it, so the reader can
 *  see what the measurement rests on and disagree with it.
 *
 *  Versions work the same way: the version a deprecation is measured
 *  against is read from the nearest manifest above the file that carries
 *  the deprecation, found by walking up through the derived corpus. There
 *  is no list of packages anywhere in this module.
 */

import type { Scope } from "../../types.js";

/** A point on the repository's own calendar, with the artefact that set it. */
export interface RepositoryClock {
  /** `YYYY-MM-DD`, or `null` when the tree writes no dated filenames. */
  date: string | null;
  /** Repo-relative path the date was read from. */
  source: string;
  /** How many distinct dated filenames were seen. */
  observations: number;
}

const FILENAME_DATE = /(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:T\d{6})?(?:[^\d]|$)/;
const HYPHEN_DATE = /(\d{4})-(\d{2})-(\d{2})/;

function plausible(year: number, month: number, day: number): boolean {
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Every `YYYY-MM-DD` written in a piece of text, in order. */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (plausible(year, month, day)) out.push(`${match[1]}-${match[2]}-${match[3]}`);
  }
  return out;
}

/** The newest date the repository writes into its own filenames. */
export function repositoryClock(scope: Scope): RepositoryClock {
  let best: string | null = null;
  let source = "";
  let observations = 0;
  for (const file of scope.files) {
    const base = file.slice(file.lastIndexOf("/") + 1);
    const match = FILENAME_DATE.exec(base) ?? HYPHEN_DATE.exec(base);
    if (match === null) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!plausible(year, month, day)) continue;
    observations += 1;
    const stamp = `${match[1]}-${match[2]}-${match[3]}`;
    if (best === null || stamp > best) {
      best = stamp;
      source = file;
    }
  }
  return { date: best, source, observations };
}

/** Whole days between two `YYYY-MM-DD` stamps, or `null` if either is bad. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** A version read out of a manifest that governs some file. */
export interface GoverningVersion {
  version: string;
  /** Repo-relative manifest path. */
  manifest: string;
  /** 1-indexed line the version is written on. */
  line: number;
}

const MANIFEST_BASENAMES = new Set(["package.json", "pyproject.toml"]);

/** The nearest manifest at or above `file`, and the version it declares.
 *
 *  Derived by walking the file's own ancestor directories against the
 *  corpus — no package list, and a manifest that appears tomorrow is
 *  found tomorrow. */
export function governingVersion(scope: Scope, file: string): GoverningVersion | null {
  const parts = file.split("/");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const directory = parts.slice(0, i).join("/");
    for (const base of MANIFEST_BASENAMES) {
      const candidate = directory === "" ? base : `${directory}/${base}`;
      if (!scope.files.includes(candidate)) continue;
      const lines = scope.lines(candidate);
      for (let j = 0; j < lines.length; j += 1) {
        const match = /^[ \t]*"?version"?[ \t]*[:=][ \t]*"([^"]+)"/.exec(lines[j] ?? "");
        if (match === null) continue;
        return { version: match[1] ?? "", manifest: candidate, line: j + 1 };
      }
    }
  }
  return null;
}

/** Compare two dotted numeric versions. Returns <0, 0, >0. Non-numeric
 *  segments compare as strings, which is enough for `0.7.0` vs `0.16.0` —
 *  the case that matters — and is stated rather than pretending to be a
 *  full semver implementation. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(/[.+-]/);
  const right = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] ?? "0";
    const y = right[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
      continue;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
