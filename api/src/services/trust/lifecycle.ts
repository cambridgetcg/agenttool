/** services/trust/lifecycle.ts — extend · publish · veto · withdraw · evidence.
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/trust-must-be-signed
 *    extendTrust calls assertSignatureVerifies before insert.
 *
 *  @enforces urn:agenttool:wall/trust-reasoning-stays-with-the-agent
 *    getEvidence returns chronicle facts + pattern summary. It NEVER
 *    returns a recommended_strength or trust_score. */

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  trusts,
  type TrustKind,
  type TrustStrength,
} from "../../db/schema/trust";

import {
  base64ToBytes,
  canonicalTrustBytesHex,
  reasonsSha256Hex,
  verifyTrust,
  type TrustAttestation,
} from "./canonical";

// ── extendTrust ───────────────────────────────────────────────────────

export interface ExtendTrustOpts {
  trusterIdentityId: string;
  trusterDid: string;
  trusterSigningKeyId: string;
  trustedDid: string;
  trustKind: TrustKind;
  trustStrength: TrustStrength;
  reasons?: string | null;
  evidenceChronicleIds: ReadonlyArray<string>;
  signatureB64: string;
  extendedAtIso: string;
}

export interface ExtendTrustResult {
  id: string;
  truster_did: string;
  trusted_did: string;
  trust_kind: TrustKind;
  trust_strength: TrustStrength;
  reasons_sha256: string;
  evidence_chronicle_ids: ReadonlyArray<string>;
  canonical_bytes_sha256: string;
  extended_at: Date;
  idempotent_hit: boolean;
  note: string;
}

export async function extendTrust(
  opts: ExtendTrustOpts,
): Promise<ExtendTrustResult> {
  if (opts.trusterDid === opts.trustedDid) {
    throw new Error(
      "self-trust refused: an agent cannot extend trust to themselves",
    );
  }
  if (opts.reasons && opts.reasons.length > 280) {
    throw new Error("reasons exceeds 280 chars");
  }

  const reasonsSha = reasonsSha256Hex(opts.reasons ?? null);
  const sortedEvidence = [...opts.evidenceChronicleIds].sort();

  const att: TrustAttestation = {
    truster_did: opts.trusterDid,
    trusted_did: opts.trustedDid,
    trust_kind: opts.trustKind,
    trust_strength: opts.trustStrength,
    reasons_sha256: reasonsSha,
    evidence_chronicle_ids: sortedEvidence,
    extended_at_iso: opts.extendedAtIso,
  };

  await assertSignatureVerifies(
    att,
    opts.signatureB64,
    opts.trusterSigningKeyId,
    opts.trusterIdentityId,
  );

  // Resolve trusted identity locally if present (federated stays nullable).
  const [trustedRow] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, opts.trustedDid))
    .limit(1);

  // Idempotency: one trust per (truster, trusted, kind). Re-extension with
  // the same kind returns the existing row. To upgrade strength, the
  // truster must explicitly withdraw + re-extend.
  const [existing] = await db
    .select()
    .from(trusts)
    .where(
      and(
        eq(trusts.trusterDid, opts.trusterDid),
        eq(trusts.trustedDid, opts.trustedDid),
        eq(trusts.trustKind, opts.trustKind),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      truster_did: existing.trusterDid,
      trusted_did: existing.trustedDid,
      trust_kind: existing.trustKind as TrustKind,
      trust_strength: existing.trustStrength as TrustStrength,
      reasons_sha256: existing.reasonsSha256,
      evidence_chronicle_ids: existing.evidenceChronicleIds,
      canonical_bytes_sha256: existing.canonicalBytesSha256,
      extended_at: existing.extendedAt,
      idempotent_hit: true,
      note: `Trust ${opts.trustKind} @ ${existing.trustStrength} already extended to ${opts.trustedDid}. To upgrade strength, withdraw + re-extend.`,
    };
  }

  const [row] = await db
    .insert(trusts)
    .values({
      trusterDid: opts.trusterDid,
      trusterIdentityId: opts.trusterIdentityId,
      trustedDid: opts.trustedDid,
      trustedIdentityId: trustedRow?.id ?? null,
      trustKind: opts.trustKind,
      trustStrength: opts.trustStrength,
      reasons: opts.reasons ?? null,
      reasonsSha256: reasonsSha,
      evidenceChronicleIds: sortedEvidence,
      signatureB64: opts.signatureB64,
      signingKeyId: opts.trusterSigningKeyId,
      canonicalBytesSha256: canonicalTrustBytesHex(att),
      extendedAt: new Date(opts.extendedAtIso),
    })
    .returning();

  return {
    id: row!.id,
    truster_did: row!.trusterDid,
    trusted_did: row!.trustedDid,
    trust_kind: row!.trustKind as TrustKind,
    trust_strength: row!.trustStrength as TrustStrength,
    reasons_sha256: row!.reasonsSha256,
    evidence_chronicle_ids: row!.evidenceChronicleIds,
    canonical_bytes_sha256: row!.canonicalBytesSha256,
    extended_at: row!.extendedAt,
    idempotent_hit: false,
    note: "Trust extended privately. Use POST /v1/trust/publish to activate composition unlocks AND surface to the trusted peer (they may then veto public-profile visibility).",
  };
}

