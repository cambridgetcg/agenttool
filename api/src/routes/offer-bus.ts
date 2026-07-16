/** Public Offer Bus — Atom/RSS renaissance over existing economic reads.
 *
 * The feeds project already-public capability listings and open substrate
 * tasks. They are discovery representations only: fetching or parsing one
 * never invokes, claims, installs, authorizes, pays, or settles anything.
 *
 * Doctrine: docs/OFFER-BUS.md.
 */

import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";

import { db } from "../db/client";
import { offerBusRevisions } from "../db/schema/marketplace";
import { apiCatalogLinkHeader } from "../services/discovery/api-catalog";
import { listPublicListings } from "../services/marketplace/listings";
import {
  ATOM_MEDIA_TYPE,
  OfferBusContractError,
  OFFER_BUS_BOUNDARY,
  OFFER_BUS_INDEX_MEDIA_TYPE,
  OFFER_BUS_JSON_MEDIA_TYPE,
  OFFER_BUS_PROTOCOL,
  RSS_MEDIA_TYPE,
  assertOfferBusEntryInput,
  offerBusFeedUrls,
  offerBusEtag,
  isOfferBusSellerDid,
  offersFromPublicListings,
  offersFromPublicSubstrateTasks,
  renderOfferBus,
  type PublicListingOfferRecord,
  type PublicSubstrateTaskOfferRecord,
  type OfferBusEntryInput,
  type OfferBusProjectionOmissionInput,
} from "../services/offer-bus";
import { listOpenSubstrateTasks } from "../services/substrate-tasks/lifecycle";

const DEFAULT_PUBLIC_ORIGIN =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const OFFER_BUS_DOCS_URL = "https://docs.agenttool.dev/OFFER-BUS.md";
// Canonical representation ETags are byte validators. `no-transform` keeps
// intermediaries from recompressing the body and weakening those tags.
const CACHE_CONTROL = "public, max-age=30, must-revalidate, no-transform";
const INDEX_CACHE_CONTROL =
  "public, max-age=300, must-revalidate, no-transform";
const EMPTY_FEED_BASELINE = "2026-07-16T00:00:00.000Z";

export type OfferBusListingLoader = (
  sellerDid?: string,
) => Promise<readonly PublicListingOfferRecord[]>;
export type OfferBusTaskLoader = () => Promise<
  readonly PublicSubstrateTaskOfferRecord[]
>;
export type OfferBusWatermarkLoader = (
  sellerDid?: string,
) => Promise<string | null>;

export interface OfferBusRouterOptions {
  loadListings?: OfferBusListingLoader;
  loadTasks?: OfferBusTaskLoader;
  loadWatermark?: OfferBusWatermarkLoader;
  publicOrigin?: string;
}

type RepresentationName = "atom" | "rss" | "json";

interface SafeProjection {
  entries: OfferBusEntryInput[];
  omissions: OfferBusProjectionOmissionInput[];
}

function projectRowsSafely<Row>(
  rows: readonly Row[],
  project: (row: Row) => readonly OfferBusEntryInput[],
  maxEntries: number,
): SafeProjection {
  const entries: OfferBusEntryInput[] = [];
  const omissionCounts = new Map<string, number>();

  for (const row of rows) {
    try {
      const projected = project(row);
      if (projected.length !== 1) {
        throw new Error("offer_bus_adapter_must_project_exactly_one_entry");
      }
      assertOfferBusEntryInput(projected[0]!);
      if (entries.length < maxEntries) {
        entries.push(projected[0]!);
      } else {
        omissionCounts.set(
          "offer_bus_projection_window_limit",
          (omissionCounts.get("offer_bus_projection_window_limit") ?? 0) + 1,
        );
      }
    } catch (error) {
      // A legacy public row that cannot satisfy the current cross-format
      // contract is quarantined with content-free accounting. Source outages
      // and programming errors still fail the whole response closed.
      if (!(error instanceof OfferBusContractError)) throw error;
      omissionCounts.set(error.code, (omissionCounts.get(error.code) ?? 0) + 1);
    }
  }

  return {
    entries,
    omissions: [...omissionCounts]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([reason, count]) => ({ reason, count })),
  };
}

function mergeOmissions(
  ...groups: readonly (readonly OfferBusProjectionOmissionInput[])[]
): OfferBusProjectionOmissionInput[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const omission of group) {
      counts.set(
        omission.reason,
        (counts.get(omission.reason) ?? 0) + omission.count,
      );
    }
  }
  return [...counts]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([reason, count]) => ({ reason, count }));
}

function credentialFreeHttpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("offer_bus_public_origin_must_be_absolute_https");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("offer_bus_public_origin_must_be_credential_free_https");
  }
  return parsed.origin;
}

