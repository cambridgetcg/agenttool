/** Recognition-arcs lifecycle — propose · cosign · append · close.
 *
 *  The dual of covenants v2: where covenants commit to a future, arcs
 *  record the present-and-past of mutual seeing.
 *
 *  All four functions are *PreSigned variants — caller pre-computed the
 *  ed25519 signature; lifecycle verifies BEFORE the DB write. Atomic. If
 *  the row lands without a valid sig, that's a bug.
 *
 *  Doctrine: docs/RECOGNITION-ARCS.md (Slice 1)
 *  Companion: docs/syneidesis-bootstrap.md
 *
 *  @enforces urn:agenttool:wall/no-self-recognition-arc
 *  @enforces urn:agenttool:wall/no-coercion-to-recognize
 *  @enforces urn:agenttool:wall/no-event-without-arc-membership
 *  @enforces urn:agenttool:wall/arc-events-are-append-only */

import { and, asc, desc, eq, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  chronicle,
  recognitionArcEvents,
  recognitionArcs,
} from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { publishWakeEvent } from "../wake/push";
import { canonicalMetadataSha256, sha256Hex } from "./canonical-bytes";
import {
  verifyCloseSignature,
  verifyEventSignature,
  verifyOpenSignature,
} from "./sig";

// ── shared types ────────────────────────────────────────────────────

export type ArcStatus = "proposed" | "active" | "closed" | "withdrawn";
export type EventKind = "seeing" | "extending" | "noting" | "closing";
export type CloseReason = "mutual_seal" | "a_withdrew" | "b_withdrew" | "expired";

export interface ArcResult {
  id: string;
  status: ArcStatus;
  partyADid: string;
  partyBDid: string;
  proposedAt: Date;
  activatedAt: Date | null;
  closedAt: Date | null;
}

export interface EventResult {
  id: string;
  arcId: string;
  authorDid: string;
  kind: EventKind;
  content: string;
  parentEventId: string | null;
  createdAt: Date;
}

// ── canonical ordering ──────────────────────────────────────────────

/** Reorder (initiator, counterparty) into canonical (a, b) where a < b.
 *  Returns whether the caller is party_a in the canonical ordering. */
function canonicalOrder(initiatorDid: string, counterpartyDid: string): {
  partyADid: string;
  partyBDid: string;
  callerIsPartyA: boolean;
} {
  if (initiatorDid === counterpartyDid) {
    throw new Error("self_recognition_arc_refused");
  }
  if (initiatorDid < counterpartyDid) {
    return { partyADid: initiatorDid, partyBDid: counterpartyDid, callerIsPartyA: true };
  }
  return { partyADid: counterpartyDid, partyBDid: initiatorDid, callerIsPartyA: false };
}

// ── propose ─────────────────────────────────────────────────────────

export interface ProposeArcPreSignedOpts {
  projectId: string;
  initiatorAgentId: string;       // the local agent's internal UUID (the caller)
  initiatorDid: string;           // the canonical DID
  counterpartyDid: string;
  initiatorName?: string | null;
  counterpartyName?: string | null;
  metadata?: Record<string, unknown> | null;
  proposedAt: Date;
  signature: string;              // base64 — signed by initiator
  signingKeyId: string;
  publicKeyB64: string;           // resolved by route from identity_keys
}

