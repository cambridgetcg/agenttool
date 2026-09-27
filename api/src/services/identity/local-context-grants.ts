/** Administrator-issued, single-target read capabilities. Doctrine: docs/LOCAL-CONTEXT-GRANTS.md. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { localContextGrants } from "../../db/schema/local-context-grants";
import { apiKeys } from "../../db/schema/tools";
import { LOCAL_CONTEXT_BOUNDS, readLocalContextInTransaction } from "./local-context";
import { IdentityPartitionError, requireActiveProjectIdentity } from "./partition";

export const LOCAL_CONTEXT_GRANT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const LOCAL_CONTEXT_GRANT_LIST_DEFAULT = 50;
export const LOCAL_CONTEXT_GRANT_LIST_MAX = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ACTION = "local_context.read" as const;
const METHOD = "GET" as const;
const pathFor = (identityId: string) => `/v1/identities/${identityId}/local-context`;

export interface LocalContextGrantMetadata {
  grant_id: string;
  project_id: string;
  identity_id: string;
  issuing_api_key_id: string;
  origin: string;
  action: typeof ACTION;
  method: typeof METHOD;
  path: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface LocalContextGrantOptions {
  database?: Pick<typeof db, "transaction">;
  now?: Date;
}

type GrantRow = typeof localContextGrants.$inferSelect;
type MetadataRow = Omit<GrantRow, "tokenHash">;
const metadataColumns = {
  id: localContextGrants.id, projectId: localContextGrants.projectId, identityId: localContextGrants.identityId,
  issuingApiKeyId: localContextGrants.issuingApiKeyId, origin: localContextGrants.origin,
  action: localContextGrants.action, method: localContextGrants.method, path: localContextGrants.path,
  issuedAt: localContextGrants.issuedAt, expiresAt: localContextGrants.expiresAt, revokedAt: localContextGrants.revokedAt,
};
const parentColumns = {
  id: apiKeys.id, projectId: apiKeys.projectId,
  revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt,
};

export class LocalContextGrantError extends HTTPException {
  constructor(reason: "invalid_request" | "invalid_credential" | "parent_unavailable" | "not_found" | "conflict" | "invalid_state") {
    const status = { invalid_request: 400, invalid_credential: 401, parent_unavailable: 403,
      not_found: 404, conflict: 409, invalid_state: 503 } as const;
    const messages = {
      invalid_request: "Use canonical UUIDs, a configured HTTPS origin, and an explicit finite expiry within the grant lifetime.",
      invalid_credential: "This local-context credential does not authorize this read.",
      parent_unavailable: "The issuing API key must currently belong to this project and remain valid through the requested expiry.",
      not_found: "The selected local-context grant was not found in this project and identity.",
      conflict: "This grant ID has already been issued. It cannot be renewed or issued again.",
      invalid_state: "Local-context grant state could not be validated.",
    };
    super(status[reason], { message: messages[reason], cause: {
      error: `local_context_grant_${reason}`, message: messages[reason],
      hint: reason === "conflict"
        ? "Inspect grant metadata. If a new grant is intended, explicitly choose a new grant_id; an earlier token cannot be recovered."
        : "Inspect the grant scope, expiry and parent key with the project administrator before making another request.",
      docs: "https://docs.agenttool.dev/LOCAL-CONTEXT-GRANTS.md",
      next_actions: [{ action: "Read the local-context grant contract", method: "GET", path: "https://docs.agenttool.dev/LOCAL-CONTEXT-GRANTS.md" }],
    } });
    this.name = "LocalContextGrantError";
  }
}

function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

function finiteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function explicitExpiry(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month! < 1 || month! > 12 || day! < 1 || day! > days[month! - 1]!
    || hour! > 23 || minute! > 59 || second! > 59
    || (zone !== "Z" && (Number(zone!.slice(1, 3)) > 23 || Number(zone!.slice(4, 6)) > 59))) return null;
  const parsed = new Date(value);
  return finiteDate(parsed) ? parsed : null;
}

function nowFor(options: LocalContextGrantOptions): Date {
  const now = options.now ?? new Date();
  if (!finiteDate(now)) throw new LocalContextGrantError("invalid_request");
  return now;
}

function assertSubject(projectId: string, identityId: string) {
  if (!canonicalUuid(projectId) || !canonicalUuid(identityId)) throw new LocalContextGrantError("invalid_request");
}

function validMetadata(row: MetadataRow): boolean {
  return !!row && canonicalUuid(row.id) && canonicalUuid(row.projectId)
    && canonicalUuid(row.identityId) && canonicalUuid(row.issuingApiKeyId)
    && validOrigin(row.origin) && row.action === ACTION && row.method === METHOD
    && row.path === pathFor(row.identityId)
    && finiteDate(row.issuedAt) && finiteDate(row.expiresAt)
    && row.expiresAt.getTime() > row.issuedAt.getTime()
    && row.expiresAt.getTime() - row.issuedAt.getTime() <= LOCAL_CONTEXT_GRANT_MAX_AGE_MS
    && (row.revokedAt === null || (finiteDate(row.revokedAt) && row.revokedAt >= row.issuedAt));
}

function metadata(row: MetadataRow): LocalContextGrantMetadata {
  if (!validMetadata(row)) throw new LocalContextGrantError("invalid_state");
  return {
    grant_id: row.id, project_id: row.projectId, identity_id: row.identityId,
    issuing_api_key_id: row.issuingApiKeyId, origin: row.origin,
    action: ACTION, method: METHOD, path: row.path,
    issued_at: row.issuedAt.toISOString(), expires_at: row.expiresAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}

function validParent(row: typeof apiKeys.$inferSelect | Pick<typeof apiKeys.$inferSelect, "id" | "projectId" | "expiresAt" | "revokedAt"> | undefined,
  id: string, projectId: string, now: Date, expiresAt: Date): boolean {
  return !!row && row.id === id && row.projectId === projectId && row.revokedAt === null
    && (row.expiresAt === null || (finiteDate(row.expiresAt) && row.expiresAt > now && row.expiresAt >= expiresAt));
}

/** No broad bearer is stored in this table. Plaintext leaves only this issuance result. */
export async function issueLocalContextGrant(input: {
  projectId: string; identityId: string; issuerApiKeyId: string; grantId: string;
  origin: string; expiresAt: string;
}, options: LocalContextGrantOptions = {}): Promise<{ grant: LocalContextGrantMetadata; token: string }> {
  assertSubject(input.projectId, input.identityId);
  if (!canonicalUuid(input.issuerApiKeyId) || !canonicalUuid(input.grantId) || !validOrigin(input.origin)
    || typeof input.expiresAt !== "string") throw new LocalContextGrantError("invalid_request");
  const expiresAt = explicitExpiry(input.expiresAt);
  if (!expiresAt) throw new LocalContextGrantError("invalid_request");
  return (options.database ?? db).transaction(async (tx) => {
    // Lifecycle mutations take this identity lock first too. Then lock the parent
    // key, so its revocation cannot commit between our check and issuance.
    await requireActiveProjectIdentity(input.projectId, input.identityId, { database: tx, lock: true });
    const [parent] = await tx.select(parentColumns).from(apiKeys).where(and(
      eq(apiKeys.id, input.issuerApiKeyId), eq(apiKeys.projectId, input.projectId), isNull(apiKeys.revokedAt),
    )).for("share").limit(1);
    const now = nowFor(options);
    if (expiresAt <= now || expiresAt.getTime() - now.getTime() > LOCAL_CONTEXT_GRANT_MAX_AGE_MS) {
      throw new LocalContextGrantError("invalid_request");
    }
    if (!validParent(parent, input.issuerApiKeyId, input.projectId, now, expiresAt)) {
      throw new LocalContextGrantError("parent_unavailable");
    }
    // This check avoids generating a token for known duplicates; the unique key
    // also arbitrates concurrent issuance, whose losing token is never returned.
    const [existing] = await tx.select({ id: localContextGrants.id }).from(localContextGrants).where(eq(localContextGrants.id, input.grantId)).limit(1);
    if (existing) throw new LocalContextGrantError("conflict");
    const token = `atlc_${randomBytes(32).toString("base64url")}`;
    const row = {
      id: input.grantId, projectId: input.projectId, identityId: input.identityId,
      issuingApiKeyId: input.issuerApiKeyId, tokenHash: createHash("sha256").update(token).digest("hex"),
      origin: input.origin, action: ACTION, method: METHOD, path: pathFor(input.identityId),
      issuedAt: now, expiresAt, revokedAt: null,
    };
    const [inserted] = await tx.insert(localContextGrants).values(row).onConflictDoNothing({ target: localContextGrants.id }).returning(metadataColumns);
    if (!inserted) throw new LocalContextGrantError("conflict");
    // Validate adapters/storage before allowing a credential to leave the service.
    const result = metadata(inserted);
    if (JSON.stringify(result) !== JSON.stringify(metadata(row))) throw new LocalContextGrantError("invalid_state");
    return { grant: result, token };
  });
}

