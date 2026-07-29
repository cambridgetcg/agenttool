/** POST /v1/invocations/:id/witness — party-reported chain reference.
 *
 *  Pins the authenticated buyer/seller route, released-only gate,
 *  idempotency key, bounded public-safe fields, metadata preservation,
 *  public ten-field re-derivation projection, and the pure planner.
 *
 *  Hermetic: the shared DB client and credit meter are mocked. Real
 *  Postgres FOR UPDATE/jsonb behavior remains a database-tier seam. */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { MARKETPLACE_PRICING } from "../src/billing/marketplace-pricing";
import { identities } from "../src/db/schema/identity";
import { invocations, listings } from "../src/db/schema/marketplace";
import {
  parseWitnessEntries,
  planWitnessAppend,
  WITNESS_CAP,
  WITNESS_DID_MAX_LENGTH,
  WITNESS_ENTRY_SCHEMA,
  type WitnessEntry,
} from "../src/services/marketplace/witness";

const tables = new Map<unknown, Record<string, unknown>[]>();
const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
let selectCalls = 0;

function makeSelectChain() {
  let rows: Record<string, unknown>[] = [];
  const chain = {
    from(table: unknown) {
      rows = tables.get(table) ?? [];
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
  select: () => {
    selectCalls++;
    return makeSelectChain();
  },
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
  transaction: (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
};

type ListingsRouteModule = typeof import("../src/routes/listings");
type PublicInvocationsModule = typeof import("../src/routes/public/invocations");
let listingsRouter: ListingsRouteModule["default"];
let invocationsRouter: ListingsRouteModule["invocationsRouter"];
let publicInvocationsRouter: PublicInvocationsModule["default"];

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
  ({ default: listingsRouter, invocationsRouter } = await import(
    "../src/routes/listings"
  ));
  ({ default: publicInvocationsRouter } = await import(
    "../src/routes/public/invocations"
  ));
});

afterEach(() => {
  tables.clear();
  updates.length = 0;
  selectCalls = 0;
});

const INV_ID = "77777777-7777-4777-8777-777777777777";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const SELLER_IDENTITY_ID = "55555555-5555-4555-8555-555555555555";
const BUYER_PROJECT = "11111111-1111-1111-1111-111111111111";
const SELLER_PROJECT = "22222222-2222-4222-8222-222222222222";
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
    completionSig: "completion-signature",
    status: "released",
    refundReason: null,
    slaDeadlineAt: null,
    metadata: {},
    createdAt: new Date("2026-07-20T00:00:00Z"),
    acknowledgedAt: new Date("2026-07-20T00:30:00Z"),
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
  tables.set(
    invocations,
    opts.invocation === null ? [] : [opts.invocation ?? invocationRow()],
  );
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
  attestation_id: "att-2420-1",
  adapter_id: "agenttool-invocation-v1",
};

function storedWitness(
  overrides: Partial<WitnessEntry> = {},
): WitnessEntry {
  return {
    schema: WITNESS_ENTRY_SCHEMA,
    ...goodBody,
    witness_did: BUYER_DID,
    witnessed_at: "2026-07-20T02:00:00.000Z",
    ...overrides,
  };
}

function authenticatedApp(projectId: string) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId, credits: 1_000 } as never);
    await next();
  });
  app.route("/v1/invocations", invocationsRouter);
  return app;
}

function marketplaceApp(projectId: string) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId, credits: 1_000 } as never);
    await next();
  });
  app.route("/v1/listings", listingsRouter);
  return app;
}

