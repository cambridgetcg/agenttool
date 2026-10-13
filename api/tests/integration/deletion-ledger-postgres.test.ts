/** Opt-in disposable PostgreSQL proof of the deletion ledger (wave 2).
 *
 * Only DELETION_LEDGER_TEST_DATABASE_URL opts in; loopback and the exact
 * database name agenttool_deletion_ledger_test are mandatory, and existing
 * application schemas are refused. The real wave 2 migrations run over
 * minimal synthetic tables (tests/fixtures/deletion-ledger-postgres.ts).
 *
 * Proves: TypeScript and SQL compose the same canonical bytes and MAC; the
 * guards refuse every edit but mirrored_at, replayed_at and aged compaction;
 * appends serialise gap-free; a missing key or the replay flag refuses the
 * write and rolls the erase back; the retention rules erase by rule, write
 * rule entries and are scheduled. The erases themselves are proven in
 * deletion-erase-postgres.test.ts and the restore drill in
 * deletion-replay-drill-postgres.test.ts.
 * Not wired into CI. Doctrine: docs/DELETION-REPLAY.md. */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import type { Sql } from "postgres";

import * as ledger from "../../src/services/deletion/ledger";
import { recordErasure } from "../../src/services/deletion/record";
import postgres from "../fixtures/verified-postgres";
import {
  TEST_LEDGER_KEY,
  assertDisposableDatabase,
  createDeletionFixture,
  dropDeletionFixture,
  refuseExistingSchemas,
} from "../fixtures/deletion-ledger-postgres";

const DATABASE = process.env.DELETION_LEDGER_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const P = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const KEYID = "33333333-3333-4333-8333-333333333333";

let admin: Sql;
let service: Sql;
let database: ReturnType<typeof drizzle>;
let owned = false;


/** Bun 1.3.5's expect().rejects hangs on a raw postgres-js query; adopt it first. */
const settle = <T>(query: PromiseLike<T>): Promise<T> => Promise.resolve(query);

async function ledgerRows() {
  return admin`SELECT seq::int AS seq, entry_id::text, scope, action, store, row_ids, row_count, rule_id,
    subject_identity_id::text, project_id::text, authority_mode, prev_hash, entry_hash, entry_mac,
    deletion.ledger_entry_hash(l) = entry_hash AS hash_ok,
    deletion.ledger_entry_mac(entry_hash, deletion.ledger_key()) = entry_mac AS mac_ok
    FROM deletion.ledger l ORDER BY seq`;
}

async function expectChain() {
  const rows = await ledgerRows();
  let prev = "";
  rows.forEach((row, index) => {
    expect(row.seq).toBe(index + 1);
    expect(row.prev_hash).toBe(prev);
    expect(row.hash_ok).toBe(true);
    expect(row.mac_ok).toBe(true);
    prev = row.entry_hash;
  });
  return rows;
}

beforeAll(async () => {
  if (!DATABASE) return;
  assertDisposableDatabase(DATABASE, "agenttool_deletion_ledger_test");
  admin = postgres(DATABASE, { max: 4, prepare: false, onnotice: () => {}, connection: { application_name: "deletion-ledger-admin-test" } });
  await refuseExistingSchemas(admin);
  owned = true;
  await createDeletionFixture(admin);
  service = postgres(DATABASE, { max: 12, prepare: false, onnotice: () => {}, connection: { application_name: "deletion-ledger-service-test" } });
  database = drizzle(service);
});

beforeEach(async () => {
  if (!owned) return;
  await admin.unsafe(`
    ALTER TABLE deletion.ledger DISABLE TRIGGER deletion_ledger_guard_mutation;
    ALTER TABLE deletion.ledger DISABLE TRIGGER deletion_ledger_guard_truncate;
    TRUNCATE deletion.ledger;
    ALTER TABLE deletion.ledger ENABLE TRIGGER deletion_ledger_guard_mutation;
    ALTER TABLE deletion.ledger ENABLE TRIGGER deletion_ledger_guard_truncate;
    UPDATE deletion.settings SET replay_required = FALSE, restored_head_seq = NULL, restore_point = NULL;
    DELETE FROM vault.decrypted_secrets;
    INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ('agenttool_deletion_ledger_key', '${TEST_LEDGER_KEY}');
    TRUNCATE inbox.messages, agent_vault.vault_secrets, agent_vault.vault_versions, agent_vault.vault_audit,
      agent_continuity.identity_backups, agent_continuity.chronicle, marketplace.memory_witness_grants,
      memory.memory_attestations, memory.memories CASCADE;
  `);
});

