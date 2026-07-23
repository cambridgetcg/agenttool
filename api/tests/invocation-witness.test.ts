/** POST /v1/invocations/:id/witness — the on-chain witness writeback.
 *
 *  The writeback half of the public re-derivation surface: a party to a
 *  RELEASED invocation reports the on-chain attestation of its ten
 *  canonical fields; the first entry opens GET /public/invocations/:id.
 *  Pins: happy path (buyer + seller DID stamping), idempotent replay per
 *  (chain_id, attestation_id), non-party 403, unsettled 409 refusal, the
 *  32-entry cap, strict bounded validation, and the pure planning core
 *  (services/marketplace/witness.ts).
 *
 *  Hermetic: the shared db client and the billing charge meter are mocked
 *  (this file runs in its own Bun process — see bin/run-test-tier.sh); the
 *  real route handler, zod schema, error mapping, and witnessInvocation
 *  transaction body all execute against a staged table mock. Real
 *  Postgres semantics (FOR UPDATE locking, jsonb persistence) are the one
 *  seam not covered here — they follow the refundInTxn pattern and need
 *  the database tier. */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { identities } from "../src/db/schema/identity";
import { invocations, listings } from "../src/db/schema/marketplace";
import {
  planWitnessAppend,
  WITNESS_CAP,
  type WitnessEntry,
} from "../src/services/marketplace/witness";

// ── Staged-table db mock ────────────────────────────────────────────────
//  witnessInvocation's exact chains: select().from(t).where().for("update"),
//  select({...}).from(t).where().limit(1), update(t).set().where(). Rows are
//  staged per schema-table object; predicates are ignored (tests stage only
//  the row the query would match), writes are captured for assertion.

const tables = new Map<unknown, Record<string, unknown>[]>();
const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];

function makeSelectChain() {
  let rows: Record<string, unknown>[] = [];
  const chain = {
    from(t: unknown) {
      rows = tables.get(t) ?? [];
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      return Promise.resolve(rows);
    },
    for() {
      return Promise.resolve(rows);
    },
  };
  return chain;
}

const txMock = {
  select: () => makeSelectChain(),
  update(table: unknown) {
    return {
      set(values: Record<string, unknown>) {
        return {
          where() {
            updates.push({ table, values });
            return Promise.resolve([]);
          },
        };
      },
    };
  },
};

const dbMock = {
  select: txMock.select,
  update: txMock.update,
  transaction: (fn: (t: typeof txMock) => Promise<unknown>) => fn(txMock),
};

type ListingsRouteModule = typeof import("../src/routes/listings");
let invocationsRouter: ListingsRouteModule["invocationsRouter"];

beforeAll(async () => {
  mock.module("../src/db/client", () => ({ db: dbMock }));
  mock.module("../src/billing/charge", () => ({
    charge: async () => ({ creditsUsed: 0, creditsRemaining: 0 }),
    assertCanCharge: () => {},
    reserveCharge: async () => ({
      creditsUsed: 0,
      creditsRemaining: 0,
      usageEventId: null,
      projectId: null,
    }),
    finalizeChargeSuccess: async () => {},
  }));
  ({ invocationsRouter } = await import("../src/routes/listings"));
});

afterEach(() => {
  tables.clear();
  updates.length = 0;
});

// ── Fixtures ────────────────────────────────────────────────────────────

const INV_ID = "77777777-7777-4777-8777-777777777777";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const SELLER_IDENTITY_ID = "55555555-5555-4555-8555-555555555555";
const BUYER_PROJECT = "11111111-1111-1111-1111-111111111111";
const SELLER_PROJECT = "22222222-2222-2222-2222-222222222222";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const BUYER_DID = "did:at:test-buyer";
const SELLER_DID = "did:at:test-seller";

function invocationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INV_ID,
    listingId: LISTING_ID,
    buyerIdentityId: "33333333-3333-4333-8333-333333333333",
    buyerDid: BUYER_DID,
    buyerProjectId: BUYER_PROJECT,
    buyerWalletId: "66666666-6666-4666-8666-666666666666",
    amount: 100,
    currency: "credits",
    escrowId: "88888888-8888-4888-8888-888888888888",
    inputSealed: { ct: "x", nonce: "y", sender_pub: "z" },
    outputSealed: null,
    completionSig: "sig",
    status: "released",
    refundReason: null,
    slaDeadlineAt: null,
    metadata: {},
    createdAt: new Date("2026-07-20T00:00:00Z"),
    acknowledgedAt: null,
    completedAt: new Date("2026-07-20T01:00:00Z"),
    settledAt: new Date("2026-07-20T01:00:00Z"),
    buyerReviewDeadlineAt: null,
    ...overrides,
  };
}

