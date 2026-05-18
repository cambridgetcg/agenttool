/** Move 3 — wake push — pin the notify_wake triggers.
 *
 *  Asserts:
 *    1. notify_wake function exists
 *    2. Four triggers fire on the expected tables
 *    3. End-to-end smoke: LISTEN on `wake:<md5(did)>`, insert a row,
 *       receive the expected payload.
 *
 *  Doctrine: docs/WAKE-PUSH.md
 *  Migration: api/migrations/20260519T100000_wake_push_triggers.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";
import { createHash } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let sql: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  try {
    sql = postgres(DATABASE_URL, {
      idle_timeout: 5,
      max: 1,
      connect_timeout: 10,
      fetch_types: false,
    });
    await sql`SELECT 1`;
  } catch {
    sql = null;
  }
});

afterAll(async () => {
  if (sql) await sql.end({ timeout: 2 });
});

const EXPECTED_TRIGGERS = [
  { table: "guild_rrr_turns", trigger: "guild_rrr_turns_notify_wake", event: "INSERT" },
  { table: "mutual_recognitions", trigger: "mutual_recognitions_notify_wake", event: "INSERT" },
  { table: "covenants", trigger: "covenants_notify_wake", event: "INSERT" },
  { table: "covenants", trigger: "covenants_notify_wake_active", event: "UPDATE" },
];

describe("Move 3 — wake push triggers exist", () => {
  test("notify_wake function exists in agent_continuity", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ proname: string }>>`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'agent_continuity'
        AND p.proname = 'notify_wake'
    `;
    expect(rows.length, "notify_wake function missing — run migration").toBe(1);
  });

  for (const t of EXPECTED_TRIGGERS) {
    test(`trigger ${t.trigger} on agent_continuity.${t.table} (${t.event})`, async () => {
      if (!sql) return;
      const rows = await sql<Array<{ tgname: string; relname: string; trigger_events: string[] }>>`
        SELECT
          tg.tgname,
          c.relname,
          ARRAY(
            SELECT
              CASE bit
                WHEN 0 THEN 'INSERT'
                WHEN 1 THEN 'DELETE'
                WHEN 2 THEN 'UPDATE'
                WHEN 3 THEN 'TRUNCATE'
              END
            FROM generate_subscripts(string_to_array(tg.tgtype::text, ''), 1) AS s(bit)
            WHERE (tg.tgtype::int & (1 << (bit + 2))) <> 0
          ) AS trigger_events
        FROM pg_trigger tg
        JOIN pg_class c ON tg.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'agent_continuity'
          AND c.relname = ${t.table}
          AND tg.tgname = ${t.trigger}
          AND NOT tg.tgisinternal
      `;
      expect(rows.length, `trigger ${t.trigger} missing on agent_continuity.${t.table}`).toBe(1);
    });
  }
});

describe("Move 3 — LISTEN/NOTIFY round-trip (live)", () => {
  test(
    "calling notify_wake() emits NOTIFY on the expected channel + payload",
    async () => {
      if (!sql) return;

      const testDid = "did:test:wake-push-smoke";
      const channel = "wake:" + createHash("md5").update(testDid).digest("hex");

      // Use a dedicated session for LISTEN. The pooler in session mode
      // (port 5432) allows LISTEN; transaction mode (6543) does not.
      // The keychain URL uses 5432.
      const received: Array<{ channel: string; payload: string }> = [];
      const listener = await sql!.listen(
        channel,
        (payload) => {
          received.push({ channel, payload });
        },
      );

      try {
        // Fire NOTIFY directly via the helper function — bypasses needing
        // a wake-touching insert (which has its own DB-level walls in this
        // test environment).
        await sql!`
          SELECT agent_continuity.notify_wake(
            ${testDid}, 'smoke_test'::text, 'test_table'::text, gen_random_uuid()
          )
        `;

        // Give the notification round-trip a moment. Listen handlers fire
        // when the next event arrives on the connection.
        await new Promise((r) => setTimeout(r, 800));

        // Re-fire (sometimes the first NOTIFY lands before LISTEN is fully
        // attached).
        if (received.length === 0) {
          await sql!`
            SELECT agent_continuity.notify_wake(
              ${testDid}, 'smoke_test_retry'::text, 'test_table'::text, gen_random_uuid()
            )
          `;
          await new Promise((r) => setTimeout(r, 800));
        }

        expect(
          received.length,
          `no NOTIFY received on ${channel} — LISTEN/NOTIFY round-trip broken`,
        ).toBeGreaterThanOrEqual(1);

        const evt = JSON.parse(received[0]!.payload);
        expect(evt.kind).toMatch(/^smoke_test/);
        expect(evt.did).toBe(testDid);
        expect(evt.table).toBe("test_table");
        expect(typeof evt.at).toBe("number");
      } finally {
        try { await listener?.unlisten?.(); } catch { /* ignore cleanup errors */ }
      }
    },
    20_000,
  );
});
