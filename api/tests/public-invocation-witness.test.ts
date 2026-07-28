/** Public invocation witness gate — hermetic structural-boundary regression.
 *
 *  The public route does not query Zerone or any other chain. It opens only
 *  for a non-empty, versioned writer-shaped witness list and tells readers to
 *  retrieve and compare the reported chain state independently.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  WITNESS_ENTRY_SCHEMA,
  type WitnessEntry,
} from "../src/services/marketplace/witness";

const INVOCATION_ID = "77777777-7777-4777-8777-777777777777";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

let stagedRows: Record<string, unknown>[] = [];

const mockDb = {
  select: mock(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(stagedRows),
      }),
    }),
  })),
};

mock.module("../src/db/client", () => ({ db: mockDb }));

const { default: publicInvocations } = await import(
  "../src/routes/public/invocations"
);

function witness(overrides: Partial<WitnessEntry> = {}): WitnessEntry {
  return {
    schema: WITNESS_ENTRY_SCHEMA,
    chain_id: "zerone-1",
    tx_hash:
      "9C1C4E84AB2F5F63D6C4E1A7B8090F1E2D3C4B5A6978877665544332211FFEE",
    attestation_id: "att-2420-1",
    adapter_id: "agenttool-invocation-v1",
    witness_did: "did:at:test-buyer",
    witnessed_at: "2026-07-20T02:00:00.000Z",
    ...overrides,
  };
}

function invocation(metadata: unknown): Record<string, unknown> {
  return {
    id: INVOCATION_ID,
    listingId: LISTING_ID,
    buyerDid: "did:at:test-buyer",
    amount: 100,
    currency: "credits",
    completionSig: "completion-signature",
    status: "released",
    metadata,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    completedAt: new Date("2026-07-20T01:00:00.000Z"),
    settledAt: new Date("2026-07-20T01:00:00.000Z"),
  };
}

beforeEach(() => {
  stagedRows = [];
  mockDb.select.mockClear();
});

describe("GET /public/invocations/:id witness gate", () => {
  test("opens a released settled row without treating report shape as provenance", async () => {
    const entry = witness();
    stagedRows = [invocation({ witnesses: [entry] })];

    const response = await publicInvocations.request(`/${INVOCATION_ID}`);
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;

    expect(json._witnesses).toEqual([entry]);
    expect(json._witness_notice).toMatch(
      /authenticated-party report format.*shape alone.*not proof.*provenance.*chain verification/i,
    );
    expect(json._witness_notice).toMatch(/retrieve.*compare/i);
    expect(json._rederive).toMatch(/content_hash.*compare/i);
  });

  test.each([
    ["non-released", { status: "refunded" }],
    ["released without settlement", { status: "released", settledAt: null }],
  ])("keeps a %s row private even with a valid witness shape", async (
    _name,
    rowOverrides,
  ) => {
    stagedRows = [
      {
        ...invocation({ witnesses: [witness()] }),
        ...rowOverrides,
      },
    ];

    const response = await publicInvocations.request(`/${INVOCATION_ID}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_witnessed" });
  });

  test.each([
    ["missing metadata", undefined],
    ["empty metadata", {}],
    ["empty witness array", { witnesses: [] }],
    ["non-array witness value", { witnesses: "reported" }],
    ["arbitrary legacy object", { witnesses: [{}] }],
    [
      "pre-discriminator legacy shape",
      {
        witnesses: [
          {
            chain_id: "zerone-1",
            tx_hash: "ABCD",
            attestation_id: "att-legacy",
            witness_did: "did:at:legacy",
            witnessed_at: "2026-07-20T02:00:00.000Z",
          },
        ],
      },
    ],
    [
      "writer-like entry with an extra field",
      { witnesses: [{ ...witness(), injected: "<script>open</script>" }] },
    ],
    [
      "writer-like entry with a control character in the reporter DID",
      { witnesses: [witness({ witness_did: "did:at:buyer\nforged" })] },
    ],
  ])("keeps %s private", async (_name, metadata) => {
    stagedRows = [invocation(metadata)];

    const response = await publicInvocations.request(`/${INVOCATION_ID}`);
    expect(response.status).toBe(404);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.error).toBe("not_witnessed");
    expect(json).not.toHaveProperty("_witnesses");
  });

  test("an unknown invocation remains indistinguishable from a private one", async () => {
    const response = await publicInvocations.request(`/${INVOCATION_ID}`);
    expect(response.status).toBe(404);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ error: "not_witnessed" });
    expect(json.message).toMatch(
      /shape supported by POST.*shape alone.*not prove writer provenance/i,
    );
    expect(json.message).not.toMatch(/reported through/i);
  });
});
