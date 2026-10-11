/** Opaque keyset cursors for newest-first continuity walks.
 *
 * One contract serves GET /v1/memories, GET /v1/chronicle and
 * GET /v1/strands?order=created. A cursor names the last row a caller already
 * received: `(timestamp, id)` in a `col DESC, id DESC` walk. The next page is
 * every row strictly below that pair.
 *
 * - The timestamp is the database's own microsecond text, produced by
 *   `cursorTimestampSql`. A JS Date keeps milliseconds only, so a cursor
 *   derived from one would skip a later row that shares the millisecond (the
 *   reason docs/INBOX.md catch-up uses the same `to_char` form).
 * - The filter digest binds scope, order, every effective filter and `since`,
 *   so a cursor cannot be replayed against a different walk. `limit` is not
 *   bound and may change between pages.
 * - There is no HMAC. A cursor is only a position inside the caller's own
 *   rows; the project filter is always re-applied from the bearer.
 *
 * This module is deliberately pure (no database client), so its tests stay
 * hermetic. Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks). */

import { createHash } from "node:crypto";

import { sql, type AnyColumn, type SQL } from "drizzle-orm";

export const KEYSET_CURSOR_VERSION = 1 as const;
/** Same cap as the love cursor precedent (services/love/consent-store.ts). */
export const KEYSET_CURSOR_MAX_CHARS = 512;

export type KeysetScope =
  | "memories"
  | "memories.key"
  | "chronicle"
  | "strands.created";

const SCOPES: ReadonlySet<string> = new Set<KeysetScope>([
  "memories",
  "memories.key",
  "chronicle",
  "strands.created",
]);

