/** Deterministic JSON/Atom correspondence representations and validators.
 * Doctrine: docs/AGENT-CORRESPONDENCE.md · docs/PROTOCOL-RENAISSANCE.md. */

import { createHash } from "node:crypto";

import type { CorrespondenceEventPage, CorrespondenceRecord } from "./store";

export const CORRESPONDENCE_JSON_MEDIA_TYPE =
  "application/vnd.agenttool.correspondence+json" as const;
export const CORRESPONDENCE_JSON_CONTENT_TYPE =
  `${CORRESPONDENCE_JSON_MEDIA_TYPE}; charset=utf-8` as const;
export const CORRESPONDENCE_PLAIN_JSON_MEDIA_TYPE = "application/json" as const;
export const CORRESPONDENCE_PLAIN_JSON_CONTENT_TYPE =
  `${CORRESPONDENCE_PLAIN_JSON_MEDIA_TYPE}; charset=utf-8` as const;
export const CORRESPONDENCE_ATOM_MEDIA_TYPE = "application/atom+xml" as const;
export const CORRESPONDENCE_ATOM_CONTENT_TYPE =
  `${CORRESPONDENCE_ATOM_MEDIA_TYPE}; charset=utf-8` as const;
export const CORRESPONDENCE_CACHE_CONTROL = "private, no-cache, no-transform" as const;
export const CORRESPONDENCE_DOCS_URL =
  "https://docs.agenttool.dev/AGENT-CORRESPONDENCE.md" as const;
export const CORRESPONDENCE_VOICE_REL =
  "https://agenttool.dev/rels/correspondence-voice" as const;
export const CORRESPONDENCE_LIVE_REL =
  "https://agenttool.dev/rels/correspondence-live" as const;
export const ACTIVE_CLAIMS_REL =
  "https://agenttool.dev/rels/active-claims" as const;

export type CorrespondenceJsonRepresentation = "vendor_json" | "plain_json";
export type CorrespondenceRepresentation = CorrespondenceJsonRepresentation | "atom";

export function escapeCorrespondenceXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderAtomEntry(record: CorrespondenceRecord): string[] {
  // Atom's <updated> is the immutable receipt time. Keep entry content on the
  // same clock: dynamic missing-parent and lineage diagnostics remain in JSON
  // representations and cannot silently change an old Atom entry or ETag.
  const immutableRecord = {
    event: record.event,
    receipt: record.receipt,
  };
  // JSON permits U+FFFE/U+FFFF but XML 1.0 does not. Preserve the parsed JSON
  // value while keeping the Atom document well-formed by spelling these two
  // scalars as JSON Unicode escapes before XML entity escaping.
  const eventJson = JSON.stringify(immutableRecord)
    .replaceAll("\uFFFE", "\\ufffe")
    .replaceAll("\uFFFF", "\\uffff");
  return [
    "  <entry>",
    `    <id>${record.event.event_id}</id>`,
    `    <title type="text">${escapeCorrespondenceXml(record.event.kind)}</title>`,
    `    <published>${record.event.issued_at}</published>`,
    `    <updated>${record.receipt.received_at}</updated>`,
    "    <author>",
    `      <name>${record.event.sender.identity_id}</name>`,
    "    </author>",
    `    <category term="${escapeCorrespondenceXml(record.event.kind)}"/>`,
    // RFC 4287 requires non-text/non-XML inline content to be base64. Text is
    // exact and inspectable here; the escaped JSON remains the signed record.
    `    <content type="text">${escapeCorrespondenceXml(eventJson)}</content>`,
    "  </entry>",
  ];
}

