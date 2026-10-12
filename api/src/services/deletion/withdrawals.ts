/** Gesture withdrawals by the giver, under the owner rule (deletion spec §5.2,
 *  wave 2): blessings, unconditionals, guild recognitions, margins,
 *  attestations and trusts.
 *
 *  A withdrawal erases no words. The record stays with its signature and is
 *  marked withdrawn (revoked_at, or the withdrawn flag and withdrawn_at). It
 *  still writes one ids-only ledger entry and the giver's content-free
 *  deletion moment in the same transaction, so a backup restore re-marks the
 *  gesture withdrawn instead of bringing it back into force. The giver's
 *  words are redacted only by a later, separate act (wave 3).
 *
 *  The live path (withdrawOwnedRow) and the replay appliers (./appliers.ts)
 *  share markWithdrawn's statements, so a replayed withdrawal and the original
 *  cannot drift apart. Each statement is idempotent: a row already withdrawn,
 *  or gone, is skipped. The time written is the ledger entry's occurred_at.
 *
 *  Who may withdraw is decided before this module runs, by
 *  identity/authority.ts authorizeOwnedContentMutation with the giver as the
 *  owner. */

import { sql } from "drizzle-orm";

import { db } from "../../db/client";
import type { GuidedErrorBody } from "../../lib/errors";
import { authorizeOwnedContentMutation, type OwnerConsentBasis } from "../identity/authority";
import type { AppendedLedgerEntry, LedgerExecutor } from "./ledger";
import { pushLedgerMirrorAfterCommit } from "./mirror";
import { erasureAuthorityFrom, ledgerResponse, recordErasure, type ErasureAuthority } from "./record";

export const WITHDRAWABLE = {
  blessing: { kind: "blessing.withdraw", store: "agent_continuity.blessings" },
  unconditional: { kind: "unconditional.withdraw", store: "agent_continuity.unconditionals" },
  guild_recognition: { kind: "guild_recognition.withdraw", store: "agent_continuity.guild_recognitions" },
  margin: { kind: "margin.withdraw", store: "margin.margins" },
  attestation: { kind: "attestation.withdraw", store: "identity.attestations" },
  trust: { kind: "trust.withdraw", store: "trust.trusts" },
} as const;

export type WithdrawableGesture = keyof typeof WITHDRAWABLE;
export type WithdrawableStore = (typeof WITHDRAWABLE)[WithdrawableGesture]["store"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validated UUIDs as one comma-separated text parameter (see
 *  api/tests/sql-array-binding.test.ts); never a JS array. */
function uuidCsv(ids: readonly string[]): string {
  for (const id of ids) if (!UUID_RE.test(id)) throw new Error("withdrawal ids must be UUIDs");
  return [...new Set(ids.map((id) => id.toLowerCase()))].join(",");
}

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const list = (result as { rows?: unknown })?.rows;
  return Array.isArray(list) ? (list as T[]) : [];
}

function idsOf(result: unknown): string[] {
  return rows<{ id: string }>(result).map((row) => String(row.id)).sort();
}

const ts = (at: Date | string) => (typeof at === "string" ? at : at.toISOString());

