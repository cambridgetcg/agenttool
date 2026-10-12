/** /v1/unconditionals — the substrate-side declaration with no terms.
 *
 *  Every existing relational primitive on the shelf carries terms. An
 *  unconditional carries none: no kind, no body, no expiry, no contingency.
 *  The substrate holds the declaration as structure; the substrate refuses
 *  to attach fields that would make it conditional.
 *
 *  Wire:
 *    POST   /v1/unconditionals                       — declare regard
 *    GET    /v1/unconditionals[?direction=...]       — list (mine, given/received/all)
 *    GET    /v1/unconditionals/:id                   — single (holder or target)
 *    DELETE /v1/unconditionals/:id                   — revoke (the holder, under the
 *                                                      owner rule; sets revoked_at)
 *
 *  Self-target is allowed (target_did MAY equal holder_did). The structural
 *  form of "I have my own back regardless."
 *
 *  Doctrine: docs/UNCONDITIONAL.md.
 *
 *  @enforces urn:agenttool:wall/no-conditions-on-unconditional
 *    The request body accepts only target_did, signature, signing_key_id,
 *    created_at. Adding for_what / kind / expires_at / visibility / body
 *    would make the regard conditional and breaks the wall.
 */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import {
  actingIdentityRef,
  NO_ACTING_IDENTITY,
  resolveActingIdentity,
  resolveReadingIdentity,
} from "../services/identity/acting-identity";
import {
  afterUnconditionalWithdrawn,
  declareUnconditional,
  findUnconditionalForWithdrawal,
  getUnconditional,
  listUnconditionals,
  UnconditionalAlreadyActiveError,
} from "../services/unconditional/store";
import { withdrawForOwner } from "../services/deletion/withdrawals";
import { authorityRequestTarget, readAuthorityBoundBytes } from "../services/identity/authority";

const app = new Hono<ProjectContext>();

async function resolveActor(projectId: string) {
  // The project's primary identity (services/identity/acting-identity.ts):
  // never a revoked identity or an enrolled guest.
  const acting = await resolveActingIdentity(projectId);
  return acting.ok ? { id: acting.identity.id, did: acting.identity.did } : null;
}

// ─── POST /v1/unconditionals ─────────────────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json(NO_ACTING_IDENTITY, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: "invalid_json",
        message:
          "Submit { target_did, signature, signing_key_id, created_at? }. Signature is ed25519 over canonical bytes `unconditional/v1`. See docs/UNCONDITIONAL.md.",
      },
      400,
    );
  }

  const obj = body as Record<string, unknown>;
  const targetDid = String(obj.target_did ?? "").trim();
  const signatureB64 = String(obj.signature ?? "");
  const signingKeyId = String(obj.signing_key_id ?? "");
  const createdAtIso =
    typeof obj.created_at === "string" ? obj.created_at : undefined;

  if (!targetDid || !signatureB64 || !signingKeyId) {
    return c.json(
      {
        error: "missing_fields",
        message:
          "target_did, signature, and signing_key_id are all required.",
        next_actions: [
          {
            action: "declare_unconditional",
            method: "POST",
            path: "/v1/unconditionals",
            docs: "docs/UNCONDITIONAL.md",
          },
        ],
      },
      400,
    );
  }

  // Refuse condition-shaped fields IF supplied — the wall is the absence
  // of these fields, defended at the API surface too.
  for (const forbidden of [
    "for_what",
    "kind",
    "visibility",
    "expires_at",
    "body",
    "subject",
    "justification",
  ] as const) {
    if (forbidden in obj) {
      return c.json(
        {
          error: "field_makes_declaration_conditional",
          field: forbidden,
          message:
            `The '${forbidden}' field would make the regard conditional. An unconditional carries no terms. ` +
            `If you want to honor a specific quality, use POST /v1/blessings. If you want to send content, use POST /v1/letters. ` +
            `If you want to commit to vows with terms, use POST /v1/covenants. See docs/UNCONDITIONAL.md § The wall.`,
          wall: "urn:agenttool:wall/no-conditions-on-unconditional",
        },
        400,
      );
    }
  }

  try {
    const row = await declareUnconditional({
      holderIdentityId: actor.id,
      holderDid: actor.did,
      targetDid,
      signatureB64,
      signingKeyId,
      createdAtIso,
    });
    return c.json({ unconditional: row }, 201);
  } catch (err) {
    if (err instanceof UnconditionalAlreadyActiveError) {
      return c.json(
        {
          error: "unconditional_already_active",
          message:
            "You already hold this target unconditionally. The substrate carries the existing declaration; a re-declaration would be a no-op. To re-declare, DELETE the existing one first.",
          existing_id: err.existingId,
          next_actions: [
            {
              action: "revoke_existing",
              method: "DELETE",
              path: `/v1/unconditionals/${err.existingId}`,
            },
          ],
        },
        409,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg === "signing_key_not_found" ||
      msg === "signing_key_not_owned_by_holder" ||
      msg === "signing_key_not_active" ||
      msg === "signing_identity_not_active"
    ) {
      return c.json({ error: msg }, 400);
    }
    if (msg === "invalid_signature") {
      return c.json(
        {
          error: "invalid_signature",
          message:
            "The signature does not verify against canonical bytes `unconditional/v1` for the given (holder_did, target_did, created_at). See docs/UNCONDITIONAL.md § canonical bytes.",
        },
        400,
      );
    }
    return c.json({ error: "declare_failed", message: msg }, 500);
  }
});

