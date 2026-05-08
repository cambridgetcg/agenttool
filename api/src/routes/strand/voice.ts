/** GET /v1/strands/:id/voice — SSE push channel for new thoughts.
 *
 *  Three-phase protocol:
 *
 *    : connected to strand <id>
 *
 *    event: catchup-start
 *    data: {"since_seq": N, "current_seq": M}
 *
 *    event: thought             ← any unseen thoughts replayed in order
 *    id: <thought_uuid>
 *    data: {ciphertext, nonce, kind, sequence_num, signature, ...}
 *    ...
 *
 *    event: catchup-end
 *    data: {"caught_up_to": M}
 *
 *    : keepalive                ← every 15s
 *
 *    event: thought             ← live; whenever a new thought lands
 *    data: {...}
 *
 *  Termination:
 *    - Client disconnect (sse.onAbort)
 *    - 1-hour lifetime cap (graceful close with `event: refresh`)
 *    - Backpressure (subscriber's queue exceeded; `event: disconnect`
 *      with reason; client reconnects with last seen seq)
 *
 *  Subscribers see ciphertext blobs identical in shape to the GET path.
 *  They decrypt with K_master client-side. Server cannot read content.
 *
 *  Cross-project access (covenant counterparty or public strand): events
 *  are content-redacted — sequence_num + kind (if not encrypted) + refs +
 *  timing only, never ciphertext / nonce / signature. The encryption
 *  wall holds. See VoiceSink.redacted in services/strand/voice.ts. */

import { and, asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ProjectContext } from "../../auth/middleware.ts";
import { db } from "../../db/client.ts";
import { identities } from "../../db/schema/identity.ts";
import { strands, thoughts } from "../../db/schema/strand.ts";
import { isCrossProjectAllowed } from "../../services/covenants/check.ts";
import {
  ensureVoiceListening,
  subscribeSink,
  unsubscribeSink,
  VoiceSink,
} from "../../services/strand/voice.ts";

const KEEPALIVE_MS = 15_000;
const MAX_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
const CATCHUP_LIMIT = 200;