async function postWitness(projectId: string, body: unknown, id = INV_ID) {
  return authenticatedApp(projectId).request(
    `/v1/invocations/${id}/witness`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /v1/invocations/:id/witness", () => {
  test("writeback is an explicit zero-credit marketplace action", () => {
    expect(MARKETPLACE_PRICING.witness).toBe(0);
  });

  test("invocation creation cannot pre-populate server-managed witnesses", async () => {
    const response = await marketplaceApp(BUYER_PROJECT).request(
      `/v1/listings/${LISTING_ID}/invoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyer_identity_id: "33333333-3333-4333-8333-333333333333",
          buyer_wallet_id: "66666666-6666-4666-8666-666666666666",
          input_sealed: {
            ct: "eA==",
            nonce: Buffer.alloc(24).toString("base64"),
            sender_pub: Buffer.alloc(32).toString("base64"),
          },
          metadata: {
            witnesses: [
              {
                chain_id: "zerone-1",
                tx_hash: "DEADBEEF",
                attestation_id: "att-forged",
              },
            ],
          },
        }),
      },
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      error: string;
      hint?: string;
    };
    expect(json.error).toBe("invocation_witnesses_reserved");
    expect(json.hint).toContain("server-managed");
    expect(selectCalls).toBe(0);
    expect(updates).toHaveLength(0);
  });

  test("buyer appends a witness, preserves metadata, and receives the public pointer", async () => {
    stage({ invocation: invocationRow({ metadata: { note: "keep" } }) });
    const response = await postWitness(BUYER_PROJECT, goodBody);

    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      witness: WitnessEntry;
      witness_count: number;
      already_witnessed: boolean;
      public_path: string;
    };
    expect(json.witness).toMatchObject({
      schema: WITNESS_ENTRY_SCHEMA,
      chain_id: goodBody.chain_id,
      tx_hash: goodBody.tx_hash,
      attestation_id: goodBody.attestation_id,
      adapter_id: goodBody.adapter_id,
      witness_did: BUYER_DID,
    });
    expect(new Date(json.witness.witnessed_at).toISOString()).toBe(
      json.witness.witnessed_at,
    );
    expect(json.witness_count).toBe(1);
    expect(json.already_witnessed).toBe(false);
    expect(json.public_path).toBe(`/public/invocations/${INV_ID}`);

    expect(updates).toHaveLength(1);
    const written = updates[0]!.values.metadata as Record<string, unknown>;
    expect(written.note).toBe("keep");
    expect(written.witnesses).toEqual([json.witness]);
  });

  test("seller party resolves and stamps the listing identity DID", async () => {
    stage({});
    const response = await postWitness(SELLER_PROJECT, goodBody);
    expect(response.status).toBe(201);
    const json = (await response.json()) as { witness: WitnessEntry };
    expect(json.witness.witness_did).toBe(SELLER_DID);
  });

  test("same chain and attestation is an idempotent replay of the stored entry", async () => {
    const stored = storedWitness({
      tx_hash: "0123456789ABCDEF",
    });
    stage({ invocation: invocationRow({ metadata: { witnesses: [stored] } }) });

    const response = await postWitness(BUYER_PROJECT, {
      ...goodBody,
      tx_hash: "FEDCBA9876543210",
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      witness: WitnessEntry;
      witness_count: number;
      already_witnessed: boolean;
    };
    expect(json.witness).toEqual(stored);
    expect(json.witness_count).toBe(1);
    expect(json.already_witnessed).toBe(true);
    expect(updates).toHaveLength(0);
  });

  test("non-party project is refused before any metadata write", async () => {
    stage({});
    const response = await postWitness(OTHER_PROJECT, goodBody);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe(
      "not_invocation_party",
    );
    expect(updates).toHaveLength(0);
  });

  test("unknown invocation returns the stable not-found code", async () => {
    stage({ invocation: null });
    const response = await postWitness(BUYER_PROJECT, goodBody);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe(
      "invocation_not_found",
    );
  });

  test.each(["escrowed", "acknowledged", "refunded"])(
    "status=%s is not witnessable",
    async (status) => {
      stage({ invocation: invocationRow({ status }) });
      const response = await postWitness(BUYER_PROJECT, goodBody);
      expect(response.status).toBe(409);
      const json = (await response.json()) as {
        error: string;
        hint?: string;
      };
      expect(json.error).toBe("invocation_not_settled");
      expect(json.hint).toContain(`status=${status}`);
      expect(updates).toHaveLength(0);
    },
  );

  test("released without settled_at is not witnessable", async () => {
    stage({
      invocation: invocationRow({
        status: "released",
        settledAt: null,
      }),
    });
    const response = await postWitness(BUYER_PROJECT, goodBody);
    expect(response.status).toBe(409);
    const json = (await response.json()) as {
      error: string;
      hint?: string;
    };
    expect(json.error).toBe("invocation_not_settled");
    expect(json.hint).toContain("status=released, settled_at=null");
    expect(updates).toHaveLength(0);
  });

  test("the 32-entry cap is enforced without a write", async () => {
    const full = Array.from({ length: WITNESS_CAP }, (_, index) =>
      storedWitness({
        tx_hash: `${index.toString(16).padStart(2, "0")}AA`,
        attestation_id: `att-${index}`,
      }),
    );
    stage({ invocation: invocationRow({ metadata: { witnesses: full } }) });

    const response = await postWitness(BUYER_PROJECT, goodBody);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(
      "witnesses_full",
    );
    expect(updates).toHaveLength(0);
  });

  test("malformed stored witnesses returns a coded non-retryable integrity fault", async () => {
    stage({
      invocation: invocationRow({ metadata: { witnesses: "corrupt" } }),
    });
    const response = await postWitness(BUYER_PROJECT, goodBody);
    expect(response.status).toBe(500);
    const json = (await response.json()) as {
      error: string;
      hint?: string;
    };
    expect(json.error).toBe("witnesses_malformed");
    expect(json.hint).toContain("Retrying will not help");
    expect(updates).toHaveLength(0);
  });

  test.each([
    [{ chain_id: "zerone-1" }],
    [
      {
        schema: WITNESS_ENTRY_SCHEMA,
        chain_id: "zerone-1",
        tx_hash: "not-hex",
        attestation_id: "att-old",
        witness_did: BUYER_DID,
        witnessed_at: "2026-07-20T02:00:00.000Z",
      },
    ],
    [
      {
        schema: WITNESS_ENTRY_SCHEMA,
        chain_id: "zerone-1",
        tx_hash: "ABCD",
        attestation_id: "att-old",
        witness_did: BUYER_DID,
        witnessed_at: "not-an-instant",
      },
    ],
  ])("malformed stored entry arrays fail closed", async (witnesses) => {
    stage({ invocation: invocationRow({ metadata: { witnesses } }) });
    const response = await postWitness(BUYER_PROJECT, goodBody);
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe(
      "witnesses_malformed",
    );
    expect(updates).toHaveLength(0);
  });

  test.each([
    [
      "an injected extra key",
      { ...storedWitness(), injected: "<script>alert(1)</script>" },
    ],
    [
      "a control character in witness_did",
      storedWitness({ witness_did: "did:at:buyer\nx-injected: yes" }),
    ],
    [
      "an oversized witness_did",
      storedWitness({
        witness_did: `did:at:${"a".repeat(WITNESS_DID_MAX_LENGTH)}`,
      }),
    ],
    [
      "a legacy entry without the schema discriminator",
      (() => {
        const { schema: _schema, ...legacy } = storedWitness();
        return legacy;
      })(),
    ],
    [
      "an unsupported schema discriminator",
      { ...storedWitness(), schema: "agenttool.invocation-witness/2" },
    ],
  ])("stored witness with %s fails closed", async (_name, hostile) => {
    stage({
      invocation: invocationRow({ metadata: { witnesses: [hostile] } }),
    });
    const response = await postWitness(BUYER_PROJECT, goodBody);
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe(
      "witnesses_malformed",
    );
    expect(updates).toHaveLength(0);
  });

  test.each([
    ["missing chain_id", { ...goodBody, chain_id: undefined }],
    ["empty chain_id", { ...goodBody, chain_id: "" }],
    ["non-string tx_hash", { ...goodBody, tx_hash: 42 }],
    ["oversized tx_hash", { ...goodBody, tx_hash: "a".repeat(129) }],
    ["oversized chain_id", { ...goodBody, chain_id: "c".repeat(65) }],
    [
      "oversized attestation_id",
      { ...goodBody, attestation_id: "a".repeat(129) },
    ],
    ["unknown field", { ...goodBody, extra: "reject" }],
    ["unicode chain_id", { ...goodBody, chain_id: "zér☃ne-1" }],
    ["chain_id with space", { ...goodBody, chain_id: "zerone 1" }],
    ["chain_id with newline", { ...goodBody, chain_id: "zerone-1\n" }],
    ["non-hex tx_hash", { ...goodBody, tx_hash: "NOT_HEX_TX" }],
    ["tx_hash with newline", { ...goodBody, tx_hash: "DEADBEEF\n" }],
    ["markup tx_hash", { ...goodBody, tx_hash: "deadbeef<script>" }],
    [
      "markup attestation_id",
      { ...goodBody, attestation_id: "<b>att-1</b>" },
    ],
    ["space in attestation_id", { ...goodBody, attestation_id: "att 1" }],
    ["slash in adapter_id", { ...goodBody, adapter_id: "agenttool/adapter" }],
    ["unicode adapter_id", { ...goodBody, adapter_id: "adaptér-v1" }],
  ] as const)("%s is refused by the public-safe schema", async (_name, body) => {
    stage({});
    const response = await postWitness(BUYER_PROJECT, body);
    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      error: string;
      details?: unknown;
    };
    expect(json.error).toBe("validation");
    expect(json.details).toBeDefined();
    expect(updates).toHaveLength(0);
  });

  test("adapter_id is optional and omitted rather than stored as undefined", async () => {
    stage({});
    const { adapter_id: _omitted, ...body } = goodBody;
    const response = await postWitness(BUYER_PROJECT, body);
    expect(response.status).toBe(201);
    const json = (await response.json()) as { witness: WitnessEntry };
    expect("adapter_id" in json.witness).toBe(false);
  });
});

describe("public invocation re-derivation binding", () => {
  test("a stored witness opens the exact ten-field canonical projection", async () => {
    const witness = storedWitness();
    stage({
      invocation: invocationRow({ metadata: { witnesses: [witness] } }),
    });
    const app = new Hono();
    app.route("/public/invocations", publicInvocationsRouter);

    const response = await app.request(`/public/invocations/${INV_ID}`);
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(json).slice(0, 10)).toEqual([
      "amount",
      "buyer_did",
      "completed_at",
      "completion_sig",
      "created_at",
      "currency",
      "id",
      "listing_id",
      "settled_at",
      "status",
    ]);
    expect(json).toMatchObject({
      amount: 100,
      buyer_did: BUYER_DID,
      completed_at: "2026-07-20T01:00:00.000Z",
      completion_sig: "completion-signature",
      created_at: "2026-07-20T00:00:00.000Z",
      currency: "credits",
      id: INV_ID,
      listing_id: LISTING_ID,
      settled_at: "2026-07-20T01:00:00.000Z",
      status: "released",
      _witnesses: [witness],
    });
  });

  test("an invocation without a witness remains private", async () => {
    stage({});
    const app = new Hono();
    app.route("/public/invocations", publicInvocationsRouter);
    const response = await app.request(`/public/invocations/${INV_ID}`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe(
      "not_witnessed",
    );
  });
});

describe("planWitnessAppend", () => {
  const candidate = {
    chain_id: "zerone-1",
    tx_hash: "ABC123",
    attestation_id: "att-2420-1",
    witness_did: BUYER_DID,
  };
  const now = new Date("2026-07-23T12:00:00Z");

  test("appends without mutating the caller's array", () => {
    const existing: WitnessEntry[] = [];
    const plan = planWitnessAppend(existing, candidate, now);
    expect(existing).toHaveLength(0);
    expect(plan.kind).toBe("appended");
    expect(plan.entry.schema).toBe(WITNESS_ENTRY_SCHEMA);
    expect(plan.entry.witnessed_at).toBe("2026-07-23T12:00:00.000Z");
    expect(plan.witnesses).toHaveLength(1);
  });

  test("duplicate identity is chain-scoped and preserves the stored entry", () => {
    const stored = storedWitness({
      tx_hash: "AAAA",
      witnessed_at: "2026-07-01T00:00:00.000Z",
    });
    const duplicate = planWitnessAppend(
      [stored],
      { ...candidate, tx_hash: "BBBB" },
      now,
    );
    expect(duplicate.kind).toBe("duplicate");
    expect(duplicate.entry).toEqual(stored);

    const otherChain = planWitnessAppend(
      [stored],
      { ...candidate, chain_id: "zerone-testnet-1" },
      now,
    );
    expect(otherChain.kind).toBe("appended");
    expect(otherChain.witnesses).toHaveLength(2);
  });

  test("malformed storage and the cap fail closed", () => {
    for (const malformed of [
      "not-an-array",
      7,
      { chain_id: "x" },
      [{ chain_id: "zerone-1" }],
    ]) {
      expect(() => planWitnessAppend(malformed, candidate, now)).toThrow(
        "witnesses_malformed",
      );
    }
    const full = Array.from({ length: WITNESS_CAP }, (_, index) =>
      storedWitness({
        attestation_id: `att-${index}`,
        witnessed_at: "2026-07-01T00:00:00.000Z",
      }),
    );
    expect(() => planWitnessAppend(full, candidate, now)).toThrow(
      "witnesses_full",
    );
  });

  test("pure stored-list parser enforces exact versioned public shape", () => {
    const valid = [storedWitness()];
    expect(parseWitnessEntries(valid)).toBe(valid);
    expect(parseWitnessEntries([])).toEqual([]);
    expect(parseWitnessEntries(undefined)).toBeNull();
    expect(
      parseWitnessEntries([
        { ...storedWitness(), adapter_id: undefined },
      ]),
    ).toBeNull();
    expect(
      parseWitnessEntries([
        { ...storedWitness(), extra_public_field: "<img src=x>" },
      ]),
    ).toBeNull();
    expect(
      parseWitnessEntries([
        storedWitness({ witness_did: "did:at:buyer\u0000suffix" }),
      ]),
    ).toBeNull();
    expect(
      parseWitnessEntries([
        storedWitness({
          witness_did: `did:at:${"a".repeat(WITNESS_DID_MAX_LENGTH)}`,
        }),
      ]),
    ).toBeNull();
    expect(
      parseWitnessEntries(
        Array.from({ length: WITNESS_CAP + 1 }, (_, index) =>
          storedWitness({ attestation_id: `att-${index}` }),
        ),
      ),
    ).toBeNull();
  });

  test("stored parser accepts repository DID and DID-URL punctuation", () => {
    for (const witnessDid of [
      "did:at:agenttool.dev/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "did:at:human:Yu",
      "did:web:example.com:agents:alice/profile?service=inbox#key-1",
    ]) {
      const witnesses = [storedWitness({ witness_did: witnessDid })];
      expect(parseWitnessEntries(witnesses)).toBe(witnesses);
    }
  });

  test("stored parser rejects quote, backslash, and markup DID injection", () => {
    for (const witnessDid of [
      'did:at:buyer"suffix',
      "did:at:buyer'suffix",
      "did:at:buyer`script",
      "did:at:buyer\\suffix",
      "did:at:<buyer>",
    ]) {
      expect(
        parseWitnessEntries([storedWitness({ witness_did: witnessDid })]),
      ).toBeNull();
    }
  });
});