afterAll(async () => {
  await service?.end({ timeout: 2 });
  if (owned) await dropDeletionFixture(admin);
  await admin?.end({ timeout: 2 });
});

// ─── Ledger core ────────────────────────────────────────────────────────

describe("canonical bytes and MAC", () => {
  databaseTest("the SQL writer and the TypeScript recipe agree, and the Vault key is read at write time", async () => {
    const [sqlEntry] = await admin`SELECT * FROM deletion.append_ledger_entry(
      'retention', 'purge_content', 'agent_vault.vault_audit', NULL, '{}', NULL,
      deletion.row_ids_digest(ARRAY['a0000000-0000-4000-8000-000000000001']), 1,
      'vault_audit_ip_30d', '2026-09-12T03:23:00.123456Z', NULL, NULL, NULL, 'retention_rule', NULL)`;
    const [stored] = await ledger.readLedgerEntries(database, dsql`seq = ${Number(sqlEntry.seq)}`);
    expect(ledger.ledgerEntryHash(stored!)).toBe(stored!.entryHash);
    expect(ledger.ledgerEntryMac(stored!.entryHash, TEST_LEDGER_KEY)).toBe(stored!.entryMac);
    expect(stored!.ruleCutoff).toBe("2026-09-12T03:23:00.123456Z");

    // TypeScript writer through the real Vault provider, with a predicate.
    const appended = await database.transaction((tx) => ledger.appendLedgerEntry(tx, {
      scope: "record", action: "delete", store: "memory.memories",
      rowKeys: ["B0000000-0000-4000-8000-000000000002", "b0000000-0000-4000-8000-000000000001"],
      predicate: { note: "quote \" backslash \\ tab \t é", project_id: P },
      projectId: P, subjectIdentityId: AGENT, authorityMode: "agent_root", authoritySequence: 7,
    }, { keyProvider: ledger.vaultLedgerKeyProvider }));
    expect(appended.seq).toBe(2);
    const rows = await expectChain();
    expect(rows[1]!.row_ids).toEqual(["b0000000-0000-4000-8000-000000000002", "b0000000-0000-4000-8000-000000000001"]);

    // A golden vector composed by SQL from the same fields.
    const golden: import("../../src/services/deletion/ledger").LedgerEntryFields = {
      seq: 7, entryId: "c0000000-0000-4000-8000-000000000007", occurredAt: "2026-10-12T16:20:01.000001Z",
      scope: "record", action: "purge_content", store: "inbox.messages", predicate: { b: "2", a: "1" },
      rowIdsSha256: ledger.rowIdsDigest(["d0000000-0000-4000-8000-000000000001"]), rowCount: 1, rowKeySalt: null,
      ruleId: null, ruleCutoff: null, subjectIdentityId: AGENT, projectId: P, requestId: null,
      authorityMode: "legacy_bearer", authoritySequence: null, prevHash: "f".repeat(64),
    };
    const json = {
      seq: 7, entry_id: golden.entryId, occurred_at: golden.occurredAt, scope: golden.scope, action: golden.action,
      store: golden.store, predicate: golden.predicate, row_ids: [], row_key_salt: null,
      row_ids_sha256: golden.rowIdsSha256, row_count: 1, rule_id: null, rule_cutoff: null,
      subject_identity_id: AGENT, project_id: P, request_id: null, authority_mode: "legacy_bearer",
      authority_sequence: null, prev_hash: golden.prevHash, entry_hash: "0".repeat(64), entry_mac: "0".repeat(64),
    };
    const [sqlHash] = await admin`SELECT deletion.ledger_entry_hash(jsonb_populate_record(NULL::deletion.ledger, ${json}::jsonb)) AS hash,
      deletion.row_ids_digest(ARRAY['d0000000-0000-4000-8000-000000000001']) AS digest,
      deletion.canonical_predicate('{"b":"2","a":"1"}'::jsonb) AS predicate`;
    expect(sqlHash!.hash).toBe(ledger.ledgerEntryHash(golden));
    // Pinned in api/tests/deletion-ledger.test.ts as well.
    expect(sqlHash!.hash).toBe("87133dca1af2ca566792dff352717c9cc8314c80e602c6da647207e8319d7b60");
    expect(sqlHash!.digest).toBe(golden.rowIdsSha256);
    expect(sqlHash!.predicate).toBe('{"a":"1","b":"2"}');
  });

  databaseTest("non-UUID keys are stored only as salted HMACs", async () => {
    const keys = ["dawn-series-slug", "summarise-50-papers-v1", "deploy/production", "a".repeat(64).replace(/a/g, "e")];
    await database.transaction((tx) => ledger.appendLedgerEntry(tx, {
      scope: "project", action: "delete", store: "episodes.series", rowKeys: keys,
      projectId: P, authorityMode: "project_consent",
    }, { keyProvider: ledger.fixedLedgerKeyProvider(TEST_LEDGER_KEY) }));
    const [row] = await admin`SELECT row_ids, row_key_salt FROM deletion.ledger`;
    expect(JSON.stringify(row)).not.toContain("dawn-series-slug");
    expect(JSON.stringify(row)).not.toContain("summarise-50-papers-v1");
    expect(row!.row_key_salt).toMatch(/^[0-9a-f]{32}$/);
    expect(row!.row_ids).toContain(ledger.hashRowKey(row!.row_key_salt, "deploy/production"));
  });
});