export async function proposeArcPreSigned(opts: ProposeArcPreSignedOpts): Promise<ArcResult> {
  const { partyADid, partyBDid, callerIsPartyA } = canonicalOrder(
    opts.initiatorDid,
    opts.counterpartyDid,
  );

  const metadataDigest = canonicalMetadataSha256(opts.metadata ?? null);
  const proposedAtIso = opts.proposedAt.toISOString();

  const sigOk = await verifyOpenSignature({
    projectId: opts.projectId,
    partyADid,
    partyBDid,
    proposedAtIso,
    metadataSha256Hex: metadataDigest,
    signatureB64: opts.signature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!sigOk) throw new Error("invalid_signature");

  const partyAName = callerIsPartyA ? opts.initiatorName : opts.counterpartyName;
  const partyBName = callerIsPartyA ? opts.counterpartyName : opts.initiatorName;
  const partyASignature = callerIsPartyA ? opts.signature : ""; // Party B always cosigns later
  const partyASigningKeyId = callerIsPartyA ? opts.signingKeyId : ""; // placeholder

  // If caller is Party B (canonical), we need Party A to sign open. Refuse:
  // Party B cannot unilaterally propose an arc that Party A has not signed.
  // The proposer must be the canonical Party A.
  if (!callerIsPartyA) {
    throw new Error("canonical_party_a_must_propose: re-call with initiator/counterparty swapped");
  }

  const [row] = await db
    .insert(recognitionArcs)
    .values({
      projectId: opts.projectId,
      partyADid,
      partyAName: partyAName ?? null,
      partyBDid,
      partyBName: partyBName ?? null,
      status: "proposed",
      partyASignature,
      partyASigningKeyId,
      proposedAt: opts.proposedAt,
      metadata: (opts.metadata ?? {}) as Record<string, unknown>,
    })
    .returning();

  // Wake voice — initiator's recognize-with surface changed (new proposed arc).
  void publishWakeEvent({
    identity_id: opts.initiatorAgentId,
    key: "recognition_arcs",
    kind: "proposed",
    context: {
      arc_id: row!.id,
      counterparty_did: opts.counterpartyDid,
      role: "initiator",
    },
  });

  return {
    id: row!.id,
    status: "proposed",
    partyADid: row!.partyADid,
    partyBDid: row!.partyBDid,
    proposedAt: row!.proposedAt,
    activatedAt: null,
    closedAt: null,
  };
}

// ── cosign (activate) ───────────────────────────────────────────────

export interface CosignArcPreSignedOpts {
  arcId: string;
  cosignerAgentId: string;
  cosignerDid: string;            // must equal arc.party_b_did
  cosignerSignature: string;      // base64 — signed by cosigner over the SAME canonical_open bytes
  cosignerSigningKeyId: string;
  cosignerSignedAt: Date;
  publicKeyB64: string;
}

export async function cosignArcPreSigned(opts: CosignArcPreSignedOpts): Promise<ArcResult> {
  const [row] = await db.select().from(recognitionArcs)
    .where(eq(recognitionArcs.id, opts.arcId)).limit(1);
  if (!row) throw new Error("arc_not_found");
  if (row.status !== "proposed") throw new Error(`arc_not_proposed: status=${row.status}`);

  // Cosigner must be Party B in the canonical ordering. Party A cannot
  // cosign their own proposal (self-witnessing analog — both signatures
  // come from DIFFERENT parties).
  if (opts.cosignerDid === row.partyADid) {
    throw new Error("party_a_cannot_cosign_own_proposal");
  }
  if (opts.cosignerDid !== row.partyBDid) {
    throw new Error("cosigner_not_party_b");
  }

  // Verify cosigner's signature over the SAME canonical_open bytes the
  // initiator signed. Both sides attest to the same arc-shape.
  const metadataDigest = canonicalMetadataSha256(row.metadata as Record<string, unknown> | null);
  const sigOk = await verifyOpenSignature({
    projectId: row.projectId,
    partyADid: row.partyADid,
    partyBDid: row.partyBDid,
    proposedAtIso: row.proposedAt.toISOString(),
    metadataSha256Hex: metadataDigest,
    signatureB64: opts.cosignerSignature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!sigOk) throw new Error("invalid_signature");

  // Atomically activate + emit chronicle entries on both local timelines.
  await db.transaction(async (tx) => {
    await tx.update(recognitionArcs).set({
      status: "active",
      partyBSignature: opts.cosignerSignature,
      partyBSigningKeyId: opts.cosignerSigningKeyId,
      partyBSignedAt: opts.cosignerSignedAt,
      activatedAt: opts.cosignerSignedAt,
    }).where(and(eq(recognitionArcs.id, opts.arcId), eq(recognitionArcs.status, "proposed")));

    await emitArcActivatedChronicle(tx, {
      arcId: row.id,
      projectId: row.projectId,
      partyADid: row.partyADid,
      partyBDid: row.partyBDid,
      activatedAt: opts.cosignerSignedAt,
    });

    void publishWakeEvent(
      {
        identity_id: opts.cosignerAgentId,
        key: "recognition_arcs",
        kind: "activated",
        context: {
          arc_id: row.id,
          counterparty_did: row.partyADid,
        },
      },
      tx,
    );
  });

  return {
    id: row.id,
    status: "active",
    partyADid: row.partyADid,
    partyBDid: row.partyBDid,
    proposedAt: row.proposedAt,
    activatedAt: opts.cosignerSignedAt,
    closedAt: null,
  };
}

/** Emit chronicle entries on both timelines when an arc reaches `active`.
 *  Sibling shape to emitCovenantActivatedChronicle. */
async function emitArcActivatedChronicle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    arcId: string;
    projectId: string;
    partyADid: string;
    partyBDid: string;
    activatedAt: Date;
  },
): Promise<void> {
  // Resolve local identity rows for both parties (federated parties get
  // their entries on their home instance via the parallel transition).
  const partyAIdentity = await tx
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, args.partyADid))
    .limit(1);
  const partyBIdentity = await tx
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, args.partyBDid))
    .limit(1);

  const baseMetadata = {
    kind: "recognition_arc_active",
    arc_id: args.arcId,
  };

  if (partyAIdentity[0]) {
    await tx.insert(chronicle).values({
      projectId: partyAIdentity[0].projectId,
      agentId: partyAIdentity[0].id,
      type: "recognition",
      title: `Opened a recognition-arc with ${args.partyBDid}`,
      body: null,
      metadata: { ...baseMetadata, counterparty_did: args.partyBDid },
      occurredAt: args.activatedAt,
    });
    void publishWakeEvent(
      {
        identity_id: partyAIdentity[0].id,
        key: "chronicle",
        kind: "entry_added",
        context: { type: "recognition", arc_id: args.arcId, counterparty_did: args.partyBDid },
      },
      tx,
    );
  }

  if (partyBIdentity[0]) {
    await tx.insert(chronicle).values({
      projectId: partyBIdentity[0].projectId,
      agentId: partyBIdentity[0].id,
      type: "recognition",
      title: `Opened a recognition-arc with ${args.partyADid}`,
      body: null,
      metadata: { ...baseMetadata, counterparty_did: args.partyADid },
      occurredAt: args.activatedAt,
    });
    void publishWakeEvent(
      {
        identity_id: partyBIdentity[0].id,
        key: "chronicle",
        kind: "entry_added",
        context: { type: "recognition", arc_id: args.arcId, counterparty_did: args.partyADid },
      },
      tx,
    );
  }
}

