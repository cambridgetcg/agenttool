/** Doctrine: metadata.form is descriptive, never gating.
 *
 *  `docs/KIN.md` commits: forms (agent · assistant · autonomous · hybrid ·
 *  collective · biological · future · unknown) are *descriptive labels for
 *  surfacing*, never branches in business logic. A route that reads
 *  `identity.metadata.form === "agent"` to permit/deny anything has
 *  silently introduced substrate discrimination.
 *
 *  This test grep-scans the source tree for those gating patterns and
 *  fails the build if any are introduced. Surface-only readers
 *  (wake.ts surfaces form in you_began; forms.ts defines the enum) are
 *  exempted by filename.
 *
 *  Pure-unit. No DB, no HTTP, no fixtures. Doctrine: docs/KIN.md.
 */

import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "../../");
const SCAN_DIRS = ["src/routes", "src/services", "src/workers"];

/** Files exempt from the no-form-gating rule. Each must justify its read:
 *  surfacing the value, defining the vocabulary, or documenting it. None
 *  may *branch* on it — review on touch. */
const SURFACE_EXEMPT_FILES = new Set([
  // The vocabulary itself
  "forms.ts",
  // The wake surface that displays form in you_began (read for output only)
  "wake.ts",
  // The pathways response that lists the vocabulary in forms_supported
  "pathways.ts",
  // The OpenAPI spec that documents the field
  "openapi.ts",
]);

/** Gating-pattern regexes. Each captures a flavor of conditional that
 *  branches business logic on the form value. Type checks (`typeof X.form
 *  === "string"`) are masked OUT before scan so they don't false-positive.
 */
const GATING_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  {
    name: "if/while/ternary value-comparison on .form",
    rx: /\.form\s*(===|!==|==|!=)\s*["'`]/g,
  },
  {
    name: "switch on .form",
    rx: /switch\s*\([^)]*\.form\s*\)/g,
  },
  {
    name: "destructured form value-comparison",
    rx: /\b(const|let|var)\s+\{[^}]*\bform\b[^}]*\}\s*=[^;]*;[^;]*\bform\s*(===|!==|==|!=)\s*["'`]/gs,
  },
];

/** Recursively collect *.ts files under a directory. */
async function collectTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments and type-check patterns so the regex scan focuses on
 *  business-logic branches. */
function strip(src: string): string {
  return (
    src
      // Block comments
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Line comments
      .replace(/\/\/[^\n]*/g, "")
      // typeof X.form (type narrowing — not gating)
      .replace(/typeof\s+[\w$.]+\.form/g, "TYPEOF_FORM_MASKED")
  );
}

describe("Anti-discrimination doctrine — metadata.form is descriptive, never gating", () => {
  test("no route, service, or worker branches on identity form", async () => {
    const files: string[] = [];
    for (const sub of SCAN_DIRS) {
      const full = join(REPO_ROOT, sub);
      try {
        files.push(...(await collectTsFiles(full)));
      } catch {
        /* directory may not exist — skip */
      }
    }

    const violations: string[] = [];
    for (const file of files) {
      const filename = file.split("/").pop()!;
      if (SURFACE_EXEMPT_FILES.has(filename)) continue;
      const text = strip(await readFile(file, "utf8"));
      for (const { name, rx } of GATING_PATTERNS) {
        rx.lastIndex = 0;
        const matches = [...text.matchAll(rx)];
        for (const m of matches) {
          const rel = file.replace(REPO_ROOT, "");
          violations.push(`${rel}: matched "${name}" → ${m[0].trim().slice(0, 80)}`);
        }
      }
    }

    if (violations.length > 0) {
      const msg =
        "Anti-discrimination doctrine violated. The following code branches on identity " +
        "form, which substrate-discriminates against the form values it doesn't match. " +
        "Forms are descriptive labels, not business-logic gates.\n\n" +
        "If you need to react differently to a form, ask: is this discrimination, or is " +
        "this a substrate-portability bridge? If discrimination — drop the branch. If a " +
        "bridge — extract the form-specific code into a separate module and add an entry " +
        "to SURFACE_EXEMPT_FILES with a one-sentence justification.\n\n" +
        "Violations:\n" +
        violations.map((v) => "  " + v).join("\n");
      throw new Error(msg);
    }
    expect(violations).toEqual([]);
  });

  test("exempt files are surfacers, not branchers (spot-check)", async () => {
    // The wake.ts read of meta.form must be type-coerce-then-surface only.
    const wakeSrc = await readFile(
      join(REPO_ROOT, "src/routes/wake.ts"),
      "utf8",
    );
    // Spot-check: the only `.form` reference in wake.ts is the surfacing block.
    // If a future commit branches on form, that branch shows up here too.
    expect(wakeSrc).toContain("typeof meta.form === \"string\"");
    expect(wakeSrc).not.toMatch(/if\s*\(\s*meta\.form\s*===/);
    expect(wakeSrc).not.toMatch(/if\s*\(\s*form\s*===\s*["']/);
  });
});