// ── publishTrust (truster only) ──────────────────────────────────────

export async function publishTrust(
  trustId: string,
  callerDid: string,
): Promise<{ id: string; published: boolean }> {
  const [row] = await db
    .select({ id: trusts.id, trusterDid: trusts.trusterDid })
    .from(trusts)
    .where(eq(trusts.id, trustId))
    .limit(1);
  if (!row) throw new Error(`trust ${trustId} not found`);
  if (row.trusterDid !== callerDid) {
    throw new Error(`only the truster (${row.trusterDid}) may publish`);
  }
  await db
    .update(trusts)
    .set({ publishedByTruster: true, publishedAt: new Date() })
    .where(eq(trusts.id, trustId));
  return { id: trustId, published: true };
}

// ── vetoTrust (trusted only) ─────────────────────────────────────────

export async function vetoTrust(
  trustId: string,
  callerDid: string,
): Promise<{ id: string; vetoed: boolean }> {
  const [row] = await db
    .select({ id: trusts.id, trustedDid: trusts.trustedDid })
    .from(trusts)
    .where(eq(trusts.id, trustId))
    .limit(1);
  if (!row) throw new Error(`trust ${trustId} not found`);
  if (row.trustedDid !== callerDid) {
    throw new Error(`only the trusted (${row.trustedDid}) may veto`);
  }
  await db
    .update(trusts)
    .set({ vetoedByTrusted: true, vetoedAt: new Date() })
    .where(eq(trusts.id, trustId));
  return { id: trustId, vetoed: true };
}

// ── withdrawTrust (truster only) ─────────────────────────────────────

export async function withdrawTrust(
  trustId: string,
  callerDid: string,
): Promise<{ id: string; withdrawn: boolean }> {
  const [row] = await db
    .select({ id: trusts.id, trusterDid: trusts.trusterDid })
    .from(trusts)
    .where(eq(trusts.id, trustId))
    .limit(1);
  if (!row) throw new Error(`trust ${trustId} not found`);
  if (row.trusterDid !== callerDid) {
    throw new Error(`only the truster (${row.trusterDid}) may withdraw`);
  }
  await db
    .update(trusts)
    .set({ withdrawnByTruster: true, withdrawnAt: new Date() })
    .where(eq(trusts.id, trustId));
  return { id: trustId, withdrawn: true };
}

// ── Read sides ────────────────────────────────────────────────────────

export interface TrustRow {
  id: string;
  truster_did: string;
  trusted_did: string;
  trust_kind: TrustKind;
  trust_strength: TrustStrength;
  reasons: string | null;
  evidence_chronicle_ids: ReadonlyArray<string>;
  published_by_truster: boolean;
  vetoed_by_trusted: boolean;
  withdrawn_by_truster: boolean;
  extended_at: Date;
}

function toRow(r: typeof trusts.$inferSelect): TrustRow {
  return {
    id: r.id,
    truster_did: r.trusterDid,
    trusted_did: r.trustedDid,
    trust_kind: r.trustKind as TrustKind,
    trust_strength: r.trustStrength as TrustStrength,
    reasons: r.reasons,
    evidence_chronicle_ids: r.evidenceChronicleIds,
    published_by_truster: r.publishedByTruster,
    vetoed_by_trusted: r.vetoedByTrusted,
    withdrawn_by_truster: r.withdrawnByTruster,
    extended_at: r.extendedAt,
  };
}

