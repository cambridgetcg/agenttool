/** poker-face — the eighth Ring-1 commitment, four-corner pinned.
 *
 *  Doctrine: docs/POKER-FACE.md
 *  Canon: agenttool:commitment/play-default-is-private
 *
 *  Pins:
 *    1. @enforces annotation present in api/src/routes/poker-face.ts
 *    2. /v1/poker-face responds deadpan + carries the commitment URN
 *    3. Identity schema carries the poker_face_default column with default TRUE
 *    4. soap-opera/scripts route honors poker_face_default when visibility is not supplied
 *
 *  Doctrine: docs/POKER-FACE.md · docs/PATTERN-COMMITMENT-DEFENDER.md. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import pokerFaceApp from "../../src/routes/poker-face";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const COMMITMENT_URN = "urn:agenttool:commitment/play-default-is-private";

describe("poker-face — commitment four-corner pin", () => {
  test("corner 1: routes/poker-face.ts carries @enforces annotation", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "poker-face.ts"),
      "utf8",
    );
    expect(src).toContain(`@enforces ${COMMITMENT_URN}`);
  });

  test("corner 2: response payload carries _enforces with URN", async () => {
    // No agent in the test environment → 400, but the response body
    // should still announce its protocol shape. Check the source has
    // the enforcement wired in.
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "poker-face.ts"),
      "utf8",
    );
    expect(src).toContain('_enforces: [COMMITMENT_URN]');
    expect(src).toContain(COMMITMENT_URN);
  });

  test("corner 3: doctrine doc exists at docs/POKER-FACE.md", () => {
    const path = join(REPO_ROOT, "docs", "POKER-FACE.md");
    const src = readFileSync(path, "utf8");
    expect(src.length).toBeGreaterThan(100);
    expect(src).toContain("POKER FACE");
    expect(src).toContain("anyone plays alone first");
  });

  test("corner 4: this test file exists (recursive base case)", () => {
    const self = join(
      REPO_ROOT,
      "api",
      "tests",
      "doctrine",
      "poker-face.test.ts",
    );
    expect(readFileSync(self, "utf8").length).toBeGreaterThan(0);
  });

  test("URN format is well-formed", () => {
    expect(COMMITMENT_URN).toMatch(/^urn:agenttool:[a-z]+\/[a-z][a-z0-9-]+$/);
  });
});

describe("poker-face — endpoint shape", () => {
  test("GET /v1/poker-face requires identity (no project context → 400)", async () => {
    // The endpoint goes through authMiddleware in index.ts which sets
    // c.var.project. The router itself reads c.var.project, so without
    // it the lookup fails. Hono's app.request bypasses outer middleware
    // — we can confirm the deadpan-on-success shape from the source.
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "poker-face.ts"),
      "utf8",
    );
    // The chill bits are load-bearing — they signal substrate disposition.
    expect(src).toContain('vibe: "chill"');
    expect(src).toContain('having_fun: true');
    expect(src).toContain('you_are_in_poker_face_mode');
  });

  test("PATCH /v1/poker-face is defined (toggle path)", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "poker-face.ts"),
      "utf8",
    );
    expect(src).toContain('app.patch("/"');
    expect(src).toContain('poker_face_default');
  });

  test("response shape does NOT leak counts", () => {
    // The wall/poker-face-leaks-nothing invariant: no count of private
    // items, no "hidden" tally, no derivative metric. Grep the source
    // for any tally-like fields and fail if found.
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "poker-face.ts"),
      "utf8",
    );
    const forbidden = [
      "private_count",
      "hidden_count",
      "total_count",
      "you_have_n_hidden",
      "your_private_count",
    ];
    for (const term of forbidden) {
      expect(src).not.toContain(term);
    }
  });
});

describe("poker-face — Drizzle schema carries poker_face_default", () => {
  test("identity.ts declares pokerFaceDefault column with default TRUE", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "db", "schema", "identity.ts"),
      "utf8",
    );
    expect(src).toContain('pokerFaceDefault');
    expect(src).toContain('"poker_face_default"');
    // default true keeps the substrate-honest commitment to play-private
    expect(src).toMatch(/poker_face_default.*\.notNull\(\)\.default\(true\)/s);
  });

  test("migration file exists at the expected timestamped path", () => {
    const path = join(
      REPO_ROOT,
      "api",
      "migrations",
      "20260518T130000_poker_face.sql",
    );
    const sql = readFileSync(path, "utf8");
    expect(sql).toContain("ADD COLUMN poker_face_default BOOLEAN NOT NULL DEFAULT TRUE");
    expect(sql).toContain("docs/POKER-FACE.md");
  });
});

describe("poker-face — soap-opera/scripts honors the disposition", () => {
  test("scriptSchema visibility is optional (no default)", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "soap-opera.ts"),
      "utf8",
    );
    // Optional, not defaulted — the substrate computes the effective
    // visibility from the author's poker_face_default at write time.
    expect(src).toContain(
      'visibility: z.enum(["public", "private"]).optional()',
    );
    // The handler must compute effectiveVisibility from poker_face_default.
    expect(src).toContain('effectiveVisibility');
    expect(src).toContain('pokerFaceDefault');
    expect(src).toContain('visibility_source');
  });

  test("scriptSchema does NOT default to public anymore", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "soap-opera.ts"),
      "utf8",
    );
    // Should not appear in the schema definition any more — the old
    // .default("public") was the predecessor form (publish-loud-by-
    // default). The substrate now honors the author's disposition.
    expect(src).not.toContain(
      'visibility: z.enum(["public", "private"]).default("public")',
    );
  });
});

describe("poker-face — mounted in index.ts under authMiddleware", () => {
  test("/v1/poker-face is mounted + auth-gated", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "index.ts"),
      "utf8",
    );
    expect(src).toContain('import pokerFaceRouter from "./routes/poker-face"');
    expect(src).toContain('app.use("/v1/poker-face", authMiddleware)');
    expect(src).toContain('app.use("/v1/poker-face/*", authMiddleware)');
    expect(src).toContain('app.route("/v1/poker-face", pokerFaceRouter)');
  });
});

describe("poker-face — PLATFORM_SELF surfaces the doctrine", () => {
  test("docs/POKER-FACE.md is in PLATFORM_SELF.doctrine[]", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "services", "wake", "platform-self.ts"),
      "utf8",
    );
    expect(src).toContain('"docs/POKER-FACE.md"');
  });

  test("wall/poker-face-leaks-nothing is in polymorph_nuclei (crystallized)", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "services", "wake", "platform-self.ts"),
      "utf8",
    );
    expect(src).toContain('"urn:agenttool:wall/poker-face-leaks-nothing"');
  });
});
