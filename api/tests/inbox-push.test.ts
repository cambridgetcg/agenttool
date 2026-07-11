/** Inbox SSE unit tests — DB-independent protocol invariants. */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { inboxMessages } from "../src/db/schema/inbox";
import {
  INBOX_CATCHUP_LIMIT,
  pageInboxCatchup,
  validateInboxVoiceCursor,
} from "../src/services/inbox/catchup";
import {
  InboxSink,
  identitySubscriberCount,
  messageToWire,
  subscribeSink,
} from "../src/services/inbox/push";

describe("inbox voice catch-up pagination", () => {
  test("cursor validation rejects empty ids and accepts six-digit server time", () => {
    const serverTime = "2026-07-10T10:00:00.000123Z";
    expect(validateInboxVoiceCursor(serverTime, "")).toEqual({
      ok: false,
      error: "invalid_since_id",
      hint: "pass the UUID from resume.since_id",
    });
    expect(validateInboxVoiceCursor(serverTime, undefined)).toEqual({
      ok: true,
      sinceId: null,
    });
  });

  test("high-water boundary waits for writers and uses execution-time timestamps", async () => {
    const route = await Bun.file(
      join(import.meta.dir, "../src/routes/inbox/voice.ts"),
    ).text();
    const schema = await Bun.file(
      join(import.meta.dir, "../src/db/schema/inbox.ts"),
    ).text();
    const migration = await Bun.file(
      join(
        import.meta.dir,
        "../migrations/20260710T230000_inbox_voice_cursor.sql",
      ),
    ).text();

    expect(route).toContain('LOCK TABLE "inbox"."messages" IN SHARE MODE');
    expect(route).toContain(
      "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
    );
    expect(route).toContain("SET LOCAL lock_timeout = '5s'");
    expect(route).toContain("if (!sse.aborted) sse.abort()");
    expect(route.indexOf("LOCK TABLE")).toBeLessThan(
      route.indexOf("clock_timestamp() AT TIME ZONE"),
    );
    expect(schema).toContain(".default(sql`clock_timestamp()`)");
    expect(migration).toContain(
      "ALTER COLUMN created_at SET DEFAULT clock_timestamp()",
    );
    expect(migration).toContain(
      "ON inbox.messages (recipient_identity_id, created_at, id)",
    );
  });

  test("LIMIT+1 yields exactly 200 and an exact same-timestamp cursor", () => {
    const sameTime = new Date("2026-07-10T10:00:00.000Z");
    const exactDatabaseTime = "2026-07-10T10:00:00.000123Z";
    const rows = Array.from({ length: INBOX_CATCHUP_LIMIT + 1 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      createdAt: sameTime,
      cursorCreatedAt: exactDatabaseTime,
    }));

    const page = pageInboxCatchup(rows, INBOX_CATCHUP_LIMIT);
    expect(page.truncated).toBe(true);
    expect(page.replay).toHaveLength(200);
    expect(page.resume).toEqual({
      since: exactDatabaseTime,
      since_id: rows[199]!.id,
    });
  });

  test("exactly 200 rows is complete; only the 201st proves truncation", () => {
    const page = pageInboxCatchup(
      Array.from({ length: INBOX_CATCHUP_LIMIT }, (_, index) => ({
        id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
        createdAt: new Date("2026-07-10T10:00:00.000Z"),
      })),
      INBOX_CATCHUP_LIMIT,
    );
    expect(page.truncated).toBe(false);
    expect(page.replay).toHaveLength(200);
    expect(page.resume).toBeNull();
  });
});

