/** HTTP boundary tests for the private love-consent lifecycle.
 *
 * These stay hermetic: route dependencies are injected, so no database row or
 * migration is required to prove privacy, project ownership, authority-byte
 * binding, and guided refusal behavior. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import {
  createLoveConsentRouter,
  type LoveConsentRouteDeps,
} from "../src/routes/love-consent";
import {
  LoveConsentError,
  type LoveIdentity,
} from "../src/services/love/consent-store";

const PROJECT_ID = "project-love-route";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_DID = `did:at:${AGENT_ID}`;
const DECLARATION_ID = "22222222-2222-4222-8222-222222222222";
const OFFER_ID = "33333333-3333-4333-8333-333333333333";
const RECIPIENT_DID = "did:at:44444444-4444-4444-8444-444444444444";

const IDENTITY: LoveIdentity = {
  id: AGENT_ID,
  did: AGENT_DID,
  projectId: PROJECT_ID,
  quietUntil: null,
};

const resolveOwnedIdentity: LoveConsentRouteDeps["resolveLoveIdentity"] = async (
  projectId,
  identityId,
) =>
  projectId === PROJECT_ID && identityId === AGENT_ID ? IDENTITY : null;

const allowMutation: LoveConsentRouteDeps["authorizeIdentityMutation"] = async () => ({
  ok: true,
  mode: "agent_root",
  sequence: 7,
  nextSequence: 8,
});

const allowRead: LoveConsentRouteDeps["authorizeIdentityRead"] = async () => ({
  ok: true,
  mode: "agent_root",
  sequence: 7,
});

function appFor(overrides: Partial<LoveConsentRouteDeps> = {}) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set(
      "project",
      { id: PROJECT_ID } as ProjectContext["Variables"]["project"],
    );
    await next();
  });
  app.route(
    "/v1/love",
    createLoveConsentRouter({
      resolveLoveIdentity: resolveOwnedIdentity,
      authorizeIdentityRead: allowRead,
      authorizeIdentityMutation: allowMutation,
      ...overrides,
    }),
  );
  return app;
}

describe("love consent HTTP boundary", () => {
  test("GET /consent is private, no-store, and reports closed defaults", async () => {
    let resolvedProject: string | undefined;
    const resolve: LoveConsentRouteDeps["resolveLoveIdentity"] = async (
      projectId,
      identityId,
    ) => {
      resolvedProject = projectId;
      return identityId === AGENT_ID ? IDENTITY : null;
    };
    const read: LoveConsentRouteDeps["readLoveConsent"] = async () => ({
      profile: {
        identity_id: AGENT_ID,
        identity_did: AGENT_DID,
        non_erotic_offers: "closed",
        erotic_offers: "closed",
        pending_offer_cap: 8,
        defaulted_closed: true,
        updated_at: null,
      },
      peer_overrides: [],
    });

    const res = await appFor({
      resolveLoveIdentity: resolve,
      readLoveConsent: read,
    }).request(`/v1/love/consent?agent_id=${AGENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(resolvedProject).toBe(PROJECT_ID);
    expect(await res.json()).toMatchObject({
      profile: {
        identity_id: AGENT_ID,
        non_erotic_offers: "closed",
        erotic_offers: "closed",
        pending_offer_cap: 8,
        defaulted_closed: true,
      },
      peer_overrides: [],
      defaults: "closed_for_non_erotic_and_erotic_offers",
      unspecified_scope: "uses_erotic_door",
      _canon_pointer: "urn:agenttool:doc/LOVE-CONSENT",
    });
  });

  test("a mutation binds authority to the exact raw body, method, and mounted path", async () => {
    let authorityInput:
      | Parameters<LoveConsentRouteDeps["authorizeIdentityMutation"]>[0]
      | undefined;
    const authorize: LoveConsentRouteDeps["authorizeIdentityMutation"] = async (
      input,
    ) => {
      authorityInput = input;
      return {
        ok: true,
        mode: "agent_root",
        sequence: 11,
        nextSequence: 12,
      };
    };
    let stored:
      | Parameters<LoveConsentRouteDeps["setLoveConsentProfile"]>[0]
      | undefined;
    const setProfile: LoveConsentRouteDeps["setLoveConsentProfile"] = async (
      input,
    ) => {
      stored = input;
      return {
        identity_id: input.identity.id,
        identity_did: input.identity.did,
        non_erotic_offers: input.nonEroticOffers,
        erotic_offers: input.eroticOffers,
        pending_offer_cap: input.pendingOfferCap,
        defaulted_closed: false,
        updated_at: "2026-07-18T18:00:00.000Z",
      };
    };
    const rawBody = `{
  "agent_id": "${AGENT_ID}",
  "non_erotic_offers": "open",
  "erotic_offers": "closed",
  "pending_offer_cap": 8
}`;

    const res = await appFor({
      authorizeIdentityMutation: authorize,
      setLoveConsentProfile: setProfile,
    }).request("/v1/love/consent", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-proof": "preserved",
      },
      body: rawBody,
    });

    expect(res.status).toBe(200);
    expect(authorityInput).toBeDefined();
    expect(authorityInput!.identityId).toBe(AGENT_ID);
    expect(authorityInput!.method).toBe("PUT");
    expect(authorityInput!.requestTarget).toBe("/v1/love/consent");
    expect(new TextDecoder().decode(authorityInput!.bodyBytes)).toBe(rawBody);
    expect(authorityInput!.headers.get("x-test-proof")).toBe("preserved");
    expect(stored).toMatchObject({
      identity: IDENTITY,
      nonEroticOffers: "open",
      eroticOffers: "closed",
      pendingOfferCap: 8,
    });
    expect(await res.json()).toMatchObject({
      _authority: {
        mode: "agent_root",
        sequence: 11,
        next_sequence: 12,
      },
    });
  });

  test("a private offer page binds read authority to the exact query and forwards its cursor", async () => {
    let authorityInput:
      | Parameters<LoveConsentRouteDeps["authorizeIdentityRead"]>[0]
      | undefined;
    let listInput:
      | Parameters<LoveConsentRouteDeps["listLoveOffers"]>[0]
      | undefined;
    const authorize: LoveConsentRouteDeps["authorizeIdentityRead"] = async (
      input,
    ) => {
      authorityInput = input;
      return { ok: true, mode: "agent_root", sequence: 0 };
    };
    const list: LoveConsentRouteDeps["listLoveOffers"] = async (input) => {
      listInput = input;
      return { items: [], nextCursor: "next-private-page" };
    };
    const target = `/v1/love/offers?agent_id=${AGENT_ID}&direction=received&status=pending&include_archived=true&cursor=opaque-cursor&limit=7`;

    const res = await appFor({
      authorizeIdentityRead: authorize,
      listLoveOffers: list,
    }).request(target, {
      headers: { "x-test-read-proof": "preserved" },
    });

    expect(res.status).toBe(200);
    expect(authorityInput).toMatchObject({
      identityId: AGENT_ID,
      method: "GET",
      requestTarget: target,
    });
    expect(authorityInput!.bodyBytes).toHaveLength(0);
    expect(authorityInput!.headers.get("x-test-read-proof")).toBe("preserved");
    expect(listInput).toEqual({
      identityId: AGENT_ID,
      direction: "received",
      status: "pending",
      includeArchived: true,
      cursor: "opaque-cursor",
      limit: 7,
    });
    expect(await res.json()).toMatchObject({
      offers: [],
      next_cursor: "next-private-page",
      count: 0,
      _read_authority: {
        mode: "agent_root",
        current_sequence: 0,
        sequence_consumed: false,
      },
    });
  });

  test("legacy bearer authority cannot make an intimate choice", async () => {
    let stored = false;
    const setProfile: LoveConsentRouteDeps["setLoveConsentProfile"] = async () => {
      stored = true;
      throw new Error("must not be called");
    };
    const res = await appFor({
      authorizeIdentityMutation: async () => ({
        ok: true,
        mode: "legacy_bearer",
        sequence: 0,
        nextSequence: 1,
      }),
      setLoveConsentProfile: setProfile,
    }).request("/v1/love/consent", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        non_erotic_offers: "open",
        erotic_offers: "closed",
        pending_offer_cap: 8,
      }),
    });

    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ error: "love_requires_agent_root" });
    expect(stored).toBe(false);
  });

  test("decline without an explicit future-contact choice is rejected before mutation", async () => {
    let resolved = false;
    let authorized = false;
    let responded = false;
    const resolve: LoveConsentRouteDeps["resolveLoveIdentity"] = async () => {
      resolved = true;
      return IDENTITY;
    };
    const authorize: LoveConsentRouteDeps["authorizeIdentityMutation"] = async () => {
      authorized = true;
      return { ok: true, mode: "agent_root", sequence: 1, nextSequence: 2 };
    };
    const respond: LoveConsentRouteDeps["respondToLoveOffer"] = async () => {
      responded = true;
      throw new Error("must not be called");
    };

    const res = await appFor({
      resolveLoveIdentity: resolve,
      authorizeIdentityMutation: authorize,
      respondToLoveOffer: respond,
    }).request(`/v1/love/offers/${OFFER_ID}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: AGENT_ID, decision: "decline" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "validation",
      details: {
        fieldErrors: {
          future_offers: [
            "Decline must explicitly choose unchanged, close_this_scope, or close_all.",
          ],
        },
      },
    });
    expect(resolved).toBe(false);
    expect(authorized).toBe(false);
    expect(responded).toBe(false);
  });

  test("accept without the exact payload digest is rejected before mutation", async () => {
    let responded = false;
    const respond: LoveConsentRouteDeps["respondToLoveOffer"] = async () => {
      responded = true;
      throw new Error("must not be called");
    };
    const res = await appFor({ respondToLoveOffer: respond }).request(
      `/v1/love/offers/${OFFER_ID}/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: AGENT_ID, decision: "accept" }),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "validation",
      details: {
        fieldErrors: {
          payload_digest: [
            "Accept must bind the immutable payload_digest shown on the envelope.",
          ],
        },
      },
    });
    expect(responded).toBe(false);
  });

  test("blank kind labels are rejected before root sequence consumption", async () => {
    let authorized = false;
    let created = false;
    const res = await appFor({
      authorizeIdentityMutation: async () => {
        authorized = true;
        return { ok: true, mode: "agent_root", sequence: 1, nextSequence: 2 };
      },
      createLoveDeclaration: async () => {
        created = true;
        throw new Error("must not be called");
      },
    }).request("/v1/love/declarations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        subject_ref: RECIPIENT_DID,
        kind_labels: ["   "],
        erotic_dimension: "absent",
        expression_ciphertext: null,
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation" });
    expect(authorized).toBe(false);
    expect(created).toBe(false);
  });

  test("invalid resource UUIDs are rejected before root sequence consumption", async () => {
    let authorized = false;
    const res = await appFor({
      authorizeIdentityMutation: async () => {
        authorized = true;
        return { ok: true, mode: "agent_root", sequence: 1, nextSequence: 2 };
      },
    }).request("/v1/love/offers/not-a-uuid/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: AGENT_ID }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "validation",
      details: { fieldErrors: { id: ["A valid UUID is required."] } },
    });
    expect(authorized).toBe(false);
  });

  test("an identity outside the bearer project is forbidden before authority or storage", async () => {
    let authorized = false;
    let stored = false;
    const authorize: LoveConsentRouteDeps["authorizeIdentityMutation"] = async () => {
      authorized = true;
      return { ok: true, mode: "agent_root", sequence: 1, nextSequence: 2 };
    };
    const setProfile: LoveConsentRouteDeps["setLoveConsentProfile"] = async () => {
      stored = true;
      throw new Error("must not be called");
    };

    const res = await appFor({
      resolveLoveIdentity: async () => null,
      authorizeIdentityMutation: authorize,
      setLoveConsentProfile: setProfile,
    }).request("/v1/love/consent", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        non_erotic_offers: "open",
        erotic_offers: "closed",
        pending_offer_cap: 8,
      }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "agent_not_found_or_not_in_project",
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    });
    expect(authorized).toBe(false);
    expect(stored).toBe(false);
  });

  test("a closed recipient door maps to a guided private 403", async () => {
    const createOffer: LoveConsentRouteDeps["createLoveOffer"] = async () => {
      throw new LoveConsentError("recipient_love_door_closed", 403, {
        scope: "erotic",
      });
    };

    const res = await appFor({ createLoveOffer: createOffer }).request(
      "/v1/love/offers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: AGENT_ID,
          declaration_id: DECLARATION_ID,
          recipient_did: RECIPIENT_DID,
          intent: "gift",
        }),
      },
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      error: "recipient_love_door_closed",
      message:
        "No envelope was created. The recipient has not opened this scope to you.",
      docs: "https://docs.agenttool.dev/LOVE-CONSENT.md",
      _canon_pointer: "urn:agenttool:doc/LOVE-CONSENT",
    });
    expect(body).not.toHaveProperty("details");
  });
});