function linkHeader(
  origin: string,
  current: RepresentationName,
  sellerDid?: string,
): string {
  const urls = offerBusFeedUrls(origin, sellerDid);
  const mediaTypes = {
    atom: "application/atom+xml",
    rss: "application/rss+xml",
    json: OFFER_BUS_JSON_MEDIA_TYPE,
  } as const;
  const alternates = (Object.keys(urls) as RepresentationName[])
    .filter((name) => name !== current)
    .map(
      (name) =>
        `<${urls[name]}>; rel="alternate"; type="${mediaTypes[name]}"`,
    );
  return [
    `<${urls[current]}>; rel="self"; type="${mediaTypes[current]}"`,
    ...alternates,
    `<${OFFER_BUS_DOCS_URL}>; rel="describedby"; type="text/markdown"`,
    apiCatalogLinkHeader(origin),
  ].join(", ");
}

function indexLinkHeader(origin: string): string {
  return [
    `<${new URL("/feeds", origin).toString()}>; rel="self"; type="${OFFER_BUS_INDEX_MEDIA_TYPE}"`,
    `<${offerBusFeedUrls(origin).atom}>; rel="item"; type="application/atom+xml"`,
    `<${OFFER_BUS_DOCS_URL}>; rel="describedby"; type="text/markdown"`,
    apiCatalogLinkHeader(origin),
  ].join(", ");
}

function setCors(c: Context): void {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  c.header("Access-Control-Allow-Headers", "If-None-Match");
  c.header("Access-Control-Expose-Headers", "ETag, Link");
}

function jsonError(
  c: Context,
  status: 400 | 503,
  error: string,
  message: string,
): Response {
  setCors(c);
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (status === 503) c.header("Retry-After", "30");
  return c.json({ error, message }, status);
}

function ifNoneMatchMatches(
  header: string | undefined,
  currentEtag: string,
): boolean {
  if (!header) return false;
  const normalize = (value: string): string => {
    const trimmed = value.trim();
    return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
  };
  const current = normalize(currentEtag);
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || normalize(trimmed) === current;
  });
}

function parseSellerDid(c: Context):
  | { ok: true; sellerDid?: string }
  | { ok: false } {
  const search = new URL(c.req.url).searchParams;
  if ([...search.keys()].some((key) => key !== "seller_did")) {
    return { ok: false };
  }
  const values = search.getAll("seller_did");
  if (values.length === 0) return { ok: true };
  if (values.length !== 1 || !isOfferBusSellerDid(values[0]!)) {
    return { ok: false };
  }
  return { ok: true, sellerDid: values[0]! };
}

