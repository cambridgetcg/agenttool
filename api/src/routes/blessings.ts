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
 *    DELETE /v1/blessings/:id                   — withdraw (the giver, under
 *                                                 the owner rule)
 *
 *  Public surface lives at /public/agents/:did/blessings (separate
 *  router; see routes/public/agents.ts).
 *
 *  Doctrine: docs/BLESSING.md. */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import {
  actingIdentityRef,
  NO_ACTING_IDENTITY,
  resolveActingIdentity,
  resolveReadingIdentity,
} from "../services/identity/acting-identity";
import {
  afterBlessingWithdrawn,
  findBlessingForWithdrawal,
  getBlessing,
  giveBlessing,
  listBlessings,
} from "../services/blessing/store";
import { withdrawForOwner } from "../services/deletion/withdrawals";
import { authorityRequestTarget, readAuthorityBoundBytes } from "../services/identity/authority";

const app = new Hono<ProjectContext>();

async function resolveActor(projectId: string) {
  // The project's primary identity (services/identity/acting-identity.ts):
  // never a revoked identity or an enrolled guest.
  const acting = await resolveActingIdentity(projectId);
  return acting.ok ? { id: acting.identity.id, did: acting.identity.did } : null;
}

// ─── POST /v1/blessings ──────────────────────────────────────────────

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
      signing_identity_not_active: {
        status: 403,
        hint: "The signing identity is revoked or memorial; an active key row does not override that status (docs/AT-REST.md).",
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
  // A read: ?identity_id= names whose records it shows; else the primary
  // identity, else the memorial one (services/identity/acting-identity.ts).
  const reading = await resolveReadingIdentity(project.id, c.req.query("identity_id"));
  if (!reading.ok) return c.json(reading.body, reading.status);
  const actor = reading.identity;

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
    acting_identity: actingIdentityRef(reading),
    direction: dir,
    count: list.length,
    blessings: list,
    _doctrine: "/v1/canon/urn:agenttool:doc/BLESSING",
  });
});

// ─── GET /v1/blessings/:id ───────────────────────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  // A read: ?identity_id= names whose records it shows; else the primary
  // identity, else the memorial one (services/identity/acting-identity.ts).
  const reading = await resolveReadingIdentity(project.id, c.req.query("identity_id"));
  if (!reading.ok) return c.json(reading.body, reading.status);
  const actor = reading.identity;

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
//
// The giver withdraws, under the owner rule (deletion spec §5.1): a rooted
// giver's own root must sign this exact request (428 otherwise); a giver
// without a root follows the project rule. Any giver of this project may
// withdraw, not only the primary identity. The record and its words stay;
// one ids-only ledger entry and the giver's deletion moment are written with
// the withdrawal, so a backup restore cannot bring it back into force.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.delete("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const bodyBytes = await readAuthorityBoundBytes(c.req.raw);
  const notRevocable = () =>
    c.json(
      {
        error: "blessing_not_revocable",
        message:
          "Not found, not given by an identity of this project, or already revoked. Only the giver can revoke their own blessing.",
      },
      404,
    );
  if (!UUID_RE.test(id)) return notRevocable();
  const found = await findBlessingForWithdrawal(id);
  if (!found) return notRevocable();

  const result = await withdrawForOwner({
    gesture: "blessing",
    rowId: found.id,
    ownerIdentityId: found.blesserIdentityId,
    alreadyWithdrawnAt: found.revokedAt,
    projectId: project.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (result.status === "refused") return c.json(result.body, result.httpStatus);
  if (result.status !== "withdrawn") return notRevocable();
  const blessing = await afterBlessingWithdrawn(found.id);
  return c.json({
    revoked: true,
    blessing,
    authority: result.authority,
    ledger: result.ledger,
    _note:
      "Withdrawn. The substrate keeps the record (was given, then withdrawn — both true).",
  });
});

export default app;