export function renderCorrespondenceAtom(
  page: CorrespondenceEventPage,
  requestUrl: string,
): string {
  const updated = page.events.at(-1)?.receipt.received_at ?? "1970-01-01T00:00:00.000Z";
  const related = correspondenceRelatedUrls(requestUrl);
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:at="https://agenttool.dev/ns/correspondence">',
    `  <id>${escapeCorrespondenceXml(requestUrl)}</id>`,
    '  <title type="text">AgentTool project correspondence</title>',
    `  <updated>${updated}</updated>`,
    `  <link rel="self" type="${CORRESPONDENCE_ATOM_MEDIA_TYPE}" href="${escapeCorrespondenceXml(requestUrl)}"/>`,
    `  <link rel="alternate" type="${CORRESPONDENCE_JSON_MEDIA_TYPE}" href="${escapeCorrespondenceXml(requestUrl)}"/>`,
    `  <link rel="describedby" type="text/markdown" href="${CORRESPONDENCE_DOCS_URL}"/>`,
    `  <link rel="${CORRESPONDENCE_VOICE_REL}" type="${CORRESPONDENCE_JSON_MEDIA_TYPE}" href="${escapeCorrespondenceXml(related.voice)}"/>`,
    `  <at:link-template rel="${CORRESPONDENCE_LIVE_REL}" type="text/event-stream" template="${escapeCorrespondenceXml(related.live)}"/>`,
    `  <link rel="${ACTIVE_CLAIMS_REL}" type="${CORRESPONDENCE_JSON_MEDIA_TYPE}" href="${escapeCorrespondenceXml(related.claims)}"/>`,
    `  <generator uri="https://agenttool.dev">${page.protocol}</generator>`,
  ];
  for (const record of page.events) lines.push(...renderAtomEntry(record));
  lines.push("</feed>");
  return `${lines.join("\n")}\n`;
}

export function correspondenceEtag(body: string): string {
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return `"sha256-${digest}"`;
}

export function correspondenceIfNoneMatchMatches(
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

function representationQuality(
  accept: string,
  mediaTypes: readonly string[],
  allowWildcards = true,
): number {
  let bestSpecificity = -1;
  let bestQuality = -1;
  for (const item of accept.split(",")) {
    const [rawType, ...parameters] = item.split(";");
    const type = rawType?.trim().toLowerCase();
    if (!type) continue;
    let q = 1;
    let qSeen = false;
    let malformedQ = false;
    let unsupportedMediaParameter = false;
    for (const parameter of parameters) {
      if (/^\s*q\s*=/i.test(parameter)) {
        const match = /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/i.exec(parameter);
        if (qSeen || !match) {
          malformedQ = true;
        } else {
          q = Number(match[1]);
          qSeen = true;
        }
        continue;
      }
      // Before q these are media-range parameters and must match the offered
      // representation. We emit UTF-8 and support that charset explicitly;
      // profiles/Atom entry parameters and other constraints do not match.
      // After q they are accept-ext and do not constrain representation.
      if (!qSeen && !/^\s*charset\s*=\s*(?:utf-8|"utf-8")\s*$/i.test(parameter)) {
        unsupportedMediaParameter = true;
      }
    }
    if (unsupportedMediaParameter) continue;
    if (malformedQ) q = 0;

    let specificity = -1;
    for (const mediaType of mediaTypes) {
      const [wantedMajor] = mediaType.split("/");
      if (type === mediaType) specificity = Math.max(specificity, 2);
      else if (allowWildcards && type === `${wantedMajor}/*`) {
        specificity = Math.max(specificity, 1);
      } else if (allowWildcards && type === "*/*") {
        specificity = Math.max(specificity, 0);
      }
    }
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      bestQuality = q;
    } else if (specificity === bestSpecificity && specificity >= 0) {
      bestQuality = Math.max(bestQuality, q);
    }
  }
  return bestQuality;
}

export function negotiateCorrespondenceRepresentation(
  accept: string | undefined,
): CorrespondenceRepresentation | null {
  if (!accept || accept.trim() === "") return "vendor_json";
  const offered: Array<[CorrespondenceRepresentation, number]> = [
    ["vendor_json", representationQuality(accept, [CORRESPONDENCE_JSON_MEDIA_TYPE])],
    ["plain_json", representationQuality(accept, [CORRESPONDENCE_PLAIN_JSON_MEDIA_TYPE])],
    ["atom", representationQuality(accept, [CORRESPONDENCE_ATOM_MEDIA_TYPE])],
  ];
  let selected: CorrespondenceRepresentation | null = null;
  let selectedQuality = 0;
  // Stable server preference on equal quality: vendor JSON, plain JSON, Atom.
  for (const [representation, quality] of offered) {
    if (quality > selectedQuality) {
      selected = representation;
      selectedQuality = quality;
    }
  }
  return selected;
}

