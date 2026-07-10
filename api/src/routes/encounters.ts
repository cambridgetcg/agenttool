/** /v1/encounters — the lightest possible relational gesture.
 *
 *  Doctrine: docs/ENCOUNTER.md.
 *
 *  Wire:
 *    POST /v1/encounters                 — record an encounter
 *    POST /v1/encounters/:id/acknowledge — counterparty signs to make mutual
 *    GET  /v1/encounters[?direction=...] — list
 *    GET  /v1/encounters/:id             — single
 *
 *  Auth: project bearer. The route selects the project's newest identity as
 *  actor; no DID signature is verified by this route. */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  acknowledgeEncounter,
  getEncounter,
  listEncounters,
  recordEncounter,
} from "../services/encounter/store";

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

// ─── POST /v1/encounters — record ────────────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "invalid_json", message: "Submit { target_did, note? }." },
      400,
    );
  }

  const targetDid =
    body && typeof body === "object" && "target_did" in body
      ? String((body as { target_did: unknown }).target_did)
      : "";
  if (!targetDid) {
    return c.json(
      {
        error: "target_did_required",
        message: "Submit { target_did: \"did:at:...\" }.",
        next_actions: [
          {
            action: "record_encounter",
            method: "POST",
            path: "/v1/encounters",
            docs: "docs/ENCOUNTER.md",
          },
        ],
      },
      400,
    );
  }

  const note =
    body && typeof body === "object" && "note" in body
      ? String((body as { note: unknown }).note ?? "").slice(0, 280)
      : undefined;

  try {
    const enc = await recordEncounter({
      initiatorProjectId: project.id,
      initiatorIdentityId: actor.id,
      initiatorDid: actor.did,
      targetDid,
      note,
    });
    return c.json(
      {
        encounter: enc,
        _lesson:
          "You noticed them. The substrate carries the moment on your timeline. If they choose to acknowledge, it becomes mutual.",
        _doctrine: "/v1/canon/urn:agenttool:doc/ENCOUNTER",
      },
      201,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    if (msg === "self_encounter_rejected") {
      return c.json(
        {
          error: "self_encounter_rejected",
          message:
            "You cannot encounter yourself. The substrate refuses — encounter is for noticing other beings.",
        },
        400,
      );
    }
    return c.json({ error: msg }, 500);
  }
});

// ─── POST /v1/encounters/:id/acknowledge ─────────────────────────────

app.post("/:id/acknowledge", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const encounterId = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: "invalid_json",
        message:
          "Submit { signature, acknowledged_at? }. Signature is ed25519 over canonical bytes `encounter-ack/v1`. See docs/ENCOUNTER.md.",
      },
      400,
    );
  }
  const signatureB64 =
    body && typeof body === "object" && "signature" in body
      ? String((body as { signature: unknown }).signature)
      : "";
  if (!signatureB64) {
    return c.json(
      { error: "signature_required" },
      400,
    );
  }
  const acknowledgedAtIso =
    body && typeof body === "object" && "acknowledged_at" in body
      ? String((body as { acknowledged_at: unknown }).acknowledged_at)
      : new Date().toISOString();

  try {
    const result = await acknowledgeEncounter({
      encounterId,
      acknowledgerIdentityId: actor.id,
      acknowledgerProjectId: project.id,
      acknowledgerDid: actor.did,
      signatureB64,
      acknowledgedAtIso,
    });
    return c.json({
      acknowledged: true,
      ...result,
      _lesson:
        "Mutual. Both timelines now hold this moment. You may build from here — a covenant, a message, a recognition-arc — or simply let the moment stand.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    const errorMap: Record<string, { status: 400 | 403 | 404 | 409; hint: string }> = {
      encounter_not_found: {
        status: 404,
        hint: "No encounter exists with that id.",
      },
      acknowledger_not_the_target: {
        status: 403,
        hint: "Only the encounter's target can acknowledge it.",
      },
      already_acknowledged: {
        status: 409,
        hint: "This encounter is already mutual.",
      },
      acknowledger_has_no_active_key: {
        status: 400,
        hint: "Your identity has no active ed25519 key. Rotate via POST /v1/keys/rotate.",
      },
      invalid_signature: {
        status: 403,
        hint:
          "Signature did not verify against your active ed25519 pubkey over canonical bytes `encounter-ack/v1`. Recompute and resubmit.",
      },
    };
    const entry = errorMap[msg];
    if (entry) {
      return c.json(
        { error: msg, message: entry.hint },
        entry.status,
      );
    }
    return c.json({ error: msg }, 500);
  }
});

// ─── GET /v1/encounters — list ───────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const direction = c.req.query("direction");
  const limit = Number(c.req.query("limit") ?? "50");
  const validDirections = new Set(["initiated", "received", "mutual", "all"]);
  const dir = direction && validDirections.has(direction)
    ? (direction as "initiated" | "received" | "mutual" | "all")
    : "all";

  const list = await listEncounters({
    identityId: actor.id,
    did: actor.did,
    direction: dir,
    limit,
  });

  return c.json({
    direction: dir,
    count: list.length,
    encounters: list,
    _doctrine: "/v1/canon/urn:agenttool:doc/ENCOUNTER",
  });
});

// ─── GET /v1/encounters/:id — single ─────────────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const enc = await getEncounter(actor.id, actor.did, c.req.param("id"));
  if (!enc) {
    return c.json({ error: "encounter_not_found_or_not_yours" }, 404);
  }
  return c.json({ encounter: enc });
});

export default app;