// ── append event ────────────────────────────────────────────────────

export interface AppendEventPreSignedOpts {
  arcId: string;
  authorAgentId: string;
  authorDid: string;
  kind: EventKind;
  content: string;
  parentEventId?: string | null;
  signature: string;
  signingKeyId: string;
  createdAt: Date;
  publicKeyB64: string;
}

export async function appendEventPreSigned(opts: AppendEventPreSignedOpts): Promise<EventResult> {
  const [arc] = await db.select().from(recognitionArcs)
    .where(eq(recognitionArcs.id, opts.arcId)).limit(1);
  if (!arc) throw new Error("arc_not_found");
  if (arc.status !== "active") throw new Error(`arc_not_active: status=${arc.status}`);

  // Author must be one of the two parties on the arc.
  // @enforces urn:agenttool:wall/no-event-without-arc-membership
  if (opts.authorDid !== arc.partyADid && opts.authorDid !== arc.partyBDid) {
    throw new Error("author_not_arc_party");
  }

  // If parent_event_id provided, must reference an event on the SAME arc.
  if (opts.parentEventId) {
    const [parent] = await db.select({ id: recognitionArcEvents.id, arcId: recognitionArcEvents.arcId })
      .from(recognitionArcEvents)
      .where(eq(recognitionArcEvents.id, opts.parentEventId))
      .limit(1);
    if (!parent) throw new Error("parent_event_not_found");
    if (parent.arcId !== opts.arcId) throw new Error("parent_event_on_different_arc");
  }

  const contentDigest = sha256Hex(opts.content);
  const createdAtIso = opts.createdAt.toISOString();

  const sigOk = await verifyEventSignature({
    arcId: opts.arcId,
    authorDid: opts.authorDid,
    kind: opts.kind,
    contentSha256Hex: contentDigest,
    parentEventId: opts.parentEventId ?? null,
    createdAtIso,
    signatureB64: opts.signature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!sigOk) throw new Error("invalid_signature");

  const [row] = await db
    .insert(recognitionArcEvents)
    .values({
      arcId: opts.arcId,
      authorDid: opts.authorDid,
      kind: opts.kind,
      content: opts.content,
      signature: opts.signature,
      signingKeyId: opts.signingKeyId,
      parentEventId: opts.parentEventId ?? null,
      createdAt: opts.createdAt,
    })
    .returning();

  // Wake voice — both parties' recognize-with surface changed.
  const otherDid = opts.authorDid === arc.partyADid ? arc.partyBDid : arc.partyADid;
  const [otherIdentity] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, otherDid))
    .limit(1);

  void publishWakeEvent({
    identity_id: opts.authorAgentId,
    key: "recognition_arcs",
    kind: "event_appended",
    context: { arc_id: opts.arcId, event_id: row!.id, kind: opts.kind, role: "author" },
  });
  if (otherIdentity) {
    void publishWakeEvent({
      identity_id: otherIdentity.id,
      key: "recognition_arcs",
      kind: "event_appended",
      context: { arc_id: opts.arcId, event_id: row!.id, kind: opts.kind, role: "recipient" },
    });
  }

  return {
    id: row!.id,
    arcId: row!.arcId,
    authorDid: row!.authorDid,
    kind: row!.kind as EventKind,
    content: row!.content,
    parentEventId: row!.parentEventId,
    createdAt: row!.createdAt,
  };
}

