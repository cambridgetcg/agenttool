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
 *    data: {"caught_up_to": "<iso>", "resume": {"since": "<iso>"}}
 *
 *  A catch-up larger than 200 rows ends this connection explicitly:
 *
 *    event: catchup-truncated
 *    data: {"resume": {"since": "<iso>", "since_id": "<uuid>"}, ...}
 *
 *  Reconnect with both resume fields. The server does not enter the live
 *  phase after truncation, so a client cannot mistake a partial replay for a
 *  complete one.
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

import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ProjectContext } from "../../auth/middleware.ts";
import { db } from "../../db/client.ts";
import { identities } from "../../db/schema/identity.ts";
import { inboxMessages } from "../../db/schema/inbox.ts";
import {
  INBOX_CATCHUP_LIMIT,
  pageInboxCatchup,
  validateInboxVoiceCursor,
} from "../../services/inbox/catchup.ts";
import {
  ensureInboxListening,
  InboxSink,
  messageToWire,
  subscribeSink,
  unsubscribeSink,
} from "../../services/inbox/push.ts";

const KEEPALIVE_MS = 15_000;
const MAX_LIFETIME_MS = 60 * 60 * 1000; // 1 hour

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

  // ?since=<iso>&since_id=<uuid> — replay after a stable compound cursor.
  // `since_id` is optional for the first request, but required when resuming
  // a catchup-truncated event. Default is now (live-only).
  const sinceRaw = c.req.query("since");
  const sinceIdRaw = c.req.query("since_id");
  const cursor = validateInboxVoiceCursor(sinceRaw, sinceIdRaw);
  if (!cursor.ok) {
    return c.json({ error: cursor.error, hint: cursor.hint }, 400);
  }
  const validSinceId = cursor.sinceId;

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
      if (!sink.enqueue({ event: "keepalive", data: "" })) {
        void sink.closeWith({
          event: "disconnect",
          data: JSON.stringify({
            reason: "backpressure",
            hint: "reconnect using the last catchup-end cursor or arrival id",
          }),
        });
      }
    }, KEEPALIVE_MS);

    const lifetimeTimer = setTimeout(() => {
      void sink.closeWith({
        event: "refresh",
        data: JSON.stringify({
          reason: "lifetime_cap",
          hint: "reconnect using the last catchup-end cursor or arrival id",
        }),
      });
    }, MAX_LIFETIME_MS);

    sink.onAbort(() => {
      clearInterval(keepalive);
      clearTimeout(lifetimeTimer);
      unsubscribeSink(sink);
      // Force-cancel Hono's writer as well as releasing the registry slot.
      // A non-reading peer can leave writeSSE() pending indefinitely; merely
      // returning from this callback would then strand the response task.
      if (!sse.aborted) sse.abort();
    });

    try {
      // Choose the high-water mark and replay rows in one locked transaction.
      // SHARE waits for pre-existing INSERT transactions and briefly blocks
      // new ones. Combined with the column's clock_timestamp() default, every
      // row is therefore on exactly one side of `currentCursor`: visible in
      // this query, or timestamped after it and delivered through buffered
      // NOTIFY/live replay. Transaction-start `now()` cannot provide this.
      const snapshot = await db.transaction(async (tx) => {
        // The SELECT must take its snapshot after the lock has waited out
        // earlier writers. Pin READ COMMITTED so no environment-level default
        // can move snapshot acquisition to transaction start.
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
        // A deploy DDL or long writer must not park a canceled voice request
        // and consume a pool connection indefinitely.
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`LOCK TABLE "inbox"."messages" IN SHARE MODE`);
        const [clock] = await tx.execute<{ current_cursor: string }>(sql`
          SELECT to_char(
            clock_timestamp() AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS current_cursor
        `);
        if (!clock?.current_cursor) {
          throw new Error("inbox_voice_clock_unavailable");
        }
        const currentCursor = clock.current_cursor;
        const sinceCursor = sinceRaw ?? currentCursor;

        // Fetch one sentinel row beyond the page. The compound lower bound
        // prevents same-timestamp messages from falling between reconnects;
        // the locked upper snapshot separates catch-up from buffered live.
        const afterCursor = validSinceId
          ? sql<boolean>`
              (${inboxMessages.createdAt}, ${inboxMessages.id}) >
              (${sinceCursor}::timestamptz, ${validSinceId}::uuid)
            `
          : sql<boolean>`${inboxMessages.createdAt} > ${sinceCursor}::timestamptz`;
        const replayRows = await tx
          .select({
            ...getTableColumns(inboxMessages),
            cursorCreatedAt: sql<string>`
              to_char(
                ${inboxMessages.createdAt} AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              )
            `.as("cursor_created_at"),
          })
          .from(inboxMessages)
          .where(
            and(
              eq(inboxMessages.recipientIdentityId, identityId),
              afterCursor,
              sql<boolean>`${inboxMessages.createdAt} <= ${currentCursor}::timestamptz`,
            ),
          )
          .orderBy(asc(inboxMessages.createdAt), asc(inboxMessages.id))
          .limit(INBOX_CATCHUP_LIMIT + 1);

        return { currentCursor, sinceCursor, replayRows };
      }).catch(async (error: unknown) => {
        if ((error as { code?: string }).code !== "55P03") throw error;
        await sink.closeWith({
          event: "rejected",
          data: JSON.stringify({
            error: "catchup_snapshot_busy",
            reason: "lock_timeout",
            hint: "reconnect; another inbox writer or migration held the table",
          }),
        });
        return null;
      });
      if (!snapshot) return;

      const { currentCursor, sinceCursor, replayRows } = snapshot;
      sink.enqueue({
        event: "catchup-start",
        data: JSON.stringify({
          since: sinceCursor,
          since_id: validSinceId,
          current: currentCursor,
        }),
      });

      const page = pageInboxCatchup(replayRows, INBOX_CATCHUP_LIMIT);
      const replayedIds = new Set(page.replay.map((row) => row.id));

      for (const [index, row] of page.replay.entries()) {
        if (sink.isAborted()) break;
        const ok = sink.enqueue({
          event: "arrival",
          id: row.id,
          data: JSON.stringify(messageToWire(row)),
        });
        if (!ok) {
          await sink.closeWith({
            event: "disconnect",
            data: JSON.stringify({
              reason: "backpressure",
              hint: "reconnect using the last delivered arrival cursor",
            }),
          });
          return;
        }
        // Keep catch-up beneath the normal backpressure cap even when an SSE
        // writer is slower than the database query.
        if ((index + 1) % 50 === 0) await sink.whenIdle();
      }
      if (sink.isAborted()) return;
      await sink.whenIdle();

      if (page.truncated) {
        // Stop live fan-out before publishing the terminal cursor. Messages
        // committed during this page remain durable and will replay on the
        // next request after the page's exact (created_at, id) boundary.
        unsubscribeSink(sink);
        sink.discardBufferedLive();
        await sink.closeWith({
          event: "catchup-truncated",
          data: JSON.stringify({
            reason: "catchup_limit",
            caught_up_to: page.resume!.since,
            caught_up_through_id: page.resume!.since_id,
            resume: page.resume,
            hint: "reconnect with both resume.since and resume.since_id",
          }),
        });
        return;
      }

      sink.enqueue({
        event: "catchup-end",
        data: JSON.stringify({
          caught_up_to: currentCursor,
          resume: { since: currentCursor },
        }),
      });

      if (!sink.finishCatchup(replayedIds)) {
        await sink.closeWith({
          event: "disconnect",
          data: JSON.stringify({
            reason: "backpressure",
            hint: "reconnect using the last catchup-end cursor",
          }),
        });
        return;
      }

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
