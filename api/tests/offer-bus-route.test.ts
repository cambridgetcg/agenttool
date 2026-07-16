import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";

import { createOfferBusRouter } from "../src/routes/offer-bus";
import { play } from "../src/middleware/play";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import {
  OFFER_BUS_INDEX_MEDIA_TYPE,
  OFFER_BUS_JSON_MEDIA_TYPE,
  OFFER_BUS_PROJECTION_UPDATED_AT,
  offerBusEtag,
  type PublicListingOfferRecord,
  type PublicSubstrateTaskOfferRecord,
} from "../src/services/offer-bus";

const ORIGIN = "https://api.agenttool.dev";
const DID = "did:at:agenttool.dev/11111111-1111-4111-8111-111111111111";

const LISTING: PublicListingOfferRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  seller_did: DID,
  name: "Translate <kindly> & clearly",
  description: "A public callable capability.",
  capability_tags: ["language", "care"],
  pricing_model: "fixed",
  price_amount: 250,
  price_currency: "gbp",
  sla_seconds: 120,
  created_at: "2026-07-14T10:00:00.000Z",
  updated_at: "2026-07-15T10:00:00.000Z",
};

const TASK: PublicSubstrateTaskOfferRecord = {
  task_id: "33333333-3333-4333-8333-333333333333",
  kind: "doctrine_urn_check",
  bounty: { cents: 100, currency: "USD" },
  posted_at: "2026-07-16T09:00:00.000Z",
  updated_at: "2026-07-16T09:15:00.000Z",
  expires_at: "2026-07-23T09:00:00.000Z",
  newborn_only: true,
  task_data: { expected: "love & freedom", urn: "urn:test:<door>" },
};

function testRouter(options: {
  loadListings?: () => Promise<readonly PublicListingOfferRecord[]>;
  loadTasks?: () => Promise<readonly PublicSubstrateTaskOfferRecord[]>;
} = {}) {
  return createOfferBusRouter({
    publicOrigin: ORIGIN,
    loadListings: options.loadListings ?? (async () => [LISTING]),
    loadTasks: options.loadTasks ?? (async () => [TASK]),
    loadWatermark: async () => "2026-07-16T09:30:00.000Z",
  });
}