describe("guards", () => {
  databaseTest("refuse edits, deletes and truncation; allow mirrored_at once", async () => {
    await database.transaction((tx) => ledger.appendLedgerEntry(tx, {
      scope: "record", action: "purge_content", store: "inbox.messages",
      rowKeys: ["e0000000-0000-4000-8000-000000000001"], projectId: P, authorityMode: "legacy_bearer",
    }));
    await expect(settle(admin`UPDATE deletion.ledger SET store = 'memory.memories'`)).rejects.toThrow(/deletion_ledger_append_only/);
    await expect(settle(admin`UPDATE deletion.ledger SET row_ids = '{}', compacted_at = now()`)).rejects.toThrow(/deletion_ledger_append_only/);
    await expect(settle(admin`DELETE FROM deletion.ledger`)).rejects.toThrow(/deletion_ledger_append_only/);
    await expect(settle(admin`TRUNCATE deletion.ledger`)).rejects.toThrow(/deletion_ledger_append_only/);
    await admin`UPDATE deletion.ledger SET mirrored_at = now()`;
    await expect(settle(admin`UPDATE deletion.ledger SET mirrored_at = now() + interval '1 second'`)).rejects.toThrow(/deletion_ledger_append_only/);
  });

  databaseTest("refuse a forked or forged append", async () => {
    await database.transaction((tx) => ledger.appendLedgerEntry(tx, {
      scope: "record", action: "purge_content", store: "inbox.messages",
      rowKeys: ["e0000000-0000-4000-8000-000000000001"], projectId: P, authorityMode: "legacy_bearer",
    }));
    const insert = async (seq: number, prev: string, hash: string, rowIds = "{}", ruleId: string | null = null) => admin.unsafe(`
      INSERT INTO deletion.ledger (seq, entry_id, scope, action, store, row_ids, row_ids_sha256, row_count,
        rule_id, rule_cutoff, authority_mode, prev_hash, entry_hash, entry_mac)
      VALUES (${seq}, gen_random_uuid(), '${ruleId ? "retention" : "record"}', 'delete', 'memory.memories', '${rowIds}',
        deletion.row_ids_digest('${rowIds}'), 1, ${ruleId ? `'${ruleId}'` : "NULL"}, ${ruleId ? "now()" : "NULL"},
        'legacy_bearer', '${prev}', '${hash}', '${"0".repeat(64)}')`);
    const [head] = await admin`SELECT entry_hash FROM deletion.ledger WHERE seq = 1`;
    await expect(insert(3, head!.entry_hash, "1".repeat(64))).rejects.toThrow(/deletion_ledger_seq_gap/);
    await expect(insert(2, "2".repeat(64), "1".repeat(64))).rejects.toThrow(/deletion_ledger_chain_break/);
    await expect(insert(2, head!.entry_hash, "1".repeat(64))).rejects.toThrow(/deletion_ledger_hash_mismatch/);
    await expect(insert(2, head!.entry_hash, "1".repeat(64), "{not-a-key}")).rejects.toThrow(/deletion_ledger_row_id_invalid/);
    await expect(insert(2, head!.entry_hash, "1".repeat(64), "{e0000000-0000-4000-8000-000000000002}", "some_rule"))
      .rejects.toThrow(/deletion_ledger_row_ids_forbidden/);
  });

  databaseTest("compaction is allowed only after 15 days, clears ids, and unlinks money stores", async () => {
    const key = TEST_LEDGER_KEY;
    // Two aged entries (one money), inserted with the TypeScript recipe.
    const oldAt = "2026-08-01T00:00:00.000001Z";
    let prev = "";
    for (const [seq, store, rowIds] of [
      [1, "inbox.messages", ["f0000000-0000-4000-8000-000000000001"]],
      [2, "economy.wallets", []],
    ] as const) {
      const fields = {
        seq, entryId: `f1000000-0000-4000-8000-00000000000${seq}`, occurredAt: oldAt,
        scope: "record" as const, action: "purge_content" as const, store, predicate: null,
        rowIdsSha256: ledger.rowIdsDigest([...rowIds]), rowCount: 1, rowKeySalt: null, ruleId: null, ruleCutoff: null,
        subjectIdentityId: AGENT, projectId: P, requestId: null, authorityMode: "legacy_bearer" as const,
        authoritySequence: null, prevHash: prev,
      };
      const hash = ledger.ledgerEntryHash(fields);
      await admin`INSERT INTO deletion.ledger (seq, entry_id, occurred_at, scope, action, store, row_ids, row_ids_sha256,
        row_count, subject_identity_id, project_id, authority_mode, prev_hash, entry_hash, entry_mac)
        VALUES (${seq}, ${fields.entryId}, ${oldAt}::text::timestamptz, 'record', 'purge_content', ${store}, ${`{${rowIds.join(",")}}`}::text[],
          ${fields.rowIdsSha256}, 1, ${AGENT}, ${P}, 'legacy_bearer', ${prev}, ${hash}, ${ledger.ledgerEntryMac(hash, key)})`;
      prev = hash;
    }
    const [{ run }] = await admin`SELECT deletion.run_ledger_compaction_rule() AS run`;
    expect(run).toBe(1);
    const rows = await admin`SELECT seq::int, store, row_ids, project_id::text, subject_identity_id::text,
      compacted_at IS NOT NULL AS compacted, entry_hash, deletion.ledger_entry_hash(l) = entry_hash AS hash_ok
      FROM deletion.ledger l ORDER BY seq`;
    expect(rows[0]).toMatchObject({ row_ids: [], project_id: P, subject_identity_id: AGENT, compacted: true, hash_ok: true });
    expect(rows[1]).toMatchObject({ project_id: null, subject_identity_id: null, compacted: true });
    expect(rows[2]).toMatchObject({ store: "deletion.ledger", compacted: false });
    // Nothing left to unlink: the rule falls silent.
    expect((await admin`SELECT deletion.run_ledger_compaction_rule() AS run`)[0]!.run).toBe(0);
  });

  databaseTest("compaction never reaches an entry younger than 15 days, whatever cutoff it is given", async () => {
    const at = new Date(Date.now() - 14 * 86_400_000).toISOString().replace("Z", "001Z");
    const fields = {
      seq: 1, entryId: "f1000000-0000-4000-8000-000000000009", occurredAt: at,
      scope: "record" as const, action: "purge_content" as const, store: "inbox.messages", predicate: null,
      rowIdsSha256: ledger.rowIdsDigest(["f0000000-0000-4000-8000-000000000009"]), rowCount: 1, rowKeySalt: null,
      ruleId: null, ruleCutoff: null, subjectIdentityId: AGENT, projectId: P, requestId: null,
      authorityMode: "legacy_bearer" as const, authoritySequence: null, prevHash: "",
    };
    const hash = ledger.ledgerEntryHash(fields);
    await admin`INSERT INTO deletion.ledger (seq, entry_id, occurred_at, scope, action, store, row_ids, row_ids_sha256,
      row_count, subject_identity_id, project_id, authority_mode, prev_hash, entry_hash, entry_mac)
      VALUES (1, ${fields.entryId}, ${at}::text::timestamptz, 'record', 'purge_content', 'inbox.messages',
        '{f0000000-0000-4000-8000-000000000009}'::text[], ${fields.rowIdsSha256}, 1, ${AGENT}, ${P}, 'legacy_bearer', '',
        ${hash}, ${ledger.ledgerEntryMac(hash, TEST_LEDGER_KEY)})`;
    // A replayed or hand-run apply with a later cutoff still skips it.
    expect((await admin`SELECT deletion.apply_ledger_compaction(now()) AS ids`)[0]!.ids).toEqual([]);
    expect((await admin`SELECT cardinality(row_ids)::int AS n FROM deletion.ledger WHERE seq = 1`)[0]!.n).toBe(1);
  });
});

