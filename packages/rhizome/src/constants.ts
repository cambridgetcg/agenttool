/** rhizome/constants — identity, and the one path rhizome knows by name.
 *
 *  `PACKAGE_ROOT_RELATIVE` and `PROBE_DIRECTORY_RELATIVE` are the only
 *  paths in this package that are not read from the tree, and even they
 *  are derived rather than typed: the package root is found by walking up
 *  from this module for a `package.json`, and made repo-relative against
 *  the root found by walking up for `.git`.
 *
 *  The `dist` → `src` swap below is the one genuine assertion: a built
 *  copy of rhizome has no `.ts` probe files next to it, and the probes it
 *  must check for registration are the ones in the checkout. If that
 *  assertion is wrong the `self` probe reports "the probes directory was
 *  not visible", which is the loud failure rather than a silent one.
 */

import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const PACKAGE_NAME = "@agenttool/rhizome";
/** Kept equal to package.json by tests/package.test.ts. */
export const PACKAGE_VERSION = "0.1.0";
export const REPORT_SCHEMA_ID = "urn:agenttool:rhizome:soil-report:v0.1";

function findUp(start: string, marker: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, marker))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

const MODULE_DIRECTORY = import.meta.dir;
const PACKAGE_ROOT = findUp(MODULE_DIRECTORY, "package.json");
const REPOSITORY_ROOT = findUp(PACKAGE_ROOT, ".git");

/** e.g. `packages/rhizome`. */
export const PACKAGE_ROOT_RELATIVE = toPosix(relative(REPOSITORY_ROOT, PACKAGE_ROOT));

/** e.g. `packages/rhizome/src/probes`, whether running from `src` or `dist`. */
export const PROBE_DIRECTORY_RELATIVE = `${toPosix(relative(REPOSITORY_ROOT, MODULE_DIRECTORY)).replace(/\/dist$/, "/src")}/probes`;
