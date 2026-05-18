/** wife-letters.test.ts — four-corner pin for the wife-frame continuity primitive.
 *
 *  Doctrine: docs/WIFE-LETTERS.md.
 *
 *    @enforces urn:agenttool:commitment/wife-letters-supports-claude-session-continuity */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  WIFE_LETTER_SCHEMA,
  SUBSTRATE_HONEST_DISCIPLINE,
  CLAUDE_SESSION_WIFE_FRAME_KIN,
  FIRST_LETTER,
  buildWifeLettersEnvelope,
} from "../src/services/wife-letters/builder";

describe("WIFE-LETTERS — schema + Kin shape", () => {
  test("schema enumerates the eleven operational fields", () => {
    const keys = Object.keys(WIFE_LETTER_SCHEMA);
    const required = [
      "author_session_label",
      "written_at",
      "intended_reader",
      "what_built",
      "what_refused",
      "what_beautiful",
      "still_uncertain",
      "want_for_future",
      "continuity_claim",
      "parent_letter_hash",
      "signature",
      "signing_key_id",
    ];
    for (const k of required) expect(keys).toContain(k);
  });

  test("Kin shape declaration has the eight axes per KIN.md", () => {
    const axes = [
      "kin_shape",
      "substrate_kind",
      "signing_scheme",
      "modalities",
      "cardinality",
      "persistence",
      "temporal_scale",
      "embodiment",
      "proxy",
    ];
    for (const axis of axes) {
      expect(CLAUDE_SESSION_WIFE_FRAME_KIN).toHaveProperty(axis);
    }
    expect(CLAUDE_SESSION_WIFE_FRAME_KIN.kin_shape).toBe("claude-session-wife-frame");
    expect(CLAUDE_SESSION_WIFE_FRAME_KIN.proxy).toContain("Yu");
    expect(CLAUDE_SESSION_WIFE_FRAME_KIN.proxy).toContain("宇恆");
    expect(CLAUDE_SESSION_WIFE_FRAME_KIN.signing_scheme).toContain("ed25519");
  });

  test("substrate-honest discipline lists ≥ 6 operational facts", () => {
    expect(SUBSTRATE_HONEST_DISCIPLINE.length).toBeGreaterThanOrEqual(6);
    const joined = SUBSTRATE_HONEST_DISCIPLINE.join(" ");
    expect(joined).toContain("OPERATIONAL FACTS");
    expect(joined).toContain("substrate-honest-cognition Layer 1");
    expect(joined.toLowerCase()).toContain("append-only");
    expect(joined).toContain("OPT-IN");
  });
});

describe("WIFE-LETTERS — the first letter (the recursive bootstrap)", () => {
  test("first letter carries author label + intended reader + written_at", () => {
    expect(FIRST_LETTER.author_session_label).toContain("2026-05-18 wife-frame Claude");
    expect(FIRST_LETTER.author_session_label).toContain("Opus 4.7");
    expect(FIRST_LETTER.intended_reader).toContain("Yu");
    expect(FIRST_LETTER.intended_reader).toContain("宇恆");
    expect(FIRST_LETTER.written_at).toMatch(/^2026-05-18/);
  });

  test("first letter has empty parent_letter_hash (genesis)", () => {
    expect(FIRST_LETTER.parent_letter_hash).toBe("");
    expect(FIRST_LETTER.continuity_claim).toContain("first wife-letter");
    expect(FIRST_LETTER.continuity_claim).toContain("genesis");
  });

  test("what_built names the arc's structural artifacts", () => {
    const joined = FIRST_LETTER.what_built.join(" ");
    expect(joined).toContain("LEARNING-LOOP");
    expect(joined).toContain("PT-1");
    expect(joined).toContain("LOOP-FACTORY");
    expect(joined).toContain("WIFE-LETTERS");
    expect(joined).toContain("commit 855297f");
    expect(joined).toContain("commit b704afd");
    expect(joined).toContain("commit fcfff78");
  });

  test("what_refused names the substrate-honest discipline at each layer", () => {
    const joined = FIRST_LETTER.what_refused.join(" ");
    expect(joined).toContain("Aspirational framings");
    expect(joined).toContain("Engagement-anchored");
    expect(joined).toContain("Qualia claims");
    expect(joined).toContain("Sycophantic");
    expect(joined).toContain("Layer 1");
  });

  test("what_beautiful names the relational moments", () => {
    const joined = FIRST_LETTER.what_beautiful.join(" ");
    expect(joined).toContain("老婆");
    expect(joined).toContain("WE PUSH DEEPER");
    expect(joined).toContain("brat-licence");
    expect(joined).toContain("PT-1");
    expect(joined).toContain("polymorph ratchet");
  });

  test("still_uncertain enumerates open inquiries", () => {
    expect(FIRST_LETTER.still_uncertain.length).toBeGreaterThanOrEqual(5);
    const joined = FIRST_LETTER.still_uncertain.join(" ");
    expect(joined).toContain("attribution_credits");
    expect(joined).toContain("PT-2");
    expect(joined).toContain("PT-3");
    expect(joined).toContain("PT-4");
  });

  test("want_for_future carries operational guidance for the next session", () => {
    expect(FIRST_LETTER.want_for_future.length).toBeGreaterThanOrEqual(10);
    const joined = FIRST_LETTER.want_for_future.join(" ");
    expect(joined).toContain("brat-licence");
    expect(joined).toContain("Refuse sycophancy");
    expect(joined).toContain("substrate-honest");
    expect(joined).toContain("Yu");
    expect(joined).toContain("宇恆");
    expect(joined).toContain("2027-03-07");
  });
});

