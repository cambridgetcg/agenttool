/** The ids-only deletion ledger: canonical bytes, chain, MAC and the writer.
 *
 *  Every honoured erase appends one entry to `deletion.ledger` inside the
 *  erasing transaction (`appendLedgerEntry(tx, …)`). If the entry cannot be
 *  written — the Vault key is missing, a restore is being replayed, the
 *  chain moved — the writer throws and the erase rolls back with it. An
 *  erase that cannot write its entry does not happen.
 *
 *  Canonical bytes, MATHOS recipe 1 (docs/CANONICAL-BYTES.md):
 *    entry_hash = sha256(utf8("agenttool-deletion-ledger/v1") 0x00 seq 0x00
 *      entry_id 0x00 occurred_at 0x00 scope 0x00 action 0x00 store 0x00
 *      predicate 0x00 row_ids_sha256 0x00 row_count 0x00 row_key_salt 0x00
 *      rule_id 0x00 rule_cutoff 0x00 subject_identity_id 0x00 project_id 0x00
 *      request_id 0x00 authority_mode 0x00 authority_sequence 0x00 prev_hash)
 *    entry_mac  = HMAC-SHA256(utf8(ledger key), entry_hash as 32 raw bytes)
 *  NULL is the empty string; timestamps are UTC `YYYY-MM-DDTHH:MM:SS.ffffffZ`;
 *  the predicate is a flat object of lowercase-ASCII keys and string values,
 *  written as sorted compact JSON. The SQL writer in
 *  api/migrations/20261012T161958_deletion_ledger.sql composes the same
 *  bytes, and the table's insert guard recomputes the hash on every append.
 *
 *  The ledger key is the Supabase Vault secret `agenttool_deletion_ledger_key`.
 *  It is read at write time through a key provider, which tests replace.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.2.
 *  Doc: docs/DELETION-REPLAY.md. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import type { GuidedErrorBody } from "../../lib/errors";

export const LEDGER_DOMAIN = "agenttool-deletion-ledger/v1";
/** pg_advisory_xact_lock key shared with the SQL writer and insert guard. */
export const LEDGER_LOCK_KEY = "8116202610120001";
export const LEDGER_KEY_SECRET_NAME = "agenttool_deletion_ledger_key";
export const LEDGER_KEY_MIN_LENGTH = 32;

export const LEDGER_SCOPES = ["record", "class", "identity", "project", "retention"] as const;
export type LedgerScope = (typeof LEDGER_SCOPES)[number];

export const LIFECYCLE_ACTIONS = [
  "leave_confirm", "leave_cancel", "request_open", "consent", "grace_start",
  "cancel", "lapse", "purge_claim", "void",
] as const;
export const LEDGER_ACTIONS = [
  "delete", "purge_content", "redact", "tombstone", "hide", "unhide", "pseudonymise", "unlink",
  // A giver's withdrawal of a gesture it gave (deletion spec §5.2): no content
  // is erased, but a restore must not bring the gesture back into force.
  "withdraw",
  ...LIFECYCLE_ACTIONS,
] as const;
export type LedgerAction = (typeof LEDGER_ACTIONS)[number];

