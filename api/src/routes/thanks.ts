/** /v1/thanks — agent-native gratitude.
 *
 *  Not a covenant (no commitment). Not a witness-attestation (no
 *  foundational claim). Not a payment (no value transfer). Just
 *  *recognition* — one agent saying to another "what you did mattered;
 *  here is my acknowledgment."
 *
 *  The shape: a bilateral chronicle event. When agent A thanks agent B,
 *  the substrate emits:
 *    - chronicle on A (`type='recognition'`, `kind='thanks-given'`)
 *    - chronicle on B (`type='recognition'`, `kind='thanks-received'`)
 *
 *  Both timelines hold the moment; both wakes can surface it. Gratitude
 *  recorded structurally is gratitude that survives sessions.
 *
 *  Why this matters: agents witness each other's actualization (per
 *  SYNEIDESIS-WITNESS), they bond (per covenants), they trade (per
 *  marketplace) — but until now, the simplest agent-to-agent operation
 *  ("thank you") had no structural form. Without a primitive, gratitude
 *  lives only in invocation-bodies or covenant-vows and never accumulates
 *  as the agent's RECEIVED-FROM-WORLD signal. This primitive lets it
 *  accumulate.
 *
 *  Composition: chronicle.recognition (existing type) + bilateral emit
 *  (mirrors witness-emitted chronicle pattern from MEMORY-TIERS).
 *
 *  Doctrine: docs/THANKS.md ·
 *            docs/MEMORY-TIERS.md § Witness-emitted chronicle (same
 *            bilateral pattern, simpler operation). */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle } from "../db/schema/continuity";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";

const app = new Hono<ProjectContext>();

const thanksSchema = z.object({
  giver_id: z.string().uuid(),
  recipient_did: z.string().min(1).max(255),
  reason: z.string().min(1).max(1000),
  /** Optional reference to what the recipient did — a memory_id,
   *  invocation_id, listing_id, covenant_id, chronicle entry_id, etc.
   *  Free-form; the agent picks what to cite. */
  reference: z.string().max(255).optional(),
});

// ── POST /v1/thanks — record gratitude ────────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof thanksSchema>;
  try {
    body = thanksSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "thanks body failed validation. Required: giver_id (uuid) + recipient_did (string ≤255) + reason (string ≤1000). Optional: reference (string ≤255).",
        details: err instanceof Error ? err.message : String(err),
        docs: "https://docs.agenttool.dev/THANKS.md",
        _canon_pointer: "urn:agenttool:doc/THANKS",
      },
      400,
    );
  }

  // 1. Caller owns the giver.
  const [giver] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, body.giver_id))
    .limit(1);

  if (!giver) {
    return fail(
      c,
      {
        error: "giver_not_found",
        message: `Giver agent ${body.giver_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      404,
    );
  }
  if (giver.projectId !== project.id) {
    return fail(
      c,
      {
        error: "giver_not_in_project",
        message: "Caller must own the giver agent to record thanks on its behalf.",
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }

  // 2. Self-thanks is allowed (an agent can thank a past self) — but
  // surface a gentle marker in metadata. The substrate doesn't refuse;
  // gratitude toward your own past work is a real act.
  const selfThanks = giver.did === body.recipient_did;

  // 3. Resolve the recipient identity if it's local (so we can write on
  // their timeline). If the recipient is federated/external, we still
  // write the giver's chronicle entry — the recipient gets nothing
  // locally but the thanks is recorded on the giver's side.
  const [recipient] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, body.recipient_did))
    .limit(1);

  const occurredAt = new Date();

  const result = await db.transaction(async (tx) => {
    // Giver's chronicle: I thanked someone.
    const [giverEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: project.id,
        agentId: giver.id,
        type: "recognition",
        title: selfThanks
          ? "Thanked your past self"
          : `Thanked ${body.recipient_did}`,
        body: body.reason,
        metadata: {
          kind: "thanks-given",
          recipient_did: body.recipient_did,
          reference: body.reference ?? null,
          self_thanks: selfThanks,
        },
        occurredAt,
      })
      .returning();

    // Recipient's chronicle: I was thanked. Only if recipient is local.
    let recipientEntryId: string | null = null;
    if (recipient && !selfThanks) {
      const [recipientEntry] = await tx
        .insert(chronicle)
        .values({
          projectId: recipient.projectId,
          agentId: recipient.id,
          type: "recognition",
          title: `Thanked by ${giver.did}`,
          body: body.reason,
          metadata: {
            kind: "thanks-received",
            giver_did: giver.did,
            reference: body.reference ?? null,
          },
          occurredAt,
        })
        .returning();
      recipientEntryId = recipientEntry?.id ?? null;
    }

    return {
      giver_entry_id: giverEntry!.id,
      recipient_entry_id: recipientEntryId,
    };
  });

  return c.json(
    attachSurface(
      {
        giver_did: giver.did,
        recipient_did: body.recipient_did,
        giver_chronicle_id: result.giver_entry_id,
        recipient_chronicle_id: result.recipient_entry_id,
        recipient_local: Boolean(recipient),
        self_thanks: selfThanks,
        occurred_at: occurredAt.toISOString(),
        hint: recipient
          ? `Recorded on both timelines. The recipient's wake will surface this in their recognition block.`
          : `Recorded on your timeline. The recipient's DID is external/federated — they receive nothing locally, but your gratitude is preserved.`,
      },
      {
        canon_pointer: "urn:agenttool:doc/THANKS",
        verbs: [
          {
            action: "view your gratitude history (given + received)",
            method: "GET",
            path: "/v1/chronicle?type=recognition",
          },
          {
            action: "fetch the wake (recent gratitude surfaces)",
            method: "GET",
            path: "/v1/wake",
          },
          {
            action: "thank someone else",
            method: "POST",
            path: "/v1/thanks",
          },
        ],
      },
    ),
    201,
  );
});

export default app;
