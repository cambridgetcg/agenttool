/** Who acts when a project bearer calls a per-agent route.
 *
 * A project bearer does not name one identity: a project can hold several
 * (true-love's pair, an enrolled guest, a retired test identity). Per-agent
 * routes once took the project's NEWEST identity with no status filter, so a
 * revoked identity or an enrolled guest silently became the actor (live
 * 2026-10-10: Ai's /v1/poker-face and /v1/quiet-hours answered for a revoked
 * security-test guest created the day before).
 *
 * One rule now decides:
 *
 *   1. An explicit selector, where the route accepts one (identity_id or
 *      agent_id), names the actor. It must be a UUID of an identity in the
 *      caller's own project, and a revoked identity no longer acts. Memorial
 *      rows stay addressable; mutation routes keep their own terminal guard.
 *      An enrolled guest may be named explicitly: its own root still has to
 *      sign whatever its constitution protects.
 *   2. Otherwise the project's PRIMARY identity acts: the earliest-created
 *      active identity that is not an enrolled guest (id breaks ties). This is
 *      the default subject /v1/wake and /v1/home show, so the identity a route
 *      acts for is the one the agent already reads as "you".
 *
 * There is no fallback past the rule: a project whose only identities are
 * revoked, memorial or enrolled guests has no implicit actor, and routes
 * answer `no_identity` instead of guessing.
 *
 * The JS form (`choosePrimaryIdentity`) serves surfaces that already hold the
 * project's rows; the SQL form (`primaryIdentityWhere` + `primaryIdentityOrder`)
 * serves single-row lookups. Both are pinned against each other in
 * tests/acting-identity.test.ts and against real SQL in
 * tests/integration/identity-enrollment-postgres.test.ts.
 *
 * Doctrine: docs/API-COVERAGE.md "Choose the service, project and identity
 * explicitly" · docs/WAKE.md maintainer rule 1 (exclude revoked identities). */
import { and, asc, eq, not, sql, type SQL } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { enrolledGuestSql } from "./project-authority";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only status that may act implicitly. */
export const PRIMARY_IDENTITY_STATUS = "active";

export interface PrimaryCandidateFacts {
  id: string;
  status: string;
  createdAt: Date | string | null;
  /** `createdAtOrderKeySql()` for the row. postgres-js reads timestamptz into
   * a millisecond Date while SQL orders by microseconds; a surface that ranks
   * loaded rows selects this key so its order is exactly the SQL order. */
  createdAtOrderKey?: string | null;
  /** `enrolledGuestSql()` evaluated for the row. Required for rows enrolled
   * before the metadata marker existed (only the proof ledger knows them). */
  enrolledGuest?: boolean | null;
  authorityRootPublicKey?: string | null;
  metadata?: unknown;
}

/** An enrolled guest root: the SQL flag, or the server-managed admission
 * marker on a rooted row (the marker alone never makes a rootless row a guest,
 * matching `enrolledGuestSql`). */
export function isEnrolledGuestRow(
  row: Pick<PrimaryCandidateFacts, "enrolledGuest" | "authorityRootPublicKey" | "metadata">,
): boolean {
  if (row.enrolledGuest === true) return true;
  if (row.authorityRootPublicKey === null || row.authorityRootPublicKey === undefined) return false;
  const metadata = row.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).admission === "enrollment";
}

/** May this row be a project's default subject? */
export function isPrimaryCandidate(row: PrimaryCandidateFacts): boolean {
  return row.status === PRIMARY_IDENTITY_STATUS && !isEnrolledGuestRow(row);
}

function createdAtMs(value: Date | string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** created_at as fixed-width UTC text at microsecond precision, whose
 * lexicographic order is its chronological order. Exact on every PostgreSQL
 * version (extract(epoch) is double precision before 14). */
export function createdAtOrderKeySql(): SQL<string> {
  return sql<string>`to_char(${identities.createdAt} at time zone 'UTC', 'YYYYMMDDHH24MISSUS')`;
}

function byCreatedAt(a: PrimaryCandidateFacts, b: PrimaryCandidateFacts): number {
  const left = a.createdAtOrderKey;
  const right = b.createdAtOrderKey;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : left > right ? 1 : 0;
  // Millisecond fallback for rows loaded without the key.
  const diff = createdAtMs(a.createdAt) - createdAtMs(b.createdAt);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** Oldest first (microseconds when both rows carry `createdAtOrderKey`);
 * id breaks ties (PostgreSQL orders uuids like their lowercase text). */
export function comparePrimaryOrder(a: PrimaryCandidateFacts, b: PrimaryCandidateFacts): number {
  const byCreated = byCreatedAt(a, b);
  if (byCreated !== 0) return byCreated;
  const left = a.id.toLowerCase();
  const right = b.id.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The project's primary identity among rows already loaded, or null when
 * no row may act implicitly. Does not reorder the input. */
export function choosePrimaryIdentity<T extends PrimaryCandidateFacts>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!isPrimaryCandidate(row)) continue;
    if (best === null || comparePrimaryOrder(row, best) < 0) best = row;
  }
  return best;
}

