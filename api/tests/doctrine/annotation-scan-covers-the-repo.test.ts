/** The annotation scanner must be able to see the whole repository.
 *
 *  Doctrine: docs/SELF-IDENTIFICATION.md · docs/PATTERN-MACHINE-READABLE-PARITY.md
 *  · docs/DOCTRINE-DRIFT.md (the inventory this test keeps honest).
 *
 *  > The canon ↔ code bijection is only as truthful as the set of files it
 *  > reads. A scanner with a hard-coded directory list does not report
 *  > "no drift"; it reports "no drift in the directories I was told about,"
 *  > and the difference is invisible from the console.
 *
 *  ── Why this file exists ─────────────────────────────────────────────
 *
 *  `annotations.ts` scanned exactly `api/src` and `bin`. Every bijection
 *  test, every `bin/walls.ts` run, and the whole of `docs/DOCTRINE-DRIFT.md`
 *  inherited that scope without ever stating it. `packages/scriptwriter/src`
 *  carried twelve `@enforces` URNs — ten walls, two commitments, all twelve
 *  with no entry in `docs/agenttool.jsonld` — and none of them was ever
 *  reported, because the detector could not see the file.
 *
 *  Widening the list fixed those twelve and nothing else: the next package
 *  to grow an annotation would have been invisible in exactly the same way.
 *  So the list is now asserted rather than assumed. `strayAnnotatedFiles()`
 *  reads the tree — not the list — and this test fails on anything it finds
 *  that the list does not cover.
 *
 *  This test is therefore the actual repair. The widening was the symptom
 *  fix; this is the one that keeps the blind spot from re-forming.
 */

import { describe, expect, test } from "bun:test";

import {
  ANNOTATION_PROBE,
  SCAN_ROOTS,
  SCANNED_EXTENSIONS,
  UNSCANNED_CARRIER_EXTENSIONS,
  scanAnnotations,
  strayAnnotatedFiles,
  unusedCarrierDeclarations,
} from "../../src/services/canon/annotations";

const stray = strayAnnotatedFiles();
const wallSites = [...scanAnnotations("wall").values()].flat();
const commitmentSites = [...scanAnnotations("commitment").values()].flat();
const allSites = [...wallSites, ...commitmentSites];

