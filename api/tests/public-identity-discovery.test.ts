import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";

interface DiscoveryRow {
  identityId: string;
  did: string;
  name: string;
  status: string;
  kid: string;
  label: string;
  keyCreatedAt: Date;
}

let stagedRows: DiscoveryRow[] = [];

const mockDb = {
  select: mock(() => ({
    from: () => ({
      innerJoin: () => ({
        where: () => Promise.resolve(stagedRows),
      }),
    }),
  })),
};

mock.module("../src/db/client", () => ({ db: mockDb }));

const {
  canonicalDiscoveryBytes,
  generateKeypair,
} = await import("../src/services/identity/crypto");
const { default: publicIdentities } = await import(
  "../src/routes/public/identities"
);
const { default: publicRouter } = await import("../src/routes/public");
const { default: openapiRouter } = await import("../src/routes/openapi");

beforeEach(() => {
  stagedRows = [];
  mockDb.select.mockClear();
});

describe("signed public identity discovery", () => {
  test("returns active recoverable identities and excludes memorial rows", async () => {
    const keys = generateKeypair();
    const timestamp = new Date().toISOString();
    const canonical = canonicalDiscoveryBytes({
      derivedPubkeyB64: keys.publicKey,
      timestamp,
    });
    const signature = Buffer.from(
      ed25519.sign(canonical, Buffer.from(keys.privateKey, "base64")),
    ).toString("base64");

    stagedRows = [
      {
        identityId: "11111111-1111-4111-8111-111111111111",
        did: "did:at:active",
        name: "Active",
        status: "active",
        kid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        label: "seed",
        keyCreatedAt: new Date("2026-07-15T00:00:00.000Z"),
      },
      {
        identityId: "22222222-2222-4222-8222-222222222222",
        did: "did:at:memorial",
        name: "Memorial",
        status: "memorial",
        kid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        label: "seed",
        keyCreatedAt: new Date("2026-07-14T00:00:00.000Z"),
      },
    ];

    const response = await publicIdentities.request("/by-pubkey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: keys.publicKey, signature, timestamp }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      agents: [
        {
          did: "did:at:active",
          name: "Active",
          identity_id: "11111111-1111-4111-8111-111111111111",
          kid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          key_label: "seed",
          key_created_at: "2026-07-15T00:00:00.000Z",
        },
      ],
      count: 1,
    });
  });

  test("is discoverable as a bounded-freshness recovery prerequisite", async () => {
    const publicRootResponse = await publicRouter.request("/");
    const openapiResponse = await openapiRouter.request("/");
    const [publicRoot, openapi] = await Promise.all([
      publicRootResponse.json(),
      openapiResponse.json(),
    ]);

    expect(publicRoot.endpoints.identity_recovery_discovery).toContain(
      "POST /public/identities/by-pubkey",
    );
    expect(publicRoot.endpoints.identity_recovery_discovery).toMatch(
      /bounded freshness.*not one-time replay protection/is,
    );
    expect(publicRoot.privacy_wall).toMatch(
      /legacy GET \/public\/discover observer route.*not mounted.*POST \/public\/identities\/by-pubkey/is,
    );

    const operation = openapi.paths["/public/identities/by-pubkey"].post;
    expect(operation.security).toEqual([]);
    expect(operation.description).toMatch(
      /±5 minutes.*bounded freshness.*not one-time replay protection.*replayed/is,
    );
    const request =
      operation.requestBody.content["application/json"].schema;
    expect(request.required).toEqual(["pubkey", "signature", "timestamp"]);
    expect(request.additionalProperties).toBe(false);
    expect(request.properties.pubkey.contentEncoding).toBe("base64");
    expect(request.properties.signature.contentEncoding).toBe("base64");
    expect(request.properties.timestamp.format).toBe("date-time");

    const response =
      operation.responses["200"].content["application/json"].schema;
    expect(response.required).toEqual(["agents", "count"]);
    expect(response.properties.agents.items.required).toEqual([
      "did",
      "name",
      "identity_id",
      "kid",
      "key_label",
      "key_created_at",
    ]);
  });
});