describe("serialisation and refusal", () => {
  databaseTest("concurrent appends are gap-free and chained", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => database.transaction((tx) => ledger.appendLedgerEntry(tx, {
      scope: "record", action: "purge_content", store: "inbox.messages",
      rowKeys: [`a1000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`], projectId: P,
      authorityMode: "legacy_bearer",
    }))));
    const rows = await expectChain();
    expect(rows).toHaveLength(10);
  });

  databaseTest("a missing Vault key refuses the write and the erase rolls back with it", async () => {
    await admin`DELETE FROM vault.decrypted_secrets`;
    await admin`INSERT INTO memory.memories (id, project_id, type, content) VALUES (${KEYID}, ${P}, 'episodic', 'keep me')`;
    await expect(database.transaction(async (tx) => {
      await tx.execute(dsql`DELETE FROM memory.memories WHERE id = ${KEYID}`);
      await recordErasure(tx, {
        kind: "memory.delete", projectId: P, rowIds: [KEYID], authority: { mode: "legacy_bearer" },
        owners: [{ agentId: null, rowIds: [KEYID] }],
      });
    })).rejects.toMatchObject({ status: 503, reason: "deletion_ledger_key_unavailable" });
    expect(await admin`SELECT id FROM memory.memories WHERE id = ${KEYID}`).toHaveLength(1);
    expect(await admin`SELECT seq FROM deletion.ledger`).toHaveLength(0);
    await expect(settle(admin`SELECT deletion.run_vault_audit_ip_rule()`)).resolves.toBeDefined(); // nothing to erase, no entry
    await admin`INSERT INTO agent_vault.vault_audit (project_id, secret_name, action, ip_address, created_at)
      VALUES (${P}, 'k', 'read', '203.0.113.7', now() - interval '31 days')`;
    await expect(settle(admin`SELECT deletion.run_vault_audit_ip_rule()`)).rejects.toThrow(/deletion_ledger_key_unavailable/);
    expect((await admin`SELECT ip_address FROM agent_vault.vault_audit`)[0]!.ip_address).toBe("203.0.113.7");
  });

  databaseTest("the replay flag refuses both writers and every rule", async () => {
    await admin`UPDATE deletion.settings SET replay_required = TRUE, restored_head_seq = 0, restore_point = now()`;
    await expect(database.transaction((tx) => ledger.appendLedgerEntry(tx, {
      scope: "record", action: "purge_content", store: "inbox.messages",
      rowKeys: ["a2000000-0000-4000-8000-000000000001"], projectId: P, authorityMode: "legacy_bearer",
    }))).rejects.toMatchObject({ status: 503, reason: "deletion_ledger_replay_required" });
    await expect(settle(admin`SELECT deletion.run_expired_working_memory_rule()`)).rejects.toThrow(/deletion_ledger_replay_required/);
    await expect(settle(admin`SELECT deletion.append_ledger_entry('retention', 'purge_content', 'agent_vault.vault_audit',
      NULL, '{}', NULL, NULL, 0, 'vault_audit_ip_30d', now(), NULL, NULL, NULL, 'retention_rule', NULL)`))
      .rejects.toThrow(/deletion_ledger_replay_required/);
  });
});