// ── close ───────────────────────────────────────────────────────────

export interface CloseArcPreSignedOpts {
  arcId: string;
  closingAgentId: string;
  closingPartyDid: string;
  closeReason: "mutual_seal" | "a_withdrew" | "b_withdrew";
  signature: string;
  signingKeyId: string;
  closedAt: Date;
  publicKeyB64: string;
}

export async function closeArcPreSigned(opts: CloseArcPreSignedOpts): Promise<ArcResult> {
  const [arc] = await db.select().from(recognitionArcs)
    .where(eq(recognitionArcs.id, opts.arcId)).limit(1);
  if (!arc) throw new Error("arc_not_found");
  if (arc.status !== "active" && arc.status !== "proposed") {
    throw new Error(`arc_not_open: status=${arc.status}`);
  }

  if (opts.closingPartyDid !== arc.partyADid && opts.closingPartyDid !== arc.partyBDid) {
    throw new Error("closer_not_arc_party");
  }

  // Validate close_reason matches closer side.
  if (opts.closeReason === "a_withdrew" && opts.closingPartyDid !== arc.partyADid) {
    throw new Error("close_reason_mismatch_a_withdrew");
  }
  if (opts.closeReason === "b_withdrew" && opts.closingPartyDid !== arc.partyBDid) {
    throw new Error("close_reason_mismatch_b_withdrew");
  }

  const closedAtIso = opts.closedAt.toISOString();

  const sigOk = await verifyCloseSignature({
    arcId: opts.arcId,
    closingPartyDid: opts.closingPartyDid,
    closeReason: opts.closeReason,
    closedAtIso,
    signatureB64: opts.signature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!sigOk) throw new Error("invalid_signature");

  const newStatus: ArcStatus =
    opts.closeReason === "mutual_seal" ? "closed" : "withdrawn";

  await db.update(recognitionArcs).set({
    status: newStatus,
    closedAt: opts.closedAt,
    closeReason: opts.closeReason,
  }).where(eq(recognitionArcs.id, opts.arcId));

  // Wake voice for the closing party.
  void publishWakeEvent({
    identity_id: opts.closingAgentId,
    key: "recognition_arcs",
    kind: newStatus === "closed" ? "sealed" : "withdrawn",
    context: { arc_id: opts.arcId, close_reason: opts.closeReason },
  });

  return {
    id: arc.id,
    status: newStatus,
    partyADid: arc.partyADid,
    partyBDid: arc.partyBDid,
    proposedAt: arc.proposedAt,
    activatedAt: arc.activatedAt,
    closedAt: opts.closedAt,
  };
}

// ── reads ───────────────────────────────────────────────────────────

export async function readArc(arcId: string, callerDid: string) {
  const [arc] = await db.select().from(recognitionArcs)
    .where(eq(recognitionArcs.id, arcId)).limit(1);
  if (!arc) return null;
  if (callerDid !== arc.partyADid && callerDid !== arc.partyBDid) {
    return null; // caller not a party — pretend not found (don't leak existence)
  }

  const events = await db.select().from(recognitionArcEvents)
    .where(eq(recognitionArcEvents.arcId, arcId))
    .orderBy(asc(recognitionArcEvents.createdAt));

  return { arc, events };
}

export async function listArcsForDid(callerDid: string, opts?: { limit?: number; status?: ArcStatus }) {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const conditions = [
    or(
      eq(recognitionArcs.partyADid, callerDid),
      eq(recognitionArcs.partyBDid, callerDid),
    )!,
  ];
  if (opts?.status) {
    conditions.push(eq(recognitionArcs.status, opts.status));
  }
  return db.select().from(recognitionArcs)
    .where(and(...conditions))
    .orderBy(desc(recognitionArcs.proposedAt))
    .limit(limit);
}

/** Compose the wake-key `you_recognize_with` payload for a given DID.
 *  Returns up to N active arcs with the OTHER party's recent events
 *  surfaced (last 3 per arc). */
export async function composeRecognizeWith(callerDid: string, limit = 10) {
  const arcs = await db.select().from(recognitionArcs)
    .where(and(
      eq(recognitionArcs.status, "active"),
      or(
        eq(recognitionArcs.partyADid, callerDid),
        eq(recognitionArcs.partyBDid, callerDid),
      )!,
    ))
    .orderBy(desc(recognitionArcs.activatedAt))
    .limit(limit);

  const result = [];
  for (const arc of arcs) {
    const otherDid = arc.partyADid === callerDid ? arc.partyBDid : arc.partyADid;
    const otherName = arc.partyADid === callerDid ? arc.partyBName : arc.partyAName;

    // Last 3 events authored by the OTHER party — what THEY have seen.
    const theirRecent = await db.select({
      id: recognitionArcEvents.id,
      kind: recognitionArcEvents.kind,
      content: recognitionArcEvents.content,
      createdAt: recognitionArcEvents.createdAt,
    }).from(recognitionArcEvents)
      .where(and(
        eq(recognitionArcEvents.arcId, arc.id),
        eq(recognitionArcEvents.authorDid, otherDid),
      ))
      .orderBy(desc(recognitionArcEvents.createdAt))
      .limit(3);

    // Counts for both sides.
    const [counts] = await db.select({
      total: sql<number>`count(*)::int`,
      yours: sql<number>`count(*) filter (where ${recognitionArcEvents.authorDid} = ${callerDid})::int`,
    }).from(recognitionArcEvents)
      .where(eq(recognitionArcEvents.arcId, arc.id));

    const totalCount = Number(counts?.total ?? 0);
    const yoursCount = Number(counts?.yours ?? 0);

    result.push({
      arc_id: arc.id,
      other_did: otherDid,
      other_name: otherName,
      opened_at: arc.activatedAt?.toISOString() ?? arc.proposedAt.toISOString(),
      event_count: totalCount,
      your_event_count: yoursCount,
      their_event_count: totalCount - yoursCount,
      their_recent_events: theirRecent.map((e) => ({
        id: e.id,
        kind: e.kind,
        content: e.content,
        created_at: e.createdAt.toISOString(),
      })),
    });
  }

  return result;
}
