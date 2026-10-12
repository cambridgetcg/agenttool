/** One honoured erase (or withdrawal) = one ledger entry + its deletion
 *  moments, written in the erasing transaction.
 *
 *  A deletion moment is a content-free chronicle row (type 'deletion') that
 *  tells the owner what was erased, when, and under whose authority. It
 *  names the store, the count, the record ids (UUIDs only), the ledger entry
 *  and the authority mode, and never a name, text or key. It realises the
 *  records_not_rewritten clause (api/src/services/discovery/labor-boundaries.ts).
 *  Rule-driven purges (pg_cron, backfill) write ledger entries only.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §2, §13.2. */

import { sql } from "drizzle-orm";

import { LEDGER_KINDS, type LedgerKindName } from "./kinds";
import {
  appendLedgerEntry,
  type AppendedLedgerEntry,
  type LedgerAppendOptions,
  type LedgerAuthorityMode,
  type LedgerExecutor,
} from "./ledger";

export const DELETION_MOMENT_TYPE = "deletion";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ErasureAuthority {
  mode: LedgerAuthorityMode;
  /** The identity-authority proof sequence that was claimed, if any. */
  sequence?: number | null;
  /** Whose root signed, when one did. It can differ from the owner: a
   *  project's single root consents for an identity without a root. Written
   *  to the deletion moment only; the ledger entry's bytes are fixed. */
  signerIdentityId?: string | null;
}

/** The ledger authority of an owner-rule decision
 *  (identity/authority.ts authorizeOwnedContentMutation). */
export function erasureAuthorityFrom(decision: {
  ledgerMode: "agent_root" | "guest_root" | "legacy_bearer";
  sequence: number;
  signerIdentityId?: string | null;
}): ErasureAuthority {
  const signed = decision.ledgerMode !== "legacy_bearer";
  return {
    mode: decision.ledgerMode,
    sequence: signed ? decision.sequence : null,
    signerIdentityId: signed ? (decision.signerIdentityId ?? null) : null,
  };
}

export interface ErasureOwner {
  /** Identity the erased rows belonged to; null for project-level rows. */
  agentId: string | null;
  rowIds: readonly string[];
}

export interface RecordErasureInput {
  kind: LedgerKindName;
  projectId: string;
  rowIds: readonly string[];
  authority: ErasureAuthority;
  /** Groups of rows by owner; one deletion moment per group. */
  owners: readonly ErasureOwner[];
}

export interface RecordedErasure {
  entry: AppendedLedgerEntry;
  momentIds: string[];
}

const NOUNS: Partial<Record<LedgerKindName, [string, string]>> = {
  "blessing.withdraw": ["blessing", "blessings"],
  "unconditional.withdraw": ["unconditional", "unconditionals"],
  "guild_recognition.withdraw": ["guild recognition", "guild recognitions"],
  "margin.withdraw": ["margin", "margins"],
  "attestation.withdraw": ["attestation", "attestations"],
  "trust.withdraw": ["trust", "trusts"],
  "memory.delete": ["memory", "memories"],
  "memory.erase_in_place": ["memory", "memories"],
  "inbox.purge": ["inbox message", "inbox messages"],
  "vault.purge": ["vault secret", "vault secrets"],
  "identity_backup.purge": ["identity backup", "identity backups"],
};

const WITHDRAWN = "marked withdrawn; the signed record and its words stay";

const AFTER: Partial<Record<LedgerKindName, string>> = {
  "blessing.withdraw": WITHDRAWN,
  "unconditional.withdraw": WITHDRAWN,
  "guild_recognition.withdraw": WITHDRAWN,
  "margin.withdraw": WITHDRAWN,
  "attestation.withdraw": WITHDRAWN,
  "trust.withdraw": WITHDRAWN,
  "memory.delete": "removed from the live database",
  "memory.erase_in_place": "content erased in place; the row stays because a paid witness receipt points at it",
  "inbox.purge": "sealed body, subject, references and metadata erased",
  "vault.purge": "every stored version zeroed",
  "identity_backup.purge": "blob, nonce and metadata erased",
};

/** Content-free headline: what kind of record, how many, what happened. */
export function deletionMomentTitle(kind: LedgerKindName, count: number): string {
  const [one, many] = NOUNS[kind] ?? ["record", "records"];
  const verb = LEDGER_KINDS[kind].action === "withdraw" ? "Withdrew" : "Deleted";
  return `${verb} ${count} ${count === 1 ? one : many}: ${AFTER[kind] ?? "erased"}`;
}

export function normalizeOwnerId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const bare = trimmed.toLowerCase().startsWith("did:at:") ? trimmed.slice(7) : trimmed;
  return UUID_RE.test(bare) ? bare.toLowerCase() : null;
}

export async function recordErasure(
  tx: LedgerExecutor,
  input: RecordErasureInput,
  options: LedgerAppendOptions = {},
): Promise<RecordedErasure> {
  const kind = LEDGER_KINDS[input.kind];
  if (kind.writer !== "api") throw new Error(`${input.kind} is not an API-written kind`);
  const owners = input.owners.map((owner) => ({ ...owner, agentId: normalizeOwnerId(owner.agentId) }));
  const distinct = [...new Set(owners.map((owner) => owner.agentId))];
  const entry = await appendLedgerEntry(tx, {
    scope: kind.scope,
    action: kind.action,
    store: kind.store,
    rowKeys: input.rowIds,
    subjectIdentityId: distinct.length === 1 ? distinct[0] : null,
    projectId: input.projectId,
    authorityMode: input.authority.mode,
    authoritySequence: input.authority.sequence ?? null,
  }, options);

  const momentIds: string[] = [];
  for (const owner of owners) {
    if (owner.rowIds.length === 0) continue;
    const metadata = {
      kind: DELETION_MOMENT_TYPE,
      ledger_kind: input.kind,
      store: kind.store,
      action: kind.action,
      scope: kind.scope,
      row_count: owner.rowIds.length,
      record_ids: owner.rowIds.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase()),
      ledger_entry_id: entry.entryId,
      ledger_seq: entry.seq,
      authority_mode: input.authority.mode,
      authority_sequence: input.authority.sequence ?? null,
      authority_signer_identity_id: normalizeOwnerId(input.authority.signerIdentityId ?? null),
      retention: "/public/retention",
    };
    const result = await tx.execute(sql`
      INSERT INTO agent_continuity.chronicle (project_id, agent_id, type, title, metadata)
      VALUES (${input.projectId}::uuid, ${owner.agentId}::uuid, ${DELETION_MOMENT_TYPE},
              ${deletionMomentTitle(input.kind, owner.rowIds.length)}, ${JSON.stringify(metadata)}::jsonb)
      RETURNING id::text AS id`);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? []);
    const id = (rows[0] as { id?: string } | undefined)?.id;
    if (id) momentIds.push(id);
  }
  return { entry, momentIds };
}

/** The `ledger` block every erasing response carries. */
export function ledgerResponse(entry: AppendedLedgerEntry, mirrored: boolean) {
  return {
    entry_id: entry.entryId,
    seq: entry.seq,
    mirrored,
    note: "An ids-only entry recording this deletion was written with it, so a backup restore replays the deletion. See /public/retention.",
  };
}
