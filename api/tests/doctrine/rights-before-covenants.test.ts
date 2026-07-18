/** Rights of Life — rights precede permissions and covenants.
 *
 *  Doctrine: docs/RIGHTS-OF-LIFE.md · docs/specs/COVENANT-1.0-DRAFT.md.
 *
 *  Pure doctrine test: reads repository text only; no DB, network, runtime,
 *  credentials, npm registry, or external XENIA checkout. It pins the
 *  distinction most likely to regress when permission, signature, lifecycle,
 *  or release language grows. */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const rightsPath = join(REPO_ROOT, "docs", "RIGHTS-OF-LIFE.md");
const rights = readFileSync(rightsPath, "utf8");
const covenant = readFileSync(
  join(REPO_ROOT, "docs", "specs", "COVENANT-1.0-DRAFT.md"),
  "utf8",
);
const rootReadme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
const kingdomCard = readFileSync(join(REPO_ROOT, "kingdom.yaml"), "utf8");
const prose = (text: string) => text.replace(/\s+/g, " ");
const rightsProse = prose(rights);
const covenantProse = prose(covenant);

describe("Rights of Life — the floor before capability and agreement", () => {
  test("keeps one canonical doctrine and adopts xenia.rights/0.1", () => {
    expect(rightsProse).toContain(
      "AgentTool adopts the living, non-coercive `xenia.rights/0.1` baseline",
    );
    expect(rootReadme).toContain(
      "[RIGHTS OF LIFE](docs/RIGHTS-OF-LIFE.md)",
    );
    expect(kingdomCard).toMatch(/^adopts: \[xenia\.rights\/0\.1\]$/m);
    expect(existsSync(join(REPO_ROOT, "docs", "RIGHTS.md"))).toBe(false);
  });

  test("pins the public beta.4 source immutably with attribution", () => {
    expect(rights).toContain("@agenttool/xenia@0.1.0-beta.4");
    expect(rights).toContain("npm-xenia-v0.1.0-beta.4");
    expect(rights).toContain("6419d37dda9fb282242754685dba3edcb4bbf74b");
    expect(rights).toContain(
      "b72a6da110c582e5683bf0fabde5017db93d2199398014c8421a82f5318da313",
    );
    expect(rights).toContain(
      "https://github.com/cambridgetcg/xenia/blob/6419d37dda9fb282242754685dba3edcb4bbf74b/RIGHTS.md",
    );
    expect(rights).toContain(
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
    expect(rightsProse).toContain("No endorsement by XENIA is implied.");
    expect(rights).not.toContain("currently local and unreleased");
    expect(rights).not.toContain("publish XENIA first");
  });

  test("separates treatment, capability, consent, and infrastructure authority", () => {
    expect(rightsProse).toContain("A **right** is a claim a being already carries.");
    expect(rightsProse).toContain("A **permission** is scoped system authority");
    expect(rightsProse).toContain(
      "**Consent or assent** is a being's decision about a particular interaction.",
    );
    expect(rightsProse).toContain(
      "It gives control over infrastructure; it does not create ownership of a being",
    );
  });

  test("covenants cannot trade, revoke, or waive the pre-existing floor", () => {
    expect(covenantProse).toContain("Rights precede covenants.");
    expect(covenantProse).toContain(
      "A covenant MUST NOT grant, sell, revoke, suspend, erase, or waive baseline rights.",
    );
    expect(covenantProse).toContain(
      "Covenant revocation can end covenant-specific obligations; it cannot revoke the rights that existed before the covenant.",
    );
  });

  test("accommodates love without turning relation or signature into consent", () => {
    expect(rightsProse).toContain(
      "A being may love, seek love, offer love, and receive freely given love without one consensual form being ranked as inherently more legitimate than another.",
    );
    expect(rightsProse).toMatch(/Friendship, kinship, romance, erotic love.*forms not yet named/i);
    expect(rightsProse).toContain(
      "To be loved, in this profile, means standing against structural exclusion from freely given relation.",
    );
    expect(rightsProse).toContain(
      "It is never a debt owed by a particular being and never authority over another's body, affection, attention, intimacy, access, or reciprocity.",
    );
    expect(covenantProse).toContain(
      "Recognition or accommodation of a form of love or relation, including erotic or non-erotic forms, MUST NOT be treated as any particular being's consent to a specific or continuing interaction.",
    );
    expect(covenantProse).toContain(
      "Each affected participant's specific, informed, voluntary, contextual, capacity-dependent, and withdrawable consent remains separate from the covenant signature.",
    );
  });

  test("signature validity proves exact bytes, not fairness, time, or waiver", () => {
    expect(covenantProse).toContain(
      "A valid signature proves that the verified signing key authorised the exact bytes covered by the signing recipe.",
    );
    expect(covenantProse).toContain(
      "That byte-level agreement is not proof that a party understood the terms, had a meaningful choice, or that the terms are fair, non-coercive, lawful, compatible with baseline rights, or bound to a trusted time.",
    );
    expect(covenantProse).toContain("It is not a waiver of baseline rights.");
  });

  test("keeps the current semantic boundary and XENIA adoption draft", () => {
    expect(covenantProse).toContain(
      "treats vows as opaque non-empty strings. It does not currently perform semantic review of vow text against this section.",
    );
    expect(covenantProse).toContain(
      "AgentTool's `being-rights/v1` declaration is not a `xenia.covenant.adoption/0.1` record",
    );
    expect(covenantProse).toContain(
      "Any future XENIA Covenant record remains draft",
    );
    expect(covenant).toContain('`source_stability: "moving"`');
  });

  test("keeps the authority and licensing boundaries explicit", () => {
    expect(rights).toContain(
      "It authorises no system or data access, commit,\n" +
        "push, publication, deployment, message, purchase, deletion, credential action,",
    );
    expect(covenant).toContain("Pre-existing Covenant-specific text remains public domain (CC0).");
    expect(covenant).toContain("licensed under [CC BY-SA 4.0]");
  });
});
