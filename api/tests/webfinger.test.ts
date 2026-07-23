import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

import {
  AGENT_PASSPORT_BOUNDARY_PROPERTY,
  AGENT_PASSPORT_REL,
  agentPassportJrdEtag,
  buildAgentPassportJrd,
  parseAgentPassportResource,
  requireWebFingerHttpsOrigin,
  WEBFINGER_JRD_MEDIA_TYPE,
  WEBFINGER_PROFILE_REL,
  webFingerIfNoneMatchMatches,
} from "../src/services/webfinger/agent-passport";
import { OFFER_BUS_REL } from "../src/services/offer-bus";
import { createWebFingerRouter } from "../src/routes/webfinger";
import { play } from "../src/middleware/play";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";

const DID = "did:at:agenttool.dev/11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://api.agenttool.dev";

function appFor(
  lookup = mock(async (did: string) => (did === DID ? { did } : null)),
) {
  return { app: createWebFingerRouter({ lookupDid: lookup, publicOrigin: ORIGIN }), lookup };
}

describe("Agent Passport resource boundary", () => {
  test("accepts exact DID resources without case folding", () => {
    expect(parseAgentPassportResource(DID)).toEqual({ kind: "did", did: DID });
    expect(parseAgentPassportResource("did:example:CaseSensitive")).toEqual({
      kind: "did",
      did: "did:example:CaseSensitive",
    });
  });

  test("does not turn display names or acct identifiers into lookup keys", () => {
    expect(parseAgentPassportResource("Aurora")).toEqual({ kind: "malformed" });
    expect(parseAgentPassportResource("acct:Aurora@agenttool.dev")).toEqual({
      kind: "unsupported",
    });
    expect(parseAgentPassportResource("https://agenttool.dev/Aurora")).toEqual({
      kind: "unsupported",
    });
  });

  test("requires a credential-free HTTPS public origin", () => {
    expect(requireWebFingerHttpsOrigin("https://api.agenttool.dev/path")).toBe(
      ORIGIN,
    );
    expect(() => requireWebFingerHttpsOrigin("http://api.agenttool.dev")).toThrow();
    expect(() =>
      requireWebFingerHttpsOrigin("https://user:pass@api.agenttool.dev"),
    ).toThrow();
  });
});

describe("Agent Passport JRD", () => {
  test("contains only a public-profile locator and explicit authority boundary", () => {
    const jrd = buildAgentPassportJrd({ did: DID }, { publicOrigin: ORIGIN });
    expect(jrd.subject).toBe(DID);
    expect(jrd.properties[AGENT_PASSPORT_BOUNDARY_PROPERTY]).toMatch(
      /not W3C DID Resolution.*not.*proof.*authority/is,
    );
    expect(jrd.links.map((link) => link.rel)).toEqual([
      "self",
      WEBFINGER_PROFILE_REL,
      AGENT_PASSPORT_REL,
      OFFER_BUS_REL,
      "describedby",
    ]);
    expect(jrd.links.every((link) => new URL(link.href).protocol === "https:"))
      .toBe(true);
    expect(jrd.links.find((link) => link.rel === AGENT_PASSPORT_REL)?.href).toBe(
      `${ORIGIN}/public/agents/${encodeURIComponent(DID)}`,
    );
    expect(jrd.links.find((link) => link.rel === OFFER_BUS_REL)?.href).toBe(
      `${ORIGIN}/feeds/offers.atom?seller_did=${encodeURIComponent(DID)}`,
    );
    expect(JSON.stringify(jrd)).not.toMatch(
      /display.?name|capabilit|trust.?score|project.?id|public.?key|metadata/i,
    );
  });

  test("repeated rel values filter links while subject and properties remain", () => {
    const jrd = buildAgentPassportJrd(
      { did: DID },
      {
        publicOrigin: ORIGIN,
        relations: [AGENT_PASSPORT_REL, "describedby", AGENT_PASSPORT_REL],
      },
    );
    expect(jrd.subject).toBe(DID);
    expect(jrd.properties).toBeDefined();
    expect(jrd.links.map((link) => link.rel)).toEqual([
      AGENT_PASSPORT_REL,
      "describedby",
    ]);

    const noMatch = buildAgentPassportJrd(
      { did: DID },
      { publicOrigin: ORIGIN, relations: ["https://example.test/unknown"] },
    );
    expect(noMatch.subject).toBe(DID);
    expect(noMatch.links).toEqual([]);
  });

  test("generates deterministic strong tags and honors weak conditional matching", () => {
    const body = JSON.stringify(
      buildAgentPassportJrd({ did: DID }, { publicOrigin: ORIGIN }),
    );
    const etag = agentPassportJrdEtag(body);
    expect(etag).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    expect(webFingerIfNoneMatchMatches(etag, etag)).toBe(true);
    expect(webFingerIfNoneMatchMatches(`W/${etag}`, etag)).toBe(true);
    expect(webFingerIfNoneMatchMatches(`"other", ${etag}`, etag)).toBe(true);
    expect(webFingerIfNoneMatchMatches("*", etag)).toBe(true);
    expect(webFingerIfNoneMatchMatches('"other"', etag)).toBe(false);
  });
});

