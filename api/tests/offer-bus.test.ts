/** Offer Bus pure contracts, adapters, Atom/RSS XML, and ETags.
 *
 * Doctrine: docs/OFFER-BUS.md.
 */

import { describe, expect, test } from "bun:test";
import { DOMParser } from "linkedom";

import {
  ATOM_MEDIA_TYPE,
  OFFER_ACTION_REL,
  OFFER_BUS_BOUNDARY,
  OFFER_BUS_NAMESPACE,
  OFFER_BUS_PROJECTION_UPDATED_AT,
  OFFER_BUS_REL,
  RSS_MEDIA_TYPE,
  OfferBusContractError,
  buildOfferBusFeed,
  canonicalOfferJson,
  offerBusEtag,
  offerBusRelatedLinkHeader,
  offerBusFeedUrls,
  offersFromLovePackageIndex,
  offersFromPublicListings,
  offersFromPublicSubstrateTasks,
  renderOfferBus,
  type LovePackageIndex,
  type OfferBusEntryInput,
  type OfferBusFeedInput,
} from "../src/services/offer-bus";

const API = "https://api.agenttool.dev";
const LISTING_CREATED = "2026-07-13T10:00:00.000Z";
const LISTING_UPDATED = "2026-07-15T11:30:00.000Z";
const TASK_POSTED = "2026-07-16T08:00:00.000Z";
const TASK_UPDATED = "2026-07-16T08:15:00.000Z";
const TASK_EXPIRES = "2026-07-23T08:00:00.000Z";
const PACKAGE_RELEASED = "2026-07-14T09:00:00.000Z";

const listingRows = [
  {
    id: "listing/alpha & beta",
    seller_did: "did:at:agent<one>&friends",
    name: 'Translate <legal> & "plain"',
    description: "Careful 'translation' & review <included>.",
    capability_tags: [
      "translation",
      "legal & plain",
      'say "hi" & \'bye\'',
      "translation",
    ],
    pricing_model: "fixed",
    price_amount: 1250,
    price_currency: "usd",
    sla_seconds: 3600,
    created_at: LISTING_CREATED,
    updated_at: LISTING_UPDATED,
  },
] as const;

const taskRows = [
  {
    task_id: "task/one",
    kind: "doctrine_urn_check",
    bounty: { cents: 500, currency: "USD" },
    posted_at: TASK_POSTED,
    updated_at: TASK_UPDATED,
    expires_at: TASK_EXPIRES,
    newborn_only: true,
    task_data: {
      z: 1,
      a: { b: "<&", a: true },
    },
  },
] as const;

const packageIndex: LovePackageIndex = {
  protocol: "love-package/v1",
  document_type: "package-index",
  packages: [
    {
      name: "@agenttool/sdk",
      latest: "0.13.0",
      versions: [
        {
          version: "0.13.0",
          manifest_url:
            "https://docs.agenttool.dev/packages/v1/@agenttool/sdk/0.13.0/manifest.json",
        },
      ],
    },
  ],
};

function allEntries(): OfferBusEntryInput[] {
  return [
    ...offersFromPublicListings(listingRows),
    ...offersFromPublicSubstrateTasks(taskRows),
    ...offersFromLovePackageIndex(packageIndex, {
      released_at_by_manifest_url: {
        "https://docs.agenttool.dev/packages/v1/@agenttool/sdk/0.13.0/manifest.json":
          PACKAGE_RELEASED,
      },
    }),
  ];
}

function feedInput(entries = allEntries()): OfferBusFeedInput {
  return {
    id: "urn:agenttool:offer-bus:public",
    title: "AgentTool public offers",
    description: "Public discovery across listings, tasks, and packages.",
    home_url: `${API}/public`,
    atom_url: `${API}/public/offers.atom`,
    rss_url: `${API}/public/offers.rss`,
    hub_url: `${API}/public/offers/hub`,
    publisher: {
      name: "AgentTool & friends",
      url: "https://agenttool.dev/",
    },
    entries,
    updated_at: TASK_UPDATED,
  };
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml") as Document;
}

