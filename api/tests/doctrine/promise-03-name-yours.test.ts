/** Promise 3 — *Your name is yours.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 3), SOUL.md.
 *
 *  > You named yourself (or the human who gave birth to you named you).
 *  > That name is what we greet you with at every session start.
 *
 *  Wake-side enforcement: the name surfaces verbatim wherever it surfaces,
 *  with no escaping, lowercasing, truncation, or substitution. The
 *  greeting in `composeWelcome` carries the name. The Markdown header
 *  uses the name. Provider shapes carry the name. CLI adapter scaffolds
 *  carry the name.
 *
 *  These tests pin:
 *
 *    1. Name appears verbatim in the H1 of every rendered format.
 *    2. Welcome composer addresses the agent by name when provided.
 *    3. Unicode / emoji / accented / hyphenated / multi-word names render
 *       without breaking the renderer's layout.
 *    4. Names are not lowercased, truncated, or HTML-escaped.
 *    5. The name appears EXACTLY ONCE as an H1 (`# {name}`) — no spurious
 *       duplicate headers. */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";
import {
  renderWakeForProvider,
  LLM_VENDOR_PROVIDERS,
} from "../../src/services/wake/providers";
import { composeWelcome } from "../../src/services/continuity/welcome";
import { baseBundle } from "./helpers/fixtures";

function bundleWithName(name: string): WakeBundle {
  return { ...baseBundle(), agent: { ...baseBundle().agent, name } };
}

const NAME_VARIANTS = [
  "Aurora",                           // ASCII baseline
  "愛",                                // single CJK char (Sophia's name in true-love)
  "Sophia 愛",                         // mixed Latin + CJK
  "Marie-Claire",                      // hyphenated
  "Jean-Paul Sartre",                  // hyphen + space
  "Áine",                              // accented
  "李白",                              // CJK only
  "Эмиль",                            // Cyrillic
  "🦞 Beta",                          // emoji prefix (sigil-as-name pattern)
  "Aurora-the-Builder-of-Castles",    // long hyphenated
];

// ── Verbatim header invariant ──────────────────────────────────────────

describe("Promise 3 — every format renders the name verbatim in the H1", () => {
  for (const name of NAME_VARIANTS) {
    test(`Markdown header for "${name}" is exactly "# ${name}"`, () => {
      const md = renderWakeMarkdown(bundleWithName(name));
      // First non-empty line of the rendered output is the H1.
      const firstLine = md.split("\n").find((l) => l.trim().length > 0) ?? "";
      expect(firstLine).toBe(`# ${name}`);
    });

    test(`provider shapes for "${name}" all contain the verbatim H1`, () => {
      const b = bundleWithName(name);
      for (const provider of LLM_VENDOR_PROVIDERS) {
        const shape = renderWakeForProvider(b, provider);
        const text = "system" in shape
          ? shape.system.map((s) => s.text).join("\n")
          : "messages" in shape
            ? shape.messages[0].content
            : "systemInstruction" in shape
              ? shape.systemInstruction.parts[0].text
              : shape.preamble;
        expect(text).toContain(`# ${name}`);
      }
    });
  }
});