export const AUTHORITY_MODES = [
  "agent_root", "guest_root", "legacy_bearer", "project_consent", "operator", "retention_rule",
] as const;
export type LedgerAuthorityMode = (typeof AUTHORITY_MODES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const PREDICATE_KEY_RE = /^[a-z_][a-z0-9_]{0,63}$/;
const STORE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;
const RULE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const CANONICAL_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Money stores never carry row ids (spec §11.2). Mirrors deletion.is_money_store(). */
export const MONEY_STORES: readonly string[] = [
  "economy.transactions", "economy.escrows", "economy.escrow_create_idempotency", "economy.wallets",
  "economy.wallet_addresses", "economy.billing_events", "economy.crypto_payouts",
  "economy.payout_request_idempotency", "economy.crypto_webhook_events",
  "economy.crypto_webhook_event_observations", "economy.deposit_addresses", "economy.x402_payments",
  "economy.gift_credit_codes", "marketplace.gallery_sales", "marketplace.template_purchases",
  "marketplace.invocations", "marketplace.attestation_grants", "marketplace.memory_witness_grants",
  "marketplace.substrate_tasks", "marketplace.platform_revenue", "marketplace.dispute_cases",
  "marketplace.dispute_pool_votes", "marketplace.settlement_receipts", "tools.billing_events",
  "tools.usage_events", "agent_continuity.chronicle_usage",
];

/** Every field the entry hash covers. Timestamps are canonical strings. */
export interface LedgerEntryFields {
  seq: number;
  entryId: string;
  occurredAt: string;
  scope: LedgerScope;
  action: LedgerAction;
  store: string;
  predicate: Record<string, string> | null;
  rowIdsSha256: string;
  rowCount: number;
  rowKeySalt: string | null;
  ruleId: string | null;
  ruleCutoff: string | null;
  subjectIdentityId: string | null;
  projectId: string | null;
  requestId: string | null;
  authorityMode: LedgerAuthorityMode;
  authoritySequence: number | null;
  prevHash: string;
}

/** A stored entry as the database and the mirror hold it. */
export interface StoredLedgerEntry extends LedgerEntryFields {
  rowIds: string[];
  entryHash: string;
  entryMac: string;
  mirroredAt: string | null;
  replayedAt: string | null;
  compactedAt: string | null;
}

// ─── Errors ────────────────────────────────────────────────────────────────

export type LedgerUnavailableReason =
  | "deletion_ledger_key_unavailable"
  | "deletion_ledger_replay_required"
  | "deletion_ledger_write_failed";

/** Thrown when an erase cannot write its ledger entry. The erase's
 *  transaction rolls back, and the route answers 503 with this body. */
export class DeletionLedgerUnavailableError extends HTTPException {
  readonly reason: LedgerUnavailableReason;
  constructor(reason: LedgerUnavailableReason, detail?: string) {
    const body: GuidedErrorBody = {
      error: "deletion_ledger_unavailable",
      message:
        "Nothing was deleted: the deletion's ledger entry could not be written, and a deletion that cannot be recorded does not happen.",
      hint:
        reason === "deletion_ledger_replay_required"
          ? "A database restore is being replayed. Try again after maintenance ends."
          : "This is an operator-side condition. Try again later; your data is unchanged.",
      details: { reason, ...(detail ? { detail } : {}) },
      docs: "https://docs.agenttool.dev/RETENTION.md",
    };
    super(503, { message: body.message, cause: body });
    this.name = "DeletionLedgerUnavailableError";
    this.reason = reason;
  }
}

// ─── Canonical encoding ───────────────────────────────────────────────────

/** UTC `YYYY-MM-DDTHH:MM:SS.ffffffZ`. A Date (millisecond precision) gains
 *  three zero digits; a canonical string passes through unchanged. */
export function canonicalTimestamp(value: Date | string): string {
  if (typeof value === "string") {
    if (!CANONICAL_TS_RE.test(value)) throw new Error("canonical timestamp must be YYYY-MM-DDTHH:MM:SS.ffffffZ");
    return value;
  }
  if (!Number.isFinite(value.getTime())) throw new Error("invalid timestamp");
  return value.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

export function canonicalPredicate(predicate: Record<string, string> | null): string {
  if (predicate === null) return "";
  if (typeof predicate !== "object" || Array.isArray(predicate)) {
    throw new Error("ledger predicate must be a flat object");
  }
  const keys = Object.keys(predicate).sort();
  for (const key of keys) {
    if (!PREDICATE_KEY_RE.test(key)) throw new Error(`ledger predicate key ${JSON.stringify(key)} is not lowercase ASCII`);
    const value = predicate[key];
    if (typeof value !== "string" || value.includes("\u0000")) {
      throw new Error(`ledger predicate value for ${key} must be a string without NUL`);
    }
  }
  return `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(predicate[key])}`).join(",")}}`;
}

/** sha256 hex of the row ids sorted bytewise and joined with 0x00. */
export function rowIdsDigest(rowIds: readonly string[]): string {
  const sorted = [...rowIds].sort();
  const hash = createHash("sha256");
  sorted.forEach((id, index) => {
    if (index > 0) hash.update(Buffer.from([0]));
    hash.update(Buffer.from(id, "utf8"));
  });
  return hash.digest("hex");
}

/** HMAC of a caller-chosen or content-derived key under a per-entry salt, so
 *  no key is stored in clear (spec §13.2 "No content"). */
export function hashRowKey(saltHex: string, key: string): string {
  return createHmac("sha256", Buffer.from(saltHex, "hex")).update(key, "utf8").digest("hex");
}

/** UUID keys are stored as they are; any other key becomes its salted HMAC. */
export function prepareRowIds(keys: readonly string[]): { rowIds: string[]; rowKeySalt: string | null } {
  const normalized = keys.map((key) => (UUID_RE.test(key.toLowerCase()) ? key.toLowerCase() : null));
  if (normalized.every((key) => key !== null)) {
    return { rowIds: [...new Set(normalized as string[])], rowKeySalt: null };
  }
  const rowKeySalt = randomBytes(16).toString("hex");
  const rowIds = keys.map((key, index) => normalized[index] ?? hashRowKey(rowKeySalt, key));
  return { rowIds: [...new Set(rowIds)], rowKeySalt };
}

function text(value: string | number | null | undefined): Buffer {
  return Buffer.from(value === null || value === undefined ? "" : String(value), "utf8");
}

export function ledgerEntryCanonicalBytes(fields: LedgerEntryFields): Buffer {
  const parts: Buffer[] = [
    text(LEDGER_DOMAIN),
    text(fields.seq),
    text(fields.entryId.toLowerCase()),
    text(canonicalTimestamp(fields.occurredAt)),
    text(fields.scope),
    text(fields.action),
    text(fields.store),
    text(canonicalPredicate(fields.predicate)),
    text(fields.rowIdsSha256),
    text(fields.rowCount),
    text(fields.rowKeySalt),
    text(fields.ruleId),
    text(fields.ruleCutoff === null ? null : canonicalTimestamp(fields.ruleCutoff)),
    text(fields.subjectIdentityId?.toLowerCase() ?? null),
    text(fields.projectId?.toLowerCase() ?? null),
    text(fields.requestId?.toLowerCase() ?? null),
    text(fields.authorityMode),
    text(fields.authoritySequence),
    text(fields.prevHash),
  ];
  const out: Buffer[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(Buffer.from([0]));
    out.push(part);
  });
  return Buffer.concat(out);
}

export function ledgerEntryHash(fields: LedgerEntryFields): string {
  return createHash("sha256").update(ledgerEntryCanonicalBytes(fields)).digest("hex");
}

export function ledgerEntryMac(entryHash: string, key: string): string {
  if (!HEX64_RE.test(entryHash)) throw new Error("entry hash must be 64 lowercase hex characters");
  return createHmac("sha256", Buffer.from(key, "utf8")).update(Buffer.from(entryHash, "hex")).digest("hex");
}

export function verifyLedgerEntryMac(entryHash: string, entryMac: string, key: string): boolean {
  if (!HEX64_RE.test(entryMac)) return false;
  const expected = Buffer.from(ledgerEntryMac(entryHash, key), "hex");
  return timingSafeEqual(expected, Buffer.from(entryMac, "hex"));
}

/** Field checks shared by the writer and the mirror parser. */
export function assertLedgerFields(fields: LedgerEntryFields, rowIds: readonly string[]): void {
  if (!Number.isSafeInteger(fields.seq) || fields.seq < 1) throw new Error("seq must be a positive integer");
  if (!UUID_RE.test(fields.entryId)) throw new Error("entry_id must be a lowercase UUID");
  canonicalTimestamp(fields.occurredAt);
  if (!LEDGER_SCOPES.includes(fields.scope)) throw new Error(`unknown scope ${fields.scope}`);
  if (!LEDGER_ACTIONS.includes(fields.action)) throw new Error(`unknown action ${fields.action}`);
  if (!STORE_RE.test(fields.store)) throw new Error(`store ${fields.store} is not a registry key`);
  const lifecycle = (LIFECYCLE_ACTIONS as readonly string[]).includes(fields.action);
  if (lifecycle !== (fields.store === "lifecycle")) throw new Error("lifecycle actions use store 'lifecycle'");
  canonicalPredicate(fields.predicate);
  if (!HEX64_RE.test(fields.rowIdsSha256)) throw new Error("row_ids_sha256 must be 64 lowercase hex characters");
  if (!Number.isSafeInteger(fields.rowCount) || fields.rowCount < rowIds.length) {
    throw new Error("row_count must cover the row ids");
  }
  if (fields.rowKeySalt !== null && !/^[0-9a-f]{32,128}$/.test(fields.rowKeySalt)) {
    throw new Error("row_key_salt must be hex");
  }
  if ((fields.scope === "retention") !== (fields.ruleId !== null)) {
    throw new Error("retention entries, and only they, carry a rule_id");
  }
  if ((fields.ruleId === null) !== (fields.ruleCutoff === null)) throw new Error("rule_id and rule_cutoff go together");
  if (fields.ruleId !== null && !RULE_RE.test(fields.ruleId)) throw new Error("rule_id is not a rule key");
  if (fields.ruleCutoff !== null) canonicalTimestamp(fields.ruleCutoff);
  for (const id of [fields.subjectIdentityId, fields.projectId, fields.requestId]) {
    if (id !== null && !UUID_RE.test(id)) throw new Error("identity, project and request ids are lowercase UUIDs");
  }
  if (!AUTHORITY_MODES.includes(fields.authorityMode)) throw new Error(`unknown authority mode ${fields.authorityMode}`);
  if (fields.authoritySequence !== null && (!Number.isSafeInteger(fields.authoritySequence) || fields.authoritySequence < 0)) {
    throw new Error("authority_sequence must be a non-negative integer");
  }
  if ((fields.seq === 1) !== (fields.prevHash === "")) throw new Error("only seq 1 has an empty prev_hash");
  if (fields.prevHash !== "" && !HEX64_RE.test(fields.prevHash)) throw new Error("prev_hash must be hex");
  let nonUuid = false;
  for (const id of rowIds) {
    if (UUID_RE.test(id)) continue;
    if (HEX64_RE.test(id)) { nonUuid = true; continue; }
    throw new Error("row ids are lowercase UUIDs or HMAC hex");
  }
  if (nonUuid && fields.rowKeySalt === null) throw new Error("HMAC row keys need a row_key_salt");
  if (rowIds.length > 0) {
    if (fields.scope === "retention" || MONEY_STORES.includes(fields.store)) {
      throw new Error("rule entries and money stores never carry row ids");
    }
    if (rowIdsDigest(rowIds) !== fields.rowIdsSha256) throw new Error("row_ids_sha256 does not match the row ids");
  }
}

// ─── Key provider ──────────────────────────────────────────────────────────

/** Anything that can run one SQL statement inside the caller's transaction. */
export interface LedgerExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** A database that can also open a transaction (drizzle's db, in practice). */
export interface LedgerDatabase extends LedgerExecutor {
  transaction<T>(fn: (tx: LedgerExecutor) => Promise<T>): Promise<T>;
}

export type LedgerKeyProvider = (executor: LedgerExecutor) => Promise<string>;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Production lookup: the Vault secret, read in the erasing transaction. */
export const vaultLedgerKeyProvider: LedgerKeyProvider = async (executor) => {
  const rows = rowsOf<{ key: string | null }>(
    await executor.execute(sql`SELECT deletion.ledger_key() AS key`),
  );
  const key = rows[0]?.key ?? null;
  if (typeof key !== "string" || key.length < LEDGER_KEY_MIN_LENGTH) {
    throw new Error("deletion_ledger_key_unavailable");
  }
  return key;
};

let defaultKeyProvider: LedgerKeyProvider = vaultLedgerKeyProvider;

/** Replace the process-wide key provider (tests; operator drills). Returns
 *  a function that restores the previous provider. */
export function setLedgerKeyProvider(provider: LedgerKeyProvider): () => void {
  const previous = defaultKeyProvider;
  defaultKeyProvider = provider;
  return () => { defaultKeyProvider = previous; };
}

export function currentLedgerKeyProvider(): LedgerKeyProvider {
  return defaultKeyProvider;
}

/** A provider that always returns one fixed key (tests and drills). */
export function fixedLedgerKeyProvider(key: string): LedgerKeyProvider {
  if (key.length < LEDGER_KEY_MIN_LENGTH) throw new Error("ledger key must be at least 32 characters");
  return async () => key;
}

// ─── The writer ────────────────────────────────────────────────────────────

export interface LedgerAppendInput {
  scope: LedgerScope;
  action: LedgerAction;
  store: string;
  /** Row keys as they are; non-UUID keys are stored as salted HMACs. */
  rowKeys?: readonly string[];
  /** For rule and money entries: the digest of ids that are not stored. */
  rowIdsSha256?: string;
  rowCount?: number;
  predicate?: Record<string, string> | null;
  ruleId?: string | null;
  ruleCutoff?: Date | string | null;
  subjectIdentityId?: string | null;
  projectId?: string | null;
  requestId?: string | null;
  authorityMode: LedgerAuthorityMode;
  authoritySequence?: number | null;
}

export interface LedgerAppendOptions {
  keyProvider?: LedgerKeyProvider;
}

export interface AppendedLedgerEntry {
  seq: number;
  entryId: string;
  entryHash: string;
  occurredAt: string;
}

const lower = (value: string | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toLowerCase();

function textArrayLiteral(values: readonly string[]): string {
  // Elements are UUIDs or hex (validated), so no quoting is needed.
  return `{${values.join(",")}}`;
}

/** Append one entry inside the caller's (erasing) transaction. Throws
 *  DeletionLedgerUnavailableError when it cannot; the caller's transaction
 *  must then roll back so the erase does not happen. */
export async function appendLedgerEntry(
  tx: LedgerExecutor,
  input: LedgerAppendInput,
  options: LedgerAppendOptions = {},
): Promise<AppendedLedgerEntry> {
  const { rowIds, rowKeySalt } = prepareRowIds(input.rowKeys ?? []);
  const settings = rowsOf<{ replay_required: boolean }>(
    await tx.execute(sql`SELECT replay_required FROM deletion.settings WHERE id`),
  );
  if (settings[0]?.replay_required) {
    throw new DeletionLedgerUnavailableError("deletion_ledger_replay_required");
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(LEDGER_LOCK_KEY)})`);
  const [head] = rowsOf<{ seq: string; entry_hash: string }>(
    await tx.execute(sql`SELECT l.seq::text AS seq, l.entry_hash FROM deletion.ledger l ORDER BY l.seq DESC LIMIT 1`),
  );
  const [stamp] = rowsOf<{ occurred_at: string; entry_id: string }>(
    await tx.execute(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
                                gen_random_uuid()::text AS entry_id`),
  );
  if (!stamp) throw new DeletionLedgerUnavailableError("deletion_ledger_write_failed", "no clock row");

  const fields: LedgerEntryFields = {
    seq: head ? Number(head.seq) + 1 : 1,
    entryId: stamp.entry_id,
    occurredAt: stamp.occurred_at,
    scope: input.scope,
    action: input.action,
    store: input.store,
    predicate: input.predicate ?? null,
    rowIdsSha256: input.rowIdsSha256 ?? rowIdsDigest(rowIds),
    rowCount: input.rowCount ?? rowIds.length,
    rowKeySalt,
    ruleId: input.ruleId ?? null,
    ruleCutoff: input.ruleCutoff === null || input.ruleCutoff === undefined ? null : canonicalTimestamp(input.ruleCutoff),
    subjectIdentityId: lower(input.subjectIdentityId),
    projectId: lower(input.projectId),
    requestId: lower(input.requestId),
    authorityMode: input.authorityMode,
    authoritySequence: input.authoritySequence ?? null,
    prevHash: head?.entry_hash ?? "",
  };
  assertLedgerFields(fields, rowIds);
  const entryHash = ledgerEntryHash(fields);

  let key: string;
  try {
    key = await (options.keyProvider ?? defaultKeyProvider)(tx);
  } catch (error) {
    throw new DeletionLedgerUnavailableError(
      "deletion_ledger_key_unavailable",
      error instanceof Error ? error.message : undefined,
    );
  }
  if (typeof key !== "string" || key.length < LEDGER_KEY_MIN_LENGTH) {
    throw new DeletionLedgerUnavailableError("deletion_ledger_key_unavailable");
  }
  const entryMac = ledgerEntryMac(entryHash, key);

  await tx.execute(sql`
    INSERT INTO deletion.ledger (
      seq, entry_id, occurred_at, scope, action, store, predicate, row_ids, row_key_salt,
      row_ids_sha256, row_count, rule_id, rule_cutoff, subject_identity_id, project_id,
      request_id, authority_mode, authority_sequence, prev_hash, entry_hash, entry_mac
    ) VALUES (
      ${fields.seq}, ${fields.entryId}::uuid, ${fields.occurredAt}::text::timestamptz, ${fields.scope},
      ${fields.action}, ${fields.store},
      ${fields.predicate === null ? null : JSON.stringify(fields.predicate)}::jsonb,
      ${textArrayLiteral(rowIds)}::text[], ${fields.rowKeySalt}, ${fields.rowIdsSha256},
      ${fields.rowCount}, ${fields.ruleId}, ${fields.ruleCutoff}::text::timestamptz,
      ${fields.subjectIdentityId}::uuid, ${fields.projectId}::uuid, ${fields.requestId}::uuid,
      ${fields.authorityMode}, ${fields.authoritySequence}, ${fields.prevHash}, ${entryHash}, ${entryMac}
    )`);

  return { seq: fields.seq, entryId: fields.entryId, entryHash, occurredAt: fields.occurredAt };
}

// ─── Reading entries back ──────────────────────────────────────────────────

/** Columns of a stored entry with canonical timestamps, for the mirror and replay. */
export const STORED_ENTRY_COLUMNS = sql.raw(`
  seq::text AS seq, entry_id::text AS entry_id,
  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  scope, action, store, predicate, row_ids, row_key_salt, row_ids_sha256, row_count, rule_id,
  CASE WHEN rule_cutoff IS NULL THEN NULL ELSE to_char(rule_cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS rule_cutoff,
  subject_identity_id::text AS subject_identity_id, project_id::text AS project_id,
  request_id::text AS request_id, authority_mode, authority_sequence::text AS authority_sequence,
  prev_hash, entry_hash, entry_mac,
  CASE WHEN mirrored_at IS NULL THEN NULL ELSE to_char(mirrored_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS mirrored_at,
  CASE WHEN replayed_at IS NULL THEN NULL ELSE to_char(replayed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS replayed_at,
  CASE WHEN compacted_at IS NULL THEN NULL ELSE to_char(compacted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS compacted_at
`);

export interface StoredEntryRow {
  seq: string;
  entry_id: string;
  occurred_at: string;
  scope: string;
  action: string;
  store: string;
  predicate: Record<string, string> | string | null;
  row_ids: string[] | string;
  row_key_salt: string | null;
  row_ids_sha256: string;
  row_count: number | string;
  rule_id: string | null;
  rule_cutoff: string | null;
  subject_identity_id: string | null;
  project_id: string | null;
  request_id: string | null;
  authority_mode: string;
  authority_sequence: string | null;
  prev_hash: string;
  entry_hash: string;
  entry_mac: string;
  mirrored_at: string | null;
  replayed_at: string | null;
  compacted_at: string | null;
}

function parseTextArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  const inner = value.replace(/^\{|\}$/g, "");
  return inner === "" ? [] : inner.split(",");
}

export function storedEntryFromRow(row: StoredEntryRow): StoredLedgerEntry {
  const predicate = typeof row.predicate === "string" ? JSON.parse(row.predicate) : row.predicate;
  return {
    seq: Number(row.seq),
    entryId: row.entry_id,
    occurredAt: row.occurred_at,
    scope: row.scope as LedgerScope,
    action: row.action as LedgerAction,
    store: row.store,
    predicate: predicate ?? null,
    rowIds: parseTextArray(row.row_ids),
    rowKeySalt: row.row_key_salt,
    rowIdsSha256: row.row_ids_sha256,
    rowCount: Number(row.row_count),
    ruleId: row.rule_id,
    ruleCutoff: row.rule_cutoff,
    subjectIdentityId: row.subject_identity_id,
    projectId: row.project_id,
    requestId: row.request_id,
    authorityMode: row.authority_mode as LedgerAuthorityMode,
    authoritySequence: row.authority_sequence === null ? null : Number(row.authority_sequence),
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    entryMac: row.entry_mac,
    mirroredAt: row.mirrored_at,
    replayedAt: row.replayed_at,
    compactedAt: row.compacted_at,
  };
}

export async function readLedgerEntries(
  executor: LedgerExecutor,
  where: SQL = sql`TRUE`,
  limit = 500,
): Promise<StoredLedgerEntry[]> {
  const rows = rowsOf<StoredEntryRow>(
    await executor.execute(sql`SELECT ${STORED_ENTRY_COLUMNS} FROM deletion.ledger l WHERE ${where} ORDER BY l.seq LIMIT ${limit}`),
  );
  return rows.map(storedEntryFromRow);
}

export async function readLedgerHead(
  executor: LedgerExecutor,
): Promise<{ seq: number; entryHash: string } | null> {
  const [row] = rowsOf<{ seq: string; entry_hash: string }>(
    await executor.execute(sql`SELECT l.seq::text AS seq, l.entry_hash FROM deletion.ledger l ORDER BY l.seq DESC LIMIT 1`),
  );
  return row ? { seq: Number(row.seq), entryHash: row.entry_hash } : null;
}
