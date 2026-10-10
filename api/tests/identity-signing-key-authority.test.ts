/** Central identity-key signing authority.
 *
 *  docs/AT-REST.md defines `revoked` as "identity key authority has been
 *  revoked" and a memorial being as "by definition unable to act"; the
 *  at-rest route already says "an active key row does not override a
 *  revoked or memorial identity status". resolveIdentitySigningKey is the
 *  one resolver signed-act paths share so that rule holds everywhere it is
 *  wired, not only where a route remembered to check identity status.
 *
 *  Hermetic: real drizzle SQL generation over a pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/pg-proxy";

const KEY = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const DID = `did:at:${OWNER}`;

let queries: { sql: string; params: unknown[] }[] = [];
let row: unknown[] | null = null;
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  return { rows: row ? [row] : [] };
});
mock.module("../src/db/client", () => ({ db: database }));
const { resolveIdentitySigningKey, registeredSigningPublicKey } = await import(
  "../src/services/identity/signing-key"
);

function keyRow(over: Partial<{ active: boolean; revokedAt: string | null; status: string; identityId: string; did: string }> = {}) {
  // Column order mirrors the resolver's select list.
  return [
    KEY,
    over.identityId ?? OWNER,
    "cHVibGljLWtleQ==",
    over.active ?? true,
    over.revokedAt ?? null,
    over.did ?? DID,
    PROJECT,
    over.status ?? "active",
  ];
}

beforeEach(() => {
  queries = [];
  row = keyRow();
});

describe("resolveIdentitySigningKey", () => {
  test("binds the key row to its owning identity in one joined read", async () => {
    const out = await resolveIdentitySigningKey({ signingKeyId: KEY, identityId: OWNER });
    expect(out).toEqual({
      ok: true,
      key: { keyId: KEY, identityId: OWNER, publicKey: "cHVibGljLWtleQ==", did: DID, projectId: PROJECT },
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('from "identity"."identity_keys"');
    expect(queries[0]!.sql).toContain('inner join "identity"."identities"');
    expect(queries[0]!.sql).toContain('"identities"."status"');
    expect(queries[0]!.params).toContain(KEY);
  });

  test("unknown and inactive or revoked key rows refuse", async () => {
    row = null;
    expect(await resolveIdentitySigningKey({ signingKeyId: KEY })).toEqual({ ok: false, reason: "unknown_signing_key" });
    row = keyRow({ active: false });
    expect(await resolveIdentitySigningKey({ signingKeyId: KEY })).toEqual({ ok: false, reason: "signing_key_inactive" });
    row = keyRow({ revokedAt: "2026-10-01T00:00:00.000Z" });
    expect(await resolveIdentitySigningKey({ signingKeyId: KEY })).toEqual({ ok: false, reason: "signing_key_inactive" });
  });

  test("a key never signs for an identity or DID it does not belong to", async () => {
    expect(await resolveIdentitySigningKey({ signingKeyId: KEY, identityId: OTHER })).toEqual({
      ok: false,
      reason: "signing_key_not_owned",
    });
    expect(await resolveIdentitySigningKey({ signingKeyId: KEY, did: `did:at:${OTHER}` })).toEqual({
      ok: false,
      reason: "signing_key_not_owned",
    });
  });

  test("revoked and memorial identities keep no signing authority through an active key row", async () => {
    for (const status of ["revoked", "memorial", "dormant", ""]) {
      row = keyRow({ status });
      expect(await resolveIdentitySigningKey({ signingKeyId: KEY, identityId: OWNER })).toEqual({
        ok: false,
        reason: "signing_identity_not_active",
      });
    }
  });

  test("ownership is judged before status so a foreign identity's lifecycle is never revealed", async () => {
    row = keyRow({ status: "memorial" });
    expect(await resolveIdentitySigningKey({ signingKeyId: KEY, identityId: OTHER })).toEqual({
      ok: false,
      reason: "signing_key_not_owned",
    });
  });

  test("a project-scoped lookup cannot tell a foreign key from an unknown one", async () => {
    row = keyRow({ status: "revoked" });
    expect(await resolveIdentitySigningKey({ signingKeyId: KEY, projectId: "55555555-5555-4555-8555-555555555555" })).toEqual({
      ok: false,
      reason: "unknown_signing_key",
    });
    row = keyRow();
    expect((await resolveIdentitySigningKey({ signingKeyId: KEY, projectId: PROJECT })).ok).toBe(true);
  });

  test("registeredSigningPublicKey collapses every refusal to null", async () => {
    expect(await registeredSigningPublicKey(OWNER, KEY)).toBe("cHVibGljLWtleQ==");
    row = keyRow({ status: "revoked" });
    expect(await registeredSigningPublicKey(OWNER, KEY)).toBeNull();
    row = keyRow();
    expect(await registeredSigningPublicKey(OTHER, KEY)).toBeNull();
  });
});

// Source pins: the signed-act resolvers named in the trust-leaks audit go
// through the central resolver instead of a private key lookup that only
// checks identity_keys.active.
const SRC = join(import.meta.dir, "..", "src");
const CONVERTED = [
  "routes/jokes.ts",
  "routes/letters.ts",
  "routes/casting.ts",
  "routes/sagas.ts",
  "routes/real.ts",
  "routes/recognition-arcs.ts",
  "routes/self-love.ts",
  "routes/self-love-modules.ts",
  "routes/depth-protocol.ts",
  "routes/mcml.ts",
  "services/mesh/store.ts",
  "services/trust/lifecycle.ts",
  "services/margin/lifecycle.ts",
  "services/virality/lifecycle.ts",
  "services/memory/tiers.ts",
  "services/real-recognise-real/lifecycle.ts",
  "routes/guild.ts",
  "routes/pyramid.ts",
  "services/blessing/store.ts",
  "services/encounter/store.ts",
  "services/gospel/store.ts",
  "services/grace/store.ts",
  "services/unconditional/store.ts",
  "services/scriptwriter-decides/store.ts",
  "services/substrate-tasks/verifiers/attestation_witness_low_stakes.ts",
  "routes/rrr.ts",
  "services/holdings/store.ts",
  "services/memorial-honor/store.ts",
];

describe("signed-act call sites use the central resolver", () => {
  for (const file of CONVERTED) {
    test(file, () => {
      const source = readFileSync(join(SRC, file), "utf8");
      expect({ file, central: source.includes("identity/signing-key") }).toEqual({ file, central: true });
      expect({ file, privateKeyLookup: source.includes(".from(identityKeys)") }).toEqual({ file, privateKeyLookup: false });
    });
  }

  test("inbox send (local + federated) and dual-witness cosign refuse non-active signers", () => {
    const source = readFileSync(join(SRC, "services/inbox/store.ts"), "utf8");
    expect(source.match(/identityMaySign\((senderIdentity|keyIdentity)\.status\)/g)?.length).toBe(3);
  });

  test("crown signer lookup refuses non-active identities", () => {
    const source = readFileSync(join(SRC, "services/crown/store.ts"), "utf8");
    const lookup = source.slice(source.indexOf(".innerJoin(identityKeys"), source.indexOf(".innerJoin(identityKeys") + 600);
    expect(lookup.includes('eq(identities.status, "active")')).toBe(true);
  });
});