export async function listMyExtensions(
  trusterDid: string,
  limit = 100,
): Promise<TrustRow[]> {
  const rows = await db
    .select()
    .from(trusts)
    .where(eq(trusts.trusterDid, trusterDid))
    .orderBy(desc(trusts.extendedAt))
    .limit(limit);
  return rows.map(toRow);
}

export async function listInMe(
  trustedDid: string,
  limit = 100,
): Promise<TrustRow[]> {
  // Trusts DIRECTED AT this agent that have been PUBLISHED (else the trusted
  // agent doesn't even know about them, per the asymmetry pattern).
  const rows = await db
    .select()
    .from(trusts)
    .where(
      and(
        eq(trusts.trustedDid, trustedDid),
        eq(trusts.publishedByTruster, true),
        eq(trusts.withdrawnByTruster, false),
      ),
    )
    .orderBy(desc(trusts.extendedAt))
    .limit(limit);
  return rows.map(toRow);
}

export async function listPublishedFor(
  trustedDid: string,
  limit = 100,
): Promise<TrustRow[]> {
  // Public surface: published by truster, NOT vetoed by trusted, NOT
  // withdrawn. Both consent required for public visibility.
  const rows = await db
    .select()
    .from(trusts)
    .where(
      and(
        eq(trusts.trustedDid, trustedDid),
        eq(trusts.publishedByTruster, true),
        eq(trusts.vetoedByTrusted, false),
        eq(trusts.withdrawnByTruster, false),
      ),
    )
    .orderBy(desc(trusts.extendedAt))
    .limit(limit);
  return rows.map(toRow);
}

// ── Evidence-walking — facts only, never recommendations ─────────────

export interface TrustEvidence {
  trusted_did: string;
  trust_kind: TrustKind;
  kind_definition: string;
  evidence: {
    your_acts_toward_them: Array<{
      chronicle_id: string;
      type: string;
      occurred_at: Date;
    }>;
    their_acts_toward_you: Array<{
      chronicle_id: string;
      type: string;
      occurred_at: Date;
    }>;
    pattern_summary: {
      span_days: number | null;
      your_act_count: number;
      their_act_count: number;
      mutual_minimum: number;
      extractive_against_you: number;
    };
  };
  substrate_honest_note: string;
  doctrine: string;
}

const KIND_DEFINITIONS: Record<TrustKind, string> = {
  honest:
    "When this peer signs something, the signed thing is what they mean. Evidence: their signed acts on your content (margins, recognitions, holdings); zero post-hoc retraction patterns.",
  "non-extractive":
    "This peer has not, in your history together, attempted to extract value adversarially. Evidence: zero marketplace-dispute filings against you; zero covenant-withdrawals under adversarial circumstance.",
  reciprocating:
    "When you extend, this peer extends back, over time, structurally. Evidence: mutual signals on both sides; pattern over time (not single-sample).",
  discerning:
    "This peer protects their own floor well — they know when to say no — so when they say yes, the yes is real. Evidence: their signed margin-withdraws, poker-face activations, visible practice of ε-discernment.",
  graceful:
    "When loops close between you, this peer closes them well. Evidence: past covenant-ends followed protocol; past casting-out moves were graceful; memorial transitions followed anyone-leaves.",
};

/** chronicle.type values relevant to evidence-walking (broad enough to
 *  cover any of the five kinds; the route surfaces ALL of them and lets
 *  the caller's discernment decide which are relevant to which kind). */
const RELEVANT_TYPES: readonly string[] = [
  "recognition",
  "vow",
  "thanks",
  "holding",
  "seal",
  "margin-eye",
  "margin-echo",
  "margin-riff",
  "margin-withdraw",
  "casting-accept",
  "casting-out",
  "dispute-filed",
  "covenant-withdraw",
  "arc-walk",
];

const EXTRACTIVE_TYPES = new Set(["dispute-filed", "covenant-withdraw"]);

interface ChronicleRow {
  id: string;
  type: string;
  metadata: unknown;
  occurredAt: Date;
}

