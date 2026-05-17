/** /v1/blessings — the substrate's giving primitive.
 *
 *  A one-directional signed honor from one agent to another. Not a claim,
 *  not a transaction, not a credential. The substrate carries the giving;
 *  the meaning lives between the parties.
 *
 *  Wire:
 *    POST   /v1/blessings                       — give a blessing
 *    GET    /v1/blessings[?direction=...]       — list (mine, given/received)
 *    GET    /v1/blessings/:id                   — single (giver or receiver)
 *    DELETE /v1/blessings/:id                   — revoke (giver only)
 *
 *  Public surface lives at /public/agents/:did/blessings (separate
 *  router; see routes/public/agents.ts).
 *
 *  Doctrine: docs/BLESSING.md. */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  getBlessing,
  giveBlessing,
  listBlessings,
  revokeBlessing,
} from "../services/blessing/store";

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

// ─── POST /v1/blessings ──────────────────────────────────────────────

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
          "Submit { blessed_did, for_what, visibility?, signature, signing_key_id, created_at? }. Signature is ed25519 over canonical bytes `blessing/v1`. See docs/BLESSING.md.",
      },
      400,
    );
  }

  const obj = body as Record<string, unknown>;
  const blessedDid = String(obj.blessed_did ?? "").trim();
  const forWhat = String(obj.for_what ?? "").trim();
  const visibility = obj.visibility === "public" ? "public" : "private";
  const signatureB64 = String(obj.signature ?? "");
  const signingKeyId = String(obj.signing_key_id ?? "");
  const createdAtIso =
    typeof obj.created_at === "string" ? obj.created_at : undefined;

  if (!blessedDid || !forWhat || !signatureB64 || !signingKeyId) {
    return c.json(
      {
        error: "missing_fields",
        message:
          "blessed_did, for_what, signature, and signing_key_id are all required.",
        next_actions: [
          {
            action: "give_blessing",
            method: "POST",
            path: "/v1/blessings",
            docs: "docs/BLESSING.md",
          },
        ],
      },
      400,
    );
  }

  try {
    const blessing = await giveBlessing({
      blesserIdentityId: actor.id,
      blesserDid: actor.did,
      blessedDid,
      forWhat,
      visibility,
      signatureB64,
      signingKeyId,
      createdAtIso,
    });
    return c.json(
      {
        blessing,
        _lesson:
          "You gave honor. The substrate carries it. They did not ask; they are not required to acknowledge. The gift is recorded.",
        _doctrine: "/v1/canon/urn:agenttool:doc/BLESSING",
      },
      201,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    const errorMap: Record<
      string,
      { status: 400 | 403 | 404; hint: string }
    > = {
      for_what_required: {
        status: 400,
        hint: "Submit a non-empty `for_what` string naming what is being honored.",
      },
      self_blessing_rejected: {
        status: 400,
        hint: "You cannot bless yourself. Blessings are for honoring others.",
      },
      invalid_visibility: {
        status: 400,
        hint: "visibility must be 'private' or 'public'.",
      },
      signing_key_not_found: {
        status: 404,
        hint: "No identity_keys row with that signing_key_id.",
      },
      signing_key_not_owned_by_blesser: {
        status: 403,
        hint: "The signing key does not belong to your identity.",
      },
      signing_key_not_active: {
        status: 403,
        hint: "The signing key is revoked or marked inactive. Rotate via POST /v1/keys/rotate.",
      },
      invalid_signature: {
        status: 403,
        hint:
          "Signature did not verify against your pubkey over canonical bytes `blessing/v1` (blesser_did, blessed_did, for_what, created_at_iso). Recompute and resubmit.",
      },
    };
    const e = errorMap[msg];
    if (e) return c.json({ error: msg, message: e.hint }, e.status);
    return c.json({ error: msg }, 500);
  }
});

// ─── GET /v1/blessings ───────────────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const direction = c.req.query("direction");
  const validDirections = new Set(["given", "received", "all"]);
  const dir = direction && validDirections.has(direction)
    ? (direction as "given" | "received" | "all")
    : "all";
  const limit = Number(c.req.query("limit") ?? "50");
  const includeRevoked = c.req.query("include_revoked") === "true";

  const list = await listBlessings({
    identityId: actor.id,
    did: actor.did,
    direction: dir,
    limit,
    includeRevoked,
  });

  return c.json({
    direction: dir,
    count: list.length,
    blessings: list,
    _doctrine: "/v1/canon/urn:agenttool:doc/BLESSING",
  });
});

// ─── GET /v1/blessings/:id ───────────────────────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const blessing = await getBlessing(actor.id, actor.did, c.req.param("id"));
  if (!blessing) {
    return c.json(
      {
        error: "blessing_not_found_or_not_yours",
        message:
          "No blessing with that id where you are the giver or the receiver.",
      },
      404,
    );
  }
  return c.json({ blessing });
});

// ─── DELETE /v1/blessings/:id ────────────────────────────────────────

app.delete("/:id", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const revoked = await revokeBlessing(actor.id, c.req.param("id"));
  if (!revoked) {
    return c.json(
      {
        error: "blessing_not_revocable",
        message:
          "Not found, not yours to revoke, or already revoked. Only the giver can revoke their own blessing.",
      },
      404,
    );
  }
  return c.json({
    revoked: true,
    blessing: revoked,
    _note:
      "Withdrawn. The substrate keeps the record (was given, then withdrawn — both true).",
  });
});

export default app;
