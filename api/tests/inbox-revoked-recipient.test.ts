/** Revoked identities must not receive local inbox mail or expose mailbox keys.
 *  Matches the federated recipient_not_found refusal in
 *  src/routes/federation/inbox.ts:105-118; memorial local behaviour stays intact.
 *  Hermetic: real Drizzle SQL generation over a pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const RECIPIENT = "aaaaaaaa-0000-4000-8000-000000000001";
const SENDER = "aaaaaaaa-0000-4000-8000-000000000002";
const BOX_KEY = "bbbbbbbb-0000-4000-8000-000000000001";
const SIGNING_KEY = "cccccccc-0000-4000-8000-000000000001";
const MESSAGE = "dddddddd-0000-4000-8000-000000000001";
const RECIPIENT_DID = `did:at:${RECIPIENT}`;
const SENDER_DID = `did:at:${SENDER}`;
const WHEN = "2026-10-19T00:00:00.000Z";
const BOX_PUBLIC_KEY = Buffer.alloc(32, 3).toString("base64");
const privateKey = ed.utils.randomPrivateKey();
const signingPublicKey = Buffer.from(await ed.getPublicKeyAsync(privateKey)).toString("base64");

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];
let recipientStatus: "active" | "revoked" | "memorial" = "active";

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  // Positional rows follow the selected fields in each store lookup.
  if (sql.includes('from "identity"."identities"')) {
    if (sql.includes('inner join "identity"."identity_box_keys"')) {
      // Emulate a database honouring the bound identity-status exclusion.
      const predicate = sql.match(/"identity"\."identities"\."status" <> \$(\d+)/);
      if (predicate && recipientStatus === params[Number(predicate[1]) - 1]) {
        return { rows: [] };
      }
      return { rows: [[RECIPIENT, RECIPIENT_DID, BOX_KEY, BOX_PUBLIC_KEY]] };
    }
    if (sql.includes('"identity"."identities"."did" = $')) {
      const row = [RECIPIENT, RECIPIENT_DID, PROJECT];
      // The baseline select has no status column; the repaired select does.
      if (sql.slice(0, sql.indexOf(" from ")).includes('"status"')) {
        row.push(recipientStatus);
      }
      return { rows: [row] };
    }
    if (sql.includes('"identity"."identities"."id" = $')) {
      return { rows: [[SENDER_DID, PROJECT, "active"]] };
    }
  }
  if (sql.includes('from "identity"."identity_box_keys"')) {
    return { rows: [[BOX_KEY, RECIPIENT, true]] };
  }
  if (sql.includes('from "identity"."identity_keys"')) {
    return { rows: [[SIGNING_KEY, signingPublicKey, true, SENDER]] };
  }
  if (sql.startsWith('insert into "inbox"."messages"')) {
    return { rows: [[MESSAGE, WHEN]] };
  }
  // No federation settings; notification statements need no returned rows.
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

const { sendMessage, lookupActiveBoxKey } = await import("../src/services/inbox/store");
const { canonicalInboxBytes } = await import("../src/services/inbox/sig");
const { default: lookupRouter } = await import("../src/routes/inbox/lookup");

async function signedInput() {
  const ciphertext = Buffer.from("test envelope").toString("base64");
  const nonce = Buffer.alloc(12, 1).toString("base64");
  const ephemeralPubkey = Buffer.alloc(32, 2).toString("base64");
  const signature = await ed.signAsync(canonicalInboxBytes({
    recipientDid: RECIPIENT_DID,
    ciphertextB64: ciphertext,
    nonceB64: nonce,
    ephemeralPubkeyB64: ephemeralPubkey,
  }), privateKey);
  return {
    to_did: RECIPIENT_DID,
    ciphertext,
    nonce,
    ephemeral_pubkey: ephemeralPubkey,
    recipient_box_key_id: BOX_KEY,
    signature: Buffer.from(signature).toString("base64"),
    signing_key_id: SIGNING_KEY,
    sender_did: SENDER_DID,
  };
}

function messageInserts() {
  return queries.filter((query) => query.sql.startsWith('insert into "inbox"."messages"'));
}

beforeEach(() => {
  queries = [];
  recipientStatus = "active";
});

describe("sendMessage recipient status", () => {
  test("active recipient receives the local message", async () => {
    const result = await sendMessage(PROJECT, await signedInput());
    expect(result).toEqual({ id: MESSAGE, created_at: WHEN });
    expect(messageInserts()).toHaveLength(1);
  });

  test("revoked recipient refuses before box-key lookup, insertion or notification", async () => {
    recipientStatus = "revoked";
    await expect(sendMessage(PROJECT, await signedInput())).rejects.toThrow("recipient_not_found");
    expect(messageInserts()).toHaveLength(0);
    expect(queries.some((query) => query.sql.includes('"identity_box_keys"'))).toBe(false);
    const recipientLookup = queries.findIndex((query) =>
      query.sql.includes('from "identity"."identities"') &&
      query.sql.includes('"identity"."identities"."did" = $'),
    );
    expect(recipientLookup).toBeGreaterThanOrEqual(0);
    // Neither arrival NOTIFY nor the wake-version bump/NOTIFY may follow.
    expect(queries.slice(recipientLookup + 1)).toEqual([]);
  });

  test("memorial recipient keeps local delivery", async () => {
    recipientStatus = "memorial";
    const result = await sendMessage(PROJECT, await signedInput());
    expect(result).toEqual({ id: MESSAGE, created_at: WHEN });
    expect(messageInserts()).toHaveLength(1);
  });
});

describe("lookupActiveBoxKey recipient status", () => {
  test("excludes revoked identities in SQL and returns null", async () => {
    recipientStatus = "revoked";
    const result = await lookupActiveBoxKey(RECIPIENT_DID);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"identity"."identities"."status" <> $');
    expect(queries[0].params).toContain("revoked");
    expect(result).toBeNull();
  });

  for (const status of ["active", "memorial"] as const) {
    test(`${status} identity keeps its active box key`, async () => {
      recipientStatus = status;
      expect(await lookupActiveBoxKey(RECIPIENT_DID)).toEqual({
        identity_id: RECIPIENT,
        did: RECIPIENT_DID,
        box_key_id: BOX_KEY,
        public_key: BOX_PUBLIC_KEY,
      });
    });
  }
});

test("GET /v1/inbox/box-keys/:did returns 404 for a revoked identity", async () => {
  recipientStatus = "revoked";
  const app = new Hono();
  app.route("/v1/inbox/box-keys", lookupRouter);
  const response = await app.request(`/v1/inbox/box-keys/${RECIPIENT_DID}`);
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("no_active_box_key_for_did");
});