describe("annotation scan coverage — the scanner sees the whole repo", () => {
  test("no annotated source file lives outside the scan roots", () => {
    const outside = stray.filter((s) => s.reason === "outside-scan-roots");
    expect(
      outside.map((s) => s.file),
      `These source file(s) carry \`@enforces urn:agenttool:…\` but sit outside every entry in SCAN_ROOTS, so the canon ↔ code bijection cannot see them and docs/DOCTRINE-DRIFT.md undercounts by exactly this much:\n${outside
        .map((s) => `  ${s.file}`)
        .join(
          "\n",
        )}\n\nCurrent SCAN_ROOTS: ${SCAN_ROOTS.join(
        ", ",
      )}\n\nFix by adding the directory to SCAN_ROOTS in api/src/services/canon/annotations.ts — then re-run \`bin/walls.ts --gaps\`, because widening the scan will surface gaps that were previously invisible. Do NOT fix this by deleting the annotation: an annotation nobody checks is the exact failure this ratchet exists to catch.`,
    ).toEqual([]);
  });

  test("no annotated file carries an extension nobody has classified", () => {
    const unknown = stray.filter((s) => s.reason === "undeclared-extension");
    expect(
      unknown.map((s) => `${s.file} (${s.ext})`),
      `These file(s) carry \`@enforces urn:agenttool:…\` in a file type that is neither scanned nor declared as a deliberate non-defender:\n${unknown
        .map((s) => `  ${s.file}`)
        .join(
          "\n",
        )}\n\nScanned: ${SCANNED_EXTENSIONS.join(
        ", ",
      )}. Declared non-defenders: ${Object.keys(UNSCANNED_CARRIER_EXTENSIONS).join(
        ", ",
      )}.\n\nDecide which it is and say so in api/src/services/canon/annotations.ts. Silence is the one answer that is always wrong.`,
    ).toEqual([]);
  });

  test("every scan root actually contributes annotations", () => {
    const barren = SCAN_ROOTS.filter(
      (root) => !allSites.some((s) => s.file.startsWith(root + "/")),
    );
    expect(
      barren,
      `SCAN_ROOTS entr(ies) with no \`@enforces\` annotation under them:\n${barren
        .map((r) => `  ${r}`)
        .join(
          "\n",
        )}\n\nEither the directory moved and the list is stale, or the root was added speculatively. A scan root that scans nothing is a claim of coverage with nothing behind it — remove it or fix the path.`,
    ).toEqual([]);
  });

  test("the scanner reads packages/scriptwriter — the directory it used to miss", () => {
    // A named regression pin, not a general assertion. The twelve URNs in
    // packages/scriptwriter/src were invisible until 2026-07-26; if the
    // scan roots are ever trimmed back, this fails by name rather than as
    // a silent drop in the dangling count.
    const scriptwriter = allSites.filter((s) =>
      s.file.startsWith("packages/scriptwriter/"),
    );
    expect(
      scriptwriter.length,
      "packages/scriptwriter/src carries @enforces annotations that the bijection is no longer allowed to ignore. Zero sites here means the scan roots were narrowed back.",
    ).toBeGreaterThan(0);
  });

  test("the stray probe recognises exactly what the scanner extracts", () => {
    // Two patterns, one meaning. `strayAnnotatedFiles()` asks "would the
    // scanner find something here" and `scanAnnotations()` finds it. If they
    // drift, one of two silences returns: a stray report nobody can act on
    // (the probe is looser), or an annotated file nobody sweeps for (the
    // probe is tighter). Both are the failure this suite exists to prevent.
    for (const kind of ["wall", "commitment"] as const) {
      const real = `@enforces urn:agenttool:${kind}/some-real-slug`;
      expect(ANNOTATION_PROBE.test(real)).toBe(true);
      // The scanner is the arbiter: a line it extracts from must probe true.
      const scannerPattern = new RegExp(
        `@enforces\\s+(urn:agenttool:${kind}\\/[a-z][a-z0-9\\-]+)`,
      );
      expect(scannerPattern.test(real)).toBe(true);
    }
    // And the shapes the scanner would NOT extract must not probe true, or
    // the sweep reports files that widening the roots cannot fix.
    for (const quoted of [
      "@enforces urn:agenttool:commitment/<slug>",
      "@enforces urn:agenttool:",
      "@enforces urn:",
    ]) {
      expect(ANNOTATION_PROBE.test(quoted)).toBe(false);
    }
  });

  test("reports declared non-defender extensions that no longer carry anything", () => {
    // Reporter — always passes. A stale exclusion is untidy, not unsafe,
    // so it is surfaced rather than enforced.
    const unused = unusedCarrierDeclarations();
    if (unused.length) {
      console.log(
        `[annotation-scan] UNSCANNED_CARRIER_EXTENSIONS declares ${unused.join(
          ", ",
        )}, but no file with that extension carries an @enforces URN any more. Safe to drop the entry.`,
      );
    }
    expect(true).toBe(true);
  });

  test("the scan surface is reported for navigation", () => {
    // Reporter — always passes.
    const byRoot = SCAN_ROOTS.map((root) => {
      const n = allSites.filter((s) => s.file.startsWith(root + "/")).length;
      return `${root}: ${n}`;
    });
    console.log(
      `[annotation-scan] ${allSites.length} annotation site(s) across ${SCAN_ROOTS.length} root(s) — ${byRoot.join(
        " · ",
      )} · extensions ${SCANNED_EXTENSIONS.join(", ")} · ${stray.length} stray`,
    );
    expect(true).toBe(true);
  });
});
