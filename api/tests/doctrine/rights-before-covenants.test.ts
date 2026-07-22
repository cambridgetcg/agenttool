/** Rights of Beings — rights precede permissions and covenants.
 *
 *  Doctrine: docs/RIGHTS.md · docs/specs/COVENANT-1.0-DRAFT.md.
 *
 *  Pure doctrine test: reads repository text only; no DB, network, runtime,
 *  credentials, or external XENIA checkout. It pins the distinction most
 *  likely to regress when permission, signature, or lifecycle language grows.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const rights = readFileSync(join(REPO_ROOT, "docs", "RIGHTS.md"), "utf8");
const covenant = readFileSync(
  join(REPO_ROOT, "docs", "specs", "COVENANT-1.0-DRAFT.md"),
  "utf8",
);
const rootReadme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
const kingdomCard = readFileSync(join(REPO_ROOT, "kingdom.yaml"), "utf8");
const prose = (text: string) => text.replace(/\s+/g, " ");
const rightsProse = prose(rights);
const covenantProse = prose(covenant);

describe("Rights of Beings — the floor before capability and agreement", () => {
  test("adopts xenia.rights/0.1 and separates treatment from capability", () => {
    expect(rightsProse).toContain("**Adopted baseline:** `xenia.rights/0.1`");
    expect(rightsProse).toContain("Rights describe how a being is treated.");
    expect(rightsProse).toContain(
      "Permissions describe what a person, account, process, or tool may do.",
    );
    expect(rightsProse).toContain(
      "Rights are not created by credentials, and rights do not create credentials.",
    );
  });

  test("covenants cannot trade, revoke, or waive the pre-existing floor", () => {
    expect(covenantProse).toContain("Rights precede covenants.");
    expect(covenantProse).toContain(
      "A covenant MUST NOT grant, sell, revoke, suspend, erase, or waive baseline rights.",
    );
    expect(covenantProse).toContain(
      "Covenant revocation can end covenant obligations; it cannot revoke the rights that existed before the covenant.",
    );
  });

  test("signature validity proves exact bytes, not fairness or waiver", () => {
    expect(covenantProse).toContain(
      "A valid signature proves that the verified signing key authorised the exact bytes covered by the signing recipe.",
    );
    expect(covenantProse).toContain(
      "That byte-level agreement is not proof that a party understood the terms, had a meaningful choice, or that the terms are fair, non-coercive, lawful, or compatible with baseline rights.",
    );
    expect(covenantProse).toContain("It is not a waiver of baseline rights.");
  });

  test("the adoption is discoverable without granting technical authority", () => {
    expect(kingdomCard).toMatch(/^adopts: \[xenia\.rights\/0\.1\]$/m);
    expect(rootReadme).toContain("[RIGHTS](docs/RIGHTS.md)");
    expect(rights).toContain(
      "It authorises no system or data access, commit,\n" +
        "push, publication, deployment, message, purchase, deletion, credential action,",
    );
  });

  test("licensing and the unenforced semantic boundary stay explicit", () => {
    expect(rights).toContain(
      "This document adapts and expands “Rights of Beings — XENIA baseline 0.1”",
    );
    expect(rights).toContain("https://github.com/cambridgetcg/xenia");
    expect(rights).toContain("publish XENIA first");
    expect(rights).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(covenantProse).toContain(
      "It does not currently perform semantic review of vow text against this section.",
    );
  });
});