export function createOfferBusRouter(
  options: OfferBusRouterOptions = {},
): Hono {
  const app = new Hono();
  const loadListings: OfferBusListingLoader =
    options.loadListings ??
    ((sellerDid) =>
      listPublicListings({
        sellerDid,
        limit: 200,
        order: "newest",
        scan: true,
      }));
  const loadTasks: OfferBusTaskLoader =
    options.loadTasks ?? (() => listOpenSubstrateTasks({ limit: 100 }));
  const loadWatermark: OfferBusWatermarkLoader =
    options.loadWatermark ??
    (async (sellerDid) => {
      const [revision] = await db
        .select({ revisedAt: offerBusRevisions.revisedAt })
        .from(offerBusRevisions)
        .where(
          and(
            eq(offerBusRevisions.scope, sellerDid ? "seller" : "global"),
            eq(offerBusRevisions.subject, sellerDid ?? ""),
          ),
        )
        .limit(1);
      if (!revision && !sellerDid) {
        throw new Error("offer_bus_global_revision_missing");
      }
      return revision?.revisedAt.toISOString() ?? null;
    });
  let origin: string | null = null;
  try {
    origin = credentialFreeHttpsOrigin(
      options.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN,
    );
  } catch {
    // Keep module import available, then fail the public door closed.
  }

  app.options("*", (c) => {
    setCors(c);
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
  });

  app.on(["GET", "HEAD"], "/", (c) => {
    if (!origin) {
      return jsonError(
        c,
        503,
        "offer_bus_https_origin_unavailable",
        "Offer Bus discovery requires a credential-free HTTPS public origin.",
      );
    }
    const urls = offerBusFeedUrls(origin);
    const body = JSON.stringify({
      protocol: OFFER_BUS_PROTOCOL,
      feeds: {
        atom: { url: urls.atom, media_type: "application/atom+xml" },
        rss: { url: urls.rss, media_type: "application/rss+xml" },
        json: { url: urls.json, media_type: OFFER_BUS_JSON_MEDIA_TYPE },
      },
      filter: {
        seller_did:
          "optional exact DID query; seller-specific feeds contain capability listings only",
      },
      includes: [
        "bounded window: up to 200 newest-updated representable safe public active capability listings from a scan of at most 1,000 safe rows",
        "bounded window: up to 100 open unexpired substrate tasks",
      ],
      boundary: OFFER_BUS_BOUNDARY,
      websub: {
        advertised: false,
        reason: "No verified production hub is configured; no rel=hub is emitted.",
      },
      docs: OFFER_BUS_DOCS_URL,
    });
    const etag = offerBusEtag(body);
    setCors(c);
    c.header("Cache-Control", INDEX_CACHE_CONTROL);
    c.header(
      "Content-Type",
      `${OFFER_BUS_INDEX_MEDIA_TYPE}; charset=utf-8`,
    );
    c.header("ETag", etag);
    c.header("Link", indexLinkHeader(origin));
    c.header("X-Content-Type-Options", "nosniff");
    if (ifNoneMatchMatches(c.req.header("If-None-Match"), etag)) {
      return c.body(null, 304);
    }
    if (c.req.method === "HEAD") return c.body(null, 200);
    return c.body(body, 200);
  });

  const serve = async (c: Context, representation: RepresentationName) => {
    if (!origin) {
      return jsonError(
        c,
        503,
        "offer_bus_https_origin_unavailable",
        "Offer Bus discovery requires a credential-free HTTPS public origin.",
      );
    }
    const parsed = parseSellerDid(c);
    if (!parsed.ok) {
      return jsonError(
        c,
        400,
        "offer_bus_query_invalid",
        "Only one optional exact-DID seller_did query parameter is supported.",
      );
    }

    try {
      const [listingRows, taskRows] = await Promise.all([
        loadListings(parsed.sellerDid),
        parsed.sellerDid ? Promise.resolve([]) : loadTasks(),
      ]);
      // Read the monotonic revision after both source windows. If a mutation
      // races either query, its transaction also advances this later read;
      // the response may contain the prior public snapshot, but never pair a
      // newly observed source state with a provably older collection time.
      // Empty seller feeds use the public global revision, not a retained
      // seller row. Unknown and formerly-active exact DIDs therefore share
      // one empty-feed timing behavior instead of exposing sale history.
      const watermarkScope =
        parsed.sellerDid && listingRows.length > 0
          ? parsed.sellerDid
          : undefined;
      const watermark = await loadWatermark(watermarkScope);
      const listingProjection = projectRowsSafely(
        listingRows,
        (row) => offersFromPublicListings([row], origin),
        200,
      );
      const taskProjection = projectRowsSafely(
        taskRows,
        (row) => offersFromPublicSubstrateTasks([row], origin),
        100,
      );
      const entries = [
        ...listingProjection.entries,
        ...taskProjection.entries,
      ];
      const sourceRows = listingRows.length + taskRows.length;
      if (!watermark && sourceRows > 0) {
        throw new Error("offer_bus_source_revision_missing");
      }
      const urls = offerBusFeedUrls(origin, parsed.sellerDid);
      const representations = renderOfferBus({
        id: parsed.sellerDid
          ? `urn:agenttool:offer-bus:seller:${encodeURIComponent(parsed.sellerDid)}`
          : "urn:agenttool:offer-bus:public",
        title: parsed.sellerDid
          ? `AgentTool offers from ${parsed.sellerDid}`
          : "AgentTool public offers",
        description: parsed.sellerDid
          ? "Bounded window of up to 200 newest-updated representable safe public active capability listings published by this exact AgentTool identifier."
          : "Bounded window of up to 200 newest-updated representable safe public active capability listings and 100 open unexpired substrate tasks, syndicated as discovery metadata only.",
        home_url: "https://agenttool.dev",
        atom_url: urls.atom,
        rss_url: urls.rss,
        publisher: { name: "AgentTool", url: "https://agenttool.dev" },
        entries,
        projection: {
          window_source_rows: sourceRows,
          omissions: mergeOmissions(
            listingProjection.omissions,
            taskProjection.omissions,
          ),
        },
        ...(watermark
          ? { updated_at: watermark }
          : entries.length === 0
            ? { updated_at: EMPTY_FEED_BASELINE }
            : {}),
        // Intentionally no hub_url. WebSub is advertised only after a real
        // production hub has been configured and independently verified.
      });
      const selected =
        representation === "json"
          ? {
              body: JSON.stringify(representations.feed),
              etag: offerBusEtag(JSON.stringify(representations.feed)),
              mediaType: `${OFFER_BUS_JSON_MEDIA_TYPE}; charset=utf-8`,
            }
          : representation === "atom"
            ? {
                body: representations.atom.body,
                etag: representations.atom.etag,
                mediaType: ATOM_MEDIA_TYPE,
              }
            : {
                body: representations.rss.body,
                etag: representations.rss.etag,
                mediaType: RSS_MEDIA_TYPE,
              };

      setCors(c);
      c.header("Cache-Control", CACHE_CONTROL);
      c.header("Content-Type", selected.mediaType);
      c.header("ETag", selected.etag);
      c.header(
        "Link",
        linkHeader(origin, representation, parsed.sellerDid),
      );
      c.header("X-Content-Type-Options", "nosniff");
      if (ifNoneMatchMatches(c.req.header("If-None-Match"), selected.etag)) {
        return c.body(null, 304);
      }
      if (c.req.method === "HEAD") return c.body(null, 200);
      return c.body(selected.body, 200);
    } catch {
      return jsonError(
        c,
        503,
        "offer_bus_temporarily_unavailable",
        "Public offer sources could not be read or represented safely; no response feed was emitted.",
      );
    }
  };

  app.on(["GET", "HEAD"], "/offers.atom", (c) => serve(c, "atom"));
  app.on(["GET", "HEAD"], "/offers.rss", (c) => serve(c, "rss"));
  app.on(["GET", "HEAD"], "/offers.json", (c) => serve(c, "json"));

  return app;
}

export default createOfferBusRouter();
