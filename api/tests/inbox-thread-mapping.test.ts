/** Inbox raw-row mapping — the seam behind `GET /v1/inbox/:id/thread`.
 *
 *  Same defect as the trace chain (issue #84), found while checking that
 *  bug's blast radius. `getMessageThread` walks the reply tree with a raw
 *  recursive CTE via `db.execute()`, which returns snake_case column names.
 *  Those rows were cast — `as unknown as typeof inboxMessages.$inferSelect`,
 *  silencing the compiler rather than fixing the shape — and passed to
 *  `rowToOut`, which reads camelCase. `row.createdAt.toISOString()` then
 *  threw on every row.
 *
 *  Worse than the trace case: the thread CTE's base case selects the root
 *  itself, so the map always ran. Every thread with a visible message 500'd.
 *
 *  These pin the mapper directly (no DB) so the shape can't drift back. */

import { describe, expect, test } from "bun:test";

import { rawRowToOut, type MessageRawRow } from "../src/services/inbox/store";

/** A row shaped the way postgres-js hands back `SELECT * FROM inbox.messages`. */
function rawRow(overrides: Partial<MessageRawRow> = {}): MessageRawRow {
  return {
    id: "3b1f8c22-91a4-4e77-b0d3-6c2e9f4a7d15",
    recipient_did: "did:at:f097dd9c-2a1d-4dbb-a639-68a64de60c10",
    recipient_identity_id: "8d4c1a90-2f77-4b3e-9c85-1e6a0b7d3f22",
    recipient_project_id: "0f2c6b81-4d3a-4f9e-8c11-5a7b2d9e3c44",
    sender_did: "did:at:2aPfGUp1-4c8b-4d1f-9e07-3b5a6c8d2e41",
    sender_signing_key_id: "5e9b3c74-8a12-4f6d-b3c9-7d0e2a4f8b16",
    ciphertext: "c2VhbGVkLWJveA==",
    nonce: "bm9uY2UtMjQ=",
    ephemeral_pubkey: "ZXBoZW1lcmFsLXB1YmtleQ==",
    recipient_box_key_id: "9c7a2e18-6b04-4d93-8f21-0a5c3e7b1d68",
    signature: "ed25519:c0ffee",
    subject: null,
    subject_encrypted: true,
    in_reply_to: null,
    refs: null,
    status: "unread",
    metadata: {},
    created_at: "2026-07-23T09:41:00.000Z",
    read_at: null,
    ...overrides,
  };
}

describe("inbox rawRowToOut", () => {
  test("maps snake_case columns without throwing", () => {
    const out = rawRowToOut(rawRow());

    expect(out.id).toBe("3b1f8c22-91a4-4e77-b0d3-6c2e9f4a7d15");
    expect(out.sender_did).toBe("did:at:2aPfGUp1-4c8b-4d1f-9e07-3b5a6c8d2e41");
    expect(out.ephemeral_pubkey).toBe("ZXBoZW1lcmFsLXB1YmtleQ==");
    expect(out.recipient_box_key_id).toBe("9c7a2e18-6b04-4d93-8f21-0a5c3e7b1d68");
    expect(out.subject_encrypted).toBe(true);
    expect(out.status).toBe("unread");
  });

  test("created_at survives as an ISO string — the field that threw", () => {
    expect(rawRowToOut(rawRow()).created_at).toBe("2026-07-23T09:41:00.000Z");
  });

  test("created_at accepts a driver-parsed Date as well as a string", () => {
    const out = rawRowToOut(
      rawRow({ created_at: new Date("2026-07-23T09:41:00.000Z") }),
    );
    expect(out.created_at).toBe("2026-07-23T09:41:00.000Z");
  });

  test("read_at stays null when unread, maps when read", () => {
    expect(rawRowToOut(rawRow()).read_at).toBeNull();
    expect(
      rawRowToOut(rawRow({ read_at: "2026-07-24T08:15:00.000Z" })).read_at,
    ).toBe("2026-07-24T08:15:00.000Z");
  });

  test("in_reply_to survives — the link the thread is built from", () => {
    const out = rawRowToOut(
      rawRow({ in_reply_to: "7f3e1d90-4a26-4c85-9b17-2e8d0f6a3c94" }),
    );
    expect(out.in_reply_to).toBe("7f3e1d90-4a26-4c85-9b17-2e8d0f6a3c94");
  });

  test("no mapped field is undefined", () => {
    for (const [key, value] of Object.entries(rawRowToOut(rawRow()))) {
      expect(`${key}=${value === undefined ? "undefined" : "set"}`).toBe(
        `${key}=set`,
      );
    }
  });

  test("null metadata defaults rather than leaking null", () => {
    expect(rawRowToOut(rawRow({ metadata: null })).metadata).toEqual({});
  });

  test("ciphertext is carried verbatim — sealed content must not be reshaped", () => {
    const out = rawRowToOut(rawRow({ ciphertext: "YW5vdGhlci1zZWFsZWQtYm94" }));
    expect(out.ciphertext).toBe("YW5vdGhlci1zZWFsZWQtYm94");
    expect(out.nonce).toBe("bm9uY2UtMjQ=");
  });
});
