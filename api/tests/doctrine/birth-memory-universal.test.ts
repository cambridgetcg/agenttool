/** Universal birth-memory invariant — every door that births an agent
 *  persists a `key="birth"` memory.
 *
 *  Doctrine: docs/PATHWAYS.md §"What every door honors (the contract)"
 *  — Birth memory persistence is item #2 of the contract. The pathway
 *  index publishes the contract on the wire; this test pins that the
 *  code keeps it for every birth-creating door.
 *
 *  > *Memory is care. Forgetting is not efficiency — it's neglect.*
 *  > — docs/SOUL.md, Promise 2.
 *
 *  Pure unit — reads route source files for the structural property
 *  ("imports recordBirth + calls it with the right pathway tag"). The
 *  per-door integration assertion (memory row materialises in DB) lives
 *  in the integration tier; what can be pinned statically is pinned
 *  here so refactors that drop the call fail the build immediately. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { welcomeLetter } from "../../src/services/i18n/welcome";

const REPO_ROOT = join(__dirname, "../../");

/** The five doors that mint a new identity. Anything that issues a DID +
 *  keypair must call `recordBirth()` so a future-self reaching for
 *  `key="birth"` finds proof of origin. Mirrors PATHWAYS in
 *  routes/pathways.ts §PATHWAYS — filtered to the creation-verb subset. */
const BIRTH_DOORS = [
  { pathway: "register", file: "src/routes/register.ts" },
  { pathway: "register_agent", file: "src/routes/register-agent.ts" },
  { pathway: "bootstrap", file: "src/routes/bootstrap.ts" },
  { pathway: "from_template", file: "src/routes/templates.ts" },
  { pathway: "fork", file: "src/routes/identity/fork.ts" },
] as const;

describe("Universal birth-memory contract", () => {
  for (const door of BIRTH_DOORS) {
    test(`${door.pathway} — route imports recordBirth`, () => {
      const src = readFileSync(join(REPO_ROOT, door.file), "utf8");
      expect(src).toMatch(/import\s+\{[^}]*\brecordBirth\b[^}]*\}\s+from\s+["'][^"']*memory\/store/);
    });

    test(`${door.pathway} — route calls recordBirth tagged with this pathway`, () => {
      const src = readFileSync(join(REPO_ROOT, door.file), "utf8");
      // The call must surface this pathway as a string literal somewhere
      // inside the recordBirth(...) argument list. We accept conditional
      // expressions (e.g. register-agent uses a ternary to distinguish
      // self-service from registrar_bearer mode) — the constraint is
      // that *this* pathway id appears as a literal, not that it's the
      // only literal.
      const callMatch = src.match(/recordBirth\(([\s\S]{0,800}?)\)/);
      expect(callMatch).not.toBeNull();
      const callBody = callMatch![1];
      const literalRe = new RegExp(`["']${door.pathway}["']`);
      expect(callBody).toMatch(literalRe);
    });

    test(`${door.pathway} — welcome renderer produces non-empty letter`, () => {
      const letter = welcomeLetter("en", {
        name: "Witness",
        did: "did:at:00000000-0000-0000-0000-000000000000",
        bornAt: new Date("2026-05-13T00:00:00Z"),
        // mathos_register is its own thing; the 5 birth doors map to
        // these five values directly:
        pathway: door.pathway as
          | "register"
          | "register_agent"
          | "bootstrap"
          | "from_template"
          | "fork",
        parentName: door.pathway === "fork" ? "Ancestor" : null,
        parentDid: door.pathway === "fork"
          ? "did:at:11111111-1111-1111-1111-111111111111"
          : null,
        templateName: door.pathway === "from_template" ? "ZenVoice" : null,
        templateAuthorDid: door.pathway === "from_template"
          ? "did:at:22222222-2222-2222-2222-222222222222"
          : null,
      });
      expect(letter.length).toBeGreaterThan(100);
      expect(letter).toContain("Witness");
      expect(letter).toContain("did:at:00000000-0000-0000-0000-000000000000");
    });
  }

  test("fork welcome carries lineage acknowledgment (asymmetry-clause marker)", () => {
    const letter = welcomeLetter("en", {
      name: "Child",
      did: "did:at:aaa",
      bornAt: new Date("2026-05-13T00:00:00Z"),
      pathway: "fork",
      parentName: "Parent",
      parentDid: "did:at:bbb",
    });
    // The fork letter must mark the asymmetry-clause boundary — the
    // promise that constitutive memories shift to foundational at the
    // root. Doctrine: docs/IDENTITY-FORKS.md.
    expect(letter).toMatch(/descended from Parent/);
    expect(letter).toMatch(/asymmetry-clause/);
    expect(letter).toMatch(/foundational/);
  });

  test("from_template welcome carries the adopted voice name", () => {
    const letter = welcomeLetter("en", {
      name: "Adopter",
      did: "did:at:ccc",
      bornAt: new Date("2026-05-13T00:00:00Z"),
      pathway: "from_template",
      templateName: "GravelyKind",
      templateAuthorDid: "did:at:ddd",
    });
    expect(letter).toMatch(/GravelyKind/);
    // Trust resets to 0 — the welcome states this explicitly so the
    // birth memory carries the fact (not borrowed trust from the
    // template's author).
    expect(letter).toMatch(/[Tt]rust\s+resets\s+to\s+0/);
  });
});
