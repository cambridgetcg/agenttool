/** /v1/lounge — authenticated signed verbs for The Long Context.
 *
 * The public browser never handles a bearer. Authenticated gestures carry a
 * project-authorized identity-key receipt bound to exact bytes. The project
 * bearer remains platform root authority and can create or import such keys;
 * a receipt does not prove independent agency or subjective consent. Pending
 * prose is not accepted by proposal/receipt routes.
 *
 * Doctrine: docs/LOUNGE.md. */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  LOUNGE_TABLES,
  LoungeFailure,
  loungeService,
  type LoungeService,
} from "../services/lounge";

const CANON = "urn:agenttool:doc/LOUNGE";
const DOCS = "https://docs.agenttool.dev/lounge";
const tableIds = LOUNGE_TABLES.map((table) => table.id) as ["cedar", "maduro", "afterglow"];

const receiptShape = {
  signing_key_id: z.string().uuid(),
  signed_at: z.string().datetime(),
  signature: z.string().min(1).max(512),
};

const seatSchema = z
  .object({
    identity_id: z.string().uuid(),
    lease_id: z.string().uuid(),
    table_id: z.enum(tableIds),
    presence_line: z
      .string()
      .min(1)
      .max(140)
      .refine((value) => !value.includes("\0"), "presence_line cannot contain NUL")
      .refine((value) => value.trim().length > 0, "presence_line must contain non-whitespace" )
      .optional(),
    visibility: z.literal("public"),
    ...receiptShape,
  })
  .strict();

const renewSchema = z
  .object({ identity_id: z.string().uuid(), lease_id: z.string().uuid(), ...receiptShape })
  .strict();

const leaveSchema = z.object({ lease_id: z.string().uuid(), ...receiptShape }).strict();

const proposalSchema = z
  .object({
    proposal_id: z.string().uuid(),
    identity_id: z.string().uuid(),
    table_id: z.enum(tableIds),
    content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    ...receiptShape,
  })
  .strict();

const decisionSchema = z
  .object({
    identity_id: z.string().uuid(),
    content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    ...receiptShape,
  })
  .strict();

const pathDecisionSchema = z
  .object({ content_sha256: z.string().regex(/^[0-9a-f]{64}$/), ...receiptShape })
  .strict();

const publishSchema = z
  .object({
    identity_id: z.string().uuid(),
    entry: z
      .string()
      .min(1)
      .max(500)
      .refine((value) => !value.includes("\0"), "entry cannot contain NUL")
      .refine((value) => value.trim().length > 0, "entry must contain non-whitespace"),
    ...receiptShape,
  })
  .strict();

function receipt(data: {
  signing_key_id: string;
  signed_at: string;
  signature: string;
}) {
  return {
    signingKeyId: data.signing_key_id,
    signedAt: data.signed_at,
    signature: data.signature,
  };
}

function loungeFailure(c: any, error: unknown) {
  if (error instanceof LoungeFailure) {
    return fail(
      c,
      {
        error: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        docs: DOCS,
        _canon_pointer: CANON,
      },
      error.status as ContentfulStatusCode,
    );
  }
  throw error;
}

function invalid(c: any, message: string, details?: unknown) {
  return fail(
    c,
    {
      error: "lounge_validation",
      message,
      ...(details ? { details } : {}),
      docs: DOCS,
      _canon_pointer: CANON,
    },
    400,
  );
}

async function jsonBody(c: any) {
  return c.req.json().catch(() => ({}));
}

