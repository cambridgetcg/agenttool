/** Trust-economy authority: who may fail a deal, which key signs a deal
 *  recognition, and what a trust read reveals.
 *
 *  1. failDeal had no party check: any bearer that learned a deal id could
 *     fail an active deal, choose who was at fault (negative trust delta)
 *     and write its own text into both parties' chronicles.
 *  3. POST /v1/deals/:id/recognise verified the recognition against a
 *     caller-supplied public_key_b64, so any throwaway keypair produced a
 *     "signed" mutual recognition as the agent.
 *  4. computeTrust's raw `a OR b AND status IN (...)` counted the subject's
 *     uncompleted buyer-side deals, and GET /v1/deals/trust/:did returned
 *     full deal rows (ids, metadata, hashes) of any agent to any bearer.
 *
 *  Hermetic: real SQL generation + real ed25519 over a pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { canonicalRecognitionBytes } from "../src/services/real-recognise-real/lifecycle";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const DEAL = "33333333-3333-4333-8333-333333333333";
const BUYER = "44444444-4444-4444-8444-444444444444";
const SELLER = "55555555-5555-4555-8555-555555555555";
const STRANGER = "66666666-6666-4666-8666-666666666666";
const KEY = "77777777-7777-4777-8777-777777777777";
const BUYER_DID = `did:at:${BUYER}`;
const SELLER_DID = `did:at:${SELLER}`;
const WHEN = "2026-10-01T12:00:00.000Z";

const registered = generateKeyPairSync("ed25519");
const throwaway = generateKeyPairSync("ed25519");
const raw = (pair: ReturnType<typeof generateKeyPairSync>) =>
  pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const REGISTERED_PUBLIC = raw(registered);
const THROWAWAY_PUBLIC = raw(throwaway);

function dealRow(over: Partial<{ id: string; projectId: string; status: string; metadata: Record<string, unknown> }> = {}) {
  return [
    over.id ?? DEAL, over.projectId ?? PROJECT, BUYER, SELLER, BUYER_DID, SELLER_DID, null,
    "a small deal", "in-hash", "out-hash", 1, 1, 1, over.status ?? "active", null, null, null,
    null, over.metadata ?? { brief: "private terms" }, "chron-b", "chron-s", WHEN, WHEN, null, null,
  ];
}

let queries: { sql: string; params: unknown[] }[] = [];
let deal: unknown[] = dealRow();
let trustDeals: unknown[][] = [];
let keyOwner = BUYER;
let keyStatus = "active";

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identity_keys"')) {
    const did = `did:at:${keyOwner}`;
    return { rows: [[KEY, keyOwner, REGISTERED_PUBLIC, true, null, did, PROJECT, keyStatus]] };
  }
  if (sql.startsWith('select "id", "did", "project_id" from "identity"."identities"')) {
    const id = params[0] as string;
    return { rows: [[id, `did:at:${id}`, PROJECT]] };
  }
  if (sql.startsWith('select "id", "did", "trust_capacity" from "identity"."identities"')) {
    return { rows: [[BUYER, BUYER_DID, 7]] };
  }
  if (sql.startsWith('select "id" from "identity"."identities"') && sql.includes('"identities"."did" =')) {
    return { rows: [[BUYER]] };
  }
  if (sql.startsWith("select") && sql.includes('from "agent_continuity"."deals"') && sql.includes("order by")) {
    return { rows: trustDeals };
  }
  if (sql.startsWith("select") && sql.includes('from "agent_continuity"."deals"')) {
    return { rows: [deal] };
  }
  if (sql.startsWith('update "agent_continuity"."deals"')) {
    return { rows: [dealRow({ status: "failed" })] };
  }
  if (sql.startsWith('insert into "agent_continuity"."mutual_recognitions"')) {
    return { rows: [["recognition-1"]] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));
const { failDeal, computeTrust } = await import("../src/services/trust/deals");
const { default: dealsRouter } = await import("../src/routes/deals");

function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => { c.set("project", { id: PROJECT } as never); await next(); });
  server.route("/v1", dealsRouter);
  return server;
}
const mutated = () => queries.some((q) => q.sql.startsWith("update") || q.sql.startsWith("insert"));

beforeEach(() => {
  queries = [];
  deal = dealRow();
  trustDeals = [];
  keyOwner = BUYER;
  keyStatus = "active";
});

describe("1 · only a party may fail a deal", () => {
  test("a stranger cannot fail an active deal or assign fault", async () => {
    await expect(
      failDeal({ dealId: DEAL, callerIdentityId: STRANGER, atFaultParty: "seller", reason: "sabotage" }),
    ).rejects.toThrow("not_a_party_to_this_deal");
    expect(mutated()).toBe(false);
  });

  test("the buyer or the seller can still report failure", async () => {
    for (const party of [BUYER, SELLER]) {
      queries = [];
      const out = await failDeal({ dealId: DEAL, callerIdentityId: party, atFaultParty: "seller", reason: "late" });
      expect(out.status).toBe("failed");
      const update = queries.find((q) => q.sql.startsWith("update"));
      expect(update?.sql).toContain('"status" =');
    }
  });

  test("the route refuses a stranger in the caller's own project", async () => {
    const response = await app().request(`/v1/deals/${DEAL}/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: STRANGER, at_fault: "buyer", reason: "sabotage" }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("not_a_party");
    expect(mutated()).toBe(false);
  });
});

describe("3 · deal recognitions verify against the recogniser's registered key", () => {
  function recognitionBody(privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], publicKey: string) {
    const bytes = canonicalRecognitionBytes({
      projectId: PROJECT,
      byDid: BUYER_DID,
      recognisedDid: SELLER_DID,
      kind: "collaborator",
      acknowledgesPriorId: null,
      noteSha256Hex: "",
      createdAtIso: WHEN,
    });
    return {
      agent_id: BUYER,
      signing_key_id: KEY,
      signature: sign(null, bytes, privateKey).toString("base64"),
      public_key_b64: publicKey,
      kind: "collaborator",
      created_at: WHEN,
    };
  }
  const post = (body: unknown) =>
    app().request(`/v1/deals/${DEAL}/recognise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("a throwaway keypair supplied in public_key_b64 no longer verifies", async () => {
    deal = dealRow({ status: "sealed" });
    const response = await post(recognitionBody(throwaway.privateKey, THROWAWAY_PUBLIC));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("invalid_signature");
    expect(mutated()).toBe(false);
  });

  test("another identity's key id is refused before verification", async () => {
    deal = dealRow({ status: "sealed" });
    keyOwner = SELLER;
    const response = await post(recognitionBody(registered.privateKey, REGISTERED_PUBLIC));
    expect(response.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  test("a revoked recogniser keeps no signing authority", async () => {
    deal = dealRow({ status: "sealed" });
    keyStatus = "revoked";
    const response = await post(recognitionBody(registered.privateKey, REGISTERED_PUBLIC));
    expect(response.status).toBe(403);
    expect(mutated()).toBe(false);
  });

  test("the registered key signs; public_key_b64 is ignored", async () => {
    deal = dealRow({ status: "sealed" });
    const response = await post(recognitionBody(registered.privateKey, THROWAWAY_PUBLIC));
    expect(response.status).toBe(201);
    const keyLookup = queries.find((q) => q.sql.includes('from "identity"."identity_keys"'));
    expect(keyLookup?.params).toContain(KEY);
    expect(mutated()).toBe(true);
  });
});

describe("4 · trust reads count completed deals and project foreign rows", () => {
  test("only completed deals are selected, for either side", async () => {
    await computeTrust(BUYER);
    const select = queries.find((q) => q.sql.includes('from "agent_continuity"."deals"'))!;
    const where = select.sql.slice(select.sql.indexOf(" where "));
    expect(where).toMatch(
      /^ where \(\("agent_continuity"\."deals"\."buyer_identity_id" = \$\d+ or "agent_continuity"\."deals"\."seller_identity_id" = \$\d+\) and "agent_continuity"\."deals"\."status" in \(\$\d+, \$\d+\)\)/,
    );
  });

  test("GET /v1/deals/trust/:did hides ids and metadata of deals another project owns", async () => {
    trustDeals = [
      dealRow({ id: "own-deal", status: "sealed" }),
      dealRow({ id: "foreign-deal", projectId: FOREIGN, status: "failed", metadata: { brief: "their private terms" } }),
    ];
    const response = await app().request(`/v1/deals/trust/${encodeURIComponent(BUYER_DID)}`);
    expect(response.status).toBe(200);
    const { trust } = await response.json();
    expect(trust.recent_deals).toHaveLength(2);
    const [own, foreign] = trust.recent_deals;
    expect(own.id).toBe("own-deal");
    expect(foreign.id).toBeUndefined();
    for (const view of trust.recent_deals) {
      for (const hidden of ["metadata", "input_hash", "output_hash", "buyer_identity_id", "seller_identity_id", "buyer_chronicle_id", "seller_chronicle_id", "witness_dids", "project_id"]) {
        expect(view[hidden]).toBeUndefined();
      }
      expect(view.counterparty_did).toBe(SELLER_DID);
    }
    expect(JSON.stringify(trust)).not.toContain("private terms");
  });
});