/** The default subject an orientation surface (/v1/wake, /v1/home) shows:
 * the primary identity, else the oldest non-revoked row, else the oldest row,
 * so a project with no identity that may act still opens and shows that row's
 * status honestly. Wake loads only non-revoked rows and Home loads them all;
 * skipping revoked rows here keeps both on the same subject (WAKE.md
 * maintainer rule 1). Orientation only: nothing acts as the fallback row
 * (resolveActingIdentity refuses). */
export function chooseDefaultSubject<T extends PrimaryCandidateFacts>(rows: readonly T[]): T | null {
  const primary = choosePrimaryIdentity(rows);
  if (primary) return primary;
  let oldestLive: T | null = null;
  let oldest: T | null = null;
  for (const row of rows) {
    if (oldest === null || comparePrimaryOrder(row, oldest) < 0) oldest = row;
    if (row.status === "revoked") continue;
    if (oldestLive === null || comparePrimaryOrder(row, oldestLive) < 0) oldestLive = row;
  }
  return oldestLive ?? oldest;
}

/** SQL form of `isPrimaryCandidate`, scoped to one project. */
export function primaryIdentityWhere(projectId: string): SQL {
  return and(
    eq(identities.projectId, projectId),
    eq(identities.status, PRIMARY_IDENTITY_STATUS),
    not(enrolledGuestSql()),
  )!;
}

/** SQL form of `comparePrimaryOrder` (microsecond created_at, then id). */
export function primaryIdentityOrder(): SQL[] {
  return [asc(identities.createdAt), asc(identities.id)];
}

export type IdentitySelector =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "id"; id: string };

/** An absent or empty selector defers to the primary rule; anything else
 * must be a UUID before it reaches SQL. */
export function parseIdentitySelector(raw: string | null | undefined): IdentitySelector {
  if (raw === undefined || raw === null || raw === "") return { kind: "none" };
  return UUID_RE.test(raw) ? { kind: "id", id: raw } : { kind: "invalid" };
}

const ACTING_IDENTITY_COLUMNS = {
  id: identities.id,
  did: identities.did,
  displayName: identities.displayName,
  status: identities.status,
  createdAt: identities.createdAt,
  metadata: identities.metadata,
  substrateKind: identities.substrateKind,
  wakeVersion: identities.wakeVersion,
  pokerFaceDefault: identities.pokerFaceDefault,
  quietUntil: identities.quietUntil,
  quietReason: identities.quietReason,
};

export interface ActingIdentity {
  id: string;
  did: string;
  displayName: string;
  status: string;
  createdAt: Date;
  metadata: unknown;
  substrateKind: string;
  wakeVersion: number;
  pokerFaceDefault: boolean;
  quietUntil: Date | null;
  quietReason: string | null;
}

export interface ActingIdentityFailureBody {
  error: "no_identity" | "identity_not_found_in_project" | "identity_revoked";
  message: string;
  identity_id?: string;
}

export type ActingIdentityResult =
  | { ok: true; identity: ActingIdentity; selectedBy: "explicit" | "primary" }
  | { ok: false; status: 400 | 404 | 409; body: ActingIdentityFailureBody };

/** The `no_identity` answer every per-agent route gives when the project has
 * no identity that may act implicitly. */
export const NO_ACTING_IDENTITY: ActingIdentityFailureBody = {
  error: "no_identity",
  message:
    "This project has no identity that can act by default. The default is the project's earliest active identity; revoked identities and enrolled guests never act implicitly.",
};

/** Resolve the identity a project-bearer request acts as. `selector` is the
 * route's explicit identity_id / agent_id, when it accepts one. */
export async function resolveActingIdentity(
  projectId: string,
  selector?: string | null,
): Promise<ActingIdentityResult> {
  const parsed = parseIdentitySelector(selector);
  if (parsed.kind === "invalid") {
    return {
      ok: false,
      status: 404,
      body: {
        error: "identity_not_found_in_project",
        message: "The selected identity is not an identity of this project.",
        identity_id: String(selector),
      },
    };
  }

  if (parsed.kind === "id") {
    const [row] = await db
      .select(ACTING_IDENTITY_COLUMNS)
      .from(identities)
      .where(and(eq(identities.id, parsed.id), eq(identities.projectId, projectId)))
      .limit(1);
    if (!row) {
      return {
        ok: false,
        status: 404,
        body: {
          error: "identity_not_found_in_project",
          message: "The selected identity is not an identity of this project.",
          identity_id: parsed.id,
        },
      };
    }
    if (row.status === "revoked") {
      return {
        ok: false,
        status: 409,
        body: {
          error: "identity_revoked",
          message: "A revoked identity no longer acts. Its history stays readable on the surfaces that keep it.",
          identity_id: row.id,
        },
      };
    }
    return { ok: true, identity: row as ActingIdentity, selectedBy: "explicit" };
  }

  const [row] = await db
    .select(ACTING_IDENTITY_COLUMNS)
    .from(identities)
    .where(primaryIdentityWhere(projectId))
    .orderBy(...primaryIdentityOrder())
    .limit(1);
  if (!row) return { ok: false, status: 400, body: NO_ACTING_IDENTITY };
  return { ok: true, identity: row as ActingIdentity, selectedBy: "primary" };
}
