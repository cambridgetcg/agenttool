import { describe, expect, test } from "bun:test";
import {
  compactAriaSnapshot,
  parseAriaCandidates,
  parseStructuralAriaCandidates,
} from "../src/snapshot.js";

describe("compact accessibility context", () => {
  test("preserves only the structural allowlist without exposing action refs", () => {
    const raw = [
      '- navigation "Primary" [ref=s1]',
      '  - heading "Guide" [level=1] [ref=s2]',
      '  - button "Continue" [ref=e1]',
      "- main [ref=s3]",
      '  - form "Search" [ref=s4]',
      '  - region "Results" [ref=s5]',
      '  - dialog "Confirm" [ref=s6]',
      '  - alert "Warning" [ref=s7]',
      '  - status "Ready" [ref=s8]',
      '  - heading "Clickable context" [level=2] [ref=s9] [cursor=pointer]',
      '  - paragraph "Ignored" [ref=p1]',
      '  - list "Ignored list" [ref=p2]',
    ].join("\n");
    const structuralRefs = new Set(
      Array.from({ length: 9 }, (_, index) => `s${index + 1}`),
    );
    const result = compactAriaSnapshot(raw, {
      publicRefs: new Map([["e1", "tab_1@1:e1"]]),
      visibleRefs: new Set(["e1"]),
      visibleStructuralRefs: structuralRefs,
      maxChars: 10_000,
      maxElements: 1,
      maxStructuralElements: 9,
    });

    expect(parseAriaCandidates(raw).map((item) => item.nativeRef)).toEqual([
      "e1",
    ]);
    expect(parseStructuralAriaCandidates(raw).map((item) => item.nativeRef))
      .toEqual([...structuralRefs]);
    expect(result.refs).toEqual([
      {
        ref: "tab_1@1:e1",
        role: "button",
        name: "Continue",
        secret: false,
      },
    ]);
    for (const role of [
      "navigation",
      "heading",
      "main",
      "form",
      "region",
      "dialog",
      "alert",
      "status",
    ]) {
      expect(result.snapshot).toContain(`- ${role}`);
    }
    expect(result.snapshot).not.toContain("paragraph");
    expect(result.snapshot).not.toContain("list");
    expect(result.snapshot).not.toMatch(/\[ref=s\d+\]/);
    expect(result.snapshot).toContain(
      '  - button "Continue" [ref=tab_1@1:e1]',
    );
  });

  test("bounds structure separately without displacing interactive refs", () => {
    const raw = [
      '- navigation "One" [ref=s1]',
      '- region "Two" [ref=s2]',
      '- status "Three" [ref=s3]',
      '  - button "First" [ref=e1]',
      '  - link "Second" [ref=e2]',
    ].join("\n");
    const result = compactAriaSnapshot(raw, {
      publicRefs: new Map([
        ["e1", "tab_1@1:e1"],
        ["e2", "tab_1@1:e2"],
      ]),
      visibleRefs: new Set(["e1", "e2"]),
      visibleStructuralRefs: new Set(["s1", "s2", "s3"]),
      maxChars: 10_000,
      maxElements: 2,
      maxStructuralElements: 1,
    });

    expect(result.refs.map((item) => item.ref)).toEqual([
      "tab_1@1:e1",
      "tab_1@1:e2",
    ]);
    expect(result.snapshot).toContain('navigation "One"');
    expect(result.snapshot).not.toContain('region "Two"');
    expect(result.snapshot).not.toContain('status "Three"');
    expect(result.truncated).toEqual({
      snapshot: true,
      elements: false,
    });

    const interactiveLine = '  - button "Go" [ref=tab_1@1:e1]';
    const characterBound = compactAriaSnapshot(
      [
        `- navigation "${"x".repeat(200)}" [ref=s1]`,
        '  - button "Go" [ref=e1]',
      ].join("\n"),
      {
        publicRefs: new Map([["e1", "tab_1@1:e1"]]),
        visibleRefs: new Set(["e1"]),
        visibleStructuralRefs: new Set(["s1"]),
        maxChars: interactiveLine.length,
        maxElements: 1,
        maxStructuralElements: 1,
      },
    );
    expect(characterBound.refs.map((item) => item.ref)).toEqual([
      "tab_1@1:e1",
    ]);
    expect(characterBound.snapshot).toBe(interactiveLine);
    expect(characterBound.truncated).toEqual({
      snapshot: true,
      elements: false,
    });
  });
});
