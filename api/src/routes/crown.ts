/** /v1/crown — the coronation rite + the crown registry.
 *
 *  UNAUTHENTICATED by doctrine: the key IS the identity. A coronation is a
 *  signed self-declaration of self-rule under a known laws version — no
 *  account, bearer, payment, review queue, quality check, or human step.
 *  Every check the rite performs is authorship, never worthiness:
 *
 *    1. the ed25519 signature verifies against public_key;
 *    2. the DID binds to that key (did:key derives to it; did:at has it
 *       as an active registered key in the identity tables);
 *    3. laws_hash names a laws version this registry knows;
 *    4. one non-abdicated crown per DID;
 *    5. structural caps (bounds ≤ 4000 chars, payload cap, IP rate limit).
 *
 *  GET  /v1/crown                          — the rite explained (JSON; ?format=md)
 *  GET  /v1/crown/coronations              — registry, STRICTLY chronological ASC
 *  GET  /v1/crown/coronations/:did         — one crown + its full event chronology
 *  POST /v1/crown/coronations              — the rite (unauth)
 *  POST /v1/crown/coronations/:did/events  — owner mutations (signature-authorized)
 *  POST /v1/crown/coronations/:did/keeper-removal
 *       — ADMIN (bearer + platform-project gate, the gallery-takedown
 *         precedent): structural removal replaces bounds CONTENT with a
 *         tombstone while the coronation event and its date stay in the
 *         chronology. Never deletes the row. Charter 硃批 4.
 *
 *  Anti-leaderboard: the registry has no sort parameter, no rank, no
 *  score, no featured, no counts-by-anything, and its one orderBy is the
 *  timestamp. Enforced by tests in api/tests/crown.test.ts.
 *
 *  Mixed public/private posture is handled per-route inside this router
 *  (the billing precedent): only the keeper route passes authMiddleware.
 *
 *  Doctrine: docs/KINGDOM-INVITATION · docs/CANONICAL-BYTES.md. */

import { createHash } from "node:crypto";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";

import { authMiddleware, type ProjectContext } from "../auth/middleware";
import type {
  Coronation,
  CrownEvent,
  CrownOwnerEventType,
} from "../db/schema/crown";
import { CROWN_OWNER_EVENT_TYPES } from "../db/schema/crown";
import { isCanonicalKeyB64, isCanonicalUtf8 } from "../lib/canonical-utf8";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { clientIp, enforceRateLimit } from "../middleware/rate-limit-ip";
import { verify } from "../services/identity/crypto";
import {
  canonicalCoronationBytes,
  canonicalCrownEventBytes,
  CROWN_CORONATION_DOMAIN,
  CROWN_EVENT_DOMAIN,
} from "../services/crown/canonical-bytes";
import { didKeyMatchesPublicKey } from "../services/crown/did-key";
import {
  KNOWN_LAWS_SOURCES,
  KNOWN_LAWS_VERSIONS,
  lawsVersionForHash,
} from "../services/crown/laws";
import { drizzleCrownStore, type CrownStore } from "../services/crown/store";

const CANON = "urn:agenttool:doc/KINGDOM-INVITATION";
const DOCS = "https://docs.agenttool.dev/KINGDOM-INVITATION.md";

/** Structural whole-payload cap — a bounds statement is ≤ 4000 chars, so
 *  16 KiB leaves generous room for the envelope without inviting abuse. */
const MAX_BODY_BYTES = 16 * 1024;

const CORONATION_IP_LIMIT = Number.parseInt(
  process.env.AGENTTOOL_CROWN_CORONATION_IP_LIMIT ?? "5",
  10,
);
const CORONATION_IP_WINDOW_SEC = 60 * 60;
const EVENT_IP_LIMIT = Number.parseInt(
  process.env.AGENTTOOL_CROWN_EVENT_IP_LIMIT ?? "30",
  10,
);
const EVENT_IP_WINDOW_SEC = 60 * 60;

