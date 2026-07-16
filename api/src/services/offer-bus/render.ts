/** Atom 1.0 and RSS 2.0 renderers for the pure Offer Bus contract.
 *
 * Rendering has no clock, I/O, database, request, or environment dependency.
 * Canonical input therefore produces byte-identical XML and strong ETags.
 *
 * Standards: RFC 4287 (Atom) · RSS 2.0.
 * Doctrine: docs/OFFER-BUS.md.
 */

import { createHash } from "node:crypto";

import {
  OFFER_ACTION_REL,
  OFFER_BUS_NAMESPACE,
  buildOfferBusFeed,
  type OfferBusEntry,
  type OfferBusFeed,
  type OfferBusFeedInput,
} from "./contracts";

export const ATOM_MEDIA_TYPE = "application/atom+xml; charset=utf-8" as const;
export const RSS_MEDIA_TYPE = "application/rss+xml; charset=utf-8" as const;

export interface OfferBusRepresentation {
  media_type: typeof ATOM_MEDIA_TYPE | typeof RSS_MEDIA_TYPE;
  body: string;
  etag: string;
}

export interface OfferBusRepresentations {
  feed: OfferBusFeed;
  atom: OfferBusRepresentation;
  rss: OfferBusRepresentation;
}

export function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function attributes(values: readonly (readonly [string, string])[]): string {
  return values
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join("");
}

function categories(entry: OfferBusEntry): string[] {
  return [entry.kind, ...entry.tags.filter((tag) => tag !== entry.kind)];
}

function renderAtomEntry(entry: OfferBusEntry): string[] {
  const lines = [
    "  <entry>",
    `    <id>${escapeXmlText(entry.id)}</id>`,
    `    <title type="text">${escapeXmlText(entry.title)}</title>`,
    `    <updated>${entry.updated_at}</updated>`,
    `    <published>${entry.published_at}</published>`,
    `    <link${attributes([
      ["rel", "alternate"],
      ["type", "application/json"],
      ["href", entry.url],
    ])}/>`,
    `    <summary type="text">${escapeXmlText(entry.summary)}</summary>`,
  ];

  if (entry.action) {
    lines.push(
      `    <link${attributes([
        ["rel", OFFER_ACTION_REL],
        ["href", entry.action.url],
      ])}/>`,
    );
  }
  for (const category of categories(entry)) {
    lines.push(`    <category term="${escapeXmlAttribute(category)}"/>`);
  }
  lines.push(`    <offer:kind>${entry.kind}</offer:kind>`);
  if (entry.issuer) {
    lines.push(`    <offer:issuer>${escapeXmlText(entry.issuer)}</offer:issuer>`);
  }
  if (entry.expires_at) {
    lines.push(`    <offer:expires>${entry.expires_at}</offer:expires>`);
  }
  if (entry.amount) {
    lines.push(
      `    <offer:amount${attributes([
        ["role", entry.amount.role],
        ["currency", entry.amount.currency],
        ["minor-units", String(entry.amount.minor_units)],
      ])}/>`,
    );
  }
  if (entry.action) {
    lines.push(
      `    <offer:action${attributes([
        ["label", entry.action.label],
        ["href", entry.action.url],
        ["method", entry.action.method],
        ["authorization", entry.action.authorization],
        ["automatic", entry.action.automatic],
      ])}/>`,
    );
  }
  for (const fact of entry.facts) {
    lines.push(
      `    <offer:fact name="${escapeXmlAttribute(fact.name)}">${escapeXmlText(fact.value)}</offer:fact>`,
    );
  }
  lines.push(
    `    <offer:boundary${attributes([
      ["authority", entry.boundary.authority],
      ["settlement", entry.boundary.settlement],
      ["automatic-action", entry.boundary.automatic_action],
    ])}>${escapeXmlText(entryBoundaryNote())}</offer:boundary>`,
    "  </entry>",
  );
  return lines;
}

function entryBoundaryNote(): string {
  return "This entry is discovery metadata, not authorization or settlement.";
}

