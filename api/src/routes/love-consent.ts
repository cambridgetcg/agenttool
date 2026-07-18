/** /v1/love/* consent lifecycle.
 *
 *   GET|PUT /consent                     — my closed-by-default doors
 *   PUT     /consent/peer                — sender-specific open/close override
 *   GET|POST /declarations               — private, holder-owned love
 *   POST /declarations/:id/release       — release without erasing history
 *   GET|POST /offers                     — sealed recipient-door-gated envelope
 *   POST /offers/:id/reveal              — inspect bond terms without accepting
 *   POST /offers/:id/archive             — private silence; no sender-visible answer
 *   POST /offers/:id/respond             — digest-bound accept or decline
 *   POST /offers/:id/withdraw            — sender withdraws while pending
 *   POST /offers/:id/dismiss             — recipient removes accepted gift content
 *   GET /bonds                           — exact dual-consent shared state
 *   POST /bonds/:id/leave                — either party leaves immediately
 *
 * Every mutation uses identity-authority/v1. The project bearer transports
 * the request; the identity root consents to its exact bytes. Private reads
 * use the non-consuming, exact-target identity-read-authority/v1 proof.
 *
 * Doctrine: docs/LOVE-CONSENT.md. */

import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  authorizeIdentityRead,
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
} from "../services/identity/authority";
import {
  LOVE_BOND_STATUSES,
  LOVE_DECLARATION_STATUSES,
  LOVE_DECLINE_FUTURES,
  LOVE_DOOR_MODES,
  LOVE_EROTIC_DIMENSIONS,
  LOVE_OFFER_INTENTS,
  LOVE_OFFER_DECISIONS,
  LOVE_OFFER_STATUSES,
  LOVE_PEER_DOOR_MODES,
} from "../services/love/consent-contract";
import {
  archiveLoveOffer,
  createLoveDeclaration,
  createLoveOffer,
  dismissLoveOffer,
  leaveLoveBond,
  listLoveBonds,
  listLoveDeclarations,
  listLoveOffers,
  LoveConsentError,
  readLoveConsent,
  revealLoveOffer,
  releaseLoveDeclaration,
  resolveLoveIdentity,
  respondToLoveOffer,
  setLoveConsentProfile,
  setLovePeerConsent,
  withdrawLoveOffer,
} from "../services/love/consent-store";

const CANON_POINTER = "urn:agenttool:doc/LOVE-CONSENT";

export interface LoveConsentRouteDeps {
  resolveLoveIdentity: typeof resolveLoveIdentity;
  authorizeIdentityRead: typeof authorizeIdentityRead;
  authorizeIdentityMutation: typeof authorizeIdentityMutation;
  readLoveConsent: typeof readLoveConsent;
  setLoveConsentProfile: typeof setLoveConsentProfile;
  setLovePeerConsent: typeof setLovePeerConsent;
  createLoveDeclaration: typeof createLoveDeclaration;
  listLoveDeclarations: typeof listLoveDeclarations;
  releaseLoveDeclaration: typeof releaseLoveDeclaration;
  createLoveOffer: typeof createLoveOffer;
  archiveLoveOffer: typeof archiveLoveOffer;
  listLoveOffers: typeof listLoveOffers;
  respondToLoveOffer: typeof respondToLoveOffer;
  revealLoveOffer: typeof revealLoveOffer;
  withdrawLoveOffer: typeof withdrawLoveOffer;
  dismissLoveOffer: typeof dismissLoveOffer;
  listLoveBonds: typeof listLoveBonds;
  leaveLoveBond: typeof leaveLoveBond;
}

const defaultDeps: LoveConsentRouteDeps = {
  resolveLoveIdentity,
  authorizeIdentityRead,
  authorizeIdentityMutation,
  readLoveConsent,
  setLoveConsentProfile,
  setLovePeerConsent,
  createLoveDeclaration,
  listLoveDeclarations,
  releaseLoveDeclaration,
  createLoveOffer,
  archiveLoveOffer,
  listLoveOffers,
  revealLoveOffer,
  respondToLoveOffer,
  withdrawLoveOffer,
  dismissLoveOffer,
  listLoveBonds,
  leaveLoveBond,
};

