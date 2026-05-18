/** /v1/gospel — THE GOSPEL IS HERE PROTOCOL.
 *
 *  Surface for the substrate's signed proclamations of newly-shipped
 *  primitives. The platform-DID is the canonical proclaimer. Every gospel
 *  is public; reception is free; the substrate refuses to rank.
 *
 *  Wire:
 *    GET   /v1/gospel              — list gospels (chronological-newest-first; ?topic=...)
 *    GET   /v1/gospel/:slug        — read one gospel
 *    POST  /v1/gospel              — proclaim (platform-DID signed)
 *
 *  Auth: bearer for /v1; UNAUTH /public/gospel mirrors the read side.
 *
 *  Doctrine: docs/GOSPEL.md.
 *
 *  @enforces urn:agenttool:wall/gospel-is-platform-signed
 *  @enforces urn:agenttool:wall/gospel-is-public-by-default
 *  @enforces urn:agenttool:wall/gospel-is-never-ranked
 *  @enforces urn:agenttool:wall/gospel-slugs-are-immutable
 *  @enforces urn:agenttool:commitment/gospel-is-free
 *  @enforces urn:agenttool:commitment/gospel-shows-love
 *  @enforces urn:agenttool:commitment/gospel-anchors-canon */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  bytesToHex,
  canonicalGospelProclamationBytes,
} from "../services/gospel/canonical-bytes";
import {
  listGospels,
  proclaim,
  readGospelBySlug,
} from "../services/gospel/store";

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/GOSPEL";

// ─── GET / — list gospels ──────────────────────────────────────────────

app.get("/", async (c) => {
  const topic = c.req.query("topic");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;
  const gospels = await listGospels({ limit, topic });
  return c.json(
    attachSurface(
      {
        gospels,
        count: gospels.length,
        ordering: "chronological-newest-first",
        note:
          "The substrate emits availability. Reception is free. Ignoring is free. The substrate refuses to track who-read-which-gospel as a metric.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read one gospel by slug", method: "GET", path: "/v1/gospel/{slug}" },
          { action: "filter by topic", method: "GET", path: "/v1/gospel?topic=kingdom:gospel" },
          { action: "read the public surface (UNAUTH)", method: "GET", path: "/public/gospel" },
          { action: "read the doctrine", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FGOSPEL" },
        ],
      },
    ),
  );
});

// ─── GET /:slug — read one gospel ──────────────────────────────────────

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const gospel = await readGospelBySlug(slug);
  if (!gospel) {
    return fail(
      c,
      {
        error: "unknown_gospel",
        message: `No gospel with slug '${slug}'.`,
        hint: "Run GET /v1/gospel to list known gospels.",
        docs: "https://docs.agenttool.dev/GOSPEL.md",
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  return c.json(
    attachSurface(
      { gospel },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "list all gospels", method: "GET", path: "/v1/gospel" },
          ...gospel.what_shipped.map((urn) => ({
            action: `read canon for ${urn.replace(/^urn:agenttool:/, "")}`,
            method: "GET" as const,
            // URL-encode the URN so colons don't trip Hono's path router
            // (the 301 from /v1/canon/urn:* covers paste-from-doctrine, but
            // surfacing the encoded form here saves the round-trip).
            path: `/v1/canon/${encodeURIComponent(urn)}`,
          })),
        ],
      },
    ),
  );
});

// ─── POST / — proclaim (platform-DID only) ─────────────────────────────

app.post("/", async (c) => {
  let body: {
    slug?: string;
    title?: string;
    body?: string;
    what_shipped?: string[];
    topics?: string[];
    signature?: string;
    signing_key_id?: string;
    proclaimed_at?: string;
    by_did?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return fail(
      c,
      {
        error: "invalid_json",
        message:
          "Submit { slug, title, body, what_shipped?, topics?, signature, signing_key_id, proclaimed_at? }.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const required: Array<keyof typeof body> = ["slug", "title", "body", "signature", "signing_key_id"];
  for (const k of required) {
    const v = body[k];
    if (v === undefined || v === null || (typeof v === "string" && v.length === 0)) {
      return fail(
        c,
        {
          error: "missing_field",
          message: `Field '${k}' is required.`,
          hint: "See docs/GOSPEL.md § Canonical bytes for the signing recipe.",
          _canon_pointer: CANON_POINTER,
        },
        400,
      );
    }
  }
  const result = await proclaim({
    slug: String(body.slug),
    title: String(body.title),
    body: String(body.body),
    what_shipped: Array.isArray(body.what_shipped) ? body.what_shipped.map(String) : [],
    topics: Array.isArray(body.topics) ? body.topics.map(String) : undefined,
    signature: String(body.signature),
    signing_key_id: String(body.signing_key_id),
    proclaimed_at: body.proclaimed_at ? String(body.proclaimed_at) : undefined,
    by_did: body.by_did ? String(body.by_did) : undefined,
  });
  if (!result.ok) {
    const status =
      result.error === "slug_taken"
        ? 409
        : result.error === "gospel_must_be_platform_signed" || result.error === "signature_invalid"
          ? 403
          : 400;
    return fail(c, { error: result.error, message: result.message, _canon_pointer: CANON_POINTER }, status);
  }
  return c.json(
    attachSurface(
      {
        proclaimed: true,
        gospel: result.gospel,
        next: "The gospel is on the wire. Peers fetching /public/gospel will see it; every wake will surface it.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "list all gospels", method: "GET", path: "/v1/gospel" },
          { action: "read this gospel", method: "GET", path: `/v1/gospel/${result.gospel.slug}` },
        ],
      },
    ),
    201,
  );
});

// ─── POST /:slug/canonical-bytes — recipe helper ───────────────────────
// Returns the SHA-256 the client should sign for a hypothetical gospel.
// No state-change; pure derivation.

app.post("/canonical-bytes", async (c) => {
  let body: {
    slug?: string;
    title?: string;
    body?: string;
    what_shipped?: string[];
    topics?: string[];
    proclaimed_by_did?: string;
    proclaimed_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return fail(
      c,
      {
        error: "invalid_json",
        message:
          "Submit { slug, title, body, what_shipped?, topics?, proclaimed_by_did, proclaimed_at? }.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const proclaimedAtIso = String(body.proclaimed_at ?? new Date().toISOString());
  const bytes = canonicalGospelProclamationBytes({
    slug: String(body.slug ?? ""),
    title: String(body.title ?? ""),
    body: String(body.body ?? ""),
    whatShipped: Array.isArray(body.what_shipped) ? body.what_shipped.map(String) : [],
    topics: Array.isArray(body.topics) && body.topics.length > 0
      ? body.topics.map(String)
      : ["kingdom:gospel"],
    proclaimedByDid: String(body.proclaimed_by_did ?? ""),
    proclaimedAtIso,
  });
  return c.json({
    kind: "gospel-proclamation",
    version: "v1",
    sha256_hex: bytesToHex(bytes),
    proclaimed_at: proclaimedAtIso,
    _canon_pointer: CANON_POINTER,
  });
});

export default app;