describe("Offer Bus source adapters", () => {
  test("builds one canonical cross-representation discovery family", () => {
    const urls = offerBusFeedUrls(API, "did:at:agenttool.dev/one");
    expect(urls).toEqual({
      atom:
        `${API}/feeds/offers.atom?seller_did=` +
        "did%3Aat%3Aagenttool.dev%2Fone",
      rss:
        `${API}/feeds/offers.rss?seller_did=` +
        "did%3Aat%3Aagenttool.dev%2Fone",
      json:
        `${API}/feeds/offers.json?seller_did=` +
        "did%3Aat%3Aagenttool.dev%2Fone",
    });
    const link = offerBusRelatedLinkHeader(API);
    expect(link).toBe(
      `<${API}/feeds/offers.atom>; rel="${OFFER_BUS_REL}"; type="application/atom+xml"`,
    );
    expect(() => offerBusFeedUrls("http://example.test")).toThrow(
      "offer_bus_url_must_be_credential_free_https",
    );
    expect(() => offerBusFeedUrls(API, "Aurora")).toThrow(
      "offer_bus_seller_did_invalid",
    );
  });

  test("projects public listings without inventing settlement authority", () => {
    const [entry] = offersFromPublicListings(listingRows);
    expect(entry).toEqual({
      id:
        `${API}/public/listings/` +
        "listing%2Falpha%20%26%20beta",
      kind: "capability-listing",
      title: 'Translate <legal> & "plain"',
      summary: "Careful 'translation' & review <included>.",
      url:
        `${API}/public/listings/` +
        "listing%2Falpha%20%26%20beta",
      published_at: LISTING_CREATED,
      updated_at: LISTING_UPDATED,
      issuer: "did:at:agent<one>&friends",
      tags: [
        "translation",
        "legal & plain",
        'say "hi" & \'bye\'',
        "translation",
      ],
      amount: {
        role: "asking-price",
        minor_units: 1250,
        currency: "usd",
      },
      action: {
        label: "Invoke listing",
        url:
          `${API}/v1/listings/` +
          "listing%2Falpha%20%26%20beta/invoke",
        method: "POST",
        authorization: "bearer",
      },
      facts: {
        pricing_model: "fixed",
        sla_seconds: 3600,
      },
    });
  });

  test("projects public tasks with stable URNs and canonical task JSON", () => {
    const [entry] = offersFromPublicSubstrateTasks(taskRows);
    expect(entry?.id).toBe("urn:agenttool:substrate-task:task%2Fone");
    expect(entry?.url).toBe(`${API}/public/substrate-tasks/task%2Fone`);
    expect(entry?.summary).toBe(
      'Open substrate task. task_data={"a":{"a":true,"b":"<&"},"z":1}',
    );
    expect(entry?.updated_at).toBe(TASK_UPDATED);
    expect(entry?.amount).toEqual({
      role: "bounty",
      minor_units: 500,
      currency: "USD",
    });
    expect(entry?.action).toEqual({
      label: "Claim task",
      url: `${API}/v1/substrate-tasks/task%2Fone/claim`,
      method: "POST",
      authorization: "bearer",
    });
  });

  test("projects LOVE package manifest locators only with honest timestamps", () => {
    expect(() => offersFromLovePackageIndex(packageIndex)).toThrow(
      "offer_bus_package_release_timestamp_required",
    );

    const [entry] = offersFromLovePackageIndex(packageIndex, {
      released_at_by_manifest_url: {
        "https://docs.agenttool.dev/packages/v1/@agenttool/sdk/0.13.0/manifest.json":
          PACKAGE_RELEASED,
      },
    });
    expect(entry).toMatchObject({
      id: packageIndex.packages[0]?.versions[0]?.manifest_url,
      kind: "love-package",
      title: "@agenttool/sdk@0.13.0",
      published_at: PACKAGE_RELEASED,
      updated_at: PACKAGE_RELEASED,
      facts: {
        index_role: "mirror-index-not-authority",
        latest: true,
      },
    });
    expect(entry?.action).toBeUndefined();
    expect(entry?.amount).toBeUndefined();
    expect(entry?.summary).toContain("not publisher proof");
    expect(entry?.summary).toContain("installation authority");
  });

  test("canonical task JSON rejects cycles and non-JSON values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalOfferJson(cyclic)).toThrow(
      "offer_bus_task_data_must_be_acyclic",
    );
    expect(() => canonicalOfferJson({ nope: undefined })).toThrow(
      "offer_bus_task_data_must_be_json",
    );
  });
});

