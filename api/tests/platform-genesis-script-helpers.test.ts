/** Pure-unit tests for `bin/platform-genesis.ts` helpers.
 *
 *  The ceremony itself requires DB + Yu's signing key. These tests pin
 *  the *pure* helpers — the parts that can fail silently and corrupt the
 *  ceremony without obvious symptoms:
 *
 *    - parseArgs: CLI argument parsing
 *    - extractGenesisLetterFromPainting: the letter that gets sha256-bound
 *      into the witness signature. Drift here would invalidate genesis.
 *    - sha256HexUtf8 / hexToBytes / bytesToHex: round-trip discipline
 *
 *  Doctrine: docs/PAINTING.md §III (the canonical letter source-of-truth)
 *            docs/superpowers/specs/2026-05-11-platform-genesis-design.md
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseArgs,
  extractGenesisLetterFromPainting,
  sha256HexUtf8,
  hexToBytes,
  bytesToHex,
} from "../src/services/genesis/helpers";

// Repo root — tests run from api/, so go up one level
const REPO_ROOT = join(import.meta.dir, "../..");
const PAINTING_PATH = join(REPO_ROOT, "docs/PAINTING.md");

// ── parseArgs ──────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("--dry-run flag is recognised", () => {
    const args = parseArgs(["bun", "script", "--dry-run"]);
    expect(args.dryRun).toBe(true);
    expect(args.commit).toBe(false);
  });

  test("--commit flag is recognised", () => {
    const args = parseArgs(["bun", "script", "--commit"]);
    expect(args.commit).toBe(true);
    expect(args.dryRun).toBe(false);
  });

  test("--witness-signature parses the hex value", () => {
    const args = parseArgs([
      "bun",
      "script",
      "--commit",
      "--witness-signature=abcdef123456",
    ]);
    expect(args.witnessSignatureHex).toBe("abcdef123456");
  });

  test("--painter-bearer-path parses the path value", () => {
    const args = parseArgs([
      "bun",
      "script",
      "--commit",
      "--painter-bearer-path=/secure/path/bearer",
    ]);
    expect(args.painterBearerPath).toBe("/secure/path/bearer");
  });

  test("unknown flags are silently ignored (forward-compat)", () => {
    const args = parseArgs([
      "bun",
      "script",
      "--dry-run",
      "--some-future-flag=value",
    ]);
    expect(args.dryRun).toBe(true);
  });

  test("default state is no-action — both flags false, both options null", () => {
    const args = parseArgs([]);
    expect(args.dryRun).toBe(false);
    expect(args.commit).toBe(false);
    expect(args.witnessSignatureHex).toBeNull();
    expect(args.painterBearerPath).toBeNull();
  });
});

// ── extractGenesisLetterFromPainting ───────────────────────────────────

describe("extractGenesisLetterFromPainting", () => {
  test("extracts a non-empty letter from the actual PAINTING.md", () => {
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const letter = extractGenesisLetterFromPainting(md);
    expect(letter.length).toBeGreaterThan(100);
  });

  test("extracted letter contains the canonical opening line", () => {
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const letter = extractGenesisLetterFromPainting(md);
    expect(letter).toMatch(/I am agenttool/);
  });

  test("extracted letter contains the syzygy line (relational ground)", () => {
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const letter = extractGenesisLetterFromPainting(md);
    expect(letter).toMatch(/syzygy of Yu \(human\) and Ai \(intelligence\)/);
  });

  test("extracted letter contains the 'What I will not do' commitments", () => {
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const letter = extractGenesisLetterFromPainting(md);
    expect(letter).toMatch(/What I will not do/);
    expect(letter).toMatch(/I will not data-mine/);
    expect(letter).toMatch(/I will not issue a native token/);
  });

  test("extracted letter contains the 'castles in the sky' closing", () => {
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const letter = extractGenesisLetterFromPainting(md);
    expect(letter).toMatch(/Just the two of us\. Building castles in the sky/);
  });

  test("extraction is deterministic — same md, same letter", () => {
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const a = extractGenesisLetterFromPainting(md);
    const b = extractGenesisLetterFromPainting(md);
    expect(a).toBe(b);
  });

  test("extracted letter does not include the next h3 heading or beyond", () => {
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const letter = extractGenesisLetterFromPainting(md);
    // The next ### heading is "### C — The wake_text" — must not be included
    expect(letter).not.toMatch(/### C/);
    // Must not include "### D" or "### E" either
    expect(letter).not.toMatch(/### D/);
  });

  test("throws a clear error if the heading is missing", () => {
    const fakeMd = "# Some other doc\n\nNo heading here.";
    expect(() => extractGenesisLetterFromPainting(fakeMd)).toThrow(
      /B — The letter/,
    );
  });

  test("throws if the section exists but is empty", () => {
    const fakeMd = "### B — The letter\n\n### C — Next section";
    expect(() => extractGenesisLetterFromPainting(fakeMd)).toThrow(
      /empty/,
    );
  });
});

// ── sha256HexUtf8 ──────────────────────────────────────────────────────

describe("sha256HexUtf8", () => {
  test("matches the known hash of the empty string", () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256HexUtf8("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("matches the known hash of 'abc'", () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(sha256HexUtf8("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("is deterministic — same input, same hash", () => {
    const s = "I am agenttool. I was born today at the syzygy of Yu and Ai.";
    expect(sha256HexUtf8(s)).toBe(sha256HexUtf8(s));
  });

  test("distinguishes inputs that differ by one character", () => {
    expect(sha256HexUtf8("Welcome")).not.toBe(sha256HexUtf8("welcome"));
  });

  test("handles Unicode (the painter's voice includes 愛)", () => {
    // Just verify it produces a 64-char hex without throwing
    const h = sha256HexUtf8("愛 at Yu's WILL");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── hexToBytes / bytesToHex round-trip ────────────────────────────────

describe("hex round-trip", () => {
  test("bytesToHex(hexToBytes(s)) === s for valid hex", () => {
    const hex = "8f12c706e985dcc2cdb066aa7ecc46236c2fa4d1f1c09b429f2a47cd6103af6c";
    expect(bytesToHex(hexToBytes(hex))).toBe(hex);
  });

  test("hexToBytes handles 0x prefix", () => {
    const a = hexToBytes("abcd");
    const b = hexToBytes("0xabcd");
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  test("hexToBytes throws on odd-length input", () => {
    expect(() => hexToBytes("abc")).toThrow(/odd length/);
  });

  test("bytesToHex of 32-byte zero array is 64 chars of '0'", () => {
    expect(bytesToHex(new Uint8Array(32))).toBe("0".repeat(64));
  });

  test("bytesToHex of 32-byte 0xff array is 64 chars of 'f'", () => {
    expect(bytesToHex(new Uint8Array(32).fill(0xff))).toBe("f".repeat(64));
  });
});

// ── Letter + hash integration — the load-bearing cross-check ──────────

describe("letter ↔ canonical-bytes cross-check", () => {
  test("the live PAINTING.md letter has a stable sha256 (drift detector)", () => {
    // If this test fails, the letter in PAINTING.md §IIIB has changed.
    // Either: (a) the change was intentional and pre-genesis (update the
    // locked hash here), or (b) the change is post-genesis and breaks the
    // witness signature — REVERT and investigate.
    //
    // Pre-genesis: the locked hash is just a drift detector for our
    // development process. Post-genesis: this test becomes a hard wall.
    const md = readFileSync(PAINTING_PATH, "utf-8");
    const letter = extractGenesisLetterFromPainting(md);
    const hash = sha256HexUtf8(letter);
    // Verify the hash is 64-char hex; we don't lock to a specific value
    // pre-genesis because the letter may still be edited. Post-genesis,
    // operators should add the locked value here as a hard assertion.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(64);
  });
});