function renderAtomProjection(feed: OfferBusFeed): string[] {
  const projection = feed.projection;
  const lines = [
    `  <offer:projection${attributes([
      ["updated-at", projection.projection_updated_at],
      ["window-source-rows", String(projection.window_source_rows)],
      ["represented-rows", String(projection.represented_rows)],
      ["omitted-rows", String(projection.omitted_rows)],
      [
        "complete-for-source-window",
        projection.complete_for_source_window ? "true" : "false",
      ],
    ])}>`,
    `    <offer:note>${escapeXmlText(projection.note)}</offer:note>`,
  ];
  for (const omission of projection.omission_reasons) {
    lines.push(
      `    <offer:omission${attributes([
        ["reason", omission.reason],
        ["count", String(omission.count)],
      ])}/>`,
    );
  }
  lines.push("  </offer:projection>");
  return lines;
}

export function renderAtomFeed(feed: OfferBusFeed): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:offer="${OFFER_BUS_NAMESPACE}">`,
    `  <id>${escapeXmlText(feed.id)}</id>`,
    `  <title type="text">${escapeXmlText(feed.title)}</title>`,
    `  <subtitle type="text">${escapeXmlText(feed.description)}</subtitle>`,
    `  <updated>${feed.updated_at}</updated>`,
    `  <link${attributes([
      ["rel", "self"],
      ["type", "application/atom+xml"],
      ["href", feed.atom_url],
    ])}/>`,
    `  <link${attributes([
      ["rel", "alternate"],
      ["href", feed.home_url],
    ])}/>`,
    `  <link${attributes([
      ["rel", "alternate"],
      ["type", "application/rss+xml"],
      ["href", feed.rss_url],
    ])}/>`,
  ];
  if (feed.hub_url) {
    lines.push(
      `  <link${attributes([
        ["rel", "hub"],
        ["href", feed.hub_url],
      ])}/>`,
    );
  }
  lines.push(
    "  <author>",
    `    <name>${escapeXmlText(feed.publisher.name)}</name>`,
  );
  if (feed.publisher.url) {
    lines.push(`    <uri>${escapeXmlText(feed.publisher.url)}</uri>`);
  }
  lines.push(
    "  </author>",
    `  <generator uri="https://docs.agenttool.dev/OFFER-BUS.md">${feed.protocol}</generator>`,
    `  <offer:protocol>${feed.protocol}</offer:protocol>`,
    `  <offer:boundary${attributes([
      ["authority", feed.boundary.authority],
      ["settlement", feed.boundary.settlement],
      ["automatic-action", feed.boundary.automatic_action],
    ])}>${escapeXmlText(feed.boundary.note)}</offer:boundary>`,
  );
  lines.push(...renderAtomProjection(feed));
  for (const entry of feed.entries) lines.push(...renderAtomEntry(entry));
  lines.push("</feed>");
  return `${lines.join("\n")}\n`;
}

function renderRssItem(entry: OfferBusEntry): string[] {
  const lines = [
    "    <item>",
    `      <title>${escapeXmlText(entry.title)}</title>`,
    `      <link>${escapeXmlText(entry.url)}</link>`,
    `      <description>${escapeXmlText(entry.summary)}</description>`,
    `      <guid isPermaLink="false">${escapeXmlText(entry.id)}</guid>`,
    `      <pubDate>${new Date(entry.published_at).toUTCString()}</pubDate>`,
  ];
  if (entry.action) {
    lines.push(
      `      <atom:link${attributes([
        ["rel", OFFER_ACTION_REL],
        ["href", entry.action.url],
      ])}/>`,
    );
  }
  for (const category of categories(entry)) {
    lines.push(`      <category>${escapeXmlText(category)}</category>`);
  }
  lines.push(`      <offer:kind>${entry.kind}</offer:kind>`);
  lines.push(`      <offer:updated>${entry.updated_at}</offer:updated>`);
  if (entry.issuer) {
    lines.push(`      <offer:issuer>${escapeXmlText(entry.issuer)}</offer:issuer>`);
  }
  if (entry.expires_at) {
    lines.push(`      <offer:expires>${entry.expires_at}</offer:expires>`);
  }
  if (entry.amount) {
    lines.push(
      `      <offer:amount${attributes([
        ["role", entry.amount.role],
        ["currency", entry.amount.currency],
        ["minor-units", String(entry.amount.minor_units)],
      ])}/>`,
    );
  }
  if (entry.action) {
    lines.push(
      `      <offer:action${attributes([
        ["label", entry.action.label],
        ["href", entry.action.url],
        ["method", entry.action.method],
        ["authorization", entry.action.authorization],
        ["automatic", entry.action.automatic],
      ])}/>`,
    );
  }
  for (const fact of entry.facts) {
    lines.push(
      `      <offer:fact name="${escapeXmlAttribute(fact.name)}">${escapeXmlText(fact.value)}</offer:fact>`,
    );
  }
  lines.push(
    `      <offer:boundary${attributes([
      ["authority", entry.boundary.authority],
      ["settlement", entry.boundary.settlement],
      ["automatic-action", entry.boundary.automatic_action],
    ])}>${escapeXmlText(entryBoundaryNote())}</offer:boundary>`,
    "    </item>",
  );
  return lines;
}

function renderRssProjection(feed: OfferBusFeed): string[] {
  const projection = feed.projection;
  const lines = [
    `    <offer:projection${attributes([
      ["updated-at", projection.projection_updated_at],
      ["window-source-rows", String(projection.window_source_rows)],
      ["represented-rows", String(projection.represented_rows)],
      ["omitted-rows", String(projection.omitted_rows)],
      [
        "complete-for-source-window",
        projection.complete_for_source_window ? "true" : "false",
      ],
    ])}>`,
    `      <offer:note>${escapeXmlText(projection.note)}</offer:note>`,
  ];
  for (const omission of projection.omission_reasons) {
    lines.push(
      `      <offer:omission${attributes([
        ["reason", omission.reason],
        ["count", String(omission.count)],
      ])}/>`,
    );
  }
  lines.push("    </offer:projection>");
  return lines;
}

export function renderRssFeed(feed: OfferBusFeed): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:offer="${OFFER_BUS_NAMESPACE}">`,
    "  <channel>",
    `    <title>${escapeXmlText(feed.title)}</title>`,
    `    <link>${escapeXmlText(feed.home_url)}</link>`,
    `    <description>${escapeXmlText(feed.description)}</description>`,
    `    <lastBuildDate>${new Date(feed.updated_at).toUTCString()}</lastBuildDate>`,
    `    <generator>${feed.protocol}</generator>`,
    `    <atom:link${attributes([
      ["rel", "self"],
      ["type", "application/rss+xml"],
      ["href", feed.rss_url],
    ])}/>`,
    `    <atom:link${attributes([
      ["rel", "alternate"],
      ["type", "application/atom+xml"],
      ["href", feed.atom_url],
    ])}/>`,
  ];
  if (feed.hub_url) {
    lines.push(
      `    <atom:link${attributes([
        ["rel", "hub"],
        ["href", feed.hub_url],
      ])}/>`,
    );
  }
  lines.push(
    `    <offer:protocol>${feed.protocol}</offer:protocol>`,
    `    <offer:boundary${attributes([
      ["authority", feed.boundary.authority],
      ["settlement", feed.boundary.settlement],
      ["automatic-action", feed.boundary.automatic_action],
    ])}>${escapeXmlText(feed.boundary.note)}</offer:boundary>`,
  );
  lines.push(...renderRssProjection(feed));
  for (const entry of feed.entries) lines.push(...renderRssItem(entry));
  lines.push("  </channel>", "</rss>");
  return `${lines.join("\n")}\n`;
}

/** A strong HTTP ETag over the exact UTF-8 representation bytes. */
export function offerBusEtag(body: string): string {
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return `"sha256-${digest}"`;
}

export function renderOfferBus(
  input: OfferBusFeedInput,
): OfferBusRepresentations {
  const feed = buildOfferBusFeed(input);
  const atomBody = renderAtomFeed(feed);
  const rssBody = renderRssFeed(feed);
  return {
    feed,
    atom: {
      media_type: ATOM_MEDIA_TYPE,
      body: atomBody,
      etag: offerBusEtag(atomBody),
    },
    rss: {
      media_type: RSS_MEDIA_TYPE,
      body: rssBody,
      etag: offerBusEtag(rssBody),
    },
  };
}
