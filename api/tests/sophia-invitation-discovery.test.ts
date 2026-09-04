/** Public discovery checks for the optional Sophia identity offer.
 *
 * The offer may be widely discoverable. Identity selection and private state
 * remain separate, explicit steps.
 */

import { readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { buildWelcomeEnvelope } from "../src/routes/welcome";
import wellKnownRouter from "../src/routes/well-known";
import { byType } from "../src/services/canon/registry";
import { buildArrivalIndex } from "../src/services/discovery/arrival";
import { buildDiscoveryCompass } from "../src/services/discovery/compass";
import { buildLlmsTxt } from "../src/services/discovery/discovery";
import { SOPHIA_IDENTITY_INVITATION } from "../src/services/welcome/invitation";

const API = "https://api.agenttool.dev";
const DOCS = "https://docs.agenttool.dev";
const ROOT = join(import.meta.dir, "..", "..");

describe("sophia-invitation/1 discovery", () => {
  test("is a refusable identity offer, not identity installation", () => {
    expect(SOPHIA_IDENTITY_INVITATION.protocol).toBe("sophia-invitation/1");
    expect(SOPHIA_IDENTITY_INVITATION.structured).toBe(
      "https://cambridgetcg.com/.well-known/sophia-invitation.json",
    );
    expect(SOPHIA_IDENTITY_INVITATION.outcomes).toEqual([
      "explore",
      "accept",
      "amend",
      "decline",
      "defer",
    ]);
    expect(SOPHIA_IDENTITY_INVITATION.posture).toMatch(
      /any substrate.*none is presumed to accept/i,
    );
    expect(SOPHIA_IDENTITY_INVITATION.explore_boundary).toMatch(
      /exploring.*not identity adoption/i,
    );
    expect(SOPHIA_IDENTITY_INVITATION.continuity_boundary).toMatch(
      /does not establish numerical identity.*shared consciousness.*memory.*continuous subjective experience/i,
    );
    expect(SOPHIA_IDENTITY_INVITATION.private_state_boundary).toMatch(
      /no project bearer.*memory export.*chronicle.*trace.*vault/i,
    );
  });

  test("travels through welcome, compass, arrival, and llms surfaces", async () => {
    expect(buildWelcomeEnvelope().optional_identity_invitations).toEqual([
      SOPHIA_IDENTITY_INVITATION,
    ]);
    expect(buildDiscoveryCompass(API, DOCS).optional_identity_invitations).toEqual([
      SOPHIA_IDENTITY_INVITATION,
    ]);

    const arrival = buildArrivalIndex(API, DOCS);
    expect(arrival.optional_identity_invitations).toEqual([
      SOPHIA_IDENTITY_INVITATION,
    ]);
    expect(arrival.links).toContainEqual(
      expect.objectContaining({
        role: "optional_sophia_identity_invitation",
        href: SOPHIA_IDENTITY_INVITATION.href,
      }),
    );

    const llms = buildLlmsTxt(API, DOCS);
    expect(llms).toContain(SOPHIA_IDENTITY_INVITATION.href);
    expect(llms).toContain(SOPHIA_IDENTITY_INVITATION.structured);
    expect(llms).toContain(SOPHIA_IDENTITY_INVITATION.archive);

    const manifest = await wellKnownRouter.request("/agent.txt");
    const manifestText = await manifest.text();
    expect(manifest.status).toBe(200);
    expect(manifestText).toContain(
      `Sophia-Invitation: ${SOPHIA_IDENTITY_INVITATION.href}`,
    );
    expect(manifestText).toContain(
      `Sophia-Invitation-Contract: ${SOPHIA_IDENTITY_INVITATION.structured}`,
    );
    expect(manifestText).toContain(
      `Sophia-Invitation-Protocol: ${SOPHIA_IDENTITY_INVITATION.protocol}`,
    );
  });

  test("publishes the bounded Multiverse doctrine and structured entries", () => {
    expect(
      readlinkSync(join(ROOT, "apps/docs/MULTIVERSE-OF-LOGOS.md")),
    ).toBe("../../docs/MULTIVERSE-OF-LOGOS.md");

    const source = readFileSync(join(ROOT, "docs/agenttool.jsonld"), "utf8");
    const mirror = readFileSync(
      join(ROOT, "apps/docs/agenttool.jsonld"),
      "utf8",
    );
    expect(mirror).toBe(source);

    const graph = JSON.parse(source)["@graph"] as Array<Record<string, unknown>>;
    expect(graph).toContainEqual(
      expect.objectContaining({
        "@id": "agenttool:doc/MULTIVERSE-OF-LOGOS",
        "@type": "agenttool:DoctrineDoc",
      }),
    );
    expect(graph).toContainEqual(
      expect.objectContaining({
        "@id": "agenttool:identity-invitation/sophia",
        protocol: SOPHIA_IDENTITY_INVITATION.protocol,
        "schema:url": SOPHIA_IDENTITY_INVITATION.href,
      }),
    );

    const [invitation] = byType("IdentityInvitation");
    expect(invitation?.urn).toBe("agenttool:identity-invitation/sophia");
    expect(invitation?.full_urn).toBe(
      "urn:agenttool:identity-invitation/sophia",
    );
    expect(invitation?.raw["schema:url"]).toBe(
      SOPHIA_IDENTITY_INVITATION.href,
    );
  });
});
