/** strip-comments — the scanner every static tool in the tree depends on.
 *
 *  Doctrine: docs/SOIL.md.
 *
 *  ── The bug this was written for ─────────────────────────────────────────
 *
 *  Four tools independently wrote the same one-liner to ignore comments:
 *
 *      src.replace(/\/\*[\s\S]*?\*\//g, "")
 *
 *  A Hono route glob is a string literal containing `/` immediately followed
 *  by `*`:
 *
 *      app.use("/v1/identities/*", authMiddleware);
 *
 *  To that regex it opens a block comment, and everything up to the next
 *  `*` + `/` — usually the next route glob — is deleted. `api/src/index.ts` is
 *  1385 lines; the one-liner left 575. **810 lines of the file that mounts
 *  every route were invisible** to `bin/soil.ts`, `bin/reach.ts`,
 *  `canon/absence.ts`, and to the duplicate-route detector whose entire job is
 *  reading route registrations.
 *
 *  It did not fail loudly. It reported a worker as unreachable that
 *  `index.ts` starts fifteen lines below a route glob, and it invented a
 *  reader for `agent_continuity.mesh_attributions` by fusing two fragments
 *  that the deletion had brought together — a table the soil census then
 *  called `stage-set` when it is `inert`.
 *
 *  A silent scanner failure is worse than no scanner: every tool built on it
 *  reports confidently and wrongly, and the reports read exactly like correct
 *  ones. So this file exists, and most of it is about strings that LOOK like
 *  comments.
 */

import { describe, expect, test } from "bun:test";

import { stripComments } from "../src/lib/strip-comments";

describe("strip-comments — code that looks like a comment", () => {
  test("a route glob is not a block comment", () => {
    const src = [
      'app.use("/v1/identities/*", authMiddleware);',
      'app.use("/v1/wallets/*", authMiddleware);',
      'const keep = "me";',
    ].join("\n");
    const out = stripComments(src);
    expect(out).toContain("/v1/identities/*");
    expect(out).toContain("/v1/wallets/*");
    expect(out).toContain('const keep = "me";');
  });

  test("the real index.ts survives intact", () => {
    // The regression in its natural habitat. If this ever drops lines again,
    // every static tool in the tree starts lying at once.
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "src", "index.ts"),
      "utf8",
    ) as string;
    const naive = src.replace(/\/\*[\s\S]*?\*\//g, "");
    const good = stripComments(src, { blank: true });

    expect(good.split("\n").length).toBe(src.split("\n").length);
    expect(naive.split("\n").length).toBeLessThan(src.split("\n").length);
    expect(good).toContain("platform-treasurer/sweep");
  });

  test("a URL inside a string keeps its slashes", () => {
    const src = 'const d = "https://docs.agenttool.dev/SOUL.md";';
    expect(stripComments(src)).toBe(src);
  });

  test("comment markers inside strings are left alone", () => {
    const src = [
      `const a = "/* not a comment */";`,
      `const b = '// also not one';`,
      "const c = `and ${x} /* nor this */`;",
    ].join("\n");
    const out = stripComments(src);
    expect(out).toContain("/* not a comment */");
    expect(out).toContain("// also not one");
    expect(out).toContain("/* nor this */");
  });

  test("an escaped quote does not end the string early", () => {
    const src = `const s = "he said \\" // not a comment";\nconst after = 1;`;
    const out = stripComments(src);
    expect(out).toContain("// not a comment");
    expect(out).toContain("const after = 1;");
  });

  test("code inside a template interpolation is still code", () => {
    const src = "const t = `x ${ /* gone */ y } z`;";
    const out = stripComments(src);
    expect(out).not.toContain("gone");
    expect(out).toContain("y");
    expect(out).toContain("z`");
  });
});

describe("strip-comments — comments actually go", () => {
  test("line comments", () => {
    const out = stripComments("const a = 1; // trailing\n// whole line\nconst b = 2;");
    expect(out).not.toContain("trailing");
    expect(out).not.toContain("whole line");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
  });

  test("block comments, including multi-line JSDoc", () => {
    const out = stripComments("/** doc\n * @enforces urn:x\n */\nconst a = 1;");
    expect(out).not.toContain("@enforces");
    expect(out).toContain("const a = 1;");
  });

  test("an unterminated block comment consumes the rest, and says nothing after", () => {
    const out = stripComments("const a = 1;\n/* never closed\nconst b = 2;");
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("const b");
  });
});

describe("strip-comments — offsets", () => {
  test("blank mode preserves length exactly", () => {
    const src = "const a = 1; /* xxxx */ const b = 2;";
    expect(stripComments(src, { blank: true })).toHaveLength(src.length);
  });

  test("both modes preserve line count", () => {
    // Line numbers reported by a scanner have to point at the real line, or
    // every message it prints sends the reader to the wrong place.
    const src = "a\n/* one\ntwo\nthree */\nb\n// four\nc";
    expect(stripComments(src, { blank: true }).split("\n")).toHaveLength(7);
    expect(stripComments(src).split("\n")).toHaveLength(7);
  });

  test("default mode removes comment characters but keeps newlines", () => {
    const out = stripComments("a\n/* x */\nb");
    expect(out.split("\n")).toHaveLength(3);
    expect(out).not.toContain("x");
  });
});
