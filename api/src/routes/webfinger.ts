/** Mount-ready RFC 7033 WebFinger Agent Passport router.
 *
 * Intended mount: `/.well-known/webfinger`. This module is isolated from the
 * shared well-known router so integration can be reviewed separately. It
 * accepts exact DID resources only; display names and `acct:` identifiers
 * never reach the database.
 *
 * Doctrine: docs/WEBFINGER.md.
 */

import { Hono, type Context } from "hono";

import {
  agentPassportJrdEtag,
  buildAgentPassportJrd,
  lookupAgentPassportByDid,
  parseAgentPassportResource,
  requireWebFingerHttpsOrigin,
  WEBFINGER_JRD_MEDIA_TYPE,
  webFingerIfNoneMatchMatches,
  type AgentPassportSubject,
} from "../services/webfinger/agent-passport";

const DEFAULT_PUBLIC_ORIGIN =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
// The JRD ETag covers exact response bytes, so intermediaries must not
// recompress the representation and silently weaken the validator.
const CACHE_CONTROL =
  "public, max-age=300, must-revalidate, no-transform";
const MAX_RELATIONS = 16;
const MAX_RELATION_LENGTH = 1024;

export type AgentPassportLookup = (
  did: string,
) => Promise<AgentPassportSubject | null>;

export interface WebFingerRouterOptions {
  lookupDid?: AgentPassportLookup;
  publicOrigin?: string;
}

function setCors(c: Context): void {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  c.header("Access-Control-Allow-Headers", "If-None-Match");
}

function setNoStore(c: Context): void {
  setCors(c);
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
}

function errorResponse(
  c: Context,
  status: 400 | 404 | 503,
  error: string,
  message: string,
): Response {
  setNoStore(c);
  if (status === 503) c.header("Retry-After", "30");
  return c.json({ error, message }, status);
}

function relationFilters(
  search: URLSearchParams,
): { ok: true; values: string[] } | { ok: false } {
  const values = search.getAll("rel");
  if (
    values.length > MAX_RELATIONS ||
    values.some(
      (value) =>
        value.length === 0 ||
        value.length > MAX_RELATION_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(value),
    )
  ) {
    return { ok: false };
  }
  return { ok: true, values };
}

export function createWebFingerRouter(
  options: WebFingerRouterOptions = {},
): Hono {
  const app = new Hono();
  const lookupDid = options.lookupDid ?? lookupAgentPassportByDid;
  let publicOrigin: string | null = null;
  try {
    publicOrigin = requireWebFingerHttpsOrigin(
      options.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN,
    );
  } catch {
    // Keep import/local startup available, but fail the public route closed:
    // RFC 7033 WebFinger must not advertise a plaintext origin.
  }

  app.options("/", (c) => {
    setCors(c);
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
  });

  app.on(["GET", "HEAD"], "/", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const resources = search.getAll("resource");
    if (resources.length !== 1 || resources[0] === "") {
      return errorResponse(
        c,
        400,
        "webfinger_resource_required",
        "Provide exactly one URI-valued resource query parameter.",
      );
    }

    const relations = relationFilters(search);
    if (!relations.ok) {
      return errorResponse(
        c,
        400,
        "webfinger_rel_invalid",
        "Each rel must be non-empty and bounded; at most 16 rel filters are accepted.",
      );
    }

    const parsed = parseAgentPassportResource(resources[0]!);
    if (parsed.kind === "malformed") {
      return errorResponse(
        c,
        400,
        "webfinger_resource_invalid",
        "The resource must be an absolute URI.",
      );
    }
    if (parsed.kind === "unsupported") {
      return errorResponse(
        c,
        404,
        "webfinger_not_found",
        "No Agent Passport is available for that exact resource.",
      );
    }
    if (!publicOrigin) {
      return errorResponse(
        c,
        503,
        "webfinger_https_origin_unavailable",
        "Agent Passport discovery is unavailable until a credential-free HTTPS public origin is configured.",
      );
    }

    let subject: AgentPassportSubject | null;
    try {
      subject = await lookupDid(parsed.did);
    } catch {
      return errorResponse(
        c,
        503,
        "webfinger_temporarily_unavailable",
        "Agent Passport lookup is temporarily unavailable; absence is not being inferred.",
      );
    }
    if (!subject) {
      return errorResponse(
        c,
        404,
        "webfinger_not_found",
        "No Agent Passport is available for that exact resource.",
      );
    }

    const body = JSON.stringify(
      buildAgentPassportJrd(subject, {
        publicOrigin,
        relations: relations.values,
      }),
    );
    const etag = agentPassportJrdEtag(body);
    setCors(c);
    c.header("Cache-Control", CACHE_CONTROL);
    c.header("Content-Type", WEBFINGER_JRD_MEDIA_TYPE);
    c.header("ETag", etag);
    c.header("X-Content-Type-Options", "nosniff");

    if (webFingerIfNoneMatchMatches(c.req.header("If-None-Match"), etag)) {
      return c.body(null, 304);
    }
    if (c.req.method === "HEAD") return c.body(null, 200);
    return c.body(body, 200);
  });

  return app;
}

export default createWebFingerRouter();