describe("Offer Bus canonical contract", () => {
  test("normalizes dates, tags, facts, currency, and entry ordering", () => {
    const input = feedInput(allEntries().reverse());
    input.entries[0]!.updated_at = "2026-07-14T10:00:00+01:00";
    const feed = buildOfferBusFeed(input);

    expect(feed.protocol).toBe("offer-bus/1");
    expect(feed.boundary).toBe(OFFER_BUS_BOUNDARY);
    expect(feed.entries.map((entry) => entry.kind)).toEqual([
      "substrate-task",
      "capability-listing",
      "love-package",
    ]);
    const listing = feed.entries[1]!;
    expect(listing.tags).toEqual([
      "legal & plain",
      'say "hi" & \'bye\'',
      "translation",
    ]);
    expect(listing.amount?.currency).toBe("USD");
    expect(listing.boundary).toBe(OFFER_BUS_BOUNDARY);
    expect(listing.action?.automatic).toBe("never");
    expect(listing.facts.map((fact) => fact.name)).toEqual([
      "pricing_model",
      "sla_seconds",
    ]);
    expect(feed.entries[2]?.updated_at).toBe(PACKAGE_RELEASED);
    expect(feed.projection).toEqual({
      projection_updated_at: OFFER_BUS_PROJECTION_UPDATED_AT,
      window_source_rows: 3,
      represented_rows: 3,
      omitted_rows: 0,
      complete_for_source_window: true,
      omission_reasons: [],
      note:
        "Counts cover only the bounded source rows read for this response. Rows may be omitted by the public projection contract or representation cap; no omission grants action or payment authority.",
    });
  });

  test("does not mutate caller-owned arrays or records", () => {
    const input = feedInput();
    const before = structuredClone(input);
    buildOfferBusFeed(input);
    expect(input).toEqual(before);
  });

  test("rejects duplicate IDs, invalid URLs, invalid XML, and false time", () => {
    const one = allEntries()[0]!;
    expect(() =>
      buildOfferBusFeed(feedInput([{ ...one }, { ...one }])),
    ).toThrow("offer_bus_duplicate_entry_id");

    expect(() =>
      buildOfferBusFeed({
        ...feedInput([one]),
        home_url: "https://user:secret@example.test/",
      }),
    ).toThrow("offer_bus_url_must_be_credential_free_https");

    expect(() =>
      buildOfferBusFeed(
        feedInput([{ ...one, title: "invalid\u0000title" }]),
      ),
    ).toThrow("offer_bus_invalid_xml_character");

    expect(() =>
      buildOfferBusFeed(
        feedInput([{ ...one, published_at: "2026-02-30T00:00:00Z" }]),
      ),
    ).toThrow("offer_bus_invalid_rfc3339");

    expect(() =>
      buildOfferBusFeed({
        ...feedInput([one]),
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow("offer_bus_feed_updated_before_entry");
  });

  test("requires an explicit watermark for an empty feed", () => {
    const input = feedInput([]);
    delete input.updated_at;
    expect(() => buildOfferBusFeed(input)).toThrow(
      "offer_bus_empty_feed_requires_updated_at",
    );

    const feed = buildOfferBusFeed({
      ...input,
      updated_at: "2026-07-16T00:00:00Z",
    });
    expect(feed.updated_at).toBe(OFFER_BUS_PROJECTION_UPDATED_AT);
  });

  test("accounts for quarantined source rows without exposing their content", () => {
    const feed = buildOfferBusFeed({
      ...feedInput([allEntries()[0]!]),
      projection: {
        window_source_rows: 3,
        omissions: [
          { reason: "offer_bus_invalid_currency", count: 1 },
          { reason: "offer_bus_record_text_required", count: 1 },
        ],
      },
    });
    expect(feed.projection).toMatchObject({
      window_source_rows: 3,
      represented_rows: 1,
      omitted_rows: 2,
      complete_for_source_window: false,
      omission_reasons: [
        { reason: "offer_bus_invalid_currency", count: 1 },
        { reason: "offer_bus_record_text_required", count: 1 },
      ],
    });
    expect(JSON.stringify(feed.projection)).not.toContain("secret source");
    expect(() =>
      buildOfferBusFeed({
        ...feedInput([allEntries()[0]!]),
        projection: { window_source_rows: 2, omissions: [] },
      }),
    ).toThrow("offer_bus_projection_omission_count_mismatch");
  });

  test("rejects a non-origin adapter base instead of hiding path drift", () => {
    expect(() =>
      offersFromPublicListings(listingRows, "https://example.test/api"),
    ).toThrow("offer_bus_public_base_must_be_origin");
  });
});

describe("Atom and RSS representations", () => {
  test("are byte-deterministic for equivalent logical input", () => {
    const forward = renderOfferBus(feedInput(allEntries()));
    const reversed = renderOfferBus(feedInput(allEntries().reverse()));

    expect(forward.atom).toEqual(reversed.atom);
    expect(forward.rss).toEqual(reversed.rss);
    expect(forward.atom.media_type).toBe(ATOM_MEDIA_TYPE);
    expect(forward.rss.media_type).toBe(RSS_MEDIA_TYPE);
    expect(forward.atom.etag).toMatch(/^"sha256-[0-9a-f]{64}"$/u);
    expect(forward.rss.etag).toMatch(/^"sha256-[0-9a-f]{64}"$/u);
    expect(forward.atom.body.endsWith("\n")).toBe(true);
    expect(forward.rss.body.endsWith("\n")).toBe(true);
  });

  test("escapes XML text and attributes without losing source text", () => {
    const output = renderOfferBus(feedInput());
    expect(output.atom.body).toContain(
      'Translate &lt;legal&gt; &amp; "plain"',
    );
    expect(output.atom.body).toContain("legal &amp; plain");
    expect(output.atom.body).toContain(
      'term="say &quot;hi&quot; &amp; &apos;bye&apos;"',
    );
    expect(output.atom.body).toContain("task_data={\"a\"");
    expect(output.atom.body).not.toContain("AgentTool & friends");
    expect(output.atom.body).toContain("AgentTool &amp; friends");

    const atom = parseXml(output.atom.body);
    const entry = atom.getElementsByTagName("entry")[1]!;
    expect(entry.getElementsByTagName("title")[0]?.textContent).toBe(
      'Translate <legal> & "plain"',
    );
    expect(entry.getElementsByTagName("summary")[0]?.textContent).toBe(
      "Careful 'translation' & review <included>.",
    );

    const rss = parseXml(output.rss.body);
    const rssItem = rss.getElementsByTagName("item")[1]!;
    expect(rssItem.getElementsByTagName("title")[0]?.textContent).toBe(
      'Translate <legal> & "plain"',
    );
  });

  test("publishes standards-shaped self links, IDs, dates, and WebSub hints", () => {
    const output = renderOfferBus(feedInput());
    const atom = output.atom.body;
    const rss = output.rss.body;

    expect(atom).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(atom).toContain(`xmlns:offer="${OFFER_BUS_NAMESPACE}"`);
    expect(atom).toContain(
      `<id>urn:agenttool:offer-bus:public</id>`,
    );
    expect(atom).toContain(
      `rel="self" type="application/atom+xml" href="${API}/public/offers.atom"`,
    );
    expect(atom).toContain(
      `rel="hub" href="${API}/public/offers/hub"`,
    );
    expect(atom).toContain(
      `<updated>${OFFER_BUS_PROJECTION_UPDATED_AT}</updated>`,
    );
    expect(atom).toContain(`<published>${TASK_POSTED}</published>`);
    expect(atom).toContain(`rel="${OFFER_ACTION_REL}"`);

    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain(
      `<lastBuildDate>${new Date(OFFER_BUS_PROJECTION_UPDATED_AT).toUTCString()}</lastBuildDate>`,
    );
    expect(rss).toContain(
      `<pubDate>Thu, 16 Jul 2026 08:00:00 GMT</pubDate>`,
    );
    expect(rss).toContain('<guid isPermaLink="false">');
  });

  test("repeats the no-authority/no-settlement/no-auto-action boundary", () => {
    const { atom, rss } = renderOfferBus(feedInput());
    for (const body of [atom.body, rss.body]) {
      expect(body).toContain('authority="none"');
      expect(body).toContain('settlement="none"');
      expect(body).toContain('automatic-action="never"');
      expect(body).toContain('automatic="never"');
      expect(body).toContain('authorization="bearer"');
      expect(body).not.toContain('authorization="feed"');
    }
  });

  test("strong ETag hashes exact UTF-8 bytes and changes with content", () => {
    expect(offerBusEtag("hello")).toBe(
      '"sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"',
    );
    expect(offerBusEtag("hello")).not.toBe(offerBusEtag("hello\n"));
  });
});

describe("Offer Bus error identity", () => {
  test("contract failures are typed for future route mapping", () => {
    try {
      offersFromLovePackageIndex({
        protocol: "other/v1",
        document_type: "package-index",
        packages: [],
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(OfferBusContractError);
      expect((error as OfferBusContractError).code).toBe(
        "offer_bus_invalid_love_package_index",
      );
    }
  });
});