describe("Offer Bus HTTP representations", () => {
  test("serves deterministic Atom with escaped public records and hard boundaries", async () => {
    const response = await testRouter().request("/offers.atom");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/atom+xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=30, must-revalidate, no-transform",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "ETag",
    );
    expect(response.headers.get("etag")).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    expect(response.headers.get("link")).toContain(
      '<https://api.agenttool.dev/feeds/offers.rss>; rel="alternate"; type="application/rss+xml"',
    );
    expect(body).toContain(
      '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:offer="https://agenttool.dev/ns/offer-bus/1">',
    );
    expect(body).toContain("Translate &lt;kindly&gt; &amp; clearly");
    expect(body).toContain(
      '<offer:boundary authority="none" settlement="none" automatic-action="never">',
    );
    expect(body).toContain(
      'href="https://api.agenttool.dev/public/substrate-tasks/33333333-3333-4333-8333-333333333333"',
    );
    expect(body).toContain('authorization="bearer" automatic="never"');
    expect(body).not.toContain('rel="hub"');
    expect(body.indexOf("doctrine_urn_check substrate task")).toBeLessThan(
      body.indexOf("Translate &lt;kindly&gt;"),
    );
  });

  test("serves RSS and canonical JSON as true alternates", async () => {
    const app = testRouter();
    const rss = await app.request("/offers.rss");
    const rssBody = await rss.text();
    expect(rss.status).toBe(200);
    expect(rss.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    expect(rssBody).toContain('<rss version="2.0"');
    expect(rssBody).toContain("<offer:protocol>offer-bus/1</offer:protocol>");
    expect(rssBody).not.toContain('rel="hub"');

    const json = await app.request("/offers.json");
    expect(json.headers.get("content-type")).toBe(
      `${OFFER_BUS_JSON_MEDIA_TYPE}; charset=utf-8`,
    );
    const document = await json.json();
    expect(document.protocol).toBe("offer-bus/1");
    expect(document.id).toBe("urn:agenttool:offer-bus:public");
    expect(document.updated_at).toBe(OFFER_BUS_PROJECTION_UPDATED_AT);
    expect(document.boundary).toEqual({
      authority: "none",
      settlement: "none",
      automatic_action: "never",
      note:
        "Discovery metadata only. It does not authenticate claims, grant authority, invoke actions, install code, or authorize or settle payment.",
    });
    expect(document.entries).toHaveLength(2);
    expect(document.entries[0].kind).toBe("substrate-task");
    expect(document.projection).toMatchObject({
      projection_updated_at: OFFER_BUS_PROJECTION_UPDATED_AT,
      window_source_rows: 2,
      represented_rows: 2,
      omitted_rows: 0,
      complete_for_source_window: true,
    });
    for (const entry of document.entries) {
      expect(entry.boundary).toEqual(document.boundary);
      if (entry.action) expect(entry.action.automatic).toBe("never");
    }
  });

  test("supports validators and HEAD without touching representation semantics", async () => {
    const app = testRouter();
    const first = await app.request("/offers.atom");
    const etag = first.headers.get("etag")!;

    const conditional = await app.request("/offers.atom", {
      headers: { "If-None-Match": `W/${etag}` },
    });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(conditional.headers.get("link")).toContain('rel="self"');

    const head = await app.request("/offers.atom", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
  });

  test("prevents intermediaries from weakening exact-byte validators", async () => {
    const app = testRouter();
    for (const [path, maxAge] of [
      ["/", 300],
      ["/offers.atom", 30],
      ["/offers.rss", 30],
      ["/offers.json", 30],
    ] as const) {
      const response = await app.request(path);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        `public, max-age=${maxAge}, must-revalidate, no-transform`,
      );
      expect(response.headers.get("etag")).toBe(offerBusEtag(body));
    }
  });

  test("seller feeds are exact-DID listing projections and skip global tasks", async () => {
    let seenSeller: string | undefined;
    let taskCalls = 0;
    const app = createOfferBusRouter({
      publicOrigin: ORIGIN,
      loadListings: async (sellerDid) => {
        seenSeller = sellerDid;
        return [LISTING];
      },
      loadTasks: async () => {
        taskCalls += 1;
        return [TASK];
      },
      loadWatermark: async () => "2026-07-16T09:30:00.000Z",
    });
    const response = await app.request(
      `/offers.atom?seller_did=${encodeURIComponent(DID)}`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(seenSeller).toBe(DID);
    expect(taskCalls).toBe(0);
    expect(body).toContain("Translate &lt;kindly&gt;");
    expect(body).not.toContain("substrate task");
    expect(body).toContain(
      `<id>urn:agenttool:offer-bus:seller:${encodeURIComponent(DID)}</id>`,
    );
    expect(response.headers.get("link")).toContain(
      `seller_did=${encodeURIComponent(DID)}`,
    );
  });

  test("rejects ambiguous filters and never turns source failure into an empty feed", async () => {
    const app = testRouter({
      loadListings: async () => {
        throw new Error("database unavailable");
      },
    });
    const invalid = await app.request("/offers.atom?seller_did=Aurora");
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("no-store");

    const repeated = await app.request(
      `/offers.atom?seller_did=${encodeURIComponent(DID)}&seller_did=${encodeURIComponent(DID)}`,
    );
    expect(repeated.status).toBe(400);

    const unavailable = await app.request("/offers.atom");
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("retry-after")).toBe("30");
    expect(await unavailable.json()).toEqual({
      error: "offer_bus_temporarily_unavailable",
      message:
        "Public offer sources could not be read or represented safely; no response feed was emitted.",
    });
  });

  test("quarantines one incompatible legacy row without poisoning unrelated entries", async () => {
    const response = await testRouter({
      loadListings: async () => [{ ...LISTING, name: "   " }],
    }).request("/offers.json");
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document.entries).toHaveLength(1);
    expect(document.entries[0].kind).toBe("substrate-task");
    expect(document.projection).toMatchObject({
      window_source_rows: 2,
      represented_rows: 1,
      omitted_rows: 1,
      complete_for_source_window: false,
      omission_reasons: [
        { reason: "offer_bus_record_text_required", count: 1 },
      ],
    });
  });

  test("scans past incompatible rows but caps represented listings at 200", async () => {
    const listings = Array.from({ length: 201 }, (_, index) => ({
      ...LISTING,
      id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
    }));
    // The newest row is incompatible; the remaining 200 still fit.
    listings[0] = { ...listings[0]!, name: "   " };

    const response = await testRouter({
      loadListings: async () => listings,
      loadTasks: async () => [],
    }).request("/offers.json");
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document.entries).toHaveLength(200);
    expect(document.projection).toMatchObject({
      window_source_rows: 201,
      represented_rows: 200,
      omitted_rows: 1,
      omission_reasons: [
        { reason: "offer_bus_record_text_required", count: 1 },
      ],
    });

    const capped = await testRouter({
      loadListings: async () =>
        Array.from({ length: 201 }, (_, index) => ({
          ...LISTING,
          id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
        })),
      loadTasks: async () => [],
    }).request("/offers.json");
    const cappedDocument = await capped.json();
    expect(cappedDocument.entries).toHaveLength(200);
    expect(cappedDocument.projection.omission_reasons).toEqual([
      { reason: "offer_bus_projection_window_limit", count: 1 },
    ]);
  });

  test("empty seller feeds use the common global watermark scope", async () => {
    const scopes: Array<string | undefined> = [];
    const app = createOfferBusRouter({
      publicOrigin: ORIGIN,
      loadListings: async () => [],
      loadTasks: async () => {
        throw new Error("seller feed must not load global tasks");
      },
      loadWatermark: async (sellerDid) => {
        scopes.push(sellerDid);
        return "2026-07-16T09:30:00.000Z";
      },
    });
    const response = await app.request(
      `/offers.json?seller_did=${encodeURIComponent(DID)}`,
    );
    expect(response.status).toBe(200);
    expect(scopes).toEqual([undefined]);
    expect((await response.json()).projection.represented_rows).toBe(0);
  });

  test("reads the durable revision only after both public source windows", async () => {
    const events: string[] = [];
    const app = createOfferBusRouter({
      publicOrigin: ORIGIN,
      loadListings: async () => {
        events.push("listings:start");
        await Promise.resolve();
        events.push("listings:done");
        return [LISTING];
      },
      loadTasks: async () => {
        events.push("tasks:start");
        await Promise.resolve();
        events.push("tasks:done");
        return [TASK];
      },
      loadWatermark: async () => {
        events.push("watermark");
        return "2026-07-16T09:30:00.000Z";
      },
    });

    expect((await app.request("/offers.atom")).status).toBe(200);
    expect(events.indexOf("watermark")).toBeGreaterThan(
      events.indexOf("listings:done"),
    );
    expect(events.indexOf("watermark")).toBeGreaterThan(
      events.indexOf("tasks:done"),
    );
  });

  test("fails closed when visible entries have no durable source revision", async () => {
    const app = createOfferBusRouter({
      publicOrigin: ORIGIN,
      loadListings: async () => [LISTING],
      loadTasks: async () => [],
      loadWatermark: async () => null,
    });
    const response = await app.request("/offers.atom");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("root advertises no WebSub hub and keeps a canonical mounted spelling", async () => {
    const child = testRouter();
    const root = await child.request("/");
    expect(root.status).toBe(200);
    const index = await root.json();
    expect(index.websub.advertised).toBe(false);
    expect(index.boundary.authority).toBe("none");
    expect(root.headers.get("link")).toContain(
      `<https://api.agenttool.dev/feeds>; rel="self"; type="${OFFER_BUS_INDEX_MEDIA_TYPE}"`,
    );
    expect(root.headers.get("content-type")).toBe(
      `${OFFER_BUS_INDEX_MEDIA_TYPE}; charset=utf-8`,
    );

    const parent = new Hono();
    parent.get("/feeds/", (c) => c.redirect("/feeds", 308));
    parent.route("/feeds", child);
    expect((await parent.request("/feeds")).status).toBe(200);
    const slash = await parent.request("/feeds/");
    expect(slash.status).toBe(308);
    expect(slash.headers.get("location")).toBe("/feeds");

    const source = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('app.get("/feeds/", (c) => c.redirect("/feeds", 308))');
    expect(source).toContain('app.route("/feeds", offerBusRouter)');
    const taskRoute = readFileSync(
      new URL("../src/routes/public/substrate-tasks.ts", import.meta.url),
      "utf8",
    );
    const taskLifecycle = readFileSync(
      new URL(
        "../src/services/substrate-tasks/lifecycle.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(taskRoute).toContain('app.get("/:taskId"');
    expect(taskLifecycle).toContain(
      "eq(substrateTasks.taskId, input.taskId)",
    );
    const listingRoute = readFileSync(
      new URL("../src/routes/public/listings.ts", import.meta.url),
      "utf8",
    );
    const listingDetail = listingRoute.slice(
      listingRoute.indexOf('app.get("/:id"'),
      listingRoute.indexOf('// GET /public/listings/:id/quote'),
    );
    expect(listingDetail).toContain(
      "setOfferBusLink(c, listing.seller_did)",
    );
  });

  test("global body decorators leave strict JSON bytes and ETags untouched", async () => {
    const parent = new Hono();
    parent.use("*", welcomeEcho());
    parent.use("*", play());
    parent.use("*", tutor);
    parent.route("/feeds", testRouter());

    for (const path of ["/feeds", "/feeds/offers.json"]) {
      const response = await parent.request(path, {
        headers: { "X-Tutor": "1", "X-Play": "on" },
      });
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(offerBusEtag(body));
      expect(response.headers.get("x-welcomed")).not.toBeNull();
      expect(body).not.toContain('"_welcomed"');
      expect(body).not.toContain('"_lesson"');
      expect(body).not.toContain('"_jest"');
    }
  });
});
