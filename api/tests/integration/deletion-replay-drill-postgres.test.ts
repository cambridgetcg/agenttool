/** Opt-in restore drill: a backup restore replays mirrored deletions to the
 *  same state (deletion spec §13.4, wave 2 "done when").
 *
 * Only DELETION_REPLAY_DRILL_TEST_DATABASE_URL opts in; loopback and the
 * exact database name agenttool_deletion_replay_drill are mandatory, and the
 * role must be able to CREATE DATABASE: the "backup" is a template copy
 * named agenttool_deletion_replay_drill_restored, dropped afterwards.
 *
 * Source: seed rows, erase one (pre-backup), push the mirror, take the
 * backup. Then erase through the real services (inbox, vault, identity
 * backup, memory incl. a paid receipt) and run the pg_cron rule commands,
 * pushing every entry to a local directory mirror (the fake object store).
 * Restored copy: a rule fires before maintenance begins (a stray entry);
 * `begin` removes it and deactivates the cron jobs; `plan` changes nothing;
 * `apply` replays the gap; the erasable state and the ledger then equal the
 * source's; `finish` reactivates the jobs and appends work again. A tampered
 * mirror object, and a void without two operators, are refused.
 * pg_cron here is the local stub (records jobs, runs nothing), so the job
 * commands are executed directly. Not wired into CI. Doctrine: docs/DELETION-REPLAY.md. */
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

import postgres from "../fixtures/verified-postgres";
import {
  assertDisposableDatabase,
  createDeletionFixture,
  refuseExistingSchemas,
  snapshotErasableState,
  withDatabase,
} from "../fixtures/deletion-ledger-postgres";

const DATABASE = process.env.DELETION_REPLAY_DRILL_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const SOURCE_NAME = "agenttool_deletion_replay_drill";
const RESTORED_NAME = "agenttool_deletion_replay_drill_restored";
const P = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const KEYID = "33333333-3333-4333-8333-333333333333";
const M_PRE = "b1000000-0000-4000-8000-000000000001";
const M_POST = "b1000000-0000-4000-8000-000000000002";
const PLAIN = "b2000000-0000-4000-8000-000000000001";
const PAID = "b2000000-0000-4000-8000-000000000002";
const EXPIRED = "b2000000-0000-4000-8000-000000000003";
const BACKUP = "b3000000-0000-4000-8000-000000000001";

let control: Sql | null = null;
let source: Sql | null = null;
let restored: Sql | null = null;
let current: ReturnType<typeof drizzle> | null = null;
let mirrorDir = "";
let ownedSource = false;
let ownedRestored = false;

const db = new Proxy({}, {
  get(_target, property) {
    if (!current) throw new Error("drill database not selected");
    const value = (current as unknown as Record<PropertyKey, unknown>)[property];
    return typeof value === "function" ? value.bind(current) : value;
  },
});
mock.module("../../src/db/client", () => ({ db }));

const { purgeMessage } = await import("../../src/services/inbox/store");
const { eraseVaultSecret } = await import("../../src/services/vault/erase");
const { eraseIdentityBackup } = await import("../../src/services/identity/backup-erase");
const memoryStore = await import("../../src/services/memory/store");
const { FileLedgerMirror, pushUnmirroredEntries } = await import("../../src/services/deletion/mirror");
const { vaultLedgerKeyProvider } = await import("../../src/services/deletion/ledger");
const replay = await import("../../src/services/deletion/replay");
const cli = await import("../../../bin/deletion-replay");

const open = (name: string, app: string) =>
  postgres(withDatabase(DATABASE, name), { max: 4, prepare: false, onnotice: () => {}, connection: { application_name: app } });

async function state(sql: Sql) {
  const snapshot = await snapshotErasableState(sql);
  snapshot.vault_audit = await sql`SELECT id, ip_address FROM agent_vault.vault_audit WHERE action <> 'delete' ORDER BY id`;
  return snapshot;
}

beforeAll(async () => {
  if (!DATABASE) return;
  assertDisposableDatabase(DATABASE, SOURCE_NAME);
  control = open("postgres", "deletion-drill-control");
  const existing = await control`SELECT datname FROM pg_database WHERE datname = ${RESTORED_NAME}`;
  if (existing.length) throw new Error(`refusing: ${RESTORED_NAME} already exists`);
  source = open(SOURCE_NAME, "deletion-drill-source");
  await refuseExistingSchemas(source);
  ownedSource = true;
  await createDeletionFixture(source);
  mirrorDir = await mkdtemp(join(process.env.DELETION_TEST_TMPDIR ?? tmpdir(), "deletion-drill-mirror-"));
});