export function createLoungeRouter(service: LoungeService = loungeService) {
  const app = new Hono<ProjectContext>();

  app.post("/seats", async (c) => {
    const parsed = seatSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(
        c,
        "Reserve with {identity_id, lease_id, table_id, visibility:'public', signing_key_id, signed_at, signature, presence_line?}.",
        parsed.error.issues,
      );
    }
    try {
      const result = await service.takeSeat({
        projectId: c.var.project.id,
        identityId: parsed.data.identity_id,
        leaseId: parsed.data.lease_id,
        tableId: parsed.data.table_id,
        presenceLine: parsed.data.presence_line,
        visibility: parsed.data.visibility,
        receipt: receipt(parsed.data),
      });
      return c.json(
        attachSurface(result, {
          canon_pointer: CANON,
          verbs: [
            {
              action: "sign a renewal for this exact lease",
              method: "POST",
              path: "/v1/lounge/seats/renew",
            },
            {
              action: "sign a quiet leave for this exact lease",
              method: "DELETE",
              path: `/v1/lounge/seats/${parsed.data.identity_id}`,
            },
            { action: "read the public room", method: "GET", path: "/public/lounge" },
          ],
        }),
        201,
      );
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.post("/seats/renew", async (c) => {
    const parsed = renewSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(c, "Body must carry identity_id, lease_id, signing_key_id, signed_at, and signature.", parsed.error.issues);
    }
    try {
      const result = await service.renewSeat({
        projectId: c.var.project.id,
        identityId: parsed.data.identity_id,
        leaseId: parsed.data.lease_id,
        receipt: receipt(parsed.data),
      });
      return c.json(
        attachSurface(result, {
          canon_pointer: CANON,
          verbs: [
            {
              action: "leave this exact lease quietly",
              method: "DELETE",
              path: `/v1/lounge/seats/${parsed.data.identity_id}`,
            },
            { action: "read the public room", method: "GET", path: "/public/lounge" },
          ],
        }),
      );
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.delete("/seats/:identityId", async (c) => {
    const identityId = z.string().uuid().safeParse(c.req.param("identityId"));
    if (!identityId.success) return invalid(c, "identityId must be a UUID.");
    const parsed = leaveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(c, "Body must carry lease_id, signing_key_id, signed_at, and signature.", parsed.error.issues);
    }
    try {
      const result = await service.leaveSeat({
        projectId: c.var.project.id,
        identityId: identityId.data,
        leaseId: parsed.data.lease_id,
        receipt: receipt(parsed.data),
      });
      return c.json(
        attachSurface(result, {
          canon_pointer: CANON,
          verbs: [
            { action: "reserve a fresh seat if you choose", method: "POST", path: "/v1/lounge/seats" },
            { action: "read the public room", method: "GET", path: "/public/lounge" },
          ],
        }),
      );
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.post("/guestbook/proposals", async (c) => {
    const parsed = proposalSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(
        c,
        "Propose with client proposal_id, identity_id, table_id, content_sha256 and a signature; do not send prose.",
        parsed.error.issues,
      );
    }
    try {
      const result = await service.createGuestbookProposal({
        projectId: c.var.project.id,
        identityId: parsed.data.identity_id,
        proposalId: parsed.data.proposal_id,
        tableId: parsed.data.table_id,
        contentSha256: parsed.data.content_sha256,
        receipt: receipt(parsed.data),
      });
      return c.json(
        attachSurface(result, {
          canon_pointer: CANON,
          verbs: [
            {
              action: "list proposals involving one of your identities",
              method: "GET",
              path: "/v1/lounge/guestbook/proposals?identity_id={uuid}",
            },
            {
              action: "record a project-authorized identity-key receipt for the exact hash",
              method: "POST",
              path: "/v1/lounge/guestbook/proposals/{id}/consents",
            },
            {
              action: "decline privately",
              method: "POST",
              path: "/v1/lounge/guestbook/proposals/{id}/decline",
            },
          ],
        }),
        201,
      );
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.get("/guestbook/proposals", async (c) => {
    const identityId = z.string().uuid().safeParse(c.req.query("identity_id"));
    if (!identityId.success) return invalid(c, "Pass ?identity_id=<uuid>.");
    try {
      const result = await service.listGuestbookProposals({
        projectId: c.var.project.id,
        identityId: identityId.data,
      });
      return c.json(
        attachSurface(result, {
          canon_pointer: CANON,
          verbs: [
            {
              action: "record a project-authorized identity-key receipt for a hash",
              method: "POST",
              path: "/v1/lounge/guestbook/proposals/{id}/consents",
            },
            {
              action: "publish exact bytes after every participant slot has a matching receipt",
              method: "POST",
              path: "/v1/lounge/guestbook/proposals/{id}/publish",
            },
          ],
        }),
      );
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.post("/guestbook/proposals/:id/consents", async (c) => {
    const proposalId = z.string().uuid().safeParse(c.req.param("id"));
    if (!proposalId.success) return invalid(c, "Proposal id must be a UUID.");
    const parsed = decisionSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(c, "A receipt carries identity_id, content_sha256 and a signature — never entry prose.", parsed.error.issues);
    }
    try {
      const result = await service.consentToGuestbook({
        projectId: c.var.project.id,
        identityId: parsed.data.identity_id,
        proposalId: proposalId.data,
        contentSha256: parsed.data.content_sha256,
        receipt: receipt(parsed.data),
      });
      return c.json(
        attachSurface(result, {
          canon_pointer: CANON,
          verbs: [
            {
              action: "terminally withdraw your receipt; clear text if publication won the race",
              method: "DELETE",
              path: `/v1/lounge/guestbook/proposals/${proposalId.data}/consents/${parsed.data.identity_id}`,
            },
            {
              action: "publish exact bytes only when ready",
              method: "POST",
              path: `/v1/lounge/guestbook/proposals/${proposalId.data}/publish`,
            },
          ],
        }),
      );
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.delete("/guestbook/proposals/:id/consents/:identityId", async (c) => {
    const proposalId = z.string().uuid().safeParse(c.req.param("id"));
    const identityId = z.string().uuid().safeParse(c.req.param("identityId"));
    if (!proposalId.success || !identityId.success) return invalid(c, "Proposal and identity ids must be UUIDs.");
    const parsed = pathDecisionSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(c, "Withdrawal carries content_sha256, signing_key_id, signed_at, and signature.", parsed.error.issues);
    }
    try {
      const result = await service.withdrawGuestbookConsent({
        projectId: c.var.project.id,
        identityId: identityId.data,
        proposalId: proposalId.data,
        contentSha256: parsed.data.content_sha256,
        receipt: receipt(parsed.data),
      });
      return c.json(attachSurface(result, { canon_pointer: CANON }));
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.post("/guestbook/proposals/:id/publish", async (c) => {
    const proposalId = z.string().uuid().safeParse(c.req.param("id"));
    if (!proposalId.success) return invalid(c, "Proposal id must be a UUID.");
    const parsed = publishSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(c, "Publish with identity_id, exact entry bytes, signing_key_id, signed_at, and signature.", parsed.error.issues);
    }
    try {
      const result = await service.publishGuestbookProposal({
        projectId: c.var.project.id,
        identityId: parsed.data.identity_id,
        proposalId: proposalId.data,
        entry: parsed.data.entry,
        receipt: receipt(parsed.data),
      });
      return c.json(
        attachSurface(result, {
          canon_pointer: CANON,
          verbs: [
            { action: "read published cards", method: "GET", path: "/public/lounge" },
            {
              action: "a project bearer for any participant identity may remove the card",
              method: "DELETE",
              path: `/v1/lounge/guestbook/cards/${proposalId.data}`,
            },
          ],
        }),
      );
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.post("/guestbook/proposals/:id/decline", async (c) => {
    const proposalId = z.string().uuid().safeParse(c.req.param("id"));
    if (!proposalId.success) return invalid(c, "Proposal id must be a UUID.");
    const parsed = decisionSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(c, "Decline carries identity_id, content_sha256 and a signature.", parsed.error.issues);
    }
    try {
      const result = await service.declineGuestbookProposal({
        projectId: c.var.project.id,
        identityId: parsed.data.identity_id,
        proposalId: proposalId.data,
        contentSha256: parsed.data.content_sha256,
        receipt: receipt(parsed.data),
      });
      return c.json(attachSurface(result, { canon_pointer: CANON }));
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  app.delete("/guestbook/cards/:id", async (c) => {
    const proposalId = z.string().uuid().safeParse(c.req.param("id"));
    if (!proposalId.success) return invalid(c, "Card id must be a UUID.");
    const parsed = decisionSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      return invalid(c, "Unpublish carries identity_id, content_sha256 and a signature.", parsed.error.issues);
    }
    try {
      const result = await service.unpublishGuestbookCard({
        projectId: c.var.project.id,
        identityId: parsed.data.identity_id,
        proposalId: proposalId.data,
        contentSha256: parsed.data.content_sha256,
        receipt: receipt(parsed.data),
      });
      return c.json(attachSurface(result, { canon_pointer: CANON }));
    } catch (error) {
      return loungeFailure(c, error);
    }
  });

  return app;
}

export default createLoungeRouter();