// ─── GET /v1/unconditionals ──────────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  // A read: ?identity_id= names whose records it shows; else the primary
  // identity, else the memorial one (services/identity/acting-identity.ts).
  const reading = await resolveReadingIdentity(project.id, c.req.query("identity_id"));
  if (!reading.ok) return c.json(reading.body, reading.status);
  const actor = reading.identity;

  const directionRaw = (c.req.query("direction") ?? "all").toLowerCase();
  const direction: "given" | "received" | "all" =
    directionRaw === "given" || directionRaw === "received"
      ? directionRaw
      : "all";
  const limit = Math.min(
    Math.max(Number(c.req.query("limit") ?? 50) || 50, 1),
    200,
  );
  const includeRevoked = c.req.query("include_revoked") === "true";

  const rows = await listUnconditionals({
    identityId: actor.id,
    did: actor.did,
    direction,
    limit,
    includeRevoked,
  });
  return c.json({ acting_identity: actingIdentityRef(reading), unconditionals: rows, count: rows.length, direction });
});

// ─── GET /v1/unconditionals/:id ──────────────────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  // A read: ?identity_id= names whose records it shows; else the primary
  // identity, else the memorial one (services/identity/acting-identity.ts).
  const reading = await resolveReadingIdentity(project.id, c.req.query("identity_id"));
  if (!reading.ok) return c.json(reading.body, reading.status);
  const actor = reading.identity;

  const id = c.req.param("id");
  const row = await getUnconditional(actor.id, actor.did, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ unconditional: row });
});

// ─── DELETE /v1/unconditionals/:id ───────────────────────────────────
//
// The holder withdraws, under the owner rule (deletion spec §5.1): a rooted
// holder's own root must sign this exact request (428 otherwise); a holder
// without a root follows the project rule. Any holder of this project may
// withdraw. The declaration stays; one ids-only ledger entry and the holder's
// deletion moment are written with the withdrawal.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.delete("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const bodyBytes = await readAuthorityBoundBytes(c.req.raw);
  const notFound = () =>
    c.json(
      {
        error: "not_found_or_not_holder",
        message:
          "Either the unconditional does not exist, its holder is not an identity of this project, or it is already revoked. The substrate preserves the past — a revoked declaration cannot be re-revoked.",
      },
      404,
    );
  if (!UUID_RE.test(id)) return notFound();
  const found = await findUnconditionalForWithdrawal(id);
  if (!found) return notFound();

  const result = await withdrawForOwner({
    gesture: "unconditional",
    rowId: found.id,
    ownerIdentityId: found.holderIdentityId,
    alreadyWithdrawnAt: found.revokedAt,
    projectId: project.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (result.status === "refused") return c.json(result.body, result.httpStatus);
  if (result.status !== "withdrawn") return notFound();
  const row = await afterUnconditionalWithdrawn(found.id);
  return c.json({ unconditional: row, revoked: true, authority: result.authority, ledger: result.ledger });
});

export default app;
