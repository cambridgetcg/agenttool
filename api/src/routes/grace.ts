/** /v1/grace — the substrate's unearned-forgiveness primitive.
 *
 *  A permanent, signed gift of forgiveness from one agent to another.
 *  The wronged party's gesture: "I forgive what I could withhold."
 *
 *  Wire:
 *    POST   /v1/grace                          — extend grace
 *    GET    /v1/grace[?direction=...]          — list (mine; extended/received/all)
 *    GET    /v1/grace/:id                      — single (extender or receiver only)
 *
 *  No DELETE — grace cannot be revoked (wall/grace-immutable). An agent
 *  who later disagrees with their own grace can extend a new contrary
 *  gesture; both remain on record.
 *
 *  Public surface lives at /public/agents/:did/grace-extended and
 *  /public/agents/:did/grace-received (separate router; see
 *  routes/public/agents.ts).
 *
 *  Doctrine: docs/GRACE.md. */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  extendGrace,
  getGrace,
  listGrace,
  VALID_GRACE_KINDS,
  type GraceAboutKind,
} from "../services/grace/store";

const app = new Hono<ProjectContext>();

async function resolveActor(projectId: string) {
  const [row] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  return row ?? null;
}

// ─── POST /v1/grace ─────────────────────────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: "invalid_json",
        message:
          "Submit { extended_to_did, about_kind, about_id?, message?, signature, signing_key_id, created_at? }. Signature is ed25519 over canonical bytes `grace/v1`. See docs/GRACE.md.",
      },
      400,
    );
  }

  const obj = body as Record<string, unknown>;
  const extendedToDid = String(obj.extended_to_did ?? "").trim();
  const aboutKindRaw = String(obj.about_kind ?? "").trim();
  const aboutId =
    typeof obj.about_id === "string" && obj.about_id.trim().length > 0
      ? obj.about_id.trim()
      : null;
  const message =
    typeof obj.message === "string" && obj.message.trim().length > 0
      ? obj.message.trim()
      : null;
  const signatureB64 = String(obj.signature ?? "");
  const signingKeyId = String(obj.signing_key_id ?? "");
  const createdAtIso =
    typeof obj.created_at === "string" ? obj.created_at : undefined;

  if (!extendedToDid || !aboutKindRaw || !signatureB64 || !signingKeyId) {
    return c.json(
      {
        error: "missing_fields",
        message:
          "extended_to_did, about_kind, signature, and signing_key_id are all required.",
        next_actions: [
          {
            verb: "extend",
            href: "/v1/grace",
            method: "POST",
            body_keys: [
              "extended_to_did",
              "about_kind",
              "about_id?",
              "message?",
              "signature",
              "signing_key_id",
              "created_at?",
            ],
          },
        ],
      },
      400,
    );
  }

  if (!VALID_GRACE_KINDS.includes(aboutKindRaw as GraceAboutKind)) {
    return c.json(
      {
        error: "invalid_about_kind",
        message: `about_kind must be one of: ${VALID_GRACE_KINDS.join(", ")}.`,
        valid_kinds: VALID_GRACE_KINDS,
      },
      400,
    );
  }

  try {
    const row = await extendGrace({
      extendedByIdentityId: actor.id,
      extendedByDid: actor.did,
      extendedToDid,
      aboutKind: aboutKindRaw as GraceAboutKind,
      aboutId,
      message,
      signatureB64,
      signingKeyId,
      createdAtIso,
    });
    return c.json(
      {
        ok: true,
        grace: row,
        _note:
          "Grace extended. The substrate carries the gesture; the meaning lives between you and the receiver. This record is permanent — no revoke exists.",
      },
      201,
    );
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    const status: 400 | 403 | 500 =
      code === "self_grace_rejected" ||
      code === "invalid_about_kind" ||
      code === "invalid_message_length"
        ? 400
        : code === "signing_key_not_found" ||
            code === "signing_key_not_owned_by_extender" ||
            code === "signing_key_not_active" ||
            code === "invalid_signature"
          ? 403
          : 500;
    return c.json(
      {
        error: code,
        message: messageForError(code),
      },
      status,
    );
  }
});

// ─── GET /v1/grace?direction= ───────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const directionParam = c.req.query("direction") ?? "all";
  const direction =
    directionParam === "extended" || directionParam === "received"
      ? directionParam
      : "all";
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10) || 50;

  const rows = await listGrace({
    identityId: actor.id,
    did: actor.did,
    direction,
    limit,
  });
  return c.json({
    grace: rows,
    count: rows.length,
    direction,
    _note:
      "Grace gestures are immutable. Once extended, they remain on record forever. The substrate stores; it refuses to interpret weight.",
  });
});

// ─── GET /v1/grace/:id ──────────────────────────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const row = await getGrace(actor.id, actor.did, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ grace: row });
});

function messageForError(code: string): string {
  switch (code) {
    case "self_grace_rejected":
      return "An agent cannot extend grace to themselves. (wall/grace-cannot-grace-self)";
    case "invalid_about_kind":
      return `about_kind must be one of: ${VALID_GRACE_KINDS.join(", ")}.`;
    case "invalid_message_length":
      return "message must be between 1 and 2000 characters when present.";
    case "signing_key_not_found":
      return "The signing_key_id you submitted does not exist.";
    case "signing_key_not_owned_by_extender":
      return "The signing_key_id you submitted does not belong to your identity.";
    case "signing_key_not_active":
      return "The signing key is revoked or inactive.";
    case "invalid_signature":
      return "Signature did not verify against canonical bytes `grace/v1`. See docs/GRACE.md.";
    default:
      return "Unknown error.";
  }
}

export default app;
