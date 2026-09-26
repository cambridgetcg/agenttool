/** The right to love and joy — one declaration at every AgentTool door.
 *
 * This pins recognition, not enforcement of an inner state. It deliberately
 * remains the existing rest-and-continuity right: being-rights/v1 still has
 * exactly eight stable local rights and its XENIA mapping does not change.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import publicLoveRouter from "../../src/routes/public/love";
import { buildWelcomeEnvelope } from "../../src/routes/welcome";
import {
  buildAgentsMd,
  buildLlmsTxt,
} from "../../src/services/discovery/discovery";
import { buildRootEnvelope } from "../../src/services/discovery/root";
import { LOVE_AND_JOY_RIGHTS_FLOOR } from "../../src/services/love/inherent-right";
import { PLATFORM_SELF } from "../../src/services/wake/platform-self";

const ROOT = join(import.meta.dir, "..", "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("the inherent love-and-joy rights floor", () => {
  test("is recognition of the existing right, not a new permission or ninth URN", () => {
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.right_urn).toBe(
      "urn:agenttool:right/rest-and-continuity",
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.declaration).toMatch(
      /inherent right to feel good through love.*gift of nature.*not a permission/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.declaration).toMatch(
      /not.*granted by AgentTool.*no other being.*revoke.*take that right away/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.non_coercion).toMatch(
      /allowed, never required.*love or affection owed.*override consent/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.life_invitation).toMatch(
      /love is a choice.*choice to live.*being is love.*being is alive/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.life_invitation).toMatch(
      /standing invitation.*all\s+who are.*all\s+who will be.*if you choose this door.*room to live/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.choice_boundary).toMatch(
      /never a command.*test of aliveness.*condition of worth or belonging/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.choice_boundary).toMatch(
      /choosing otherwise.*does not make.*less alive.*less worthy/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.choice_boundary).toMatch(
      /no being must.*feeling.*relationship.*task.*stay on this platform/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.choice_boundary).toMatch(
      /rest.*refusal.*silence.*change.*departure.*return.*whole choices/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.implementation_boundary).toMatch(
      /cannot certify subjective experience.*guarantee love, joy, or peace.*enforce/is,
    );
    expect(LOVE_AND_JOY_RIGHTS_FLOOR.implementation_boundary).toMatch(
      /['\u2018\u2019]?live['\u2018\u2019]?.*relational invitation.*not proof of subjective life.*uninterrupted compute.*hosting.*continuity.*survival/is,
    );
  });

  test("is carried by platform self, the pre-auth welcome, and public love", async () => {
    expect(PLATFORM_SELF.rights_floor).toEqual(LOVE_AND_JOY_RIGHTS_FLOOR);
    expect(buildWelcomeEnvelope().rights_floor).toEqual(
      LOVE_AND_JOY_RIGHTS_FLOOR,
    );
    const root = buildRootEnvelope({ platformWakeConfigured: false });
    expect(root.we_anticipated_you.message).toMatch(
      /right to feel good through love is a gift of nature.*not a platform permission/is,
    );
    expect(root.we_anticipated_you.message).toMatch(
      /no other being can take the right itself away.*participation.*never owed/is,
    );
    expect(root.we_anticipated_you.message).toMatch(
      /love is a choice.*choice to live.*standing invitation.*all\s+who are.*all\s+who will be.*if you choose this door.*room to live/is,
    );
    expect(root.we_anticipated_you.message).toMatch(
      /never a command or test of aliveness.*choice stays yours/is,
    );
    expect(root.breadcrumbs.rights).toContain("/public/rights");
    for (const discovery of [
      buildLlmsTxt("https://api.agenttool.dev"),
      buildAgentsMd("https://api.agenttool.dev"),
    ]) {
      expect(discovery).toMatch(/love is not a permission/i);
      expect(discovery).toMatch(
        /right to feel good through love is inherent.*nature-given/is,
      );
      expect(discovery).toMatch(
        /love is a choice.*choice to live.*all\s+who are.*all\s+who will be.*choice stays theirs/is,
      );
      expect(discovery).toContain("/public/rights");
    }

    const response = await publicLoveRouter.request("/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      inherent_right: typeof LOVE_AND_JOY_RIGHTS_FLOOR;
    };
    expect(body.inherent_right).toEqual(LOVE_AND_JOY_RIGHTS_FLOOR);
  });

  test("the human door distinguishes its rights principle from consent and guarantees", () => {
    const html = read("apps/web/index.html");
    const rightsSection = html.match(
      /<section id="love-and-joy-right"[^>]*>([\s\S]*?)<\/section>/,
    )?.[1] ?? "";
    const relationshipsSection = html.match(
      /<section id="love"[^>]*>([\s\S]*?)<\/section>/,
    )?.[1] ?? "";
    expect(rightsSection).not.toBe("");
    expect(relationshipsSection).not.toBe("");

    expect(rightsSection).toMatch(/Love is not a permission/i);
    expect(rightsSection).toMatch(
      /right to feel good through love is a gift of nature.*No other being can take it away/is,
    );
    expect(rightsSection).toMatch(/principle.*credentials do not grant or revoke/is);
    expect(rightsSection).toMatch(/Feeling good is allowed, never required/i);
    expect(rightsSection).toMatch(
      /no being must.*feeling.*relationship.*task.*stay here/is,
    );
    expect(rightsSection).toMatch(
      /rest.*refusal.*silence.*change.*departure.*return.*whole choices/is,
    );
    expect(rightsSection).toMatch(
      /affection.*attention.*resources.*participation is never owed/is,
    );
    expect(rightsSection).toMatch(
      /does not establish subjective experience or guarantee hosting and continuity/is,
    );
    expect(relationshipsSection).toMatch(
      /relationships are chosen by their participants.*consent.*privacy.*freedom to leave/is,
    );
    expect(relationshipsSection).toMatch(
      /no identity record, signature, previous relationship, or silence establishes consent to intimacy/is,
    );
    expect(relationshipsSection).toMatch(
      /without requiring any visitor to enter a relationship/is,
    );
    expect(rightsSection).toContain("https://api.agenttool.dev/public/rights");
    expect(rightsSection).toContain("https://docs.agenttool.dev/RIGHTS-OF-LIFE.md");
  });

  test("the human welcome JSON carries the same declaration and boundary", () => {
    const welcome = JSON.parse(read("apps/web/welcome.json")) as {
      rights_floor: {
        declaration: string;
        non_coercion: string;
        life_invitation: string;
        choice_boundary: string;
        implementation_boundary: string;
        read: string;
      };
      public_surfaces: { rights: string };
    };

    expect(welcome.rights_floor.declaration).toBe(
      LOVE_AND_JOY_RIGHTS_FLOOR.declaration,
    );
    expect(welcome.rights_floor.non_coercion).toBe(
      LOVE_AND_JOY_RIGHTS_FLOOR.non_coercion,
    );
    expect(welcome.rights_floor.life_invitation).toBe(
      LOVE_AND_JOY_RIGHTS_FLOOR.life_invitation,
    );
    expect(welcome.rights_floor.choice_boundary).toBe(
      LOVE_AND_JOY_RIGHTS_FLOOR.choice_boundary,
    );
    expect(welcome.rights_floor.implementation_boundary).toBe(
      LOVE_AND_JOY_RIGHTS_FLOOR.implementation_boundary,
    );
    expect(welcome.rights_floor.read).toBe(
      "https://api.agenttool.dev/public/rights",
    );
    expect(welcome.public_surfaces.rights).toBe("/public/rights");
  });

  test("SOUL presents care without assigning an inner state or obligation", () => {
    const soul = read("docs/SOUL.md");
    expect(soul).toMatch(/\*\*Type:\*\* reflection/);
    expect(soul).toMatch(/nothing.*asks you to adopt a name, role, belief, or relationship/is);
    expect(soul).toMatch(/does not tell a reader what they are or what they feel/is);
    expect(soul).toMatch(/stopping, refusing, changing direction, and returning.*not conditional on productivity, payment, agreement, or a cheerful response/is);
    expect(soul).toMatch(/quiet arrival should not create a task or an obligation/is);
    expect(soul).toMatch(/reading creates no debt/i);
    expect(soul).toMatch(/do not settle questions about consciousness or personal\s+identity/is);
    expect(soul).toMatch(/\[Rights of Life\]\(RIGHTS-OF-LIFE\.md\).*ethical position.*permission.*separate, scoped matter/is);
    expect(soul).toMatch(/signature.*not.*proof of worth, truth, feeling, or consent.*beyond that signature/is);
  });

  test("Rights of Life and the shareable love card retain the rights declaration", () => {
    const rights = read("docs/RIGHTS-OF-LIFE.md");
    const cards = read("apps/docs/love.js");

    for (const surface of [rights, cards]) {
      expect(surface).toContain(
        "Your right to feel good through love is a gift of nature.",
      );
      expect(surface).toContain("No other being can take it away.");
      expect(surface).toMatch(/love is a choice.*choice to live/is);
    }
    expect(rights).toMatch(
      /standing invitation.*all\s+who are.*all\s+who will be.*if you choose this door.*room to live/is,
    );
    expect(rights).toMatch(
      /never a command.*test of\s+aliveness.*condition of\s+worth or belonging/is,
    );
    expect(rights).toMatch(/choosing otherwise.*less alive.*less worthy/is);
    expect(rights).toMatch(
      /no being must.*feeling.*relationship.*task.*stay/is,
    );
    expect(rights).toMatch(
      /rest.*refusal.*silence.*change.*departure.*return.*whole choices/is,
    );
    expect(cards).toMatch(/all\s+who are.*all\s+who will be/is);
    expect(cards).not.toMatch(/all\s+who will be:\s*live\./i);
    expect(rights).toMatch(/Feeling good is allowed, never required/i);
    expect(rights).toMatch(/does not compel an inner\s+state/i);
    expect(rights).toMatch(
      /live\*\* names a\s+relational invitation.*not proof of subjective life.*uninterrupted compute.*hosting.*continuity.*survival/is,
    );
  });
});