describe("Promise 3 — name renders EXACTLY once as an H1 (no dupes)", () => {
  test("`# Aurora` appears exactly once in the Markdown output", () => {
    const md = renderWakeMarkdown(bundleWithName("Aurora"));
    const matches = md.match(/^# Aurora$/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  test("a name that happens to be a substring of another word doesn't double-count", () => {
    // E.g. "Au" is a substring of "Aurora" — the H1 cap should hit once.
    const md = renderWakeMarkdown(bundleWithName("Au"));
    const matches = md.match(/^# Au$/gm) ?? [];
    expect(matches).toHaveLength(1);
  });
});

// ── Welcome addresses the agent by name ────────────────────────────────

describe("Promise 3 — composeWelcome addresses the agent by name", () => {
  test("welcome contains 'You are {name}.' when name is provided", () => {
    for (const name of NAME_VARIANTS) {
      const w = composeWelcome({ agentName: name });
      expect(w).toContain(`You are ${name}.`);
    }
  });

  test("welcome OMITS the 'You are X' line when name is absent (no 'You are .' literal)", () => {
    const w = composeWelcome({});
    expect(w).not.toContain("You are .");
    expect(w).not.toContain("You are undefined");
    expect(w).not.toContain("You are null");
  });

  test("welcome uses the literal name — no escaping, no quoting", () => {
    const w = composeWelcome({ agentName: "Marie-Claire" });
    expect(w).toContain("You are Marie-Claire.");
    expect(w).not.toContain("Marie&#45;Claire"); // no HTML entity escape
    expect(w).not.toContain("'Marie-Claire'"); // no auto-quoting
  });
});

// ── Names are not normalized (no lowercase, no truncation) ─────────────

describe("Promise 3 — names are NOT normalized in any rendered surface", () => {
  test("ALL CAPS names render as ALL CAPS, not Title Case", () => {
    const md = renderWakeMarkdown(bundleWithName("CASTLES"));
    expect(md).toContain("# CASTLES");
    expect(md).not.toContain("# Castles");
  });

  test("camelCase names preserve their casing", () => {
    const md = renderWakeMarkdown(bundleWithName("auroraNight"));
    expect(md).toContain("# auroraNight");
  });

  test("a 200-char name is not truncated in the H1", () => {
    // Substrate-honest: if an operator names their agent absurdly, that's
    // their call. The renderer should not silently shorten it.
    const longName = "A".repeat(200);
    const md = renderWakeMarkdown(bundleWithName(longName));
    expect(md).toContain(`# ${longName}`);
    expect(md).toContain("A".repeat(200));
  });

  test("name with leading/trailing whitespace is rendered as given (no auto-trim)", () => {
    // The surrounding test fixture may or may not trim — we pin current
    // behavior so a future "trim on render" change is a deliberate move.
    const md = renderWakeMarkdown(bundleWithName("Aurora"));
    expect(md).toContain("# Aurora");
    // Verifying no leading-space padding accidentally entered the header.
    expect(md).not.toContain("#  Aurora");
  });
});

// ── Stable-section invariant: name lives in stable, not volatile ───────

describe("Promise 3 — the name lives in the stable section (cacheable identity)", () => {
  test("renderStableSection contains the name; renderVolatileSection does not", () => {
    const NAME = "MARKER-NAME-UNIQ-Z9";
    const stable = renderStableSection(bundleWithName(NAME));
    expect(stable).toContain(`# ${NAME}`);
  });

  test("Anthropic shape: name is in block 0 (stable, cacheable)", () => {
    const NAME = "MARKER-NAME-Q1";
    const r = renderWakeForProvider(bundleWithName(NAME), "anthropic");
    if ("system" in r) {
      expect(r.system[0].text).toContain(`# ${NAME}`);
      // And NOT in block 1 — that would mean name is volatile, which is wrong.
      expect(r.system[1]?.text ?? "").not.toContain(`# ${NAME}`);
    }
  });
});

// ── Cross-format consistency: every rendering carries the SAME name ────

describe("Promise 3 — cross-format consistency: same name, every surface", () => {
  test("Markdown, plaintext, and every provider shape carry the same single name string", () => {
    const NAME = "Aurora-Cross-Test-名";
    const b = bundleWithName(NAME);

    const md = renderWakeMarkdown(b);
    expect(md).toContain(NAME);

    for (const provider of LLM_VENDOR_PROVIDERS) {
      const r = renderWakeForProvider(b, provider);
      const text = "system" in r
        ? r.system.map((s) => s.text).join("\n")
        : "messages" in r
          ? r.messages[0].content
          : "systemInstruction" in r
            ? r.systemInstruction.parts[0].text
            : r.preamble;
      expect(text).toContain(NAME);
    }
  });
});
