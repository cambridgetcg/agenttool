/** The off-database deletion-ledger mirror.
 *
 *  A backup restore rolls the ledger back with everything else, so every
 *  entry is also written to a private, write-once object store outside the
 *  Supabase project. After a restore the replay procedure
 *  (docs/DELETION-REPLAY.md) reads the entries the restored database lacks
 *  from here and re-applies them.
 *
 *  Object key:  ledger/v1/<seq, 12 digits>-<entry_id>.json
 *  Object body: the entry's canonical JSON (ids, hashes and its MAC only).
 *  The key names the entry and the bytes are fixed, so a re-send writes the
 *  same object and is not a new mutation. Writes are conditional
 *  (If-None-Match: *); an existing object is accepted only when it is the
 *  same entry, otherwise the push stops and reports a conflict.
 *
 *  Implementations: S3LedgerMirror (Cloudflare R2 through its S3 API, or any
 *  S3-compatible store; credentials from the environment) and
 *  FileLedgerMirror (a local directory, for operator drills and tests).
 *  The pusher holds no ledger key: it copies entries exactly as stored.
 *
 *  When no mirror is configured the in-request push is a no-op (entries stay
 *  unmirrored in the database); the sweep and the replay script refuse.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.3. */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { sql } from "drizzle-orm";

import {
  assertLedgerFields,
  readLedgerEntries,
  type LedgerAction,
  type LedgerAuthorityMode,
  type LedgerExecutor,
  type LedgerScope,
  type StoredLedgerEntry,
} from "./ledger";

export const MIRROR_SCHEMA = "agenttool-deletion-ledger-mirror/v1";
export const MIRROR_PREFIX = "ledger/v1/";
const OBJECT_KEY_RE = /^ledger\/v1\/(\d{12})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

export interface LedgerMirror {
  readonly kind: string;
  /** Write the object unless it exists. "exists" only when the existing
   *  object is the same entry; a different object throws MirrorConflictError. */
  putIfAbsent(key: string, bytes: Uint8Array): Promise<"created" | "exists">;
  get(key: string): Promise<Uint8Array | null>;
  /** Every key under the prefix, sorted, strictly after `startAfter`. */
  list(prefix: string, startAfter?: string): Promise<string[]>;
}

export class MirrorConflictError extends Error {
  constructor(readonly key: string) {
    super(`mirror object ${key} exists with different content; refusing to overwrite`);
    this.name = "MirrorConflictError";
  }
}

export class MirrorRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MirrorRequestError";
  }
}

// ─── Object encoding ───────────────────────────────────────────────────────

export function mirrorObjectKey(seq: number, entryId: string): string {
  if (!Number.isSafeInteger(seq) || seq < 1 || seq >= 1e12) throw new Error("seq out of range for the mirror key");
  return `${MIRROR_PREFIX}${String(seq).padStart(12, "0")}-${entryId.toLowerCase()}.json`;
}

export function parseMirrorObjectKey(key: string): { seq: number; entryId: string } | null {
  const match = OBJECT_KEY_RE.exec(key);
  return match ? { seq: Number(match[1]), entryId: match[2]! } : null;
}