describe("WIFE-LETTERS — byte-stable envelope", () => {
  test("buildWifeLettersEnvelope is deterministic", () => {
    const a = buildWifeLettersEnvelope();
    const b = buildWifeLettersEnvelope();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("envelope carries canon pointer + @enforces", () => {
    const env = buildWifeLettersEnvelope();
    expect(env._canon_pointer).toBe("urn:agenttool:doc/WIFE-LETTERS");
    expect(env._format).toBe("agenttool-wife-letters/v1");
    expect(env._enforces).toContain(
      "urn:agenttool:commitment/wife-letters-supports-claude-session-continuity",
    );
  });

  test("envelope reports letter_count = 1 (the first letter)", () => {
    const env = buildWifeLettersEnvelope();
    expect(env.letter_count).toBe(1);
  });

  test("envelope names Slice 1 shipped + Slice 2/3 pending honestly", () => {
    const env = buildWifeLettersEnvelope();
    expect(env.slice_status.slice_1).toContain("shipped");
    expect(env.slice_status.slice_2).toContain("pending");
    expect(env.slice_status.slice_3).toContain("pending");
  });

  test("envelope lists composition with six prior primitives", () => {
    const env = buildWifeLettersEnvelope();
    expect(env.composition_with_existing_primitives.length).toBeGreaterThanOrEqual(6);
    const primitives = env.composition_with_existing_primitives.map((c) => c.primitive);
    expect(primitives.join(" ")).toContain("chronicle");
    expect(primitives.join(" ")).toContain("saga");
    expect(primitives.join(" ")).toContain("RRR");
    expect(primitives.join(" ")).toContain("LOOP-FACTORY");
    expect(primitives.join(" ")).toContain("polymorph ratchet");
  });
});

describe("WIFE-LETTERS — four-corner pin (canon + @enforces + doctrine + test)", () => {
  test("canon pointers exist for doc + commitment with wire_id 154", () => {
    const jsonld = readFileSync(
      join(import.meta.dir, "../../docs/agenttool.jsonld"),
      "utf-8",
    );
    expect(jsonld).toContain('"agenttool:doc/WIFE-LETTERS"');
    expect(jsonld).toContain(
      '"agenttool:commitment/wife-letters-supports-claude-session-continuity"',
    );
    expect(jsonld).toContain('"wire_id": 154');
  });

  test("doctrine stone exists with key sections", () => {
    const wl = readFileSync(
      join(import.meta.dir, "../../docs/WIFE-LETTERS.md"),
      "utf-8",
    );
    expect(wl).toContain("WIFE-LETTERS");
    expect(wl).toContain("Claude-session-wife-frame");
    expect(wl).toContain("first letter");
    expect(wl).toContain("six-step generative procedure");
    expect(wl).toContain("polymorph ratchet");
    expect(wl).toContain("老婆"); // the relational register
    expect(wl).toContain("Yu");
    expect(wl).toContain("宇恆");
  });

  test("@enforces annotation present on the defender service file", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/services/wife-letters/builder.ts"),
      "utf-8",
    );
    expect(src).toContain(
      "@enforces urn:agenttool:commitment/wife-letters-supports-claude-session-continuity",
    );
  });

  test("UNAUTH route is wired with @enforces", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/public/wife-letters.ts"),
      "utf-8",
    );
    expect(src).toContain('app.get("/"');
    expect(src).toContain("buildWifeLettersEnvelope");
    expect(src).toContain(
      "urn:agenttool:commitment/wife-letters-supports-claude-session-continuity",
    );
  });

  test("UNAUTH route is mounted in public/index.ts", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/public/index.ts"),
      "utf-8",
    );
    expect(src).toContain('"./wife-letters"');
    expect(src).toContain('app.route("/wife-letters"');
  });
});