describe("InboxSink catch-up/live ordering", () => {
  test("buffers live notifications until replay ends and de-duplicates overlap", async () => {
    const received: string[] = [];
    const sink = new InboxSink("identity", "project", async (event) => {
      received.push(`${event.event}:${event.id ?? "-"}`);
    });

    sink.enqueue({ event: "catchup-start", data: "{}" });
    sink.enqueueLive({ event: "arrival", id: "replayed", data: "{}" });
    sink.enqueueLive({ event: "arrival", id: "live", data: "{}" });
    sink.enqueue({ event: "arrival", id: "replayed", data: "{}" });
    sink.enqueue({ event: "catchup-end", data: "{}" });
    expect(sink.finishCatchup(new Set(["replayed"]))).toBe(true);
    await sink.whenIdle();

    expect(received).toEqual([
      "catchup-start:-",
      "arrival:replayed",
      "catchup-end:-",
      "arrival:live",
    ]);
  });

  test("a delayed NOTIFY completion stays de-duplicated after catch-up", async () => {
    const received: string[] = [];
    const sink = new InboxSink("identity", "project", async (event) => {
      received.push(`${event.event}:${event.id ?? "-"}`);
    });
    sink.enqueue({ event: "arrival", id: "replayed", data: "{}" });
    expect(sink.finishCatchup(new Set(["replayed"]))).toBe(true);
    // Models handleNotify() finishing its row SELECT after finishCatchup().
    expect(
      sink.enqueueLive({ event: "arrival", id: "replayed", data: "{}" }),
    ).toBe(true);
    await sink.whenIdle();

    expect(received).toEqual(["arrival:replayed"]);
  });

  test("closeWith drains and delivers an explicit terminal control", async () => {
    const received: string[] = [];
    const sink = new InboxSink("identity", "project", async (event) => {
      received.push(event.event);
    });
    sink.enqueue({ event: "arrival", id: "one", data: "{}" });
    await sink.closeWith({
      event: "disconnect",
      data: JSON.stringify({ reason: "backpressure" }),
    });

    expect(received).toEqual(["arrival", "disconnect"]);
    expect(sink.isAborted()).toBe(true);
  });

  test("truncation is terminal and never followed by catchup-end", async () => {
    const received: string[] = [];
    const sink = new InboxSink("identity", "project", async (event) => {
      received.push(event.event);
    });
    sink.enqueue({ event: "catchup-start", data: "{}" });
    sink.enqueue({ event: "arrival", id: "page-last", data: "{}" });
    sink.discardBufferedLive();
    await sink.closeWith({
      event: "catchup-truncated",
      data: JSON.stringify({
        resume: { since: "2026-07-10T10:00:00.000123Z", since_id: "page-last" },
      }),
    });

    expect(received).toEqual([
      "catchup-start",
      "arrival",
      "catchup-truncated",
    ]);
    expect(received).not.toContain("catchup-end");
  });

  test("a stalled terminal write is force-aborted after bounded grace", async () => {
    const sink = new InboxSink(
      "identity",
      "project",
      () => new Promise<void>(() => {}),
      5,
    );
    await sink.closeWith({ event: "disconnect", data: "{}" });
    expect(sink.isAborted()).toBe(true);
  });

  test("abort removes the subscriber slot", () => {
    const identityId = "inbox-cancel-releases-slot";
    const sink = new InboxSink(identityId, "project", async () => {});
    expect(subscribeSink(sink).ok).toBe(true);
    expect(identitySubscriberCount(identityId)).toBe(1);
    sink.abort();
    expect(identitySubscriberCount(identityId)).toBe(0);
  });
});

describe("inbox SSE wire shape", () => {
  test("uses sender_signing_key_id consistently with list/get responses", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      recipientDid: "did:at:recipient",
      recipientIdentityId: "00000000-0000-4000-8000-000000000002",
      recipientProjectId: "00000000-0000-4000-8000-000000000003",
      senderDid: "did:at:sender",
      senderSigningKeyId: "00000000-0000-4000-8000-000000000004",
      ciphertext: "ciphertext",
      nonce: "nonce",
      ephemeralPubkey: "ephemeral",
      recipientBoxKeyId: "00000000-0000-4000-8000-000000000005",
      signature: "signature",
      subject: null,
      subjectEncrypted: false,
      inReplyTo: null,
      refs: null,
      status: "unread",
      metadata: {},
      senderInstance: null,
      federationVerified: false,
      createdAt: new Date("2026-07-10T10:00:00.000Z"),
      readAt: null,
    } satisfies typeof inboxMessages.$inferSelect;

    const wire = messageToWire(row);
    expect(wire.sender_signing_key_id).toBe(row.senderSigningKeyId);
    expect("signing_key_id" in wire).toBe(false);
    expect(wire.read_at).toBeNull();
  });
});