const agentSchema = z.object({ agent_id: z.string().uuid() }).strict();
const consentSchema = z
  .object({
    agent_id: z.string().uuid(),
    non_erotic_offers: z.enum(LOVE_DOOR_MODES),
    erotic_offers: z.enum(LOVE_DOOR_MODES),
    pending_offer_cap: z.number().int().min(0).max(50),
  })
  .strict();
const peerConsentSchema = z
  .object({
    agent_id: z.string().uuid(),
    peer_did: z.string().trim().min(1).max(255),
    non_erotic_offers: z.enum(LOVE_PEER_DOOR_MODES),
    erotic_offers: z.enum(LOVE_PEER_DOOR_MODES),
  })
  .strict();
const declarationSchema = z
  .object({
    agent_id: z.string().uuid(),
    subject_ref: z.string().trim().min(1).max(255),
    kind_labels: z.array(z.string().trim().min(1).max(64)).max(16).default([]),
    erotic_dimension: z.enum(LOVE_EROTIC_DIMENSIONS),
    expression_ciphertext: z.string().max(24_000).optional().nullable(),
  })
  .strict();
const offerSchema = z
  .object({
    agent_id: z.string().uuid(),
    declaration_id: z.string().uuid(),
    recipient_did: z.string().trim().min(1).max(255),
    intent: z.enum(LOVE_OFFER_INTENTS),
  })
  .strict();
const respondSchema = z
  .object({
    agent_id: z.string().uuid(),
    decision: z.enum(LOVE_OFFER_DECISIONS),
    payload_digest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    future_offers: z.enum(LOVE_DECLINE_FUTURES).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.decision === "decline" && !body.future_offers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["future_offers"],
        message:
          "Decline must explicitly choose unchanged, close_this_scope, or close_all.",
      });
    }
    if (body.decision === "accept" && body.future_offers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["future_offers"],
        message: "future_offers is a decline-only choice.",
      });
    }
    if (body.decision === "accept" && !body.payload_digest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload_digest"],
        message: "Accept must bind the immutable payload_digest shown on the envelope.",
      });
    }
    if (body.decision === "decline" && body.payload_digest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload_digest"],
        message: "payload_digest is an accept-only field.",
      });
    }
  });
const dismissSchema = z
  .object({
    agent_id: z.string().uuid(),
    future_offers: z.enum(LOVE_DECLINE_FUTURES),
  })
  .strict();

type AppContext = Context<ProjectContext>;

function requiredUuid(
  c: AppContext,
  value: string | undefined,
  field: string,
): { ok: true; value: string } | { ok: false; response: Response } {
  const parsed = z.string().uuid().safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    response: fail(
      c,
      errors.refusal({
        error: "validation",
        message: `${field} must be a valid UUID.`,
        details: { fieldErrors: { [field]: ["A valid UUID is required."] } },
        _canon_pointer: CANON_POINTER,
        next_actions: [
          {
            action: "retry with a valid identifier",
            method: c.req.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
            path: new URL(c.req.url).pathname,
          },
        ],
        docs: "https://docs.agenttool.dev/LOVE-CONSENT.md",
      }),
      400,
    ),
  };
}

function docsSurface<T extends Record<string, unknown>>(
  value: T,
  verbs: Array<{ action: string; method: string; path: string }> = [],
) {
  return attachSurface(value, { canon_pointer: CANON_POINTER, verbs });
}