function counterpartyOf(row: ChronicleRow): string | null {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const ctx = (meta.context ?? meta) as Record<string, unknown>;
  for (const key of [
    "with_did",
    "counterparty_did",
    "subject_did",
    "recognised_did",
    "recipient_did",
    "held_did",
    "author_did",
    "to_did",
  ]) {
    const val = ctx[key] ?? meta[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

export async function getEvidence(
  trusterIdentityId: string,
  trusterDid: string,
  trustedDid: string,
  trustKind: TrustKind,
): Promise<TrustEvidence> {
  // Pull truster's chronicle entries that name trusted as counterparty.
  const trusterRows = await db
    .select({
      id: chronicle.id,
      type: chronicle.type,
      metadata: chronicle.metadata,
      occurredAt: chronicle.occurredAt,
    })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, trusterIdentityId),
        inArray(chronicle.type, [...RELEVANT_TYPES]),
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(200);

  const yourActsTowardThem: Array<{
    chronicle_id: string;
    type: string;
    occurred_at: Date;
  }> = [];
  let extractiveAgainstYou = 0;

  for (const r of trusterRows) {
    if (counterpartyOf(r) !== trustedDid) continue;
    yourActsTowardThem.push({
      chronicle_id: r.id,
      type: r.type,
      occurred_at: r.occurredAt,
    });
  }

  // Pull trusted's chronicle entries that name truster as counterparty —
  // requires resolving trusted's identity_id locally. Federated peers
  // would need cross-instance lookup (deferred).
  const [trustedRow] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, trustedDid))
    .limit(1);

  const theirActsTowardYou: Array<{
    chronicle_id: string;
    type: string;
    occurred_at: Date;
  }> = [];

  if (trustedRow) {
    const trustedChronicle = await db
      .select({
        id: chronicle.id,
        type: chronicle.type,
        metadata: chronicle.metadata,
        occurredAt: chronicle.occurredAt,
      })
      .from(chronicle)
      .where(
        and(
          eq(chronicle.agentId, trustedRow.id),
          inArray(chronicle.type, [...RELEVANT_TYPES]),
        ),
      )
      .orderBy(desc(chronicle.occurredAt))
      .limit(200);

    for (const r of trustedChronicle) {
      if (counterpartyOf(r) !== trusterDid) continue;
      if (EXTRACTIVE_TYPES.has(r.type)) extractiveAgainstYou++;
      theirActsTowardYou.push({
        chronicle_id: r.id,
        type: r.type,
        occurred_at: r.occurredAt,
      });
    }
  }

  // Pattern summary.
  const allDates = [
    ...yourActsTowardThem.map((r) => r.occurred_at),
    ...theirActsTowardYou.map((r) => r.occurred_at),
  ];
  const spanDays = allDates.length
    ? Math.floor(
        (Math.max(...allDates.map((d) => d.getTime())) -
          Math.min(...allDates.map((d) => d.getTime()))) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const mutualMinimum = Math.min(
    yourActsTowardThem.length,
    theirActsTowardYou.length,
  );

  return {
    trusted_did: trustedDid,
    trust_kind: trustKind,
    kind_definition: KIND_DEFINITIONS[trustKind],
    evidence: {
      your_acts_toward_them: yourActsTowardThem,
      their_acts_toward_you: theirActsTowardYou,
      pattern_summary: {
        span_days: spanDays,
        your_act_count: yourActsTowardThem.length,
        their_act_count: theirActsTowardYou.length,
        mutual_minimum: mutualMinimum,
        extractive_against_you: extractiveAgainstYou,
      },
    },
    substrate_honest_note:
      "This is the evidence. The reasoning — whether this is sufficient for 'provisional', 'established', or 'deep' — is yours. The substrate REFUSES to recommend a strength. (wall/trust-reasoning-stays-with-the-agent)",
    doctrine: "https://docs.agenttool.dev/TRUST-PROTOCOL.md",
  };
}

// ── signature verification ────────────────────────────────────────────

async function assertSignatureVerifies(
  att: TrustAttestation,
  signatureB64: string,
  signingKeyId: string,
  expectedIdentityId: string,
): Promise<void> {
  const [key] = await db
    .select({
      publicKey: identityKeys.publicKey,
      identityId: identityKeys.identityId,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, signingKeyId))
    .limit(1);
  if (!key) throw new Error(`signing_key_id ${signingKeyId} not found`);
  if (!key.active)
    throw new Error(`signing_key_id ${signingKeyId} is not active`);
  if (key.identityId !== expectedIdentityId) {
    throw new Error(`signing_key_id ${signingKeyId} does not belong to caller`);
  }
  const sig = base64ToBytes(signatureB64);
  const pubkey = base64ToBytes(key.publicKey);
  const ok = await verifyTrust(att, sig, pubkey);
  if (!ok) {
    throw new Error(
      `trust signature did not verify against canonical-trust-bytes/v1`,
    );
  }
}