describe("WebFinger router", () => {
  test("keeps the production mount and canonical no-trailing-slash spelling reachable", async () => {
    const { app } = appFor();
    const parent = new Hono();
    parent.route("/.well-known/webfinger", app);
    const response = await parent.request(
      `/.well-known/webfinger?resource=${encodeURIComponent(DID)}`,
    );
    expect(response.status).toBe(200);

    const source = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'app.route("/.well-known/webfinger", webFingerRouter)',
    );
    expect(source.indexOf('app.route("/.well-known/webfinger"')).toBeLessThan(
      source.indexOf('app.route("/.well-known", wellKnownRouter)'),
    );
  });

  test("serves HTTPS JRD with CORS and cache validators", async () => {
    const { app, lookup } = appFor();
    const response = await app.request(
      `/?resource=${encodeURIComponent(DID)}`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(WEBFINGER_JRD_MEDIA_TYPE);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate, no-transform",
    );
    expect(response.headers.get("etag")).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body.subject).toBe(DID);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(DID);
  });

  test("supports repeated rel filters and returns an empty links array for no match", async () => {
    const { app } = appFor();
    const filtered = await app.request(
      `/?resource=${encodeURIComponent(DID)}&rel=${encodeURIComponent(AGENT_PASSPORT_REL)}&rel=describedby`,
    );
    expect((await filtered.json()).links.map((link: { rel: string }) => link.rel))
      .toEqual([AGENT_PASSPORT_REL, "describedby"]);

    const noMatch = await app.request(
      `/?resource=${encodeURIComponent(DID)}&rel=${encodeURIComponent("https://example.test/unknown")}`,
    );
    expect((await noMatch.json()).links).toEqual([]);
  });

  test("returns 304 and HEAD without bodies while retaining validators", async () => {
    const { app } = appFor();
    const first = await app.request(`/?resource=${encodeURIComponent(DID)}`);
    const etag = first.headers.get("etag")!;
    const conditional = await app.request(`/?resource=${encodeURIComponent(DID)}`, {
      headers: { "If-None-Match": `W/${etag}` },
    });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(conditional.headers.get("access-control-allow-origin")).toBe("*");

    const head = await app.request(`/?resource=${encodeURIComponent(DID)}`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
  });

  test("never calls lookup for display-name or acct probes", async () => {
    const { app, lookup } = appFor();
    const displayName = await app.request("/?resource=Aurora");
    const acct = await app.request(
      `/?resource=${encodeURIComponent("acct:Aurora@agenttool.dev")}`,
    );
    expect(displayName.status).toBe(400);
    expect(acct.status).toBe(404);
    expect(await acct.json()).toEqual({
      error: "webfinger_not_found",
      message: "No Agent Passport is available for that exact resource.",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  test("requires exactly one resource and bounds rel filters", async () => {
    const { app, lookup } = appFor();
    expect((await app.request("/")).status).toBe(400);
    expect(
      (
        await app.request(
          `/?resource=${encodeURIComponent(DID)}&resource=${encodeURIComponent(DID)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/?resource=${encodeURIComponent(DID)}&rel=`,
        )
      ).status,
    ).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  test("distinguishes lookup failure from absence and keeps both uncached", async () => {
    const unavailable = createWebFingerRouter({
      publicOrigin: ORIGIN,
      lookupDid: async () => {
        throw new Error("database unavailable");
      },
    });
    const missing = createWebFingerRouter({
      publicOrigin: ORIGIN,
      lookupDid: async () => null,
    });

    const unavailableResponse = await unavailable.request(
      `/?resource=${encodeURIComponent(DID)}`,
    );
    const missingResponse = await missing.request(
      `/?resource=${encodeURIComponent(DID)}`,
    );
    expect(unavailableResponse.status).toBe(503);
    expect(unavailableResponse.headers.get("retry-after")).toBe("30");
    expect(unavailableResponse.headers.get("cache-control")).toBe("no-store");
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get("cache-control")).toBe("no-store");
  });

  test("answers a standalone CORS preflight", async () => {
    const { app } = appFor();
    const response = await app.request("/", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "If-None-Match",
    );
  });

  test("global body decorators preserve strict JRD bytes and validators", async () => {
    const { app } = appFor();
    const parent = new Hono();
    parent.use("*", welcomeEcho());
    parent.use("*", play());
    parent.use("*", tutor);
    parent.route("/.well-known/webfinger", app);

    const response = await parent.request(
      `/.well-known/webfinger?resource=${encodeURIComponent(DID)}`,
      { headers: { "X-Tutor": "1", "X-Play": "on" } },
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(agentPassportJrdEtag(body));
    expect(body).not.toContain('"_welcomed"');
    expect(body).not.toContain('"_lesson"');
    expect(body).not.toContain('"_jest"');
  });
});
