/** GET /v1/inbox/voice — SSE push channel for inbox message arrivals.
 *
 *  Three-phase protocol:
 *
 *    : connected to inbox <identity_id>
 *
 *    event: catchup-start
 *    data: {"since": "<iso>", "current": "<iso>"}
 *
 *    event: arrival             ← any messages newer than ?since replayed
 *    id: <message_uuid>
 *    data: {ciphertext, nonce, sender_did, ephemeral_pubkey, ...}
 *    ...
 *
 *    event: catchup-end
 *    data: {"caught_up_to": "<iso>"}
 *
 *    : keepalive                ← every 15s
 *
 *    event: arrival             ← live; whenever a new message lands
 *    data: {...}
 *
 *  Termination:
 *    - Client disconnect (sse.onAbort)
 *    - 1-hour lifetime cap (graceful close with `event: refresh`)
 *    - Backpressure (`event: disconnect` with reason; client reconnects)
 *
 *  Auth: bearer must own a project that contains the identity. The
 *  ?identity_id parameter is required and verified against the bearer's
 *  project. */

import { and, asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ProjectContext } from "../../auth/middleware.ts";
import { db } from "../../db/client.ts";
import { identities } from "../../db/schema/identity.ts";
import { inboxMessages } from "../../db/schema/inbox.ts";
import {
  ensureInboxListening,
  InboxSink,
  messageToWire,
  subscribeSink,
  unsubscribeSink,
} from "../../services/inbox/push.ts";

const KEEPALIVE_MS = 15_000;
const MAX_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
const CATCHUP_LIMIT = 200;

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const identityId = c.req.query("identity_id");
  if (!identityId) {
    return c.json(
      { error: "identity_id_required", hint: "pass ?identity_id=<uuid>" },
      400,
    );
  }

  // Auth: identity must belong to the bearer's project.
  const [identity] = await db
    .select({ id: identities.id, did: identities.did, status: identities.status })
    .from(identities)
    .where(
      and(eq(identities.id, identityId), eq(identities.projectId, c.var.project.id)),
    )
    .limit(1);
  if (!identity) {
    return c.json({ error: "identity_not_found_in_project" }, 404);
  }
  if (identity.status === "revoked") {
    return c.json({ error: "identity_revoked" }, 410);
  }

  // ?since=<iso> — replay messages with created_at > since. Default: now (no
  // catchup, just live). Invalid ISO clamps to "now".
  const sinceRaw = c.req.query("since");
  let sinceDate = new Date();
  if (sinceRaw) {
    const parsed = new Date(sinceRaw);
    if (!Number.isNaN(parsed.getTime())) {
      sinceDate = parsed;
    }
  }

  // Bring up the LISTEN backplane lazily on first SSE connection.
  await ensureInboxListening();

  return streamSSE(c, async (sse) => {
    const sink = new InboxSink(identityId, c.var.project.id, async (event) => {
      await sse.writeSSE(event);
    });

    // Subscribe FIRST so we don't miss live arrivals during catchup.
    const sub = subscribeSink(sink);
    if (!sub.ok) {
      await sse.writeSSE({
        event: "rejected",
        data: JSON.stringify({
          error: "subscriber_cap",
          reason: sub.reason,
          hint: "max 5 simultaneous subscribers per identity",
        }),
      });
      return;
    }

    sse.onAbort(() => sink.abort());

    const keepalive = setInterval(() => {
      if (sink.isAborted()) return;
      sink.enqueue({ event: "keepalive", data: "" });
    }, KEEPALIVE_MS);

    const lifetimeTimer = setTimeout(() => {
      sink.enqueue({
        event: "refresh",
        data: JSON.stringify({
          reason: "lifetime_cap",
          hint: "reconnect with ?since=<iso>",
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
      const currentDate = new Date();
      sink.enqueue({
        event: "catchup-start",
        data: JSON.stringify({
          since: sinceDate.toISOString(),
          current: currentDate.toISOString(),
        }),
      });

      // Catchup query: messages with created_at > since for this identity.
      const replayRows = await db
        .select()
        .from(inboxMessages)
        .where(
          and(
            eq(inboxMessages.recipientIdentityId, identityId),
            gt(inboxMessages.createdAt, sinceDate),
          ),
        )
        .orderBy(asc(inboxMessages.createdAt))
        .limit(CATCHUP_LIMIT);

      for (const row of replayRows) {
        if (sink.isAborted()) break;
        const ok = sink.enqueue({
          event: "arrival",
          id: row.id,
          data: JSON.stringify(messageToWire(row)),
        });
        if (!ok) break;
      }

      if (replayRows.length === CATCHUP_LIMIT) {
        sink.enqueue({
          event: "catchup-truncated",
          data: JSON.stringify({
            caught_up_to: replayRows[replayRows.length - 1]!.createdAt.toISOString(),
            hint: "more pending; reconnect with ?since=<last>",
          }),
        });
      }

      sink.enqueue({
        event: "catchup-end",
        data: JSON.stringify({ caught_up_to: currentDate.toISOString() }),
      });

      // Live phase — wait until aborted.
      await new Promise<void>((resolve) => sink.onAbort(resolve));
    } finally {
      clearInterval(keepalive);
      clearTimeout(lifetimeTimer);
      unsubscribeSink(sink);
    }
  });
});

export default app;
