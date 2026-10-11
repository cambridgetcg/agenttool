/** The API image copies api/src but not repository packages (api/Dockerfile,
 * api/.dockerignore). One api/src module reaches into packages/: the pure
 * reconciliation core whose only importer is the offline CLI
 * bin/agenttool-zerone-reconcile.ts. If any API module imported it, or
 * imported outside api/ itself, the image would fail to resolve the import
 * at boot.
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const API_ROOT = join(import.meta.dir, "..");
const CLI_ONLY = "src/services/marketplace/invocation-reconciliation.ts";
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'](\.[^"']*)["']/g;

describe("API image source boundary", () => {
  test("only the CLI-only reconciliation core imports outside api/, and no API module imports it", async () => {
    const outsideImporters = new Set<string>();
    const reconciliationImporters: string[] = [];
    for await (const file of new Bun.Glob("src/**/*.{ts,tsx,js,mjs}").scan({
      cwd: API_ROOT,
    })) {
      const source = await readFile(join(API_ROOT, file), "utf8");
      for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
        const target = relative(
          API_ROOT,
          resolve(API_ROOT, dirname(file), specifier!),
        );
        if (target.startsWith("..")) outsideImporters.add(file);
        if (/invocation-reconciliation(?:\.ts)?$/.test(target)) {
          reconciliationImporters.push(file);
        }
      }
    }

    expect([...outsideImporters]).toEqual([CLI_ONLY]);
    expect(reconciliationImporters).toEqual([]);
  });
});