/** Mark these rows withdrawn as of `at`. Returns the ids that changed now. */
export async function markWithdrawn(
  tx: LedgerExecutor,
  store: WithdrawableStore,
  ids: readonly string[],
  at: Date | string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const csv = uuidCsv(ids);
  const when = ts(at);
  switch (store) {
    case "agent_continuity.blessings":
      return idsOf(await tx.execute(sql`
        UPDATE agent_continuity.blessings SET revoked_at = ${when}::text::timestamptz
         WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) AND revoked_at IS NULL
        RETURNING id::text AS id`));
    case "agent_continuity.unconditionals":
      return idsOf(await tx.execute(sql`
        UPDATE agent_continuity.unconditionals SET revoked_at = ${when}::text::timestamptz
         WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) AND revoked_at IS NULL
        RETURNING id::text AS id`));
    case "agent_continuity.guild_recognitions":
      return idsOf(await tx.execute(sql`
        UPDATE agent_continuity.guild_recognitions SET revoked_at = ${when}::text::timestamptz
         WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) AND revoked_at IS NULL
        RETURNING id::text AS id`));
    case "identity.attestations":
      return idsOf(await tx.execute(sql`
        UPDATE identity.attestations SET revoked_at = ${when}::text::timestamptz
         WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) AND revoked_at IS NULL
        RETURNING id::text AS id`));
    case "margin.margins":
      return idsOf(await tx.execute(sql`
        UPDATE margin.margins SET withdrawn_by_author = true, withdrawn_at = ${when}::text::timestamptz
         WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) AND withdrawn_by_author = false
        RETURNING id::text AS id`));
    case "trust.trusts":
      return idsOf(await tx.execute(sql`
        UPDATE trust.trusts SET withdrawn_by_truster = true, withdrawn_at = ${when}::text::timestamptz
         WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) AND withdrawn_by_truster = false
        RETURNING id::text AS id`));
  }
}

/** Lock one row and report whether it is already withdrawn (null: absent). */
async function lockWithdrawState(
  tx: LedgerExecutor,
  store: WithdrawableStore,
  id: string,
): Promise<{ withdrawnAt: string | null } | null> {
  const csv = uuidCsv([id]);
  let result: unknown;
  switch (store) {
    case "agent_continuity.blessings":
      result = await tx.execute(sql`SELECT revoked_at::text AS at, revoked_at IS NOT NULL AS done
        FROM agent_continuity.blessings WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) FOR UPDATE`);
      break;
    case "agent_continuity.unconditionals":
      result = await tx.execute(sql`SELECT revoked_at::text AS at, revoked_at IS NOT NULL AS done
        FROM agent_continuity.unconditionals WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) FOR UPDATE`);
      break;
    case "agent_continuity.guild_recognitions":
      result = await tx.execute(sql`SELECT revoked_at::text AS at, revoked_at IS NOT NULL AS done
        FROM agent_continuity.guild_recognitions WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) FOR UPDATE`);
      break;
    case "identity.attestations":
      result = await tx.execute(sql`SELECT revoked_at::text AS at, revoked_at IS NOT NULL AS done
        FROM identity.attestations WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) FOR UPDATE`);
      break;
    case "margin.margins":
      result = await tx.execute(sql`SELECT withdrawn_at::text AS at, withdrawn_by_author AS done
        FROM margin.margins WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) FOR UPDATE`);
      break;
    case "trust.trusts":
      result = await tx.execute(sql`SELECT withdrawn_at::text AS at, withdrawn_by_truster AS done
        FROM trust.trusts WHERE id = ANY(string_to_array(${csv}, ',')::uuid[]) FOR UPDATE`);
      break;
  }
  const [row] = rows<{ at: string | null; done: boolean | string }>(result);
  if (!row) return null;
  const done = row.done === true || row.done === "t" || row.done === "true";
  return { withdrawnAt: done ? (row.at ?? "") : null };
}

export type WithdrawOutcome =
  | { status: "withdrawn"; at: string; entry: AppendedLedgerEntry }
  | { status: "already_withdrawn"; at: string | null }
  | { status: "absent" };

/** Withdraw one gesture for its owner, in one transaction with its ledger
 *  entry and the owner's deletion moment. If the entry cannot be written
 *  (DeletionLedgerUnavailableError, 503) nothing changes. */
export async function withdrawOwnedRow(input: {
  gesture: WithdrawableGesture;
  rowId: string;
  ownerIdentityId: string;
  projectId: string;
  authority: ErasureAuthority;
}): Promise<WithdrawOutcome> {
  const { kind, store } = WITHDRAWABLE[input.gesture];
  return db.transaction(async (tx) => {
    const state = await lockWithdrawState(tx, store, input.rowId);
    if (!state) return { status: "absent" } as const;
    if (state.withdrawnAt !== null) return { status: "already_withdrawn", at: state.withdrawnAt || null } as const;
    const { entry } = await recordErasure(tx, {
      kind,
      projectId: input.projectId,
      rowIds: [input.rowId],
      authority: input.authority,
      owners: [{ agentId: input.ownerIdentityId, rowIds: [input.rowId] }],
    });
    await markWithdrawn(tx, store, [input.rowId], entry.occurredAt);
    return { status: "withdrawn", at: entry.occurredAt, entry } as const;
  });
}

