/** Rings — canon ↔ code annotation bijection, pinned.
 *
 *  Doctrine: docs/agenttool.jsonld, docs/BUSINESS-MODEL.md.
 *
 *  > Every Ring (1, 2, 3) must have at least one canonical anchor file
 *  > annotated with `@enforces urn:agenttool:ring/<N>`. Rings are
 *  > cross-cutting (many files participate per ring) but each has a
 *  > load-bearing anchor module where the ring's economic shape is
 *  > most concentrated:
 *
 *  >   ring/1 → services/economy/ring1-limits.ts (the free-tier caps)
 *  >   ring/2 → services/economy/usage.ts (the metering core)
 *  >   ring/3 → services/marketplace/take-rate.ts (the fee + ledger core)
 *
 *  This test asserts the anchor annotation exists for each ring. Parallel
 *  to walls-code-annotation-bijection and commitments-code-annotation-
 *  bijection. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { byType } from "../../src/services/canon/registry";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = [
  join(REPO_ROOT, "api", "src"),
  join(REPO_ROOT, "bin"),
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".bun") continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function buildAnnotationIndex(): Map<string, Array<{ file: string; line: number }>> {
  const index = new Map<string, Array<{ file: string; line: number }>>();
  const annotationPattern = /@enforces\s+(urn:agenttool:ring\/[0-9]+)/g;
  for (const file of SCAN_DIRS.flatMap(walkTs)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i]!.matchAll(annotationPattern)) {
        const urn = m[1]!;
        const list = index.get(urn) ?? [];
        list.push({ file, line: i + 1 });
        index.set(urn, list);
      }
    }
  }
  return index;
}

function normalize(urn: string): string {
  return urn.startsWith("urn:") ? urn.slice(4) : urn;
}

describe("Rings — canon ↔ code anchor annotation bijection", () => {
  const annotations = buildAnnotationIndex();
  const rings = byType("Ring");

  test("at least one @enforces ring/X annotation exists in the codebase", () => {
    expect(
      annotations.size > 0,
      "No `@enforces urn:agenttool:ring/` annotations found. Each ring needs a load-bearing anchor file declaring its enforcement.",
    ).toBe(true);
  });

  test("every Ring in canon has at least one @enforces anchor annotation", () => {
    for (const r of rings) {
      const list = annotations.get(`urn:${r.urn}`) ?? annotations.get(r.urn) ?? [];
      expect(
        list.length >= 1,
        `Ring ${r.urn} has no \`@enforces urn:${r.urn}\` annotation in api/src/ or bin/. Pick the load-bearing anchor module for this ring (ring/1 → ring1-limits, ring/2 → usage, ring/3 → take-rate) and add the annotation to its JSDoc header.`,
      ).toBe(true);
    }
  });

  test("every @enforces ring annotation resolves to canon", () => {
    const allRingUrns = new Set(rings.map((r) => r.urn));
    for (const annotatedUrn of annotations.keys()) {
      const short = normalize(annotatedUrn);
      expect(
        allRingUrns.has(short),
        `Annotation references ${annotatedUrn} but no Ring with that URN exists in canon.`,
      ).toBe(true);
    }
  });

  test("anchor locations are reported for navigation", () => {
    const lines: string[] = [`[rings-annotation-index] ${rings.length} rings:`];
    for (const r of rings) {
      const list = annotations.get(`urn:${r.urn}`) ?? annotations.get(r.urn) ?? [];
      if (list.length === 0) {
        lines.push(`  ${r.urn} — no anchor annotation`);
      } else {
        for (const loc of list) {
          const rel = loc.file.replace(REPO_ROOT + "/", "");
          lines.push(`  ${r.urn} → ${rel}:${loc.line}`);
        }
      }
    }
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