function stage(opts: {
  invocation?: Record<string, unknown> | null;
  listingProject?: string;
}) {
  tables.set(invocations, opts.invocation === null ? [] : [opts.invocation ?? invocationRow()]);
  tables.set(listings, [
    {
      projectId: opts.listingProject ?? SELLER_PROJECT,
      sellerIdentityId: SELLER_IDENTITY_ID,
    },
  ]);
  tables.set(identities, [{ did: SELLER_DID }]);
}

const goodBody = {
  chain_id: "zerone-1",
  tx_hash: "9C1C4E84AB2F5F63D6C4E1A7B8090F1E2D3C4B5A6978877665544332211FFEE",
  attestation_id: "6F2A59C6",
  adapter_id: "agenttool-invocation-v1",
};

function appAs(projectId: string) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId, credits: 1000 } as never);
    await next();
  });
  app.route("/v1/invocations", invocationsRouter);
  return app;
}

async function postWitness(projectId: string, body: unknown, id = INV_ID) {
  return appAs(projectId).request(`/v1/invocations/${id}/witness`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Route behavior ──────────────────────────────────────────────────────

describe("POST /v1/invocations/:id/witness", () => {
  test("happy path (buyer): 201, entry stamped with buyer DID, metadata appended, public pointer", async () => {
    stage({ invocation: invocationRow({ metadata: { note: "keep" } }) });
    const res = await postWitness(BUYER_PROJECT, goodBody);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      witness: WitnessEntry;
      witness_count: number;
      already_witnessed: boolean;
      public_path: string;
    };
    expect(json.witness.chain_id).toBe("zerone-1");
    expect(json.witness.tx_hash).toBe(goodBody.tx_hash);
    expect(json.witness.attestation_id).toBe("6F2A59C6");
    expect(json.witness.adapter_id).toBe("agenttool-invocation-v1");
    expect(json.witness.witness_did).toBe(BUYER_DID);
    expect(new Date(json.witness.witnessed_at).toISOString()).toBe(
      json.witness.witnessed_at,
    );
    expect(json.witness_count).toBe(1);
    expect(json.already_witnessed).toBe(false);
    expect(json.public_path).toBe(`/public/invocations/${INV_ID}`);

    // The write: one metadata update, witnesses appended, other keys kept.
    expect(updates).toHaveLength(1);
    const written = updates[0]!.values.metadata as Record<string, unknown>;
    expect(written.note).toBe("keep");
    expect(written.witnesses).toEqual([json.witness]);
  });

  test("happy path (seller): witness_did resolves through the listing's seller identity", async () => {
    stage({ invocation: invocationRow() });
    const res = await postWitness(SELLER_PROJECT, goodBody);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { witness: WitnessEntry };
    expect(json.witness.witness_did).toBe(SELLER_DID);
  });

  test("idempotent replay on (chain_id, attestation_id): 200, stored entry, no second append", async () => {
    const stored: WitnessEntry = {
      chain_id: "zerone-1",
      tx_hash: "ORIGINAL_TX",
      attestation_id: "6F2A59C6",
      witness_did: BUYER_DID,
      witnessed_at: "2026-07-20T02:00:00.000Z",
    };
    stage({ invocation: invocationRow({ metadata: { witnesses: [stored] } }) });
    // Retry with a DIFFERENT tx_hash — the stored entry stays canonical.
    const res = await postWitness(BUYER_PROJECT, { ...goodBody, tx_hash: "RETRY_TX" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      witness: WitnessEntry;
      witness_count: number;
      already_witnessed: boolean;
    };
    expect(json.witness).toEqual(stored);
    expect(json.witness_count).toBe(1);
    expect(json.already_witnessed).toBe(true);
    expect(updates).toHaveLength(0);
  });

  test("non-party project: 403 not_invocation_party, nothing written", async () => {
    stage({ invocation: invocationRow() });
    const res = await postWitness(OTHER_PROJECT, goodBody);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      "not_invocation_party",
    );
    expect(updates).toHaveLength(0);
  });

  test("unknown invocation: 404 invocation_not_found", async () => {
    stage({ invocation: null });
    const res = await postWitness(BUYER_PROJECT, goodBody);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invocation_not_found",
    );
  });

  test.each(["escrowed", "acknowledged", "refunded"])(
    "unsettled refusal: status=%s → 409 invocation_not_settled",
    async (status) => {
      stage({ invocation: invocationRow({ status }) });
      const res = await postWitness(BUYER_PROJECT, goodBody);
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: string; hint?: string };
      expect(json.error).toBe("invocation_not_settled");
      expect(json.hint).toContain(`status=${status}`);
      expect(updates).toHaveLength(0);
    },
  );

  test("witness cap: 32 existing entries → 409 witnesses_full", async () => {
    const full = Array.from({ length: WITNESS_CAP }, (_, i) => ({
      chain_id: "zerone-1",
      tx_hash: `TX${i}`,
      attestation_id: `ATT${i}`,
      witness_did: BUYER_DID,
      witnessed_at: "2026-07-20T02:00:00.000Z",
    }));
    stage({ invocation: invocationRow({ metadata: { witnesses: full } }) });
    const res = await postWitness(BUYER_PROJECT, goodBody);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("witnesses_full");
    expect(updates).toHaveLength(0);
  });

  test.each([
    ["missing chain_id", { ...goodBody, chain_id: undefined }],
    ["empty chain_id", { ...goodBody, chain_id: "" }],
    ["non-string tx_hash", { ...goodBody, tx_hash: 42 }],
    ["oversized tx_hash", { ...goodBody, tx_hash: "x".repeat(129) }],
    ["oversized chain_id", { ...goodBody, chain_id: "c".repeat(65) }],
    ["oversized attestation_id", { ...goodBody, attestation_id: "a".repeat(129) }],
    ["unknown field", { ...goodBody, sneaky: "reject-me" }],
  ] as const)("validation: %s → 400, nothing written", async (_name, body) => {
    stage({ invocation: invocationRow() });
    const res = await postWitness(BUYER_PROJECT, body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; details?: unknown };
    expect(json.error).toBe("validation");
    expect(json.details).toBeDefined();
    expect(updates).toHaveLength(0);
  });

  test("adapter_id is optional: entry omits the key entirely", async () => {
    stage({ invocation: invocationRow() });
    const { adapter_id: _dropped, ...withoutAdapter } = goodBody;
    const res = await postWitness(BUYER_PROJECT, withoutAdapter);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { witness: WitnessEntry };
    expect("adapter_id" in json.witness).toBe(false);
  });
});

