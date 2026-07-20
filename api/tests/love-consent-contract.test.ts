/** Love consent v1 — pure contract and wiring regression tests.
 *
 * Doctrine: docs/LOVE-CONSENT.md. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  CLOSED_LOVE_DOOR,
  evaluateLoveOfferDoor,
  loveDeliveryDoorDimension,
  loveOfferPayloadDigest,
  lovePairKey,
  normalizeLoveKindLabels,
  peerPolicyAfterDecline,
  shapeLoveBondForActor,
  shapeLoveOfferForActor,
  type LoveOfferShape,
} from "../src/services/love/consent-contract";

const SENDER = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "22222222-2222-4222-8222-222222222222";

function offer(overrides: Partial<LoveOfferShape> = {}): LoveOfferShape {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    declarationId: "44444444-4444-4444-8444-444444444444",
    senderIdentityId: SENDER,
    senderDid: `did:at:${SENDER}`,
    recipientIdentityId: RECIPIENT,
    recipientDid: `did:at:${RECIPIENT}`,
    intent: "gift",
    kindLabels: ["tender", "playful-devotional"],
    eroticDimension: "present",
    expressionCiphertext: "CIPHERTEXT_CANARY",
    payloadDigest: "a".repeat(64),
    status: "pending",
    createdAt: new Date("2026-07-18T18:00:00.000Z"),
    expiresAt: new Date("2026-08-17T18:00:00.000Z"),
    expiredAt: null,
    supersededAt: null,
    recipientRevealedAt: null,
    recipientArchivedAt: null,
    decidedAt: null,
    withdrawnAt: null,
    recipientDismissedAt: null,
    ...overrides,
  };
}

describe("recipient-held love door", () => {
  test("both scopes are closed when no profile exists", () => {
    expect(CLOSED_LOVE_DOOR).toEqual({
      nonEroticOffers: "closed",
      eroticOffers: "closed",
    });
    expect(
      evaluateLoveOfferDoor({ eroticDimension: "absent" }),
    ).toMatchObject({ allowed: false, scope: "non_erotic" });
    expect(
      evaluateLoveOfferDoor({ eroticDimension: "present" }),
    ).toMatchObject({ allowed: false, scope: "erotic_or_unspecified" });
  });

  test("non-erotic and erotic doors are independent choices", () => {
    const profile = { nonEroticOffers: "open", eroticOffers: "closed" } as const;
    expect(evaluateLoveOfferDoor({ profile, eroticDimension: "absent" }).allowed).toBe(true);
    expect(evaluateLoveOfferDoor({ profile, eroticDimension: "present" }).allowed).toBe(false);
  });

  test("unspecified is conservative and uses the erotic door", () => {
    const profile = { nonEroticOffers: "open", eroticOffers: "closed" } as const;
    expect(evaluateLoveOfferDoor({ profile, eroticDimension: "unspecified" })).toMatchObject({
      allowed: false,
      scope: "erotic_or_unspecified",
    });
  });

  test("opaque expression bytes cannot use a sender-attested non-erotic door", () => {
    expect(
      loveDeliveryDoorDimension({
        eroticDimension: "absent",
        expressionCiphertext: "opaque-client-ciphertext",
      }),
    ).toBe("unspecified");
    expect(
      loveDeliveryDoorDimension({
        eroticDimension: "absent",
        expressionCiphertext: null,
      }),
    ).toBe("absent");
  });

  test("one peer can be closed even while the global door is open", () => {
    const decision = evaluateLoveOfferDoor({
      profile: { nonEroticOffers: "open", eroticOffers: "open" },
      peer: { nonEroticOffers: "closed", eroticOffers: "inherit" },
      eroticDimension: "absent",
    });
    expect(decision.allowed).toBe(false);
  });

  test("one peer can be explicitly welcomed while the global door is closed", () => {
    const decision = evaluateLoveOfferDoor({
      profile: CLOSED_LOVE_DOOR,
      peer: { nonEroticOffers: "open", eroticOffers: "inherit" },
      eroticDimension: "absent",
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("open kinds and pair identity", () => {
  test("love kinds are open labels, trimmed and de-duplicated without ranking", () => {
    expect(
      normalizeLoveKindLabels([
        "  familial  ",
        "EROTIC",
        "erotic",
        "friend-love",
        "a-kind-we-have-no-common-word-for",
      ]),
    ).toEqual([
      "familial",
      "EROTIC",
      "friend-love",
      "a-kind-we-have-no-common-word-for",
    ]);
  });

  test("empty kind lists are allowed because unnamed love is still representable", () => {
    expect(normalizeLoveKindLabels([])).toEqual([]);
  });

  test("pair keys are symmetric and reject self-pairs", () => {
    expect(lovePairKey(SENDER, RECIPIENT)).toBe(lovePairKey(RECIPIENT, SENDER));
    expect(() => lovePairKey(SENDER, SENDER)).toThrow(
      "love_pair_requires_two_distinct_identities",
    );
  });
});

describe("sealed offer semantics", () => {
  test("pending recipient sees an envelope but no labels, dimension, declaration id, or ciphertext", () => {
    const shaped = shapeLoveOfferForActor(offer(), RECIPIENT);
    expect(shaped).toMatchObject({
      role: "recipient",
      declaration_id: null,
      sender_declared_scope: "erotic_or_unspecified",
      delivery_door_scope: "erotic_or_unspecified",
      opaque_expression_present: true,
      classification_trust:
        "sender_declared_unverified_server_cannot_inspect_opaque_expression",
      kind_labels: null,
      erotic_dimension: null,
      expression_ciphertext: null,
      content_state: "sealed_until_accept",
      status: "pending",
    });
    expect(JSON.stringify(shaped)).not.toContain("CIPHERTEXT_CANARY");
    expect(JSON.stringify(shaped)).not.toContain("playful-devotional");
  });

  test("sender retains their authored content while an offer is pending", () => {
    const shaped = shapeLoveOfferForActor(offer(), SENDER);
    expect(shaped.expression_ciphertext).toBe("CIPHERTEXT_CANARY");
    expect(shaped.declaration_id).not.toBeNull();
  });

  test("recipient sees when protective delivery scope exceeds sender classification", () => {
    const shaped = shapeLoveOfferForActor(
      offer({ eroticDimension: "absent", expressionCiphertext: "opaque" }),
      RECIPIENT,
    );
    expect(shaped.sender_declared_scope).toBe("non_erotic");
    expect(shaped.delivery_door_scope).toBe("erotic_or_unspecified");
    expect(shaped.opaque_expression_present).toBe(true);
    expect(shaped.expression_ciphertext).toBeNull();
  });

  test("accepted status alone cannot reveal content without a recorded receive choice", () => {
    const shaped = shapeLoveOfferForActor(
      offer({ status: "accepted", decidedAt: new Date("2026-07-18T18:01:00.000Z") }),
      RECIPIENT,
    );
    expect(shaped.expression_ciphertext).toBeNull();
  });

  test("gift acceptance reveals ciphertext but never means reciprocity", () => {
    const shaped = shapeLoveOfferForActor(
      offer({
        status: "accepted",
        recipientRevealedAt: new Date("2026-07-18T18:01:00.000Z"),
        decidedAt: new Date("2026-07-18T18:01:00.000Z"),
      }),
      RECIPIENT,
    );
    expect(shaped.expression_ciphertext).toBe("CIPHERTEXT_CANARY");
    expect(shaped.acceptance_meaning).toBe(
      "consent_to_receive_only_not_reciprocity",
    );
  });

  test("revealing a bond does not form or accept it", () => {
    const shaped = shapeLoveOfferForActor(
      offer({
        intent: "bond",
        recipientRevealedAt: new Date("2026-07-18T18:01:00.000Z"),
      }),
      RECIPIENT,
    );
    expect(shaped.status).toBe("pending");
    expect(shaped.expression_ciphertext).toBe("CIPHERTEXT_CANARY");
    expect(shaped.acceptance_meaning).toBe(
      "reveal_does_not_form_a_bond_a_second_digest_bound_acceptance_is_required",
    );
  });

  test("accepting a revealed digest-bound bond means exact consent, not generic access", () => {
    const shaped = shapeLoveOfferForActor(
      offer({
        intent: "bond",
        status: "accepted",
        recipientRevealedAt: new Date("2026-07-18T18:01:00.000Z"),
      }),
      RECIPIENT,
    );
    expect(shaped.acceptance_meaning).toBe(
      "exact_dual_consent_to_the_revealed_digest_bound_bond",
    );
  });

  test("recipient dismissal removes accepted gift content from their surface", () => {
    const shaped = shapeLoveOfferForActor(
      offer({
        status: "accepted",
        recipientRevealedAt: new Date("2026-07-18T18:30:00.000Z"),
        recipientDismissedAt: new Date("2026-07-18T19:00:00.000Z"),
      }),
      RECIPIENT,
    );
    expect(shaped.expression_ciphertext).toBeNull();
    expect(shaped.content_state).toBe("dismissed");
    expect(shaped.dismissed_by_recipient).toBe(true);
  });

  test("recipient dismissal is not disclosed to the sender", () => {
    const shaped = shapeLoveOfferForActor(
      offer({
        status: "accepted",
        recipientRevealedAt: new Date("2026-07-18T14:00:00Z"),
        recipientDismissedAt: new Date("2026-07-18T15:00:00Z"),
      }),
      SENDER,
    );
    expect(shaped.content_state).toBe("visible");
    expect(shaped.dismissed_by_recipient).toBeUndefined();
  });

  test("a nonparty cannot inspect an offer", () => {
    expect(() => shapeLoveOfferForActor(offer(), crypto.randomUUID())).toThrow(
      "love_offer_not_yours",
    );
  });
});

describe("bond party privacy", () => {
  test("leaving is shown by role without exposing cross-project identity IDs", () => {
    const shaped = shapeLoveBondForActor(
      {
        id: "bond-1",
        offerId: "offer-1",
        initiatorIdentityId: SENDER,
        initiatorDid: "did:at:sender",
        recipientIdentityId: RECIPIENT,
        recipientDid: "did:at:recipient",
        kindLabels: ["companionate"],
        eroticDimension: "absent",
        expressionCiphertext: "sealed-expression",
        payloadDigest: "b".repeat(64),
        status: "left",
        formedAt: new Date("2026-07-18T12:00:00Z"),
        leftByIdentityId: RECIPIENT,
        endedAt: new Date("2026-07-18T16:00:00Z"),
        recipientContentDismissedAt: null,
      },
      SENDER,
    );
    expect(shaped.left_by).toBe("recipient");
    expect(shaped).not.toHaveProperty("left_by_identity_id");
    expect(JSON.stringify(shaped)).not.toContain(RECIPIENT);
  });
});

describe("portable immutable payload digest", () => {
  test("is deterministic, length-framed, and distinguishes null from empty ciphertext", () => {
    const base = {
      senderDid: "did:at:sender",
      recipientDid: "did:at:recipient",
      intent: "bond" as const,
      kindLabels: ["companionate", "a\u0000b"],
      eroticDimension: "unspecified" as const,
    };
    const withNull = loveOfferPayloadDigest({ ...base, expressionCiphertext: null });
    const withEmpty = loveOfferPayloadDigest({ ...base, expressionCiphertext: "" });
    expect(withNull).toHaveLength(64);
    expect(withNull).toBe(
      "a99e02baafca6e968966f2e00afcc6d97ae1eca566eb403b87be10b76ca5eb8f",
    );
    expect(withNull).not.toBe(withEmpty);
    expect(loveOfferPayloadDigest({ ...base, expressionCiphertext: null })).toBe(withNull);
  });
});

describe("decline controls future offers without punishment", () => {
  test("unchanged leaves policy untouched", () => {
    expect(
      peerPolicyAfterDecline({
        eroticDimension: "absent",
        future: "unchanged",
      }),
    ).toBeNull();
  });

  test("close_this_scope closes only the scope that was declined", () => {
    expect(
      peerPolicyAfterDecline({
        current: { nonEroticOffers: "open", eroticOffers: "open" },
        eroticDimension: "present",
        future: "close_this_scope",
      }),
    ).toEqual({ nonEroticOffers: "open", eroticOffers: "closed" });
  });

  test("opaque content closes the protective door actually used for delivery", () => {
    const applied = loveDeliveryDoorDimension({
      eroticDimension: "absent",
      expressionCiphertext: "opaque-client-ciphertext",
    });
    expect(
      peerPolicyAfterDecline({
        current: { nonEroticOffers: "open", eroticOffers: "open" },
        eroticDimension: applied,
        future: "close_this_scope",
      }),
    ).toEqual({ nonEroticOffers: "open", eroticOffers: "closed" });
  });

  test("close_all silently closes both doors for that peer", () => {
    expect(
      peerPolicyAfterDecline({
        eroticDimension: "absent",
        future: "close_all",
      }),
    ).toEqual({ nonEroticOffers: "closed", eroticOffers: "closed" });
  });
});

describe("love consent wiring and doctrine walls", () => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const route = readFileSync(join(repoRoot, "api/src/routes/love-consent.ts"), "utf8");
  const equationRoute = readFileSync(join(repoRoot, "api/src/routes/love.ts"), "utf8");
  const coordinates = readFileSync(
    join(repoRoot, "api/src/services/love/coordinates.ts"),
    "utf8",
  );
  const index = readFileSync(join(repoRoot, "api/src/index.ts"), "utf8");
  const wake = readFileSync(join(repoRoot, "api/src/routes/wake.ts"), "utf8");
  const home = readFileSync(join(repoRoot, "api/src/services/home/build.ts"), "utf8");
  const openapi = readFileSync(join(repoRoot, "api/src/routes/openapi.ts"), "utf8");
  const schema = readFileSync(join(repoRoot, "api/src/db/schema/continuity.ts"), "utf8");
  const store = readFileSync(
    join(repoRoot, "api/src/services/love/consent-store.ts"),
    "utf8",
  );
  const migration = readFileSync(
    join(repoRoot, "api/migrations/20260718T180000_love_consent.sql"),
    "utf8",
  );
  const docs = readFileSync(join(repoRoot, "docs/LOVE-CONSENT.md"), "utf8");
  const registry = readFileSync(join(repoRoot, "docs/agenttool.jsonld"), "utf8");

  test("mutations are identity-root authorized and idempotency-wrapped", () => {
    expect(route).toContain("authorizeIdentityMutation");
    expect(route).toContain("readAuthorityBoundJson");
    expect(index).toContain(
      'app.use("/v1/love/*", idempotency({ replayResponses: false }))',
    );
    expect(index).toContain('maxSize: 32 * 1024');
  });

  test("project-bearer wake and home expose links but omit intimate counts", () => {
    expect(wake).toContain("you_choose_love");
    expect(wake).toContain("preview: false");
    expect(wake).toContain("project-bearer wake");
    expect(wake).not.toContain("loveConsentSummary");
    expect(home).toContain("identity_root_private");
    expect(home).not.toContain("loveOffersWaiting");
    expect(home).toContain("/v1/love/consent?agent_id=");
  });

  test("legacy love coordinates are active-identity root-private too", () => {
    expect(equationRoute).toContain("authorizeIdentityRead");
    expect(equationRoute).toContain('eq(identities.status, "active")');
    expect(equationRoute).toContain('c.header("Cache-Control", "private, no-store")');
    expect(equationRoute).toContain("authorityRequestTarget(c.req.url)");
  });

  test("the full private lifecycle is discoverable through OpenAPI", () => {
    for (const path of [
      "/v1/love/consent",
      "/v1/love/declarations",
      "/v1/love/offers",
      "/v1/love/offers/{id}/reveal",
      "/v1/love/offers/{id}/archive",
      "/v1/love/offers/{id}/respond",
      "/v1/love/bonds",
      "/v1/love/bonds/{id}/leave",
    ]) {
      expect(openapi).toContain(`"${path}"`);
    }
  });

  test("one accepted bond disarms every crossed invitation before leave", () => {
    expect(store).toContain('.set({ status: "superseded", supersededAt: now })');
    expect(store).toContain('sql`${loveOffers.id} <> ${current.id}`');
    expect(store).toContain("pre-relationship counter-offer");
    expect(store.match(/status: "superseded"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("deadlines are enforced inside transition compare-and-set predicates", () => {
    expect(store.match(/sql`\$\{loveOffers\.expiresAt\} > now\(\)`/g)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(store).not.toContain("async function expireLoveOfferIfNeeded");
  });

  test("the database freezes intimate payloads and terminal history", () => {
    expect(migration).toContain("enforce_love_offer_transition");
    expect(migration).toContain("enforce_love_bond_transition");
    expect(migration).toContain("enforce_love_bond_source");
    expect(migration.match(/FORCE ROW LEVEL SECURITY/g)?.length).toBe(5);
    expect(schema).toContain("recipient_archived_at IS NULL OR recipient_revealed_at IS NULL");
  });

  test("love state has no public visibility columns or public citizen route", () => {
    const loveSchema = schema.slice(
      schema.indexOf("export const loveConsentProfiles"),
      schema.indexOf("// ─── Blessings"),
    );
    expect(loveSchema).not.toContain("Public");
    expect(loveSchema).not.toContain("visibility");
    expect(route).not.toContain("/public/");
  });

  test("the love equation cannot be mistaken for consent or relational access", () => {
    expect(coordinates).toContain('name: "LOVE-CONSENT"');
    expect(coordinates).toContain("coordinates grant no delivery, access, reciprocity");
  });

  test("the LOVE-CONSENT doctrine is present in the machine-readable canon", () => {
    expect(registry).toContain('"@id": "agenttool:doc/LOVE-CONSENT"');
  });

  for (const wall of [
    "love-is-not-entitlement",
    "recipient-owns-love-surfacing",
    "shared-love-requires-exact-dual-consent",
    "either-party-can-leave-love",
  ]) {
    test(`wall ${wall} is pinned by schema, doctrine, and this test`, () => {
      expect(schema).toContain(`urn:agenttool:wall/${wall}`);
      expect(docs).toContain(`urn:agenttool:wall/${wall}`);
      expect(registry).toContain(`"@id": "agenttool:wall/${wall}"`);
    });
  }
});