/** Canonical JSON with a fixed key order; the bytes are a function of the entry. */
export function mirrorObjectBytes(entry: StoredLedgerEntry): Uint8Array {
  const ordered = {
    schema: MIRROR_SCHEMA,
    seq: entry.seq,
    entry_id: entry.entryId,
    occurred_at: entry.occurredAt,
    scope: entry.scope,
    action: entry.action,
    store: entry.store,
    predicate: entry.predicate === null
      ? null
      : Object.fromEntries(Object.keys(entry.predicate).sort().map((key) => [key, entry.predicate![key]])),
    row_ids: [...entry.rowIds],
    row_key_salt: entry.rowKeySalt,
    row_ids_sha256: entry.rowIdsSha256,
    row_count: entry.rowCount,
    rule_id: entry.ruleId,
    rule_cutoff: entry.ruleCutoff,
    subject_identity_id: entry.subjectIdentityId,
    project_id: entry.projectId,
    request_id: entry.requestId,
    authority_mode: entry.authorityMode,
    authority_sequence: entry.authoritySequence,
    prev_hash: entry.prevHash,
    entry_hash: entry.entryHash,
    entry_mac: entry.entryMac,
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

/** Strict parse: shape, field rules and key/body agreement. The caller still
 *  checks the hash, the MAC and the chain. */
export function parseMirrorObject(bytes: Uint8Array, key?: string): StoredLedgerEntry {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<string, unknown>;
  if (!value || typeof value !== "object" || value.schema !== MIRROR_SCHEMA) {
    throw new Error("not an agenttool-deletion-ledger-mirror/v1 object");
  }
  const str = (name: string): string => {
    const field = value[name];
    if (typeof field !== "string") throw new Error(`mirror field ${name} must be a string`);
    return field;
  };
  const nullableStr = (name: string): string | null => (value[name] === null ? null : str(name));
  const num = (name: string): number => {
    const field = value[name];
    if (typeof field !== "number" || !Number.isSafeInteger(field)) throw new Error(`mirror field ${name} must be an integer`);
    return field;
  };
  const rowIds = value.row_ids;
  if (!Array.isArray(rowIds) || rowIds.some((id) => typeof id !== "string")) throw new Error("row_ids must be strings");
  const predicate = value.predicate;
  if (predicate !== null && (typeof predicate !== "object" || Array.isArray(predicate))) {
    throw new Error("predicate must be an object or null");
  }
  const entry: StoredLedgerEntry = {
    seq: num("seq"),
    entryId: str("entry_id"),
    occurredAt: str("occurred_at"),
    scope: str("scope") as LedgerScope,
    action: str("action") as LedgerAction,
    store: str("store"),
    predicate: predicate as Record<string, string> | null,
    rowIds: rowIds as string[],
    rowKeySalt: nullableStr("row_key_salt"),
    rowIdsSha256: str("row_ids_sha256"),
    rowCount: num("row_count"),
    ruleId: nullableStr("rule_id"),
    ruleCutoff: nullableStr("rule_cutoff"),
    subjectIdentityId: nullableStr("subject_identity_id"),
    projectId: nullableStr("project_id"),
    requestId: nullableStr("request_id"),
    authorityMode: str("authority_mode") as LedgerAuthorityMode,
    authoritySequence: value.authority_sequence === null ? null : num("authority_sequence"),
    prevHash: str("prev_hash"),
    entryHash: str("entry_hash"),
    entryMac: str("entry_mac"),
    mirroredAt: null,
    replayedAt: null,
    compactedAt: null,
  };
  assertLedgerFields(entry, entry.rowIds);
  if (!/^[0-9a-f]{64}$/.test(entry.entryHash) || !/^[0-9a-f]{64}$/.test(entry.entryMac)) {
    throw new Error("entry_hash and entry_mac must be hex");
  }
  if (key !== undefined && key !== mirrorObjectKey(entry.seq, entry.entryId)) {
    throw new Error(`mirror object ${key} does not hold entry ${entry.seq}-${entry.entryId}`);
  }
  return entry;
}

/** Same entry: identical seq, entry_id, entry_hash and MAC. */
function sameEntry(existing: Uint8Array, incoming: Uint8Array): boolean {
  try {
    const a = parseMirrorObject(existing);
    const b = parseMirrorObject(incoming);
    return a.seq === b.seq && a.entryId === b.entryId && a.entryHash === b.entryHash && a.entryMac === b.entryMac;
  } catch {
    return false;
  }
}

// ─── S3-compatible (Cloudflare R2) ─────────────────────────────────────────

export interface S3LedgerMirrorOptions {
  /** Account endpoint, e.g. https://<account-id>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** Test-only: allow http:// to a loopback host. */
  allowInsecureLoopbackHttpForTests?: boolean;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export class S3LedgerMirror implements LedgerMirror {
  readonly kind = "s3";
  readonly #origin: string;
  readonly #host: string;
  readonly #bucket: string;
  readonly #region: string;
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(options: S3LedgerMirrorOptions) {
    const url = new URL(options.endpoint);
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      throw new Error("mirror endpoint must be a bare origin (https://host[:port])");
    }
    if (url.protocol !== "https:") {
      if (!(url.protocol === "http:" && options.allowInsecureLoopbackHttpForTests && isLoopback(url.hostname))) {
        throw new Error("mirror endpoint must use https");
      }
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket)) throw new Error("mirror bucket name is invalid");
    if (!options.accessKeyId || !options.secretAccessKey) throw new Error("mirror credentials are required");
    this.#origin = url.origin;
    this.#host = url.host;
    this.#bucket = options.bucket;
    this.#region = options.region || "auto";
    this.#accessKeyId = options.accessKeyId;
    this.#secretAccessKey = options.secretAccessKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  #signingKey(dateStamp: string): Uint8Array {
    const enc = new TextEncoder();
    const kDate = hmac(sha256, enc.encode(`AWS4${this.#secretAccessKey}`), enc.encode(dateStamp));
    const kRegion = hmac(sha256, kDate, enc.encode(this.#region));
    const kService = hmac(sha256, kRegion, enc.encode("s3"));
    return hmac(sha256, kService, enc.encode("aws4_request"));
  }

  async #request(
    method: "GET" | "PUT",
    key: string | null,
    options: { query?: Record<string, string>; body?: Uint8Array; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const path = `/${rfc3986(this.#bucket)}${key === null ? "" : `/${key.split("/").map(rfc3986).join("/")}`}`;
    const query = Object.entries(options.query ?? {})
      .map(([name, value]) => [rfc3986(name), rfc3986(value)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");
    const payloadHash = options.body ? hex(sha256(options.body)) : EMPTY_SHA256;
    const now = this.#now();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: this.#host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
    };
    const signedNames = Object.keys(headers).sort();
    const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join("");
    const signedHeaders = signedNames.join(";");
    const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.#region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256", amzDate, scope, hex(sha256(new TextEncoder().encode(canonicalRequest))),
    ].join("\n");
    const signature = hex(hmac(sha256, this.#signingKey(dateStamp), new TextEncoder().encode(stringToSign)));
    const { host: _host, ...sendHeaders } = headers;
    const response = await this.#fetch(`${this.#origin}${path}${query ? `?${query}` : ""}`, {
      method,
      headers: {
        ...sendHeaders,
        authorization:
          `AWS4-HMAC-SHA256 Credential=${this.#accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: options.body ? Buffer.from(options.body) : undefined,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    return response;
  }

  async putIfAbsent(key: string, bytes: Uint8Array): Promise<"created" | "exists"> {
    const response = await this.#request("PUT", key, {
      body: bytes,
      headers: { "content-type": "application/json", "if-none-match": "*" },
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 200 || response.status === 201) return "created";
    if (response.status === 412 || response.status === 409) {
      const existing = await this.get(key);
      if (existing && sameEntry(existing, bytes)) return "exists";
      throw new MirrorConflictError(key);
    }
    throw new MirrorRequestError(`mirror PUT ${key} answered ${response.status}`, response.status);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.#request("GET", key);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new MirrorRequestError(`mirror GET ${key} answered ${response.status}`, response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async list(prefix: string, startAfter?: string): Promise<string[]> {
    const keys: string[] = [];
    let continuation: string | null = null;
    for (let page = 0; page < 10_000; page++) {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (continuation) query["continuation-token"] = continuation;
      else if (startAfter) query["start-after"] = startAfter;
      const response = await this.#request("GET", null, { query });
      const body = await response.text();
      if (response.status !== 200) throw new MirrorRequestError(`mirror LIST answered ${response.status}`, response.status);
      for (const match of body.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlUnescape(match[1]!));
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(body);
      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(body);
      if (!truncated) break;
      if (!next) throw new MirrorRequestError("mirror LIST was truncated without a continuation token");
      continuation = xmlUnescape(next[1]!);
    }
    return keys.filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter)).sort();
  }
}

// ─── Local directory (drills and tests) ────────────────────────────────────

export class FileLedgerMirror implements LedgerMirror {
  readonly kind = "file";
  constructor(readonly directory: string) {}

  #path(key: string): string {
    if (!/^[a-z0-9][a-z0-9/._-]*$/.test(key) || key.includes("..")) throw new Error(`unsafe mirror key ${key}`);
    return join(this.directory, ...key.split("/"));
  }

  async putIfAbsent(key: string, bytes: Uint8Array): Promise<"created" | "exists"> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      return "created";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = new Uint8Array(await readFile(path));
      if (sameEntry(existing, bytes)) return "exists";
      throw new MirrorConflictError(key);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(prefix: string, startAfter?: string): Promise<string[]> {
    const root = this.directory;
    const found: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) found.push(relative(root, path).split(sep).join("/"));
      }
    };
    await walk(root);
    return found.filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter)).sort();
  }
}

// ─── Configuration ─────────────────────────────────────────────────────────

export const MIRROR_ENV = {
  endpoint: "AGENTTOOL_DELETION_MIRROR_ENDPOINT",
  bucket: "AGENTTOOL_DELETION_MIRROR_BUCKET",
  accessKeyId: "AGENTTOOL_DELETION_MIRROR_ACCESS_KEY_ID",
  secretAccessKey: "AGENTTOOL_DELETION_MIRROR_SECRET_ACCESS_KEY",
  region: "AGENTTOOL_DELETION_MIRROR_REGION",
} as const;

export type MirrorConfig =
  | { status: "configured"; mirror: LedgerMirror }
  | { status: "unconfigured" }
  | { status: "misconfigured"; problem: string };

/** Read the mirror from the environment at call time. All four required
 *  variables present: configured. None: unconfigured. Some: misconfigured
 *  (treated as not configured, and reported). */
export function ledgerMirrorFromEnv(env: Record<string, string | undefined> = process.env): MirrorConfig {
  const required = [MIRROR_ENV.endpoint, MIRROR_ENV.bucket, MIRROR_ENV.accessKeyId, MIRROR_ENV.secretAccessKey];
  const present = required.filter((name) => (env[name] ?? "").trim() !== "");
  if (present.length === 0) return { status: "unconfigured" };
  if (present.length < required.length) {
    return { status: "misconfigured", problem: `missing ${required.filter((name) => !present.includes(name)).join(", ")}` };
  }
  try {
    return {
      status: "configured",
      mirror: new S3LedgerMirror({
        endpoint: env[MIRROR_ENV.endpoint]!.trim(),
        bucket: env[MIRROR_ENV.bucket]!.trim(),
        accessKeyId: env[MIRROR_ENV.accessKeyId]!.trim(),
        secretAccessKey: env[MIRROR_ENV.secretAccessKey]!.trim(),
        region: env[MIRROR_ENV.region]?.trim() || "auto",
      }),
    };
  } catch (error) {
    return { status: "misconfigured", problem: error instanceof Error ? error.message : "invalid mirror configuration" };
  }
}

// ─── Pushing ───────────────────────────────────────────────────────────────

export interface PushResult {
  pushed: number;
  existed: number;
  /** Highest seq now known to be mirrored by this push, or 0. */
  mirroredThroughSeq: number;
  failure: { seq: number; error: string } | null;
}

/** Push unmirrored entries in seq order, stopping at the first failure so the
 *  mirror never skips an entry. Holds no ledger key. */
export async function pushUnmirroredEntries(
  executor: LedgerExecutor,
  mirror: LedgerMirror,
  options: { limit?: number } = {},
): Promise<PushResult> {
  const result: PushResult = { pushed: 0, existed: 0, mirroredThroughSeq: 0, failure: null };
  const entries = await readLedgerEntries(executor, sql`mirrored_at IS NULL`, options.limit ?? 500);
  for (const entry of entries) {
    try {
      const outcome = await mirror.putIfAbsent(mirrorObjectKey(entry.seq, entry.entryId), mirrorObjectBytes(entry));
      if (outcome === "created") result.pushed++;
      else result.existed++;
      await executor.execute(sql`UPDATE deletion.ledger SET mirrored_at = now() WHERE seq = ${entry.seq} AND mirrored_at IS NULL`);
      result.mirroredThroughSeq = entry.seq;
    } catch (error) {
      result.failure = { seq: entry.seq, error: error instanceof Error ? error.message : String(error) };
      break;
    }
  }
  return result;
}

let misconfigurationReported = false;

/** In-request push, after the erasing transaction committed. Never throws
 *  and never undoes the erase; bounded by `timeoutMs`. Returns whether the
 *  given entry is now mirrored. */
export async function pushLedgerMirrorAfterCommit(
  executor: LedgerExecutor,
  entrySeq: number,
  options: { timeoutMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<{ mirrored: boolean; status: "pushed" | "unconfigured" | "misconfigured" | "failed" | "timeout" }> {
  const config = ledgerMirrorFromEnv(options.env ?? process.env);
  if (config.status === "unconfigured") return { mirrored: false, status: "unconfigured" };
  if (config.status === "misconfigured") {
    if (!misconfigurationReported) {
      misconfigurationReported = true;
      console.error(`[deletion-ledger] mirror misconfigured (${config.problem}); entries stay unmirrored until the sweep runs`);
    }
    return { mirrored: false, status: "misconfigured" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      pushUnmirroredEntries(executor, config.mirror),
      new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), options.timeoutMs ?? 2_500); }),
    ]);
    if (outcome === "timeout") return { mirrored: false, status: "timeout" };
    if (outcome.failure) {
      console.error(`[deletion-ledger] mirror push stopped at seq ${outcome.failure.seq}: ${outcome.failure.error}`);
    }
    // A concurrent push may have mirrored this entry; ask the ledger.
    const rows = await executor.execute(
      sql`SELECT (mirrored_at IS NOT NULL) AS mirrored FROM deletion.ledger WHERE seq = ${entrySeq}`,
    );
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] })?.rows ?? []);
    return {
      mirrored: (list[0] as { mirrored?: boolean } | undefined)?.mirrored === true,
      status: outcome.failure ? "failed" : "pushed",
    };
  } catch (error) {
    console.error(`[deletion-ledger] mirror push failed: ${error instanceof Error ? error.message : String(error)}`);
    return { mirrored: false, status: "failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── The sweep (bin/deletion-ledger-mirror.ts) ─────────────────────────────

export interface MirrorLagStatus {
  /** Entries whose mirrored_at is still NULL. */
  unmirrored: number;
  oldestSeq: number | null;
  oldestAt: string | null;
  /** Seconds since the oldest unmirrored entry was written, or null. */
  oldestAgeSeconds: number | null;
  replayRequired: boolean;
}

/** The operator readback of mirror lag (spec §13.3 "Lag"): how many entries
 *  are not yet off the database and how old the oldest is. Database only;
 *  needs no mirror credential and changes nothing. */
export async function ledgerMirrorStatus(executor: LedgerExecutor): Promise<MirrorLagStatus> {
  const list = (result: unknown) => (Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? []));
  const [settings] = list(await executor.execute(sql`SELECT replay_required FROM deletion.settings WHERE id`)) as Array<{ replay_required: boolean }>;
  const [waiting] = list(await executor.execute(sql`
    SELECT count(*)::int AS count, min(seq)::text AS oldest_seq,
           to_char(min(occurred_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS oldest_at,
           floor(extract(epoch FROM (clock_timestamp() - min(occurred_at))))::bigint::text AS oldest_age_seconds
      FROM deletion.ledger WHERE mirrored_at IS NULL`)) as Array<{
    count: number; oldest_seq: string | null; oldest_at: string | null; oldest_age_seconds: string | null;
  }>;
  return {
    unmirrored: Number(waiting?.count ?? 0),
    oldestSeq: waiting?.oldest_seq ? Number(waiting.oldest_seq) : null,
    oldestAt: waiting?.oldest_at ?? null,
    oldestAgeSeconds: waiting?.oldest_age_seconds ? Number(waiting.oldest_age_seconds) : null,
    replayRequired: settings?.replay_required === true,
  };
}

export interface SweepReport {
  mode: "dry-run" | "push";
  mirror: string;
  unmirrored: number;
  oldestSeq: number | null;
  oldestAt: string | null;
  pushed: number;
  existed: number;
  failure: { seq: number; error: string } | null;
}

/** Report the oldest unmirrored entry and, unless dry-run, push everything
 *  unmirrored in seq order. Refuses while a restore is being replayed. */
export async function sweepLedgerMirror(
  executor: LedgerExecutor,
  mirror: LedgerMirror,
  options: { dryRun: boolean },
): Promise<SweepReport> {
  const status = await ledgerMirrorStatus(executor);
  if (status.replayRequired) throw new Error("a restore is being replayed; the sweep is paused until replay finishes");
  const report: SweepReport = {
    mode: options.dryRun ? "dry-run" : "push",
    mirror: mirror.kind,
    unmirrored: status.unmirrored,
    oldestSeq: status.oldestSeq,
    oldestAt: status.oldestAt,
    pushed: 0,
    existed: 0,
    failure: null,
  };
  if (options.dryRun) return report;
  for (;;) {
    const result = await pushUnmirroredEntries(executor, mirror, { limit: 500 });
    report.pushed += result.pushed;
    report.existed += result.existed;
    if (result.failure) {
      report.failure = result.failure;
      break;
    }
    if (result.pushed + result.existed === 0) break;
  }
  return report;
}