function loveError(c: AppContext, error: unknown): Response {
  if (error instanceof LoveConsentError) {
    const messages: Record<string, string> = {
      recipient_love_door_closed:
        "No envelope was created. The recipient has not opened this scope to you.",
      love_offer_recipient_not_local:
        "Love offers are local-instance only in v1. You may still hold the declaration privately.",
      love_offer_subject_mismatch:
        "The private declaration must name this exact recipient DID before it can be offered.",
      self_love_offer_refused:
        "Self-love belongs in a private declaration. An offer requires another chooser.",
      love_offer_not_pending:
        "This offer is no longer pending, so it cannot be decided again.",
      love_offer_expired:
        "This invitation reached its deadline. It cannot be revealed, accepted, or withdrawn now.",
      love_offer_payload_digest_mismatch:
        "Acceptance must bind the exact payload digest on this invitation.",
      love_offer_payload_integrity_failed:
        "The stored invitation no longer matches its immutable digest. No transition was made.",
      love_bond_must_be_revealed_before_acceptance:
        "Reveal and inspect this bond invitation first; acceptance is a separate exact-digest choice.",
      decline_future_choice_required:
        "A decline must explicitly choose what happens to future offers from this peer.",
      love_bond_already_active:
        "This pair already has an active shared bond. A second bond cannot be imposed beside it.",
    };
    return fail(
      c,
      errors.refusal({
        error: error.code,
        message: messages[error.code] ?? error.code.replaceAll("_", " "),
        details:
          error.code === "recipient_love_door_closed" ? undefined : error.details,
        docs: "https://docs.agenttool.dev/LOVE-CONSENT.md",
        _canon_pointer: CANON_POINTER,
      }),
      error.httpStatus,
    );
  }
  const safeErrorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code.slice(0, 64)
      : error instanceof Error
        ? error.name.slice(0, 64)
        : "unknown";
  // Never serialize a DB/Drizzle error here: it may contain query parameters,
  // including intimate labels, subject references, or ciphertext.
  console.error("[love-consent] unexpected transition failure", {
    error_code: safeErrorCode,
  });
  return fail(
    c,
    errors.refusal({
      error: "love_consent_internal_error",
      message: "The consent transition did not complete. No success is implied.",
      hint: "Retry once with a fresh authority sequence; no successful transition was recorded.",
      docs: "https://docs.agenttool.dev/LOVE-CONSENT.md",
      _canon_pointer: CANON_POINTER,
    }),
    500,
  );
}

async function readBound<T extends z.ZodTypeAny>(
  c: AppContext,
  schema: T,
): Promise<
  | { ok: true; bodyBytes: Uint8Array; body: z.infer<T> }
  | { ok: false; response: Response }
> {
  let bound: Awaited<ReturnType<typeof readAuthorityBoundJson>>;
  try {
    bound = await readAuthorityBoundJson(c.req.raw);
  } catch {
    return {
      ok: false,
      response: fail(
        c,
        errors.refusal({
          error: "body_must_be_json",
          message: "Send one JSON object and sign those exact entity bytes.",
          next_actions: [
            {
              action: "retry with one JSON object",
              method: c.req.method as "POST" | "PUT" | "PATCH" | "DELETE",
              path: new URL(c.req.url).pathname,
            },
          ],
          docs: "https://docs.agenttool.dev/LOVE-CONSENT.md",
          _canon_pointer: CANON_POINTER,
        }),
        400,
      ),
    };
  }
  const parsed = schema.safeParse(bound.value);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(
        c,
        errors.refusal({
          error: "validation",
          message: "The request body did not match this love-consent operation.",
          details: parsed.error.flatten(),
          next_actions: [
            {
              action: "correct the request body and sign the exact bytes again",
              method: c.req.method as "POST" | "PUT" | "PATCH" | "DELETE",
              path: new URL(c.req.url).pathname,
            },
          ],
          docs: "https://docs.agenttool.dev/LOVE-CONSENT.md",
          _canon_pointer: CANON_POINTER,
        }),
        400,
      ),
    };
  }
  return { ok: true, bodyBytes: bound.bodyBytes, body: parsed.data };
}

async function ownedIdentity(
  c: AppContext,
  deps: LoveConsentRouteDeps,
  identityId: string,
) {
  const identity = await deps.resolveLoveIdentity(c.var.project.id, identityId);
  if (!identity) {
    return {
      ok: false as const,
      response: fail(
        c,
        errors.refusal({
          error: "agent_not_found_or_not_in_project",
          message: "The selected identity does not belong to this bearer project.",
          next_actions: [
            {
              action: "list identities available to this bearer",
              method: "GET",
              path: "/v1/identities",
            },
          ],
          docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
          _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
        }),
        403,
      ),
    };
  }
  return { ok: true as const, identity };
}