afterAll(async () => {
  current = null;
  await restored?.end({ timeout: 2 });
  await source?.end({ timeout: 2 });
  if (control) {
    if (ownedRestored) await control.unsafe(`DROP DATABASE IF EXISTS ${RESTORED_NAME}`);
    if (ownedSource) {
      const cleanup = open(SOURCE_NAME, "deletion-drill-cleanup");
      await cleanup.unsafe(`
        DROP SCHEMA IF EXISTS deletion CASCADE; DROP SCHEMA IF EXISTS inbox CASCADE; DROP SCHEMA IF EXISTS agent_vault CASCADE;
        DROP SCHEMA IF EXISTS agent_continuity CASCADE; DROP SCHEMA IF EXISTS memory CASCADE; DROP SCHEMA IF EXISTS vault CASCADE;
        DROP EXTENSION IF EXISTS pg_cron CASCADE; DROP SCHEMA IF EXISTS cron CASCADE;
        DROP EXTENSION IF EXISTS pgcrypto CASCADE; DROP SCHEMA IF EXISTS extensions CASCADE;`);
      await cleanup.end({ timeout: 2 });
    }
    await control.end({ timeout: 2 });
  }
  if (mirrorDir) await rm(mirrorDir, { recursive: true, force: true });
});

databaseTest("a restore replays mirrored deletions, pg_cron strays included, to the same state", async () => {
  const sql = source!;
  const mirror = new FileLedgerMirror(mirrorDir);
  current = drizzle(sql);

  // ── Seed, one pre-backup erase, mirror it.
  for (const id of [M_PRE, M_POST]) {
    await sql`INSERT INTO inbox.messages (id, recipient_did, recipient_identity_id, recipient_project_id, sender_did,
      sender_signing_key_id, ciphertext, nonce, ephemeral_pubkey, recipient_box_key_id, signature, subject)
      VALUES (${id}, 'did:at:r', ${AGENT}, ${P}, 'did:at:s', ${KEYID}, 'c2VhbGVk', 'bg==', 'ZQ==', ${KEYID}, 'c2ln', 'subject')`;
  }
  const [{ id: secret }] = await sql`INSERT INTO agent_vault.vault_secrets (project_id, name, description)
    VALUES (${P}, 'api-key', 'desc') RETURNING id::text`;
  await sql`INSERT INTO agent_vault.vault_versions (secret_id, version, encrypted_value, iv, auth_tag)
    VALUES (${secret}, 1, '\\x0102', '\\x03', '\\x04')`;
  await sql`INSERT INTO agent_vault.vault_audit (project_id, secret_name, action, ip_address, created_at)
    VALUES (${P}, 'api-key', 'read', '203.0.113.7', now() - interval '31 days')`;
  await sql`INSERT INTO agent_continuity.identity_backups (id, project_id, agent_id, blob_base64, key_derivation, nonce)
    VALUES (${BACKUP}, ${P}, ${AGENT}, 'YmxvYg==', 'argon2id-v1', 'bg==')`;
  await sql`INSERT INTO memory.memories (id, project_id, identity_id, type, key, content, expires_at) VALUES
    (${PLAIN}, ${P}, ${AGENT}, 'episodic', 'k', 'plain', NULL),
    (${PAID}, ${P}, ${AGENT}, 'semantic', 'k', 'paid', NULL),
    (${EXPIRED}, ${P}, NULL, 'working', NULL, 'scratch', now() - interval '25 hours')`;
  await sql`INSERT INTO memory.memory_attestations (memory_id, attester_did, signing_key_id, signature, source_grant_id)
    VALUES (${PAID}, 'did:at:w', ${KEYID}, 's', ${KEYID})`;
  expect(await purgeMessage(P, M_PRE)).toMatchObject({ alreadyPurged: false });
  expect((await pushUnmirroredEntries(current, mirror)).pushed).toBe(1);

  // ── The backup: a template copy taken now.
  await sql.end({ timeout: 2 });
  source = null;
  current = null;
  const restorePoint = new Date();
  await control!.unsafe(`CREATE DATABASE ${RESTORED_NAME} TEMPLATE ${SOURCE_NAME}`);
  ownedRestored = true;
  await Bun.sleep(5);

  // ── After the backup: erases and rules on the source, all mirrored.
  source = open(SOURCE_NAME, "deletion-drill-source-2");
  current = drizzle(source);
  await purgeMessage(P, M_POST);
  await eraseVaultSecret(P, "api-key", { agentId: null, ip: "unknown" });
  await eraseIdentityBackup(P, BACKUP);
  expect(await memoryStore.deleteByKey(P, "k")).toMatchObject({ rows_removed: 1, erased_in_place: 1 });
  for (const job of await source`SELECT command FROM cron.job WHERE jobname LIKE 'deletion-%' ORDER BY jobname`) {
    await source.unsafe(job.command);
  }
  const pushed = await pushUnmirroredEntries(current, mirror);
  expect(pushed.failure).toBeNull();
  const sourceState = await state(source);
  expect(sourceState.ledger.length).toBe(8); // 1 pre-backup + 4 erases (memory writes 2) + 2 rule entries

  // ── The restored copy: a rule fires before maintenance begins.
  restored = open(RESTORED_NAME, "deletion-drill-restored");
  current = drizzle(restored);
  const database = current as unknown as Parameters<typeof replay.runReplay>[0];
  await Bun.sleep(5);
  expect((await restored`SELECT deletion.run_expired_working_memory_rule() AS n`)[0]!.n).toBe(1);
  expect((await restored`SELECT count(*)::int AS n FROM deletion.ledger`)[0]!.n).toBe(2);

  // Before begin, replay refuses.
  await expect(cli.runReplayCli(database, cli.parseReplayArgs(["plan", "--mirror-dir", mirrorDir]), {}))
    .rejects.toThrow(/run `begin` first/);

  const begun = await cli.runReplayCli(database, cli.parseReplayArgs(["begin", "--restore-point", restorePoint.toISOString()]), {});
  expect(begun).toMatchObject({ restoredHeadSeq: 1, removedStrayEntries: [{ seq: 2, ruleId: "expired_working_memory_24h" }] });
  expect((await restored`SELECT jobname, active FROM cron.job WHERE jobname LIKE 'deletion-%'`).every((job) => !job.active)).toBe(true);
  await expect(Promise.resolve(restored`SELECT deletion.run_vault_audit_ip_rule()`)).rejects.toThrow(/replay_required/);

  // A tampered mirror object stops everything.
  const tampered = await mkdtemp(join(process.env.DELETION_TEST_TMPDIR ?? tmpdir(), "deletion-drill-tampered-"));
  try {
    await cp(mirrorDir, tampered, { recursive: true });
    const objects = (await readdir(join(tampered, "ledger", "v1"))).sort();
    const target = join(tampered, "ledger", "v1", objects[3]!);
    const body = JSON.parse(await readFile(target, "utf8"));
    body.entry_mac = "0".repeat(64);
    await writeFile(target, JSON.stringify(body));
    await expect(cli.runReplayCli(database, cli.parseReplayArgs(["plan", "--mirror-dir", tampered]), {}))
      .rejects.toThrow(/entry 4 has a bad entry_mac/);
  } finally {
    await rm(tampered, { recursive: true, force: true });
  }
  // A void needs two operators and a reason.
  expect(() => cli.parseReplayArgs(["plan", "--void", "3"])).toThrow(/only accepted by apply/);
  await expect(cli.runReplayCli(database, cli.parseReplayArgs(["apply", "--mirror-dir", mirrorDir, "--void", "3",
    "--void-reason", "confirmed stolen bearer key", "--operator", "alice"]), {})).rejects.toThrow(/two/);

  // Plan changes nothing.
  const beforePlan = await state(restored);
  const plan = await cli.runReplayCli(database, cli.parseReplayArgs(["plan", "--mirror-dir", mirrorDir]), {}) as Awaited<ReturnType<typeof replay.runReplay>>;
  expect(plan.mode).toBe("plan");
  expect(plan.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  expect(await state(restored)).toEqual(beforePlan);

  // Apply replays the gap; the state equals the source's.
  const applied = await cli.runReplayCli(database, cli.parseReplayArgs(["apply", "--mirror-dir", mirrorDir]), {}) as Awaited<ReturnType<typeof replay.runReplay>>;
  expect(applied.mode).toBe("apply");
  expect(applied.nothingToDo).toContain(7); // the source's memory rule entry: the stray already deleted that row
  expect(await state(restored)).toEqual(sourceState);
  const replayedMoments = await restored`SELECT metadata FROM agent_continuity.chronicle
    WHERE type = 'deletion' AND metadata->>'replayed_after_restore' = 'true'`;
  expect(replayedMoments.length).toBe(5);
  expect((await restored`SELECT count(*)::int AS n FROM deletion.ledger WHERE replayed_at IS NOT NULL`)[0]!.n).toBe(7);

  // Finish: the flag clears, jobs return, appends work again.
  expect(await cli.runReplayCli(database, cli.parseReplayArgs(["finish", "--mirror-dir", mirrorDir]), {}))
    .toEqual({ reactivatedCronJobs: ["deletion-expired-working-memory", "deletion-ledger-compaction", "deletion-vault-audit-ip"] });
  expect((await restored`SELECT replay_required FROM deletion.settings`)[0]!.replay_required).toBe(false);
  expect((await restored`SELECT deletion.run_expired_working_memory_rule() AS n`)[0]!.n).toBe(0);
  await restored`INSERT INTO inbox.messages (id, recipient_did, recipient_identity_id, recipient_project_id, sender_did,
    sender_signing_key_id, ciphertext, nonce, ephemeral_pubkey, recipient_box_key_id, signature)
    VALUES ('b1000000-0000-4000-8000-000000000009', 'did:at:r', ${AGENT}, ${P}, 'did:at:s', ${KEYID}, 'x', 'n', 'e', ${KEYID}, 's')`;
  expect(await purgeMessage(P, "b1000000-0000-4000-8000-000000000009")).toMatchObject({ entry: { seq: 9 } });
  void vaultLedgerKeyProvider;
}, 60_000);