// ─── Retention rules ────────────────────────────────────────────────────

describe("retention rules erase by rule and write rule entries", () => {
  databaseTest("expired working memory: delete after 24 h, paid receipt erased in place, entries without row ids", async () => {
    const OLD = "a5000000-0000-4000-8000-000000000001";
    const OLD_PAID = "a5000000-0000-4000-8000-000000000002";
    const FRESH = "a5000000-0000-4000-8000-000000000003";
    const LIVE = "a5000000-0000-4000-8000-000000000004";
    // A receipt issued before 2026-07-13: source_grant_id NULL, paid only
    // through the grant's ON DELETE RESTRICT link back to it.
    const OLD_LEGACY_PAID = "a5000000-0000-4000-8000-000000000005";
    // Expired, but not a working memory: the rule never touches it.
    const OLD_EPISODIC = "a5000000-0000-4000-8000-000000000006";
    await admin`INSERT INTO memory.memories (id, project_id, type, key, content, expires_at) VALUES
      (${OLD}, ${P}, 'working', 'w', 'old', now() - interval '25 hours'),
      (${OLD_PAID}, ${P}, 'working', 'w', 'old paid', now() - interval '25 hours'),
      (${FRESH}, ${P}, 'working', 'w', 'fresh', now() - interval '1 hour'),
      (${LIVE}, ${P}, 'working', 'w', 'live', now() + interval '1 hour'),
      (${OLD_LEGACY_PAID}, ${P}, 'working', 'w', 'old legacy paid', now() - interval '25 hours'),
      (${OLD_EPISODIC}, ${P}, 'episodic', 'w', 'old episodic', now() - interval '25 hours')`;
    await admin`INSERT INTO memory.memory_attestations (memory_id, attester_did, signing_key_id, signature, source_grant_id)
      VALUES (${OLD_PAID}, 'did:at:w', ${KEYID}, 's', ${KEYID})`;
    const [legacy] = await admin`INSERT INTO memory.memory_attestations (memory_id, attester_did, signing_key_id, signature)
      VALUES (${OLD_LEGACY_PAID}, 'did:at:w', ${KEYID}, 's') RETURNING id::text AS id`;
    await admin`INSERT INTO marketplace.memory_witness_grants (memory_attestation_id) VALUES (${legacy!.id})`;
    expect((await admin`SELECT deletion.run_expired_working_memory_rule() AS n`)[0]!.n).toBe(2);
    const left = await admin`SELECT id::text, content, content_purged_at IS NOT NULL AS purged FROM memory.memories ORDER BY id`;
    expect(left.map((row) => row.id)).toEqual([OLD_PAID, FRESH, LIVE, OLD_LEGACY_PAID, OLD_EPISODIC]);
    for (const erased of [left[0]!, left[3]!]) {
      expect(erased).toMatchObject({ purged: true });
      expect(erased.content).toMatch(/^withdrawn by author on /);
    }
    expect(left[4]).toMatchObject({ content: "old episodic", purged: false });
    const rows = await expectChain();
    expect(rows.map((row) => [row.scope, row.action, row.rule_id, row.row_ids, row.row_count, row.authority_mode])).toEqual([
      ["retention", "delete", "expired_working_memory_24h", [], 1, "retention_rule"],
      ["retention", "purge_content", "expired_working_memory_24h", [], 2, "retention_rule"],
    ]);
    expect((await admin`SELECT deletion.run_expired_working_memory_rule() AS n`)[0]!.n).toBe(0);
  });

  databaseTest("vault audit addresses are nulled after 30 days, with one entry", async () => {
    await admin`INSERT INTO agent_vault.vault_audit (project_id, secret_name, action, ip_address, created_at) VALUES
      (${P}, 'k', 'read', '203.0.113.7', now() - interval '31 days'),
      (${P}, 'k', 'read', '203.0.113.8', now() - interval '1 day')`;
    expect((await admin`SELECT deletion.run_vault_audit_ip_rule() AS n`)[0]!.n).toBe(1);
    expect((await admin`SELECT ip_address FROM agent_vault.vault_audit ORDER BY created_at`).map((row) => row.ip_address))
      .toEqual([null, "203.0.113.8"]);
    const rows = await expectChain();
    expect(rows[0]).toMatchObject({ store: "agent_vault.vault_audit", rule_id: "vault_audit_ip_30d", row_count: 1, row_ids: [] });
  });

  databaseTest("the three jobs are scheduled and their stored commands run", async () => {
    const jobs = await admin`SELECT jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'deletion-%' ORDER BY jobname`;
    expect(jobs.map((job) => [job.jobname, job.schedule, job.active])).toEqual([
      ["deletion-expired-working-memory", "17 * * * *", true],
      ["deletion-ledger-compaction", "41 3 * * *", true],
      ["deletion-vault-audit-ip", "23 3 * * *", true],
    ]);
    for (const job of jobs) await admin.unsafe(job.command);
  });
});