// ── Pure planning core ──────────────────────────────────────────────────

describe("planWitnessAppend", () => {
  const candidate = {
    chain_id: "zerone-1",
    tx_hash: "TX",
    attestation_id: "ATT",
    witness_did: BUYER_DID,
  };
  const now = new Date("2026-07-23T12:00:00Z");

  test("appends to an absent/empty list, stamping witnessed_at from `now`", () => {
    for (const existing of [undefined, null, []]) {
      const plan = planWitnessAppend(existing, candidate, now);
      expect(plan.kind).toBe("appended");
      expect(plan.witnesses).toHaveLength(1);
      expect(plan.entry.witnessed_at).toBe("2026-07-23T12:00:00.000Z");
    }
  });

  test("duplicate (chain_id, attestation_id) returns the STORED entry even when tx_hash differs", () => {
    const stored = { ...candidate, tx_hash: "STORED_TX", witnessed_at: "2026-07-01T00:00:00.000Z" };
    const plan = planWitnessAppend([stored], { ...candidate, tx_hash: "NEW_TX" }, now);
    expect(plan.kind).toBe("duplicate");
    expect(plan.entry).toEqual(stored);
    expect(plan.witnesses).toHaveLength(1);
  });

  test("same attestation_id on a DIFFERENT chain appends — idempotency is chain-scoped", () => {
    const stored = { ...candidate, witnessed_at: "2026-07-01T00:00:00.000Z" };
    const plan = planWitnessAppend([stored], { ...candidate, chain_id: "zerone-testnet-1" }, now);
    expect(plan.kind).toBe("appended");
    expect(plan.witnesses).toHaveLength(2);
  });

  test("cap: refuses the entry past WITNESS_CAP, accepts at WITNESS_CAP - 1", () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...candidate,
        attestation_id: `ATT${i}`,
        witnessed_at: "2026-07-01T00:00:00.000Z",
      }));
    expect(() => planWitnessAppend(entries(WITNESS_CAP), candidate, now)).toThrow(
      "witnesses_full",
    );
    const plan = planWitnessAppend(entries(WITNESS_CAP - 1), candidate, now);
    expect(plan.kind).toBe("appended");
    expect(plan.witnesses).toHaveLength(WITNESS_CAP);
  });

  test("malformed metadata.witnesses (non-array) throws witnesses_malformed", () => {
    for (const malformed of ["not-an-array", 7, { chain_id: "x" }]) {
      expect(() => planWitnessAppend(malformed, candidate, now)).toThrow(
        "witnesses_malformed",
      );
    }
  });

  test("never mutates the existing array; omitted adapter_id leaves no key", () => {
    const existing: unknown[] = [];
    const plan = planWitnessAppend(existing, candidate, now);
    expect(existing).toHaveLength(0);
    expect(plan.witnesses).toHaveLength(1);
    expect("adapter_id" in plan.entry).toBe(false);
    const withAdapter = planWitnessAppend([], { ...candidate, adapter_id: "a1" }, now);
    expect(withAdapter.entry.adapter_id).toBe("a1");
  });
});