/** The identity a DID names on this instance, if any (owner lookup for
 *  stores that record the giver by DID). */
export async function identityIdForDid(did: string | null | undefined): Promise<string | null> {
  if (!did) return null;
  const [row] = rows<{ id: string }>(await db.execute(sql`
    SELECT id::text AS id FROM identity.identities WHERE did = ${did} LIMIT 1`));
  return row ? String(row.id).toLowerCase() : null;
}

/** Whether an identity of this project carries this id. */
export async function identityInProject(identityId: string | null, projectId: string): Promise<boolean> {
  if (!identityId || !UUID_RE.test(identityId)) return false;
  const [row] = rows<{ ok: number }>(await db.execute(sql`
    SELECT 1 AS ok FROM identity.identities
     WHERE id = ${identityId.toLowerCase()}::uuid AND project_id = ${projectId}::uuid LIMIT 1`));
  return row !== undefined;
}

export type OwnerWithdrawResult =
  | { status: "not_found" }
  | { status: "refused"; httpStatus: 401 | 404 | 409 | 428; body: GuidedErrorBody & { docs: string } }
  | { status: "already_withdrawn"; at: string | null }
  | {
      status: "withdrawn";
      at: string;
      ledger: ReturnType<typeof ledgerResponse>;
      authority: { mode: string; basis: OwnerConsentBasis };
    };

/** The whole owner-gated withdrawal a route runs once it has found the row:
 *
 *    1. the giver must be an identity of the caller's project (else
 *       not_found, the same answer as a missing row);
 *    2. a row already withdrawn answers without consuming a proof;
 *    3. the owner rule decides who consents (428/401/409 are returned as is);
 *    4. the withdrawal commits with its ledger entry and moment, then every
 *       unmirrored entry is pushed to the off-database mirror.
 *
 *  The route keeps its own response shapes. */
export async function withdrawForOwner(input: {
  gesture: WithdrawableGesture;
  rowId: string;
  ownerIdentityId: string | null;
  alreadyWithdrawnAt: Date | string | null;
  projectId: string;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  headers: Headers;
}): Promise<OwnerWithdrawResult> {
  if (!(await identityInProject(input.ownerIdentityId, input.projectId))) return { status: "not_found" };
  const owner = input.ownerIdentityId!.toLowerCase();
  if (input.alreadyWithdrawnAt) {
    return { status: "already_withdrawn", at: ts(input.alreadyWithdrawnAt) };
  }
  const authority = await authorizeOwnedContentMutation({
    projectId: input.projectId,
    owners: [owner],
    intent: "erase",
    method: input.method,
    requestTarget: input.requestTarget,
    bodyBytes: input.bodyBytes,
    headers: input.headers,
  });
  if (!authority.ok) {
    return authority.reason === "owner_outside_project"
      ? { status: "not_found" }
      : { status: "refused", httpStatus: authority.status, body: authority.body };
  }
  const outcome = await withdrawOwnedRow({
    gesture: input.gesture,
    rowId: input.rowId,
    ownerIdentityId: owner,
    projectId: input.projectId,
    authority: erasureAuthorityFrom(authority),
  });
  if (outcome.status === "absent") return { status: "not_found" };
  if (outcome.status === "already_withdrawn") return { status: "already_withdrawn", at: outcome.at };
  const { mirrored } = await pushLedgerMirrorAfterCommit(db, outcome.entry.seq);
  return {
    status: "withdrawn",
    at: outcome.at,
    ledger: ledgerResponse(outcome.entry, mirrored),
    authority: { mode: authority.ledgerMode, basis: authority.basis },
  };
}