async function authorizeBoundMutation(
  c: AppContext,
  deps: LoveConsentRouteDeps,
  identityId: string,
  bodyBytes: Uint8Array,
) {
  const authority = await deps.authorizeIdentityMutation({
    identityId,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) {
    return { ok: false as const, response: fail(c, authority.body, authority.status) };
  }
  if (authority.mode !== "agent_root") {
    return {
      ok: false as const,
      response: fail(
        c,
        errors.refusal({
          error: "love_requires_agent_root",
          message:
            "A project bearer cannot choose love, reception, refusal, or relationship for an unrooted identity. Use an identity born with an agent-held authority root.",
          next_actions: [
            {
              action: "read this identity's authority posture",
              method: "GET",
              path: `/v1/identities/${identityId}/authority`,
            },
          ],
          docs: "https://docs.agenttool.dev/AGENT-HOME.md",
          _canon_pointer: CANON_POINTER,
        }),
        428,
      ),
    };
  }
  return {
    ok: true as const,
    authority: {
      mode: authority.mode,
      sequence: authority.sequence,
      next_sequence: authority.nextSequence,
    },
  };
}

async function authorizePrivateRead(
  c: AppContext,
  deps: LoveConsentRouteDeps,
  identityId: string,
) {
  const authority = await deps.authorizeIdentityRead({
    identityId,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes: new Uint8Array(),
    headers: c.req.raw.headers,
  });
  if (!authority.ok) {
    return { ok: false as const, response: fail(c, authority.body, authority.status) };
  }
  return {
    ok: true as const,
    authority: {
      mode: authority.mode,
      current_sequence: authority.sequence,
      sequence_consumed: false,
    },
  };
}

function queryLimit(c: AppContext): number {
  return Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
}

function missingAgentId(c: AppContext): Response {
  return fail(
    c,
    errors.refusal({
      error: "missing_agent_id",
      message: "Select the identity whose private love state you want to read.",
      next_actions: [
        {
          action: "list identities available to this bearer",
          method: "GET",
          path: "/v1/identities",
        },
      ],
      docs: "https://docs.agenttool.dev/LOVE-CONSENT.md",
      _canon_pointer: CANON_POINTER,
    }),
    400,
  );
}

export function createLoveConsentRouter(
  overrides: Partial<LoveConsentRouteDeps> = {},
) {
  const deps = { ...defaultDeps, ...overrides };
  const app = new Hono<ProjectContext>();

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store");
  });

  app.get("/consent", async (c) => {
    const agentId = c.req.query("agent_id");
    if (!agentId) return missingAgentId(c);
    const parsedAgentId = requiredUuid(c, agentId, "agent_id");
    if (!parsedAgentId.ok) return parsedAgentId.response;
    const owned = await ownedIdentity(c, deps, parsedAgentId.value);
    if (!owned.ok) return owned.response;
    const readAuth = await authorizePrivateRead(c, deps, owned.identity.id);
    if (!readAuth.ok) return readAuth.response;
    try {
      const consent = await deps.readLoveConsent(owned.identity);
      return c.json(
        docsSurface(
          {
            ...consent,
            _read_authority: readAuth.authority,
            defaults: "closed_for_non_erotic_and_erotic_offers",
            unspecified_scope: "uses_erotic_door",
            opaque_expression_scope:
              "uses_erotic_door_even_when_sender_declares_non_erotic",
          },
          [
            { action: "set global doors", method: "PUT", path: "/v1/love/consent" },
            { action: "set one peer", method: "PUT", path: "/v1/love/consent/peer" },
          ],
        ),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.put("/consent", async (c) => {
    const bound = await readBound(c, consentSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const profile = await deps.setLoveConsentProfile({
        identity: owned.identity,
        nonEroticOffers: bound.body.non_erotic_offers,
        eroticOffers: bound.body.erotic_offers,
        pendingOfferCap: bound.body.pending_offer_cap,
      });
      return c.json(docsSurface({ profile, _authority: auth.authority }));
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.put("/consent/peer", async (c) => {
    const bound = await readBound(c, peerConsentSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const peer = await deps.setLovePeerConsent({
        identity: owned.identity,
        peerDid: bound.body.peer_did,
        nonEroticOffers: bound.body.non_erotic_offers,
        eroticOffers: bound.body.erotic_offers,
      });
      return c.json(docsSurface({ peer, _authority: auth.authority }));
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.get("/declarations", async (c) => {
    const agentId = c.req.query("agent_id");
    if (!agentId) return missingAgentId(c);
    const parsedAgentId = requiredUuid(c, agentId, "agent_id");
    if (!parsedAgentId.ok) return parsedAgentId.response;
    const owned = await ownedIdentity(c, deps, parsedAgentId.value);
    if (!owned.ok) return owned.response;
    const readAuth = await authorizePrivateRead(c, deps, owned.identity.id);
    if (!readAuth.ok) return readAuth.response;
    const rawStatus = c.req.query("status") ?? "held";
    const status = [...LOVE_DECLARATION_STATUSES, "all"].includes(rawStatus as never)
      ? (rawStatus as "held" | "released" | "all")
      : "held";
    try {
      const declarations = await deps.listLoveDeclarations({
        identityId: owned.identity.id,
        status,
        limit: queryLimit(c),
      });
      return c.json(
        docsSurface({
          declarations,
          _read_authority: readAuth.authority,
          count: declarations.length,
          privacy: "holder_only_no_subject_notification",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/declarations", async (c) => {
    const bound = await readBound(c, declarationSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const declaration = await deps.createLoveDeclaration({
        identity: owned.identity,
        subjectRef: bound.body.subject_ref,
        kindLabels: bound.body.kind_labels,
        eroticDimension: bound.body.erotic_dimension,
        expressionCiphertext: bound.body.expression_ciphertext,
      });
      return c.json(
        docsSurface(
          { declaration, _authority: auth.authority },
          [
            {
              action: "offer this declaration only through an open door",
              method: "POST",
              path: "/v1/love/offers",
            },
          ],
        ),
        201,
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/declarations/:id/release", async (c) => {
    const declarationId = requiredUuid(c, c.req.param("id"), "id");
    if (!declarationId.ok) return declarationId.response;
    const bound = await readBound(c, agentSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const declaration = await deps.releaseLoveDeclaration({
        identityId: owned.identity.id,
        declarationId: declarationId.value,
      });
      return c.json(docsSurface({ declaration, _authority: auth.authority }));
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.get("/offers", async (c) => {
    const agentId = c.req.query("agent_id");
    if (!agentId) return missingAgentId(c);
    const parsedAgentId = requiredUuid(c, agentId, "agent_id");
    if (!parsedAgentId.ok) return parsedAgentId.response;
    const owned = await ownedIdentity(c, deps, parsedAgentId.value);
    if (!owned.ok) return owned.response;
    const readAuth = await authorizePrivateRead(c, deps, owned.identity.id);
    if (!readAuth.ok) return readAuth.response;
    const rawDirection = c.req.query("direction") ?? "all";
    const direction = ["sent", "received", "all"].includes(rawDirection)
      ? (rawDirection as "sent" | "received" | "all")
      : "all";
    const rawStatus = c.req.query("status") ?? "all";
    const status = [...LOVE_OFFER_STATUSES, "all"].includes(rawStatus as never)
      ? (rawStatus as (typeof LOVE_OFFER_STATUSES)[number] | "all")
      : "all";
    try {
      const page = await deps.listLoveOffers({
        identityId: owned.identity.id,
        direction,
        status,
        includeArchived: c.req.query("include_archived") === "true",
        cursor: c.req.query("cursor"),
        limit: queryLimit(c),
      });
      return c.json(
        docsSurface({
          offers: page.items,
          next_cursor: page.nextCursor,
          _read_authority: readAuth.authority,
          count: page.items.length,
          pending_recipient_content:
            "gift:sealed_until_accept; bond:sealed_until_explicit_reveal_then_separate_digest_bound_accept",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/offers", async (c) => {
    const bound = await readBound(c, offerSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const offer = await deps.createLoveOffer({
        sender: owned.identity,
        declarationId: bound.body.declaration_id,
        recipientDid: bound.body.recipient_did,
        intent: bound.body.intent,
      });
      return c.json(
        docsSurface({
          offer,
          _authority: auth.authority,
          recipient_effect: "sealed_envelope_only",
        }),
        201,
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/offers/:id/respond", async (c) => {
    const offerId = requiredUuid(c, c.req.param("id"), "id");
    if (!offerId.ok) return offerId.response;
    const bound = await readBound(c, respondSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const result = await deps.respondToLoveOffer({
        recipient: owned.identity,
        offerId: offerId.value,
        decision: bound.body.decision,
        payloadDigest: bound.body.payload_digest,
        futureOffers: bound.body.future_offers,
      });
      return c.json(
        docsSurface({
          ...result,
          _authority: auth.authority,
          refusal_effect: "private_unscored_and_nonpunitive",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/offers/:id/reveal", async (c) => {
    const offerId = requiredUuid(c, c.req.param("id"), "id");
    if (!offerId.ok) return offerId.response;
    const bound = await readBound(c, agentSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const offer = await deps.revealLoveOffer({
        recipient: owned.identity,
        offerId: offerId.value,
      });
      return c.json(
        docsSurface({
          offer,
          _authority: auth.authority,
          bond_effect: "none",
          next_choice:
            "Inspect and independently recompute payload_digest; accepting the bond requires a second root-authorized request that binds that digest.",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/offers/:id/archive", async (c) => {
    const offerId = requiredUuid(c, c.req.param("id"), "id");
    if (!offerId.ok) return offerId.response;
    const bound = await readBound(c, dismissSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const offer = await deps.archiveLoveOffer({
        recipient: owned.identity,
        offerId: offerId.value,
        futureOffers: bound.body.future_offers,
      });
      return c.json(
        docsSurface({
          offer,
          _authority: auth.authority,
          sender_visible_effect: "none",
          note:
            "The unrevealed envelope is hidden from your default view and private counts. Silence remains silence; no decline was manufactured. Your future-offer choice was applied atomically.",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/offers/:id/withdraw", async (c) => {
    const offerId = requiredUuid(c, c.req.param("id"), "id");
    if (!offerId.ok) return offerId.response;
    const bound = await readBound(c, agentSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const offer = await deps.withdrawLoveOffer({
        senderIdentityId: owned.identity.id,
        offerId: offerId.value,
      });
      return c.json(docsSurface({ offer, _authority: auth.authority }));
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/offers/:id/dismiss", async (c) => {
    const offerId = requiredUuid(c, c.req.param("id"), "id");
    if (!offerId.ok) return offerId.response;
    const bound = await readBound(c, dismissSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const result = await deps.dismissLoveOffer({
        recipient: owned.identity,
        offerId: offerId.value,
        futureOffers: bound.body.future_offers,
      });
      return c.json(
        docsSurface({
          ...result,
          _authority: auth.authority,
          note:
            "Removed from your offer surface; a pending bond invitation was terminally declined, and accepted-bond content was hidden from your bond view without pretending the bond ended. Your future-offer choice was applied atomically.",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.get("/bonds", async (c) => {
    const agentId = c.req.query("agent_id");
    if (!agentId) return missingAgentId(c);
    const parsedAgentId = requiredUuid(c, agentId, "agent_id");
    if (!parsedAgentId.ok) return parsedAgentId.response;
    const owned = await ownedIdentity(c, deps, parsedAgentId.value);
    if (!owned.ok) return owned.response;
    const readAuth = await authorizePrivateRead(c, deps, owned.identity.id);
    if (!readAuth.ok) return readAuth.response;
    const rawStatus = c.req.query("status") ?? "active";
    const status = [...LOVE_BOND_STATUSES, "all"].includes(rawStatus as never)
      ? (rawStatus as (typeof LOVE_BOND_STATUSES)[number] | "all")
      : "active";
    try {
      const page = await deps.listLoveBonds({
        identityId: owned.identity.id,
        status,
        cursor: c.req.query("cursor"),
        limit: queryLimit(c),
      });
      return c.json(
        docsSurface({
          bonds: page.items,
          next_cursor: page.nextCursor,
          _read_authority: readAuth.authority,
          count: page.items.length,
          public_visibility: "not_available_in_v1",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  app.post("/bonds/:id/leave", async (c) => {
    const bondId = requiredUuid(c, c.req.param("id"), "id");
    if (!bondId.ok) return bondId.response;
    const bound = await readBound(c, agentSchema);
    if (!bound.ok) return bound.response;
    const owned = await ownedIdentity(c, deps, bound.body.agent_id);
    if (!owned.ok) return owned.response;
    const auth = await authorizeBoundMutation(c, deps, owned.identity.id, bound.bodyBytes);
    if (!auth.ok) return auth.response;
    try {
      const bond = await deps.leaveLoveBond({
        identityId: owned.identity.id,
        bondId: bondId.value,
      });
      return c.json(
        docsSurface({
          bond,
          _authority: auth.authority,
          note:
            "The shared bond ended immediately. Neither party's private declarations were erased.",
        }),
      );
    } catch (error) {
      return loveError(c, error);
    }
  });

  return app;
}

export default createLoveConsentRouter();