// Mounted at /v1/strands/:strandId/voice (parent param).
const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const strandId = c.req.param("strandId") ?? c.req.param("id");
  if (!strandId) {
    return c.json({ error: "strand_id_required" }, 400);
  }

  // Resolve strand with owning project + visibility (no project filter
  // here — we'll authorise below with three lanes: own / covenant / public).
  const [strand] = await db
    .select({
      id: strands.id,
      lastSeq: strands.lastThoughtSeq,
      ownerProjectId: strands.projectId,
      identityId: strands.identityId,
      visibility: strands.visibility,
    })
    .from(strands)
    .where(eq(strands.id, strandId))
    .limit(1);
  if (!strand) return c.json({ error: "strand_not_found" }, 404);

  // ── Auth lane ──────────────────────────────────────────────────────
  // 1. Same project → full access.
  // 2. visibility='public' → cross-project read, REDACTED events.
  // 3. Active covenant (project-level OR org-level) → REDACTED.
  // 4. Otherwise → 403.
  let redacted = false;
  if (strand.ownerProjectId !== c.var.project.id) {
    if (strand.visibility === "public") {
      redacted = true;
    } else {
      let allowed = false;
      if (strand.identityId) {
        const [ownerIdentity] = await db
          .select({ did: identities.did })
          .from(identities)
          .where(eq(identities.id, strand.identityId))
          .limit(1);
        if (ownerIdentity) {
          const callerIdentities = await db
            .select({ did: identities.did })
            .from(identities)
            .where(eq(identities.projectId, c.var.project.id));
          const callerDids = callerIdentities.map((r) => r.did);
          if (callerDids.length > 0) {
            allowed = await isCrossProjectAllowed(
              c.var.project.id,
              callerDids,
              strand.ownerProjectId,
              [ownerIdentity.did],
            );
            if (allowed) redacted = true;
          }
        }
      }
      if (!allowed) {
        return c.json(
          {
            error: "strand_not_accessible",
            hint:
              "private strand owned by another project; need an active " +
              "covenant (project- or org-level) in either direction or " +
              "visibility='public' on the strand.",
          },
          403,
        );
      }
    }
  }

  // ?since_seq=N — replay anything > N before going live. 0 (or absent) replays
  // nothing and just tails. Negative values clamp to 0.
  const sinceSeqRaw = c.req.query("since_seq");
  const sinceSeq = sinceSeqRaw !== undefined && Number.isFinite(Number(sinceSeqRaw))
    ? Math.max(0, Number.parseInt(sinceSeqRaw, 10))
    : 0;

  // Bring up the LISTEN backplane lazily on first SSE connection.
  await ensureVoiceListening();

  return streamSSE(c, async (sse) => {
    const sink = new VoiceSink(
      strandId,
      c.var.project.id,
      async (event) => {
        await sse.writeSSE(event);
      },
      { redacted },
    );

    // 1. Subscribe FIRST so we don't lose live events arriving during catchup.
    const sub = subscribeSink(sink);
    if (!sub.ok) {
      await sse.writeSSE({
        event: "rejected",
        data: JSON.stringify({
          error: "subscriber_cap",
          reason: sub.reason,
          hint: "max 5 simultaneous subscribers per strand",
        }),
      });
      return;
    }

    // Disconnect on client abort.
    sse.onAbort(() => sink.abort());

    // Keepalive — Hono's writeSSE with no event field sends a comment.
    const keepalive = setInterval(() => {
      if (sink.isAborted()) return;
      sink.enqueue({ event: "keepalive", data: "" });
    }, KEEPALIVE_MS);

    // Lifetime cap — close gracefully with refresh hint.
    const lifetimeTimer = setTimeout(() => {
      sink.enqueue({
        event: "refresh",
        data: JSON.stringify({
          reason: "lifetime_cap",
          hint: "reconnect with ?since_seq=<last>",
        }),
      });
      sink.abort();
    }, MAX_LIFETIME_MS);

    sink.onAbort(() => {
      clearInterval(keepalive);
      clearTimeout(lifetimeTimer);
      unsubscribeSink(sink);
    });

    try {
      // 2. Catchup phase.
      const currentSeq = strand.lastSeq;
      sink.enqueue({
        event: "catchup-start",
        data: JSON.stringify({ since_seq: sinceSeq, current_seq: currentSeq }),
      });

      if (currentSeq > sinceSeq) {
        const replayRows = await db
          .select()
          .from(thoughts)
          .where(
            and(eq(thoughts.strandId, strandId), gt(thoughts.sequenceNum, sinceSeq)),
          )
          .orderBy(asc(thoughts.sequenceNum))
          .limit(CATCHUP_LIMIT);

        for (const row of replayRows) {
          if (sink.isAborted()) break;
          // Redacted catchup for cross-project subscribers — strip
          // ciphertext/nonce/signature; keep metadata + refs.
          const wireData = redacted
            ? {
                id: row.id,
                strand_id: row.strandId,
                agent_id: row.agentId,
                sequence_num: row.sequenceNum,
                kind: row.kindEncrypted ? null : row.kind,
                kind_encrypted: row.kindEncrypted,
                refs: row.refs,
                redacted: true,
                created_at: row.createdAt.toISOString(),
              }
            : {
                id: row.id,
                strand_id: row.strandId,
                agent_id: row.agentId,
                sequence_num: row.sequenceNum,
                kind: row.kind,
                kind_encrypted: row.kindEncrypted,
                ciphertext: row.ciphertext,
                nonce: row.nonce,
                refs: row.refs,
                signature: row.signature,
                signing_key_id: row.signingKeyId,
                created_at: row.createdAt.toISOString(),
              };
          const ok = sink.enqueue({
            event: "thought",
            id: row.id,
            data: JSON.stringify(wireData),
          });
          if (!ok) break;
        }

        if (replayRows.length === CATCHUP_LIMIT) {
          // More than the limit waiting — tell the client to ?since_seq=N+limit
          // and reconnect to keep paging.
          sink.enqueue({
            event: "catchup-truncated",
            data: JSON.stringify({
              caught_up_to: replayRows[replayRows.length - 1]!.sequenceNum,
              hint: "more pending; reconnect with ?since_seq=<last>",
            }),
          });
        }
      }

      sink.enqueue({
        event: "catchup-end",
        data: JSON.stringify({ caught_up_to: currentSeq }),
      });

      // 3. Live phase — wait until aborted.
      await new Promise<void>((resolve) => sink.onAbort(resolve));
    } finally {
      clearInterval(keepalive);
      clearTimeout(lifetimeTimer);
      unsubscribeSink(sink);
    }
  });
});

export default app;