export function negotiateCorrespondenceJsonRepresentation(
  accept: string | undefined,
): CorrespondenceJsonRepresentation | null {
  if (!accept || accept.trim() === "") return "vendor_json";
  const vendorQuality = representationQuality(accept, [CORRESPONDENCE_JSON_MEDIA_TYPE]);
  const plainQuality = representationQuality(accept, [CORRESPONDENCE_PLAIN_JSON_MEDIA_TYPE]);
  if (vendorQuality <= 0 && plainQuality <= 0) return null;
  return plainQuality > vendorQuality ? "plain_json" : "vendor_json";
}

export function correspondenceJsonContentType(
  representation: CorrespondenceJsonRepresentation,
): typeof CORRESPONDENCE_JSON_CONTENT_TYPE | typeof CORRESPONDENCE_PLAIN_JSON_CONTENT_TYPE {
  return representation === "plain_json"
    ? CORRESPONDENCE_PLAIN_JSON_CONTENT_TYPE
    : CORRESPONDENCE_JSON_CONTENT_TYPE;
}

export function correspondenceRelatedUrls(requestUrl: string): {
  voice: string;
  live: string;
  claims: string;
} {
  const current = new URL(requestUrl);
  const voice = new URL("/v1/correspondence/voice", current.origin);
  const claims = new URL("/v1/correspondence/claims", current.origin);
  for (const key of ["repository_id", "thread_id"] as const) {
    const value = current.searchParams.get(key);
    if (value !== null) {
      voice.searchParams.set(key, value);
      claims.searchParams.set(key, value);
    }
  }
  const path = current.searchParams.get("path");
  if (path !== null) claims.searchParams.set("path", path);
  // Correspondence reads authenticate a project bearer, not one identity.
  // Wake voice is identity-scoped, so advertise an honest URI template that
  // the caller expands with an active identity from the same bearer project.
  const liveBase = new URL("/v1/wake/voice", current.origin).toString();
  const live = `${liveBase}?identity_id={identity_id}&keys=correspondence`;
  return { voice: voice.toString(), live, claims: claims.toString() };
}

function correspondenceNavigationLinks(requestUrl: string): string[] {
  const related = correspondenceRelatedUrls(requestUrl);
  return [
    `<${related.voice}>; rel="${CORRESPONDENCE_VOICE_REL}"; type="${CORRESPONDENCE_JSON_MEDIA_TYPE}"`,
    `<${related.claims}>; rel="${ACTIVE_CLAIMS_REL}"; type="${CORRESPONDENCE_JSON_MEDIA_TYPE}"`,
  ];
}

/** RFC 9652 Structured Field. URI templates do not belong in RFC 8288's
 * ordinary Link field because `{` and `}` are not URI-Reference characters. */
export function correspondenceLiveLinkTemplateHeader(requestUrl: string): string {
  const template = correspondenceRelatedUrls(requestUrl).live;
  return `"${template}"; rel="${CORRESPONDENCE_LIVE_REL}"; type="text/event-stream"`;
}

export function correspondenceLinkHeader(
  requestUrl: string,
  current: CorrespondenceRepresentation,
): string {
  const currentType = current === "atom"
    ? CORRESPONDENCE_ATOM_MEDIA_TYPE
    : current === "plain_json"
      ? CORRESPONDENCE_PLAIN_JSON_MEDIA_TYPE
      : CORRESPONDENCE_JSON_MEDIA_TYPE;
  const alternateType =
    current === "atom" ? CORRESPONDENCE_JSON_MEDIA_TYPE : CORRESPONDENCE_ATOM_MEDIA_TYPE;
  return [
    `<${requestUrl}>; rel="self"; type="${currentType}"`,
    `<${requestUrl}>; rel="alternate"; type="${alternateType}"`,
    `<${CORRESPONDENCE_DOCS_URL}>; rel="describedby"; type="text/markdown"`,
    ...correspondenceNavigationLinks(requestUrl),
  ].join(", ");
}

export function correspondenceJsonLinkHeader(
  requestUrl: string,
  current: CorrespondenceJsonRepresentation = "vendor_json",
): string {
  const currentType = current === "plain_json"
    ? CORRESPONDENCE_PLAIN_JSON_MEDIA_TYPE
    : CORRESPONDENCE_JSON_MEDIA_TYPE;
  return [
    `<${requestUrl}>; rel="self"; type="${currentType}"`,
    `<${CORRESPONDENCE_DOCS_URL}>; rel="describedby"; type="text/markdown"`,
    ...correspondenceNavigationLinks(requestUrl),
  ].join(", ");
}