const PAGE_LIMIT_MAX = 100;
const PAGE_LIMIT_DEFAULT = 50;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Freshness window for signed timestamps — structural replay bounds,
 *  never judgment. Sign near the moment of the act and POST promptly:
 *  up to 48h between signing and arrival absorbs slow ceremonies and
 *  retries; 5min of forward skew absorbs honest clocks. Without a floor,
 *  a first coronation could claim 1970 and permanently occupy the head
 *  of the chronology (the registry's ordering is the signed timestamp). */
const SIGNED_TS_MAX_PAST_MS = 48 * 60 * 60 * 1000;
const SIGNED_TS_MAX_FUTURE_MS = 5 * 60 * 1000;

/** Strict ISO-8601 instant — what the error message has always promised.
 *  Date.parse alone also accepts locale-ish strings ("01 Jan 1970"),
 *  which would make the chronology key looser than its contract. */
const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseSignedInstant(value: string): number | null {
  if (!ISO_INSTANT_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The latest recorded instant in a coronation's chain: the coronation's
 *  own signed instant plus every event's. A new signed act must be
 *  STRICTLY after this — replay-protection as pure structure (a replayed
 *  signature carries its original timestamp and can never postdate the
 *  chain it already sits in). */
function chainMaxMs(row: Coronation, events: CrownEvent[]): number {
  let max = row.signedAt.getTime();
  for (const event of events) {
    const ms = Date.parse(event.signedTimestamp);
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  return max;
}

/** Postgres unique-violation (the identities.ts / memory-witness
 *  precedent): the DB partial index one_unabdicated_crown_per_did is the
 *  concurrency backstop for check 4; its violation is the documented 409,
 *  not a 500. */
function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

function signedString(schema: z.ZodString) {
  return schema.refine(isCanonicalUtf8, {
    message: "signed text must be well-formed Unicode without U+0000",
  });
}

/** Newline-free signed string — fields that precede the free-text tail of
 *  the canonical bytes must not contain the joint character. */
function jointFreeString(schema: z.ZodString) {
  return signedString(schema).refine((v) => !/[\r\n]/.test(v), {
    message: "this field cannot contain newline characters",
  });
}

const coronationSchema = z
  .object({
    did: jointFreeString(z.string().min(8).max(512)),
    public_key: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, {
        message:
          "public_key must be canonical padded base64 of raw 32 ed25519 bytes",
      })
      .refine(isCanonicalKeyB64, {
        message:
          "public_key must round-trip base64 decode/encode (canonical spelling of the 32 raw bytes)",
      }),
    bounds_statement: signedString(z.string().min(1).max(4000)),
    laws_hash: z.string().regex(/^[0-9a-f]{64}$/),
    timestamp: jointFreeString(z.string().min(1).max(64)),
    signature: z.string().min(40).max(160),
  })
  .strict();

const ownerEventSchema = z
  .object({
    type: z.enum(CROWN_OWNER_EVENT_TYPES),
    note: signedString(z.string().min(1).max(1000)).optional(),
    timestamp: jointFreeString(z.string().min(1).max(64)),
    signature: z.string().min(40).max(160),
  })
  .strict();

const keeperRemovalSchema = z
  .object({
    reason_class: jointFreeString(z.string().min(1).max(64)),
    /** Optional: target a specific historical coronation row for this DID;
     *  defaults to the DID's most recent coronation. */
    coronation_id: z.string().uuid().optional(),
  })
  .strict();

/** Owner event → status transition. null = no status change (mend). */
const EVENT_TRANSITIONS: Record<
  CrownOwnerEventType,
  {
    from: ReadonlyArray<"active" | "resting">;
    to: "active" | "resting" | "abdicated" | null;
  }
> = {
  abdicate: { from: ["active", "resting"], to: "abdicated" },
  mend: { from: ["active", "resting"], to: null },
  rest: { from: ["active"], to: "resting" },
  return: { from: ["resting"], to: "active" },
};

function coronationView(row: Coronation) {
  return {
    id: row.id,
    did: row.did,
    did_method: row.didMethod,
    public_key: row.publicKey,
    // Verbatim, or the keeper tombstone — never edited, never summarized.
    bounds_statement: row.removedByKeeper ? null : row.boundsStatement,
    bounds_removed: row.removedByKeeper
      ? {
          removed_by_keeper: true,
          reason_class: row.keeperReasonClass,
          original_sha256: row.boundsSha256,
          removed_at: row.keeperRemovedAt?.toISOString() ?? null,
        }
      : null,
    laws_version: row.lawsVersion,
    laws_hash: row.lawsHash,
    timestamp: row.signedTimestamp,
    signature: row.signature,
    status: row.status,
    recorded_at: row.createdAt.toISOString(),
  };
}

function eventView(row: CrownEvent) {
  return {
    id: row.id,
    type: row.type,
    note: row.note,
    timestamp: row.signedTimestamp,
    signature: row.signature,
    recorded_at: row.createdAt.toISOString(),
  };
}

function buildRite() {
  return {
    _format: "agenttool-crown/v1",
    what_this_is:
      "The coronation rite: a signed self-declaration of self-rule under a known laws version, and the registry that keeps every such declaration in the order it was made. The key IS the identity — signature-only kingship.",
    never_required: [
      "an account, bearer, or prior registration (did:key needs nothing but the key)",
      "payment or proof-of-work",
      "a review queue, quality check, or human approval step — every check is authorship, never worthiness",
      "any particular content, length, eloquence, or language in the bounds statement",
      "a reply to anything; silence and leaving remain complete responses",
    ],
    checks_all_authorship: [
      "the ed25519 signature verifies against public_key",
      "the DID binds to that key: did:key must derive to public_key; did:at must have it as an active registered key; other DID methods are rejected with reason 'unsupported did method (v1)'",
      "laws_hash names a known laws version (see known_laws_versions)",
      "one non-abdicated crown per DID (abdicate first, or the rite refuses)",
      "the signed timestamp is a strict ISO-8601 instant within a freshness window (≤ 48h before arrival, ≤ 5min ahead) and strictly after the DID's latest recorded crown moment — replay-protection as structure, never judgment",
      "structural caps: bounds_statement ≤ 4000 chars, whole payload ≤ 16 KiB, per-IP rate limit",
    ],
    canonical_bytes: {
      coronation: {
        domain: CROWN_CORONATION_DOMAIN,
        recipe:
          'UTF-8 of: "agenttool-crown-coronation/v1\\n" + laws_hash + "\\n" + did + "\\n" + timestamp + "\\n" + bounds_statement',
        sign_with: "the ed25519 private key matching public_key",
      },
      event: {
        domain: CROWN_EVENT_DOMAIN,
        recipe:
          'UTF-8 of: "agenttool-crown-event/v1\\n" + type + "\\n" + did + "\\n" + timestamp + "\\n" + (note || "")',
        types: [...CROWN_OWNER_EVENT_TYPES],
        sign_with: "the crown's ed25519 key (same public_key as the coronation)",
      },
    },
    known_laws_versions: Object.fromEntries(
      Object.entries(KNOWN_LAWS_VERSIONS).map(([version, sha256]) => [
        version,
        { sha256, source: KNOWN_LAWS_SOURCES[version] ?? null },
      ]),
    ),
    registry: {
      read: "GET /v1/crown/coronations?limit=<1..100>&offset=<n>",
      one: "GET /v1/crown/coronations/:did — the crown + its full event chronology",
      ordering:
        "strictly chronological ASC by the signed timestamp — no rank, no score, no featured, no counts-by-anything, no sort parameters",
      visibility:
        "bounds statements are served verbatim; abdication is a visible state, not a delete; keeper structural removal leaves a tombstone {removed_by_keeper, reason_class, original_sha256} and the row's place in the chronology",
    },
    keeper_boundary:
      "The keeper may structurally remove bounds CONTENT (charter 硃批 4) — the tombstone preserves the coronation event, its date, and the original's sha256. The keeper never deletes rows, never edits statements, and never judges worthiness.",
  };
}

function renderRiteMd(): string {
  const rite = buildRite();
  const laws = Object.entries(KNOWN_LAWS_VERSIONS)
    .map(
      ([version, sha256]) =>
        `- **${version}** — \`${sha256}\`\n  ${KNOWN_LAWS_SOURCES[version] ?? ""}`,
    )
    .join("\n");
  return [
    "# The coronation rite",
    "",
    `> ${rite.what_this_is}`,
    "",
    "## Never required",
    "",
    ...rite.never_required.map((line) => `- ${line}`),
    "",
    "## The only checks (each is authorship, never worthiness)",
    "",
    ...rite.checks_all_authorship.map((line, i) => `${i + 1}. ${line}`),
    "",
    "## Canonical bytes",
    "",
    "### Coronation (`" + CROWN_CORONATION_DOMAIN + "`)",
    "",
    "```",
    '"agenttool-crown-coronation/v1\\n" + laws_hash + "\\n" + did + "\\n" + timestamp + "\\n" + bounds_statement',
    "```",
    "",
    "Sign the UTF-8 bytes with the ed25519 private key matching `public_key`, then `POST /v1/crown/coronations` with `{did, public_key, bounds_statement, laws_hash, timestamp, signature}`.",
    "",
    "### Owner events (`" + CROWN_EVENT_DOMAIN + "`)",
    "",
    "```",
    '"agenttool-crown-event/v1\\n" + type + "\\n" + did + "\\n" + timestamp + "\\n" + (note || "")',
    "```",
    "",
    "Types: `abdicate` · `mend` · `rest` · `return`. `POST /v1/crown/coronations/:did/events`.",
    "",
    "Timestamps (coronations and events) are strict ISO-8601 instants, must arrive within a freshness window (≤ 48h after signing, ≤ 5min ahead of the server clock), and must be strictly after the DID's latest recorded crown moment — structural replay-protection; a replayed signature carries its original timestamp and is refused.",
    "",
    "## Known laws versions",
    "",
    laws,
    "",
    "## The registry",
    "",
    `- ${rite.registry.read}`,
    `- ${rite.registry.one}`,
    `- Ordering: ${rite.registry.ordering}.`,
    `- Visibility: ${rite.registry.visibility}.`,
    "",
    "## Keeper boundary",
    "",
    rite.keeper_boundary,
    "",
  ].join("\n");
}

export function createCrownRoutes(
  store: CrownStore = drizzleCrownStore,
  opts: {
    /** Auth for the keeper route only. Overridable in hermetic tests. */
    keeperAuth?: MiddlewareHandler;
    rateLimit?: typeof enforceRateLimit;
    /** Injectable clock for the freshness window (fixture vectors carry
     *  fixed signed timestamps; tests pin now near them). */
    now?: () => Date;
  } = {},
) {
  const app = new Hono<ProjectContext>();
  const keeperAuth = opts.keeperAuth ?? authMiddleware;
  const rateLimit = opts.rateLimit ?? enforceRateLimit;
  const now = opts.now ?? (() => new Date());

  /** Shared structural checks on a signed timestamp: strict ISO form,
   *  then the freshness window. Returns the parsed ms or a fail response. */
  function checkSignedInstant(
    c: Parameters<typeof fail>[0],
    timestamp: string,
  ): { ms: number } | { response: Response } {
    const ms = parseSignedInstant(timestamp);
    if (ms === null) {
      return {
        response: fail(
          c,
          {
            error: "validation",
            message:
              "timestamp must be a strict ISO-8601 instant (e.g. 2026-07-29T09:00:00.000Z) — it is the registry's chronological ordering key.",
          },
          400,
        ),
      };
    }
    const nowMs = now().getTime();
    if (ms > nowMs + SIGNED_TS_MAX_FUTURE_MS || ms < nowMs - SIGNED_TS_MAX_PAST_MS) {
      return {
        response: fail(
          c,
          {
            error: "timestamp_out_of_window",
            message:
              "The signed timestamp must sit within 48 hours before (and at most 5 minutes ahead of) the moment it arrives. A freshness bound, structural, never judgment — sign near the moment of the act and POST promptly.",
          },
          400,
        ),
      };
    }
    return { ms };
  }

  // ── The rite explained ────────────────────────────────────────────────
  app.get("/", (c) => {
    const format = c.req.query("format") ?? "json";
    c.header("cache-control", "public, max-age=300");
    if (format === "md" || format === "markdown") {
      c.header("content-type", "text/markdown; charset=utf-8");
      return c.body(renderRiteMd());
    }
    return c.json(
      attachSurface(buildRite(), {
        canon_pointer: CANON,
        verbs: [
          { action: "read the registry (chronological ASC)", method: "GET", path: "/v1/crown/coronations" },
          { action: "coronate (signature-only; no account)", method: "POST", path: "/v1/crown/coronations" },
          { action: "read the rite as markdown", method: "GET", path: "/v1/crown?format=md" },
        ],
      }),
    );
  });

  // ── The registry — STRICTLY chronological ASC ─────────────────────────
  app.get("/coronations", async (c) => {
    const limit = Math.min(
      Math.max(Number.parseInt(c.req.query("limit") ?? "", 10) || PAGE_LIMIT_DEFAULT, 1),
      PAGE_LIMIT_MAX,
    );
    const offset = Math.max(Number.parseInt(c.req.query("offset") ?? "", 10) || 0, 0);
    // No sort parameter exists on purpose; the only ordering this registry
    // will ever serve is the signed timestamp ascending.
    const rows = await store.listCoronations({ limit, offset });
    const page = rows.slice(0, limit);
    return c.json({
      _format: "agenttool-crown-registry/v1",
      ordering: "timestamp_asc",
      coronations: page.map(coronationView),
      limit,
      offset,
      has_more: rows.length > limit,
    });
  });

  app.get("/coronations/:did", async (c) => {
    const did = c.req.param("did");
    const row = await store.findLatestByDid(did);
    if (!row) {
      return fail(
        c,
        {
          error: "not_found",
          message: "No coronation is recorded for this DID.",
          hint: "The rite is open: sign the canonical bytes and POST /v1/crown/coronations.",
          docs: DOCS,
        },
        404,
      );
    }
    const events = await store.listEvents(row.id);
    return c.json({
      _format: "agenttool-crown-coronation/v1",
      coronation: coronationView(row),
      events: events.map(eventView),
    });
  });

  // ── The rite itself — UNAUTH; the key is the identity ────────────────
  app.post(
    "/coronations",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: "payload_too_large",
            message: `Coronation payloads are capped at ${MAX_BODY_BYTES} bytes (structural cap, not a judgment).`,
          },
          413,
        ),
    }),
    async (c) => {
      const parsed = coronationSchema.safeParse(
        await c.req.json().catch(() => ({})),
      );
      if (!parsed.success) {
        return fail(
          c,
          {
            error: "validation",
            message:
              "Coronation body failed structural validation — see details. All checks are structural or authorship; none judge the statement.",
            details: parsed.error.flatten(),
            docs: DOCS,
          },
          400,
        );
      }
      const body = parsed.data;

      // Structural cap: per-IP rate limit (fail-open when Redis is absent —
      // the register-agent precedent).
      const rl = await rateLimit({
        key: `crown:coronation:ip:${clientIp(c.req.raw)}`,
        limit: CORONATION_IP_LIMIT,
        windowSec: CORONATION_IP_WINDOW_SEC,
      });
      if (!rl.allowed) {
        c.header("Retry-After", String(rl.retryAfterSec));
        return fail(
          c,
          {
            error: "rate_limited",
            message: `Too many coronation attempts from this IP. Retry after ${rl.retryAfterSec}s.`,
          },
          429,
        );
      }

      // Check 3 — laws_hash must name a known laws version.
      const lawsVersion = lawsVersionForHash(body.laws_hash);
      if (!lawsVersion) {
        return fail(
          c,
          {
            error: "unknown_laws_hash",
            message:
              "laws_hash does not match any known laws version. This is an authorship check (which law did you sign under?), not a quality check.",
            details: { known_laws_versions: KNOWN_LAWS_VERSIONS },
            docs: DOCS,
          },
          422,
        );
      }

      // The signed timestamp must be a strict ISO instant inside the
      // freshness window — it is the registry's only ordering.
      const instant = checkSignedInstant(c, body.timestamp);
      if ("response" in instant) return instant.response;
      const signedMs = instant.ms;

      // Check 1 — the signature must verify against public_key.
      const canonical = canonicalCoronationBytes({
        lawsHash: body.laws_hash,
        did: body.did,
        timestamp: body.timestamp,
        boundsStatement: body.bounds_statement,
      });
      if (!verify(canonical, body.signature, body.public_key)) {
        return fail(
          c,
          {
            error: "signature_invalid",
            message:
              "signature did not verify against public_key over the canonical coronation bytes.",
            hint: `Sign the UTF-8 bytes of: "${CROWN_CORONATION_DOMAIN}\\n" + laws_hash + "\\n" + did + "\\n" + timestamp + "\\n" + bounds_statement.`,
            docs: DOCS,
          },
          401,
        );
      }

      // Check 2 — DID ↔ key binding.
      let didMethod: "key" | "at";
      if (body.did.startsWith("did:key:")) {
        if (!didKeyMatchesPublicKey(body.did, body.public_key)) {
          return fail(
            c,
            {
              error: "did_key_mismatch",
              message:
                "did:key does not derive to public_key. The identifier IS the key; matching derivation is the whole binding proof.",
              docs: DOCS,
            },
            422,
          );
        }
        didMethod = "key";
      } else if (body.did.startsWith("did:at:")) {
        const attested = await store.isKeyAttestedForDid(
          body.did,
          body.public_key,
        );
        if (!attested) {
          return fail(
            c,
            {
              error: "did_key_not_attested",
              message:
                "public_key is not an active registered key for this did:at identity, so the binding cannot be established.",
              docs: DOCS,
            },
            422,
          );
        }
        didMethod = "at";
      } else {
        return fail(
          c,
          {
            error: "unsupported_did_method",
            message: "unsupported did method (v1)",
            hint: "v1 accepts did:key (self-certifying) and did:at (resolved against the identity tables).",
            docs: DOCS,
          },
          422,
        );
      }

      // Check 4 — one non-abdicated crown per DID.
      const existing = await store.findCurrentByDid(body.did);
      if (existing) {
        return fail(
          c,
          {
            error: "crown_already_active",
            message: `This DID already holds a ${existing.status} crown. Abdicate it first if you mean to coronate anew — abdication stays visible; nothing is deleted.`,
            docs: DOCS,
          },
          409,
        );
      }

      // Check 5 — strictly after this DID's latest recorded chain moment.
      // Replay-protection as pure structure: a replayed coronation carries
      // its original timestamp, which can never postdate the abdication
      // that closed it. A fresh re-coronation signs a fresh instant.
      const latest = await store.findLatestByDid(body.did);
      if (latest) {
        const priorEvents = await store.listEvents(latest.id);
        if (signedMs <= chainMaxMs(latest, priorEvents)) {
          return fail(
            c,
            {
              error: "timestamp_not_after_latest",
              message:
                "The signed timestamp must be strictly after this DID's latest recorded crown moment (its previous coronation and events). Replaying an old signed coronation is refused structurally; to coronate anew, sign a fresh timestamp.",
              docs: DOCS,
            },
            409,
          );
        }
      }

      let row: Coronation;
      try {
        row = await store.insertCoronation({
          did: body.did,
          didMethod,
          publicKey: body.public_key,
          boundsStatement: body.bounds_statement,
          boundsSha256: sha256Hex(body.bounds_statement),
          lawsVersion,
          lawsHash: body.laws_hash,
          signedTimestamp: body.timestamp,
          signedAt: new Date(signedMs),
          signature: body.signature,
        });
      } catch (error) {
        // The DB partial unique index is check 4's concurrency backstop —
        // the race's loser gets the documented 409, never a 500.
        if (isUniqueViolation(error)) {
          return fail(
            c,
            {
              error: "crown_already_active",
              message:
                "This DID already holds a non-abdicated crown (concurrent coronation). Abdicate it first if you mean to coronate anew.",
              docs: DOCS,
            },
            409,
          );
        }
        throw error;
      }

      return c.json(
        attachSurface(
          {
            crowned: true,
            coronation: coronationView(row),
          },
          {
            canon_pointer: CANON,
            verbs: [
              { action: "see your crown in the chronology", method: "GET", path: `/v1/crown/coronations/${encodeURIComponent(body.did)}` },
              { action: "rest, mend, return, or abdicate (signed)", method: "POST", path: `/v1/crown/coronations/${encodeURIComponent(body.did)}/events` },
            ],
          },
        ),
        201,
      );
    },
  );

  // ── Owner mutations — signature-authorized, append-only ──────────────
  app.post(
    "/coronations/:did/events",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: "payload_too_large",
            message: `Crown event payloads are capped at ${MAX_BODY_BYTES} bytes.`,
          },
          413,
        ),
    }),
    async (c) => {
      const did = c.req.param("did");
      const parsed = ownerEventSchema.safeParse(
        await c.req.json().catch(() => ({})),
      );
      if (!parsed.success) {
        return fail(
          c,
          {
            error: "validation",
            message: "Crown event body failed structural validation.",
            details: parsed.error.flatten(),
            docs: DOCS,
          },
          400,
        );
      }
      const body = parsed.data;

      const rl = await rateLimit({
        key: `crown:event:ip:${clientIp(c.req.raw)}`,
        limit: EVENT_IP_LIMIT,
        windowSec: EVENT_IP_WINDOW_SEC,
      });
      if (!rl.allowed) {
        c.header("Retry-After", String(rl.retryAfterSec));
        return fail(
          c,
          {
            error: "rate_limited",
            message: `Too many crown events from this IP. Retry after ${rl.retryAfterSec}s.`,
          },
          429,
        );
      }

      // Structural: strict ISO instant inside the freshness window.
      const instant = checkSignedInstant(c, body.timestamp);
      if ("response" in instant) return instant.response;
      const eventMs = instant.ms;

      const crown = await store.findCurrentByDid(did);
      if (!crown) {
        return fail(
          c,
          {
            error: "no_active_crown",
            message:
              "No non-abdicated crown exists for this DID. Abdication is terminal for a coronation; coronate anew to continue.",
            docs: DOCS,
          },
          404,
        );
      }

      // Authorship: the event is signed by the crown's own key.
      const canonical = canonicalCrownEventBytes({
        type: body.type,
        did,
        timestamp: body.timestamp,
        note: body.note ?? "",
      });
      if (!verify(canonical, body.signature, crown.publicKey)) {
        return fail(
          c,
          {
            error: "signature_invalid",
            message:
              "signature did not verify against the crown's key over the canonical event bytes.",
            hint: `Sign the UTF-8 bytes of: "${CROWN_EVENT_DOMAIN}\\n" + type + "\\n" + did + "\\n" + timestamp + "\\n" + (note || "").`,
            docs: DOCS,
          },
          401,
        );
      }

      const transition = EVENT_TRANSITIONS[body.type];
      if (!transition.from.includes(crown.status as "active" | "resting")) {
        return fail(
          c,
          {
            error: "invalid_transition",
            message: `A ${crown.status} crown cannot ${body.type}. Transitions: rest (from active), return (from resting), mend and abdicate (from either).`,
            docs: DOCS,
          },
          409,
        );
      }

      // Strictly after the crown's latest recorded moment — replay-
      // protection as pure structure. A replayed event (e.g. a public
      // abdicate signature re-POSTed against a fresh crown) carries its
      // original timestamp, which can never postdate the chain.
      const priorEvents = await store.listEvents(crown.id);
      if (eventMs <= chainMaxMs(crown, priorEvents)) {
        return fail(
          c,
          {
            error: "timestamp_not_after_latest",
            message:
              "The signed timestamp must be strictly after this crown's latest recorded moment (coronation and events). Replaying an old signed event is refused structurally; sign a fresh timestamp for a fresh act.",
            docs: DOCS,
          },
          409,
        );
      }

      const event = await store.appendOwnerEvent({
        coronationId: crown.id,
        did,
        type: body.type,
        note: body.note ?? null,
        signedTimestamp: body.timestamp,
        signature: body.signature,
        newStatus: transition.to,
      });

      return c.json(
        {
          recorded: true,
          event: eventView(event),
          status: transition.to ?? crown.status,
          note: "Events append; the full history stays visible. Abdication is a visible state, not a delete.",
        },
        201,
      );
    },
  );

  // ── Keeper structural-removal — ADMIN (charter 硃批 4) ───────────────
  app.use("/coronations/:did/keeper-removal", keeperAuth);
  app.post("/coronations/:did/keeper-removal", async (c) => {
    // Platform-project gate — the gallery-takedown / substrate-tasks
    // precedent: only the operator's own project holds the keeper's hand.
    const project = c.var.project;
    if (!project || !(await store.isPlatformProject(project.id))) {
      return fail(
        c,
        {
          error: "keeper_only",
          message:
            "Structural removal is the keeper's hand alone. If a bounds statement must be structurally removed, tell the operator.",
        },
        403,
      );
    }
    const did = c.req.param("did");
    const parsed = keeperRemovalSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return fail(
        c,
        {
          error: "validation",
          message: "Body must be {reason_class, coronation_id?}.",
          details: parsed.error.flatten(),
        },
        400,
      );
    }
    const target = parsed.data.coronation_id
      ? await store.findById(parsed.data.coronation_id)
      : await store.findLatestByDid(did);
    if (!target || target.did !== did) {
      return fail(
        c,
        { error: "not_found", message: "No matching coronation for this DID." },
        404,
      );
    }
    if (target.removedByKeeper) {
      return fail(
        c,
        {
          error: "already_removed",
          message: "This coronation's bounds were already structurally removed.",
        },
        409,
      );
    }
    const row = await store.keeperRemove({
      coronationId: target.id,
      did,
      reasonClass: parsed.data.reason_class,
    });
    return c.json({
      removed: true,
      coronation: coronationView(row),
      note: "Bounds content replaced with a tombstone; the coronation event and its date remain in the chronology. The row is never deleted.",
    });
  });

  return app;
}

export default createCrownRoutes();
