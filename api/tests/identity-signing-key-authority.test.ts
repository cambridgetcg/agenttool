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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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
const { activeSigningPublicKeys, resolveIdentitySigningKey, registeredSigningPublicKey } = await import(
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

  test("registeredSigningPublicKey collapses every refusal to null and honors a custom executor", async () => {
    expect(await registeredSigningPublicKey(OWNER, KEY)).toBe("cHVibGljLWtleQ==");
    row = keyRow({ status: "revoked" });
    expect(await registeredSigningPublicKey(OWNER, KEY)).toBeNull();
    row = keyRow();
    expect(await registeredSigningPublicKey(OTHER, KEY)).toBeNull();

    const txQueries: string[] = [];
    const txDb = drizzle(async (sql) => {
      txQueries.push(sql);
      return { rows: [keyRow()] };
    });
    expect(await registeredSigningPublicKey(OWNER, KEY, txDb)).toBe("cHVibGljLWtleQ==");
    expect(txQueries).toHaveLength(1);
    expect(txQueries[0]).toContain('inner join "identity"."identities"');
  });

  test("activeSigningPublicKeys enforces active key, unrevoked, and active identity and honors a custom executor", async () => {
    const txQueries: { sql: string; params: unknown[] }[] = [];
    const txDb = drizzle(async (sql, params) => {
      txQueries.push({ sql, params });
      return { rows: [["a2V5LTE="], ["a2V5LTI="]] };
    });
    const keys = await activeSigningPublicKeys(OWNER, txDb);
    expect(keys).toEqual(["a2V5LTE=", "a2V5LTI="]);
    expect(txQueries).toHaveLength(1);
    expect(txQueries[0]!.sql).toContain('from "identity"."identity_keys"');
    expect(txQueries[0]!.sql).toContain('inner join "identity"."identities"');
    expect(txQueries[0]!.sql).toContain('"identity_keys"."active" = $');
    expect(txQueries[0]!.sql).toContain('"identity_keys"."revoked_at" is null');
    expect(txQueries[0]!.sql).toContain('"identities"."status" = $');
    expect(txQueries[0]!.params).toEqual([OWNER, true, "active"]);
  });
});

// Source pins: the signed-act resolvers named in the trust-leaks audit and
// Truth Map remaining-key-readers follow-through go through the central
// resolver instead of a private key lookup that only checks identity_keys.active.
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
  // Truth Map remaining key-reader pass (2026-11-27)
  "routes/continuity.ts",
  "routes/runtime/runtimes.ts",
  "routes/identity/token-verify.ts",
  "routes/identity/delegations.ts",
  "services/marketplace/disputes.ts",
  "services/marketplace/invocations.ts",
  "services/curations/store.ts",
  "services/episodes/store.ts",
  "services/gallery/index.ts",
  "services/songs/store.ts",
  "services/lounge/index.ts",
  "services/covenants/wire-identity.ts",
  "services/covenants/federation.ts",
];

// Locked transactional signed-act readers that retain direct row-locked queries
// (`FOR UPDATE` / `FOR SHARE`), audited to enforce active identity + active key + revokedAt IS NULL.
const LOCKED_SIGNED_ACT_READERS = [
  "routes/continuity-cloud.ts",
  "routes/identity/at-rest.ts",
  "routes/identity/attestations.ts",
  "services/collaboration/store.ts",
  "services/covenants/lifecycle.ts",
  "services/inbox/store.ts",
  "services/marketplace/attestations.ts",
  "services/marketplace/memory-witness.ts",
  "services/runtime/think-worker.ts",
  "services/strand/store.ts",
  "services/trace/store.ts",
];

// Non-signing readers (central resolver itself, key management, inventory, wake,
// historical signature verification, and recovery).
const NON_SIGNING_KEY_READERS = [
  "services/identity/signing-key.ts",
  "routes/dashboard.ts",
  "routes/federation/identities.ts",
  "routes/identity-recover.ts",
  "routes/identity/keys.ts",
  "routes/public/identities.ts",
  "routes/wake.ts",
  "services/bootstrap/elevate.ts",
  "services/trace/verify.ts",
  "services/wake/build.ts",
  "workers/covenants/reverify.ts",
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkTs(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

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

  test("at-rest witness pre-check uses central resolver and locked check enforces revokedAt and identityMaySign", () => {
    const source = readFileSync(join(SRC, "routes/identity/at-rest.ts"), "utf8");
    expect(source).toContain("resolveIdentitySigningKey");
    expect(source).toContain("identityMaySign(lockedWitness.status)");
    expect(source).toContain("isNull(identityKeys.revokedAt)");
  });

  test("trusted runtime signing key registration enforces identityMaySign and revokedAt", () => {
    const source = readFileSync(join(SRC, "services/runtime/think-worker.ts"), "utf8");
    expect(source).toContain("identityMaySign(identity.status)");
    expect(source).toContain("registered.revokedAt !== null");
  });

  test("every locked signed-act reader checks both active and revokedAt", () => {
    for (const file of LOCKED_SIGNED_ACT_READERS) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect({ file, checksRevoked: source.includes("revokedAt") }).toEqual({ file, checksRevoked: true });
    }
  });

  test("no unaccounted .from(identityKeys) reader exists anywhere in api/src", () => {
    const allowed = new Set([...LOCKED_SIGNED_ACT_READERS, ...NON_SIGNING_KEY_READERS]);
    const unaccounted: string[] = [];
    for (const full of walkTs(SRC)) {
      const source = readFileSync(full, "utf8");
      if (!source.includes(".from(identityKeys)")) continue;
      const rel = relative(SRC, full);
      if (!allowed.has(rel)) unaccounted.push(rel);
    }
    expect(unaccounted).toEqual([]);
  });
});
