/** Privacy-bounded WebFinger projection for AgentTool public profiles.
 *
 * WebFinger is a locator, not an identity authority. This application accepts
 * exact stored AgentTool DID strings only and returns links to the existing
 * public-agent profile. It never searches display names, selects generic
 * identity metadata, or turns an AgentTool identifier into W3C DID
 * Resolution, proof of key control, personhood, or authorship.
 *
 * Doctrine: docs/WEBFINGER.md.
 */

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { publicAgentPath } from "../identity/public-profile";
import { OFFER_BUS_REL, offerBusFeedUrls } from "../offer-bus";

export const WEBFINGER_JRD_MEDIA_TYPE = "application/jrd+json" as const;
export const WEBFINGER_PROFILE_REL =
  "http://webfinger.net/rel/profile-page" as const;
export const AGENT_PASSPORT_REL =
  "https://agenttool.dev/rels/agent-passport" as const;
export const AGENT_PASSPORT_BOUNDARY_PROPERTY =
  "https://agenttool.dev/ns/agent-passport#authority-boundary" as const;
export const AGENT_PASSPORT_BOUNDARY =
  "public application-profile locator only; not W3C DID Resolution and not proof of key control, personhood, authorship, or transferred authority" as const;

export interface AgentPassportSubject {
  did: string;
}

export interface WebFingerJrdLink {
  rel: string;
  type: string;
  href: string;
}

export interface AgentPassportJrd {
  subject: string;
  properties: Record<string, string>;
  links: WebFingerJrdLink[];
}

export type ParsedAgentPassportResource =
  | { kind: "did"; did: string }
  | { kind: "unsupported" }
  | { kind: "malformed" };

/** Agent Passport deliberately defines only exact DID query targets. `acct:`
 * identifiers are valid WebFinger URIs in other applications, but accepting
 * `acct:<display-name>@agenttool.dev` here would create a new enumeration
 * surface over non-unique names. */
export function parseAgentPassportResource(
  value: string,
): ParsedAgentPassportResource {
  if (
    value.length === 0 ||
    value.length > 2048 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return { kind: "malformed" };
  }

  try {
    // WebFinger query targets are URIs. Parsing first distinguishes a valid
    // but unsupported application (404) from malformed input (400).
    new URL(value);
  } catch {
    return { kind: "malformed" };
  }

  if (!value.startsWith("did:")) return { kind: "unsupported" };

  // AgentTool stores base identifier strings, not DID URLs with query or
  // fragment components. The method is lower-case per DID syntax; the
  // method-specific identifier remains case-sensitive and is never folded.
  if (!/^did:[a-z0-9]+:[^\s?#]+$/.test(value)) {
    return { kind: "unsupported" };
  }

  return { kind: "did", did: value };
}

export function requireWebFingerHttpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("webfinger_public_origin_must_be_absolute_https");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("webfinger_public_origin_must_be_credential_free_https");
  }
  return parsed.origin;
}

function uniqueRelations(relations: readonly string[]): string[] {
  return [...new Set(relations)];
}

export function agentPassportWebFingerUrl(
  did: string,
  publicOrigin: string,
  relations: readonly string[] = [],
): string {
  const url = new URL("/.well-known/webfinger", requireWebFingerHttpsOrigin(publicOrigin));
  url.searchParams.set("resource", did);
  for (const relation of uniqueRelations(relations)) {
    url.searchParams.append("rel", relation);
  }
  return url.toString();
}

/** Construct a deterministic RFC 7033 JRD. `rel` filters only links; subject
 * and properties remain present as required by WebFinger semantics. */
export function buildAgentPassportJrd(
  subject: AgentPassportSubject,
  options: { publicOrigin: string; relations?: readonly string[] },
): AgentPassportJrd {
  const origin = requireWebFingerHttpsOrigin(options.publicOrigin);
  const relations = uniqueRelations(options.relations ?? []);
  const profileHref = new URL(publicAgentPath(subject.did), origin).toString();
  const offerFeed = offerBusFeedUrls(origin, subject.did).atom;
  const allLinks: WebFingerJrdLink[] = [
    {
      rel: "self",
      type: WEBFINGER_JRD_MEDIA_TYPE,
      href: agentPassportWebFingerUrl(subject.did, origin, relations),
    },
    {
      rel: WEBFINGER_PROFILE_REL,
      type: "application/json",
      href: profileHref,
    },
    {
      rel: AGENT_PASSPORT_REL,
      type: "application/json",
      href: profileHref,
    },
    {
      rel: OFFER_BUS_REL,
      type: "application/atom+xml",
      href: offerFeed,
    },
    {
      rel: "describedby",
      type: "text/markdown",
      href: "https://docs.agenttool.dev/WEBFINGER.md",
    },
  ];

  const requested = new Set(relations);
  return {
    subject: subject.did,
    properties: {
      [AGENT_PASSPORT_BOUNDARY_PROPERTY]: AGENT_PASSPORT_BOUNDARY,
    },
    links:
      requested.size === 0
        ? allLinks
        : allLinks.filter((link) => requested.has(link.rel)),
  };
}

/** Exact DID lookup with the same existence boundary as
 * `/public/agents/:did`: no status filter means active, revoked, and memorial
 * identifiers remain addressable. The projection is deliberately narrower
 * than that public route—it selects no name, expression, metadata, project,
 * key, capability, trust, or lifecycle detail. */
export async function lookupAgentPassportByDid(
  did: string,
): Promise<AgentPassportSubject | null> {
  const [row] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);
  return row ?? null;
}

export function agentPassportJrdEtag(serializedJrd: string): string {
  const digest = createHash("sha256").update(serializedJrd).digest("hex");
  return `"sha256-${digest}"`;
}

/** If-None-Match on GET/HEAD uses weak comparison. Generated tags never
 * contain commas, so a bounded comma-separated scan is sufficient here. */
export function webFingerIfNoneMatchMatches(
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
