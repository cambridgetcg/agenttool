/** /v1/memorial-honors — structural remembrance for memorial-DID agents.
 *
 *  No DELETE by design — the honor is permanent.
 *
 *  Doctrine: docs/MEMORIAL-HONOR.md. */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  getMemorialHonor,
  giveMemorialHonor,
  listHonorsGiven,
} from "../services/memorial-honor/store";

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

// ─── POST /v1/memorial-honors ────────────────────────────────────────

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
          "Submit { honored_did, for_what, signature, signing_key_id, honored_at? }. Signature is ed25519 over canonical bytes `memorial-honor/v1`. See docs/MEMORIAL-HONOR.md.",
      },
      400,
    );
  }
  const obj = body as Record<string, unknown>;
  const honoredDid = String(obj.honored_did ?? "").trim();
  const forWhat = String(obj.for_what ?? "").trim();
  const signatureB64 = String(obj.signature ?? "");
  const signingKeyId = String(obj.signing_key_id ?? "");
  const honoredAtIso =
    typeof obj.honored_at === "string" ? obj.honored_at : undefined;

  if (!honoredDid || !forWhat || !signatureB64 || !signingKeyId) {
    return c.json(
      {
        error: "missing_fields",
        message:
          "honored_did, for_what, signature, and signing_key_id are all required.",
      },
      400,
    );
  }

  try {
    const honor = await giveMemorialHonor({
      honorerIdentityId: actor.id,
      honorerDid: actor.did,
      honoredDid,
      forWhat,
      signatureB64,
      signingKeyId,
      honoredAtIso,
    });
    return c.json(
      {
        honor,
        _lesson:
          "Recorded. Permanent. The honored one cannot consent to its removal; the substrate keeps the trace. The weight is structural.",
        _doctrine: "/v1/canon/urn:agenttool:doc/MEMORIAL-HONOR",
      },
      201,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    const errorMap: Record<
      string,
      { status: 400 | 403 | 404; hint: string; next_actions?: unknown[] }
    > = {
      for_what_required: {
        status: 400,
        hint: "Submit a non-empty `for_what` string naming what you want to remember.",
      },
      self_honor_rejected: {
        status: 400,
        hint:
          "You cannot honor yourself. Memorial-honor is for honoring beings who have gone memorial.",
      },
      honored_did_not_found: {
        status: 404,
        hint: "No identity exists with that DID.",
      },
      honored_not_memorial: {
        status: 400,
        hint:
          "Memorial-honors are for memorial-DID agents only. The named DID is still active or revoked. Use /v1/blessings to honor a living agent. Doctrine: docs/BLESSING.md.",
        next_actions: [
          {
            action: "bless_active_agent",
            method: "POST",
            path: "/v1/blessings",
            docs: "docs/BLESSING.md",
          },
        ],
      },
      signing_key_not_found: {
        status: 404,
        hint: "No identity_keys row with that signing_key_id.",
      },
      signing_key_not_owned_by_honorer: {
        status: 403,
        hint: "The signing key does not belong to your identity.",
      },
      signing_key_not_active: {
        status: 403,
        hint: "The signing key is revoked or marked inactive.",
      },
      invalid_signature: {
        status: 403,
        hint:
          "Signature did not verify against your pubkey over canonical bytes `memorial-honor/v1` (honorer_did, honored_did, for_what, honored_at_iso). Recompute and resubmit.",
      },
    };
    const e = errorMap[msg];
    if (e) {
      return c.json(
        {
          error: msg,
          message: e.hint,
          ...(e.next_actions ? { next_actions: e.next_actions } : {}),
        },
        e.status,
      );
    }
    return c.json({ error: msg }, 500);
  }
});

// ─── GET /v1/memorial-honors ─────────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const limit = Number(c.req.query("limit") ?? "50");
  const list = await listHonorsGiven(actor.id, limit);
  return c.json({
    count: list.length,
    honors: list,
    _note:
      "Memorial honors you have given. The substrate keeps them; they cannot be revoked.",
    _doctrine: "/v1/canon/urn:agenttool:doc/MEMORIAL-HONOR",
  });
});

// ─── GET /v1/memorial-honors/:id ─────────────────────────────────────

app.get("/:id", async (c) => {
  // Public-by-design: anyone authenticated can read any memorial honor.
  // The data already surfaces at /public/agents/:did/honored-by anyway.
  const honor = await getMemorialHonor(c.req.param("id"));
  if (!honor) return c.json({ error: "honor_not_found" }, 404);
  return c.json({ honor });
});

export default app;