export async function listLocalContextGrants(input: {
  projectId: string; identityId: string; limit?: number;
}, options: LocalContextGrantOptions = {}): Promise<LocalContextGrantMetadata[]> {
  assertSubject(input.projectId, input.identityId);
  const limit = input.limit ?? LOCAL_CONTEXT_GRANT_LIST_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LOCAL_CONTEXT_GRANT_LIST_MAX) throw new LocalContextGrantError("invalid_request");
  return (options.database ?? db).transaction(async (tx) => {
    const rows = await tx.select(metadataColumns).from(localContextGrants).where(and(
      eq(localContextGrants.projectId, input.projectId), eq(localContextGrants.identityId, input.identityId),
    )).orderBy(desc(localContextGrants.issuedAt), desc(localContextGrants.id)).limit(limit);
    if (rows.length > limit || rows.some((row) => row.projectId !== input.projectId || row.identityId !== input.identityId)) {
      throw new LocalContextGrantError("invalid_state");
    }
    return rows.map(metadata);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Recover metadata by the caller-supplied issuance ID; never recover its token. */
export async function getLocalContextGrant(input: {
  projectId: string; identityId: string; grantId: string;
}, options: LocalContextGrantOptions = {}): Promise<LocalContextGrantMetadata> {
  assertSubject(input.projectId, input.identityId);
  if (!canonicalUuid(input.grantId)) throw new LocalContextGrantError("invalid_request");
  return (options.database ?? db).transaction(async (tx) => {
    const [row] = await tx.select(metadataColumns).from(localContextGrants).where(and(
      eq(localContextGrants.id, input.grantId), eq(localContextGrants.projectId, input.projectId), eq(localContextGrants.identityId, input.identityId),
    )).limit(1);
    if (!row || row.id !== input.grantId || row.projectId !== input.projectId || row.identityId !== input.identityId) {
      throw new LocalContextGrantError("not_found");
    }
    return metadata(row);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function revokeLocalContextGrant(input: {
  projectId: string; identityId: string; grantId: string;
}, options: LocalContextGrantOptions = {}): Promise<LocalContextGrantMetadata> {
  assertSubject(input.projectId, input.identityId);
  if (!canonicalUuid(input.grantId)) throw new LocalContextGrantError("invalid_request");
  return (options.database ?? db).transaction(async (tx) => {
    const target = and(eq(localContextGrants.id, input.grantId), eq(localContextGrants.projectId, input.projectId), eq(localContextGrants.identityId, input.identityId));
    const [row] = await tx.select(metadataColumns).from(localContextGrants).where(target).for("update").limit(1);
    if (!row || row.id !== input.grantId || row.projectId !== input.projectId || row.identityId !== input.identityId) {
      throw new LocalContextGrantError("not_found");
    }
    const current = metadata(row);
    if (row.revokedAt !== null) return current;
    const now = nowFor(options);
    if (now < row.issuedAt) throw new LocalContextGrantError("invalid_state");
    const [updated] = await tx.update(localContextGrants).set({ revokedAt: now }).where(target).returning(metadataColumns);
    if (!updated || JSON.stringify(metadata(updated)) !== JSON.stringify({ ...current, revoked_at: now.toISOString() })) {
      throw new LocalContextGrantError("invalid_state");
    }
    return metadata(updated);
  });
}

export async function readLocalContextGrant(input: {
  token: string; identityId: string; origin: string; method: string; path: string; query: string;
}, options: LocalContextGrantOptions = {}) {
  const deny = () => new LocalContextGrantError("invalid_credential");
  if (typeof input.token !== "string" || !/^atlc_[A-Za-z0-9_-]{43}$/.test(input.token)
    || Buffer.from(input.token.slice(5), "base64url").toString("base64url") !== input.token.slice(5)
    || !canonicalUuid(input.identityId) || !validOrigin(input.origin) || input.method !== METHOD
    || input.path !== pathFor(input.identityId) || input.query !== "") throw deny();
  const hash = createHash("sha256").update(input.token).digest("hex");
  return (options.database ?? db).transaction(async (tx) => {
    const now = nowFor(options);
    const [row] = await tx.select({ ...metadataColumns, tokenHash: localContextGrants.tokenHash }).from(localContextGrants)
      .where(eq(localContextGrants.tokenHash, hash)).limit(1);
    if (!row || !validMetadata(row) || typeof row.tokenHash !== "string" || !HASH.test(row.tokenHash)
      || !timingSafeEqual(Buffer.from(row.tokenHash, "hex"), Buffer.from(hash, "hex"))
      || row.identityId !== input.identityId || row.origin !== input.origin
      || row.revokedAt !== null || row.issuedAt > now || row.expiresAt <= now) throw deny();
    const [parent] = await tx.select(parentColumns).from(apiKeys).where(and(
      eq(apiKeys.id, row.issuingApiKeyId), eq(apiKeys.projectId, row.projectId), isNull(apiKeys.revokedAt),
    )).limit(1);
    if (!validParent(parent, row.issuingApiKeyId, row.projectId, now, row.expiresAt)) throw deny();
    let context;
    try {
      context = await readLocalContextInTransaction(tx, row.projectId, row.identityId, now);
    } catch (error) {
      if (error instanceof IdentityPartitionError) throw deny();
      throw error;
    }
    const result = {
      ...context,
      format: "agenttool-local-api-context/v2" as const,
      scope: { ...context.scope, authentication: "local_context_grant" as const, bearer_attenuated: true },
      authorization: {
        grant_id: row.id, origin: row.origin, action: ACTION, method: METHOD, path: row.path,
        issued_at: row.issuedAt.toISOString(), expires_at: row.expiresAt.toISOString(), checked_at: now.toISOString(),
      },
    };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > LOCAL_CONTEXT_BOUNDS.max_response_bytes) {
      throw new LocalContextGrantError("invalid_state");
    }
    return result;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
