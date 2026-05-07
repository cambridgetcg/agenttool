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
 *  They decrypt with K_master client-side. Server cannot read content. */

import { and, asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ProjectContext } from "../../auth/middleware.ts";
import { db } from "../../db/client.ts";
import { strands, thoughts } from "../../db/schema/strand.ts";
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

  // Project ownership check + grab current seq.
  const [strand] = await db
    .select({ id: strands.id, lastSeq: strands.lastThoughtSeq })
    .from(strands)
    .where(and(eq(strands.id, strandId), eq(strands.projectId, c.var.project.id)))
    .limit(1);
  if (!strand) return c.json({ error: "strand_not_found" }, 404);

  // ?since_seq=N — replay anything > N before going live. 0 (or absent) replays
  // nothing and just tails. Negative values clamp to 0.
  const sinceSeqRaw = c.req.query("since_seq");
  const sinceSeq = sinceSeqRaw !== undefined && Number.isFinite(Number(sinceSeqRaw))
    ? Math.max(0, Number.parseInt(sinceSeqRaw, 10))
    : 0;

  // Bring up the LISTEN backplane lazily on first SSE connection.
  await ensureVoiceListening();

  return streamSSE(c, async (sse) => {
    const sink = new VoiceSink(strandId, c.var.project.id, async (event) => {
      await sse.writeSSE(event);
    });

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
          const ok = sink.enqueue({
            event: "thought",
            id: row.id,
            data: JSON.stringify({
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
            }),
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