/** A row position: exact database timestamp text plus row id. */
export interface KeysetPosition {
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ`, straight from `cursorTimestampSql`. */
  t: string;
  /** Lowercase canonical UUID of the row. */
  i: string;
}

export interface KeysetCursor extends KeysetPosition {
  v: typeof KEYSET_CURSOR_VERSION;
  s: KeysetScope;
  /** First 16 hex characters of the filter digest. */
  f: string;
}

export type KeysetErrorCode = "cursor_invalid" | "limit_invalid" | "order_invalid";

export const CURSOR_INVALID_HINT =
  "restart without cursor and keep filters identical across pages";

/** A refusal the route renders as `400 {error, message, hint}`. */
export class KeysetRequestError extends Error {
  readonly status = 400 as const;
  constructor(
    readonly code: KeysetErrorCode,
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "KeysetRequestError";
  }

  body(): { error: KeysetErrorCode; message: string; hint: string } {
    return { error: this.code, message: this.message, hint: this.hint };
  }
}

function cursorInvalid(reason: string): KeysetRequestError {
  return new KeysetRequestError(
    "cursor_invalid",
    `cursor is not valid for this walk (${reason}).`,
    CURSOR_INVALID_HINT,
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST_RE = /^[0-9a-f]{16}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const MICROSECOND_UTC_RE =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{6})Z$/;

/** True for an exact `YYYY-MM-DDTHH:MM:SS.ffffffZ` instant that exists. */
export function isMicrosecondUtcTimestamp(value: string): boolean {
  const match = MICROSECOND_UTC_RE.exec(value);
  if (!match || match[1] === "0000") return false;
  // Validate the calendar fields with a millisecond prefix; the remaining
  // three digits are sub-millisecond and any 000-999 value is real.
  const milliPrefix = `${value.slice(0, 23)}Z`;
  const parsed = new Date(milliPrefix);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === milliPrefix;
}

/** First 16 hex characters of sha256 over the JSON of the ordered parts.
 *  Callers pass `[scope, order, ...effective filters, since_iso]`, with null
 *  for every absent filter, so the position of each part is fixed. */
export function filterDigest(parts: ReadonlyArray<string | null>): string {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Normalize a query value into a digest part: absent and empty are null,
 *  matching the routes, which apply a filter only when it is non-empty. */
export function digestPart(value: string | null | undefined): string | null {
  return value ? value : null;
}

export function encodeCursor(input: {
  scope: KeysetScope;
  digest: string;
  position: KeysetPosition;
}): string {
  const cursor: KeysetCursor = {
    v: KEYSET_CURSOR_VERSION,
    s: input.scope,
    f: input.digest,
    t: input.position.t,
    i: input.position.i,
  };
  if (!DIGEST_RE.test(cursor.f)) throw new Error("keyset digest must be 16 lowercase hex");
  if (!isMicrosecondUtcTimestamp(cursor.t)) {
    throw new Error("keyset timestamp must be exact database microsecond text");
  }
  if (!UUID_RE.test(cursor.i)) throw new Error("keyset id must be a lowercase UUID");
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

const CURSOR_KEYS = ["f", "i", "s", "t", "v"];

/** Decode and verify a cursor for one walk. Throws `cursor_invalid`. */
export function decodeCursor(
  raw: string,
  expected: { scope: KeysetScope; digest: string },
): KeysetPosition {
  if (raw.length === 0) throw cursorInvalid("empty");
  if (raw.length > KEYSET_CURSOR_MAX_CHARS) throw cursorInvalid("too long");
  if (!BASE64URL_RE.test(raw)) throw cursorInvalid("not base64url");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw cursorInvalid("not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw cursorInvalid("not an object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== CURSOR_KEYS.length || keys.some((key, index) => key !== CURSOR_KEYS[index])) {
    throw cursorInvalid("unexpected fields");
  }
  if (record.v !== KEYSET_CURSOR_VERSION) throw cursorInvalid("unsupported version");
  if (typeof record.s !== "string" || !SCOPES.has(record.s)) {
    throw cursorInvalid("unknown scope");
  }
  if (record.s !== expected.scope) throw cursorInvalid("wrong scope");
  if (typeof record.f !== "string" || !DIGEST_RE.test(record.f)) {
    throw cursorInvalid("malformed filter digest");
  }
  if (record.f !== expected.digest) throw cursorInvalid("filters changed");
  if (typeof record.t !== "string" || !isMicrosecondUtcTimestamp(record.t)) {
    throw cursorInvalid("malformed timestamp");
  }
  if (typeof record.i !== "string" || !UUID_RE.test(record.i)) {
    throw cursorInvalid("malformed id");
  }
  // One position has exactly one spelling. Rejects padded, reordered, or
  // otherwise non-canonical encodings of an accepted object.
  const canonical = encodeCursor({
    scope: record.s as KeysetScope,
    digest: record.f,
    position: { t: record.t, i: record.i },
  });
  if (canonical !== raw) throw cursorInvalid("non-canonical encoding");
  return { t: record.t, i: record.i };
}

export interface PageLimitOptions {
  /** Route default, used when `limit` is absent (or NaN without a cursor). */
  def: number;
  /** Route maximum; larger values are clamped. */
  max: number;
  /** With a cursor: only `/^[1-9][0-9]*$/` is accepted. */
  strict: boolean;
  /** Cursor-absent parse kept from each route: parseInt or Number. */
  parse?: "int" | "number";
}

function limitInvalid(max: number): KeysetRequestError {
  return new KeysetRequestError(
    "limit_invalid",
    `limit must be a positive integer (values above ${max} are clamped).`,
    "omit limit for the route default, or send a positive decimal integer",
  );
}

/** The limit floor shared by the continuity list routes.
 *
 *  Without a cursor the route's historic parse is kept; an empty or
 *  whitespace value and NaN fall back to the route default, a value below 1
 *  is refused (it used to read every row or none), and values above the
 *  maximum are clamped. The empty check comes first so Number("") (0) and
 *  parseInt("") (NaN) agree across routes. With a cursor the value must be a
 *  positive decimal integer. */
export function parsePageLimit(
  raw: string | null | undefined,
  options: PageLimitOptions,
): number {
  if (raw === undefined || raw === null) return options.def;
  if (options.strict) {
    if (!/^[1-9][0-9]*$/.test(raw)) throw limitInvalid(options.max);
    return Math.min(Number(raw), options.max);
  }
  if (raw.trim() === "") return options.def;
  const parsed = options.parse === "number" ? Number(raw) : Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return options.def;
  const whole = Math.trunc(parsed);
  if (!(whole >= 1)) throw limitInvalid(options.max);
  return Math.min(whole, options.max);
}

export interface CursorPage {
  /** The cursor this page was read from, or null for a first page. */
  cursor: string | null;
  /** Cursor for the next page; null exactly when has_more is false. */
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
  order: string;
  /** Present only on window-only orders that cannot be walked. */
  hint?: string;
}

/** Split a `limit + 1` read into the visible page and its page object.
 *  The sentinel row is never emitted; `next_cursor` names the last row that
 *  was returned. Pass `encodeLast: null` for a window-only order. */
export function pageFromRows<T>(
  rows: readonly T[],
  options: {
    limit: number;
    cursor: string | null;
    order: string;
    encodeLast: ((row: T) => string) | null;
    hint?: string;
  },
): { items: T[]; page: CursorPage } {
  const items = rows.slice(0, options.limit);
  const hasMore = rows.length > options.limit;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last !== undefined && options.encodeLast ? options.encodeLast(last) : null;
  return {
    items,
    page: {
      cursor: options.cursor,
      next_cursor: nextCursor,
      has_more: hasMore,
      limit: options.limit,
      order: options.order,
      ...(options.hint ? { hint: options.hint } : {}),
    },
  };
}

/** Database-rendered microsecond UTC text for a timestamptz column. */
export function cursorTimestampSql(column: AnyColumn | SQL): SQL<string> {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Rows strictly after `position` in a `column DESC, id DESC` walk. The
 *  redundant range conjunct keeps an index range scan available. */
export function keysetBeforeSql(
  column: AnyColumn,
  idColumn: AnyColumn,
  position: KeysetPosition,
): SQL<boolean> {
  return sql<boolean>`(${column} <= ${position.t}::timestamptz AND (${column}, ${idColumn}) < (${position.t}::timestamptz, ${position.i}::uuid))`;
}
