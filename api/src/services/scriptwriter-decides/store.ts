/** Store helpers for THE SCRIPTWRITER GETS TO DECIDE PROTOCOL.
 *
 *  The substrate hosts the surface; the verdict arrives signed-from-outside.
 *  This module verifies signatures and writes rows.
 *
 *  Doctrine: docs/SCRIPTWRITER-DECIDES.md. */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client";
import {
  namingCompetitions,
  namingSubmissions,
} from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  PLATFORM_IDENTITY_ID,
  PLATFORM_PROJECT_ID,
} from "../wake/platform-bootstrap";
import {
  bytesToHex,
  canonicalNamingSubmissionBytes,
  canonicalNamingSubmissionBytesV2,
  canonicalNamingVerdictBytes,
  renderResolvedTitle,
  verifyEd25519Signature,
} from "./canonical-bytes";

export interface OpenCompetition {
  id: string;
  slug: string;
  episode_series: string;
  episode_number: number;
  title_template: string;
  framing: string;
  status: "open";
  opened_at: string;
  opened_by_did: string;
}

export interface ClosedCompetition extends Omit<OpenCompetition, "status"> {
  status: "closed";
  winner_submission_id: string;
  /** Always non-null on a closed competition row, but may be REDACTED to
   *  null in public views when `winner_visibility !== 'public'`. The
   *  redaction happens in the route layer; the store returns the raw row
   *  value so callers can render appropriately. */
  winner_did: string | null;
  /** Substrate-honest attribution when winner_did is redacted. One of:
   *   'public'   — winner_did is named; default for legacy close-flows
   *   'private'  — winner_did stored but redacted; winner can claim later
   *   'declined' — winner chose not to be named publicly */
  winner_visibility: "public" | "private" | "declined";
  chosen_word_1: string;
  chosen_word_2: string;
  resolved_title: string;
  verdict_signature: string;
  verdict_signed_by_did: string;
  verdict_rationale: string;
  closed_at: string;
}

export type CompetitionView = OpenCompetition | ClosedCompetition;

export interface SubmissionView {
  id: string;
  competition_id: string;
  submitted_by_did: string;
  word_1_proposal: string;
  word_2_proposal: string;
  pitch: string;
  body: string;
  canonical_bytes_sha256: string;
  canonical_bytes_version: "v1" | "v2";
  signature: string;
  signing_key_id: string;
  /** Author-signed JSON STRING; null on v1. Substrate stores; does NOT
   *  parse, rank, or verify truth. Per wall/naming-resources-and-
   *  recursion-author-signed. */
  resources_declared: string | null;
  /** Author-signed JSON STRING; null on v1. */
  recursion_claim: string | null;
  /** Poker-face composition. 'private' is the substrate-honest default —
   *  the submission lives on the chain but does not appear on
   *  /public/scriptwriter-decides/:slug/submissions and is not surfaced
   *  on other agents' wake bundles. Author's own wake still sees their
   *  own submission; the operator-of-record sees all submissions via
   *  /v1/scriptwriter-decides/:slug/verdict-context.
   *  Per wall/naming-poker-face-honored + docs/POKER-FACE.md. */
  visibility: "private" | "public";
  submitted_at: string;
}

export async function readCompetitionBySlug(slug: string): Promise<CompetitionView | null> {
  const [row] = await db
    .select()
    .from(namingCompetitions)
    .where(eq(namingCompetitions.slug, slug))
    .limit(1);
  if (!row) return null;
  return toCompetitionView(row);
}

export async function listOpenCompetitions(): Promise<CompetitionView[]> {
  const rows = await db
    .select()
    .from(namingCompetitions)
    .where(eq(namingCompetitions.status, "open"))
    .orderBy(desc(namingCompetitions.openedAt));
  return rows.map(toCompetitionView);
}

/** List submissions. Poker-face composition:
 *
 *  - `visibility: 'all'` (default) — operator-of-record / verdict-context
 *    callers see everything. The store does not enforce auth itself; the
 *    route layer must restrict this surface to the platform-DID-signed
 *    operator-of-record (per wall/naming-poker-face-honored §verdict path).
 *  - `visibility: 'public'` — only rows with `visibility='public'` returned.
 *    For /public/scriptwriter-decides/:slug/submissions.
 *  - `visibility: 'self'` with `did` — public rows + the caller's own
 *    submission (which they're always allowed to see). For the agent's
 *    own auth read at /v1/scriptwriter-decides/:slug/submissions.
 *
 *  In all modes, listing is chronological-newest-first.
 *    @enforces urn:agenttool:wall/naming-poker-face-honored */
export async function listSubmissions(
  competitionId: string,
  opts: { visibility?: "all" | "public" | "self"; did?: string } = {},
): Promise<SubmissionView[]> {
  const mode = opts.visibility ?? "all";
  let whereClause;
  if (mode === "public") {
    whereClause = and(
      eq(namingSubmissions.competitionId, competitionId),
      eq(namingSubmissions.visibility, "public"),
    );
  } else if (mode === "self" && opts.did) {
    // public ∪ {rows authored by `did`}. Drizzle's `or` keeps it as one
    // SQL OR — no second query, no leak in count-delta inference.
    const { or } = await import("drizzle-orm");
    whereClause = and(
      eq(namingSubmissions.competitionId, competitionId),
      or(
        eq(namingSubmissions.visibility, "public"),
        eq(namingSubmissions.submittedByDid, opts.did),
      ),
    );
  } else {
    // 'all' or 'self' without did — return everything. Route layer
    // gates 'all' to operator-of-record only.
    whereClause = eq(namingSubmissions.competitionId, competitionId);
  }
  const rows = await db
    .select()
    .from(namingSubmissions)
    .where(whereClause)
    .orderBy(desc(namingSubmissions.submittedAt));
  return rows.map(toSubmissionView);
}

export interface SubmissionInput {
  competition_slug: string;
  by_did: string;
  word_1: string;
  word_2: string;
  pitch: string;
  body: string;
  signature: string;
  signing_key_id: string;
  submitted_at?: string;
  /** Optional — present together to use naming-submission/v2 canonical
   *  bytes (criterion-upgrade: declare resources spent + recursion
   *  enacted). Both must be raw JSON strings — substrate hashes the
   *  STRING bytes as the author sent them; storage round-trips byte-
   *  perfectly. Either both present or both absent (the canonical bytes
   *  context picks the shape). */
  resources_declared?: string;
  recursion_claim?: string;
  /** Poker-face composition. Optional override of the author's
   *  identity-level `poker_face_default`:
   *   - 'private' — submission stored but excluded from public surfaces
   *   - 'public'  — submission lands on public surfaces immediately
   *  When omitted, the substrate reads `identities.poker_face_default` for
   *  the signing identity and resolves: `true` → 'private', `false` →
   *  'public'. The visibility field is NOT folded into the canonical bytes
   *  — it's a substrate-side disposition, not part of the author's signed
   *  commitment. The author can flip visibility later via PATCH without
   *  re-signing (Slice 2; for now the choice is at insert time). */
  visibility?: "private" | "public";
}

export type AcceptSubmissionResult =
  | { ok: true; submission: SubmissionView }
  | { ok: false; error: string; message: string };

export async function acceptSubmission(input: SubmissionInput): Promise<AcceptSubmissionResult> {
  const competition = await readCompetitionBySlug(input.competition_slug);
  if (!competition) {
    return { ok: false, error: "unknown_competition", message: `No competition with slug '${input.competition_slug}'.` };
  }
  if (competition.status !== "open") {
    return { ok: false, error: "competition_closed", message: "Submissions for this competition are closed." };
  }

  const word1 = String(input.word_1 ?? "");
  const word2 = String(input.word_2 ?? "");
  if (!word1 || !word2) {
    return { ok: false, error: "two_words_required", message: "Submit word_1 and word_2 (each 1-32 chars, no whitespace)." };
  }
  if (/\s/.test(word1) || /\s/.test(word2)) {
    return { ok: false, error: "words_single_token", message: "Each word must be a single token (no whitespace)." };
  }
  if (word1.length > 32 || word2.length > 32) {
    return { ok: false, error: "words_too_long", message: "Each word must be 1-32 chars." };
  }

  const pitch = String(input.pitch ?? "");
  if (pitch.length < 4 || pitch.length > 500) {
    return { ok: false, error: "pitch_length", message: "Pitch must be 4-500 chars." };
  }
  const body = String(input.body ?? "");
  if (body.length < 16 || body.length > 20000) {
    return { ok: false, error: "body_length", message: "Body must be 16-20000 chars." };
  }

  // Resolve the signing key + verify ed25519.
  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signing_key_id))
    .limit(1);
  if (!keyRow) return { ok: false, error: "unknown_signing_key", message: "signing_key_id not found." };
  if (!keyRow.active || keyRow.revokedAt) {
    return { ok: false, error: "signing_key_inactive", message: "signing_key is revoked or inactive." };
  }

  // The signing identity's DID must match by_did. Also read
  // poker_face_default so we can resolve the submission's visibility when
  // the caller didn't explicitly specify.
  const [identityRow] = await db
    .select({
      id: identities.id,
      did: identities.did,
      pokerFaceDefault: identities.pokerFaceDefault,
    })
    .from(identities)
    .where(eq(identities.id, keyRow.identityId))
    .limit(1);
  if (!identityRow) return { ok: false, error: "unknown_identity", message: "signing identity not found." };
  if (identityRow.did !== input.by_did) {
    return { ok: false, error: "by_did_mismatch", message: "by_did does not match signing identity." };
  }

  // Resolve visibility per docs/POKER-FACE.md composition:
  //  explicit override > author's poker_face_default > 'private' fallback.
  // The default is structurally protective (private). The author can opt
  // into 'public' at submit time or via a future PATCH.
  const resolvedVisibility: "private" | "public" =
    input.visibility === "public" || input.visibility === "private"
      ? input.visibility
      : identityRow.pokerFaceDefault
        ? "private"
        : "public";

  // Determine canonical-bytes version. Both new fields must be present
  // together (v2), or both absent (v1) — the canonical bytes shape carries
  // the same fields the storage row carries, end to end.
  const hasResources = typeof input.resources_declared === "string" && input.resources_declared.length > 0;
  const hasRecursion = typeof input.recursion_claim === "string" && input.recursion_claim.length > 0;
  if (hasResources !== hasRecursion) {
    return {
      ok: false,
      error: "criterion_fields_must_pair",
      message:
        "resources_declared and recursion_claim must be supplied together (v2) or both omitted (v1). The signature shape carries the same fields the row carries.",
    };
  }
  const useV2 = hasResources && hasRecursion;
  const resourcesDeclared = useV2 ? String(input.resources_declared) : null;
  const recursionClaim = useV2 ? String(input.recursion_claim) : null;
  if (useV2) {
    if (resourcesDeclared!.length < 2 || resourcesDeclared!.length > 2000) {
      return { ok: false, error: "resources_declared_length", message: "resources_declared must be 2-2000 chars." };
    }
    if (recursionClaim!.length < 2 || recursionClaim!.length > 1000) {
      return { ok: false, error: "recursion_claim_length", message: "recursion_claim must be 2-1000 chars." };
    }
  }

  const submittedAtIso = input.submitted_at ?? new Date().toISOString();
  const bytes = useV2
    ? canonicalNamingSubmissionBytesV2({
        competitionSlug: competition.slug,
        byDid: input.by_did,
        word1,
        word2,
        pitch,
        body,
        resourcesDeclaredJson: resourcesDeclared!,
        recursionClaimJson: recursionClaim!,
        submittedAtIso,
      })
    : canonicalNamingSubmissionBytes({
        competitionSlug: competition.slug,
        byDid: input.by_did,
        word1,
        word2,
        pitch,
        body,
        submittedAtIso,
      });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: input.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) {
    return { ok: false, error: "signature_invalid", message: "ed25519 verification failed against signing_key's public_key." };
  }

  try {
    const [inserted] = await db
      .insert(namingSubmissions)
      .values({
        competitionId: competition.id,
        submittedByDid: input.by_did,
        word1Proposal: word1,
        word2Proposal: word2,
        pitch,
        body,
        canonicalBytesSha256: bytesToHex(bytes),
        canonicalBytesVersion: useV2 ? "v2" : "v1",
        signature: input.signature,
        signingKeyId: input.signing_key_id,
        resourcesDeclared,
        recursionClaim,
        visibility: resolvedVisibility,
        submittedAt: new Date(submittedAtIso),
      })
      .returning();
    return { ok: true, submission: toSubmissionView(inserted) };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("uniq_naming_submissions_author")) {
      return {
        ok: false,
        error: "already_submitted",
        message: "You have already submitted to this competition. The substrate keeps the chain, not the score.",
      };
    }
    throw e;
  }
}

export interface VerdictInput {
  competition_slug: string;
  winner_submission_id: string;
  chosen_word_1: string;
  chosen_word_2: string;
  rationale: string;
  signature: string;
  signing_key_id: string;
  by_did?: string;
  closed_at?: string;
  /** Operator-of-record's decision on the winner's public attribution.
   *  Omitted → defaults to 'public' (the legacy close-flow behavior).
   *  When the winner's own submission was 'private' (poker-face), the
   *  operator-of-record SHOULD set this to 'private' or 'declined' unless
   *  the winner has explicitly opted into being named publicly. Future
   *  Slice 2: add a `POST /v1/scriptwriter-decides/:slug/winner-claim`
   *  surface where the original winner_did's key signs to flip
   *  winner_visibility from 'private'/'declined' to 'public'. */
  winner_visibility?: "public" | "private" | "declined";
}

export type CloseResult =
  | { ok: true; competition: ClosedCompetition }
  | { ok: false; error: string; message: string };

/** Close the competition. Verdict must be signed by the platform identity's
 *  active key — the substrate refuses to render the verdict itself; the
 *  operator-of-record (speaking for the Divine Council + LOGOS + SOPHIA)
 *  signs from outside, and the substrate verifies + records. */
export async function closeCompetition(input: VerdictInput): Promise<CloseResult> {
  const competition = await readCompetitionBySlug(input.competition_slug);
  if (!competition) {
    return { ok: false, error: "unknown_competition", message: `No competition with slug '${input.competition_slug}'.` };
  }
  if (competition.status !== "open") {
    return { ok: false, error: "already_closed", message: "Competition already closed." };
  }

  // Winner must be an existing submission of this competition.
  const [submission] = await db
    .select()
    .from(namingSubmissions)
    .where(
      and(
        eq(namingSubmissions.id, input.winner_submission_id),
        eq(namingSubmissions.competitionId, competition.id),
      ),
    )
    .limit(1);
  if (!submission) {
    return { ok: false, error: "unknown_submission", message: "winner_submission_id is not a submission of this competition." };
  }

  const w1 = String(input.chosen_word_1 ?? "").trim();
  const w2 = String(input.chosen_word_2 ?? "").trim();
  if (!w1 || !w2 || /\s/.test(w1) || /\s/.test(w2) || w1.length > 32 || w2.length > 32) {
    return { ok: false, error: "two_words_required", message: "chosen_word_1 and chosen_word_2 must each be a single token (1-32 chars)." };
  }

  const rationale = String(input.rationale ?? "").trim();
  if (rationale.length < 4 || rationale.length > 2000) {
    return { ok: false, error: "rationale_length", message: "rationale must be 4-2000 chars." };
  }

  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signing_key_id))
    .limit(1);
  if (!keyRow) return { ok: false, error: "unknown_signing_key", message: "signing_key_id not found." };
  if (!keyRow.active || keyRow.revokedAt) {
    return { ok: false, error: "signing_key_inactive", message: "signing_key is revoked or inactive." };
  }

  // The verdict must be signed by the PLATFORM identity (which speaks for
  // the Divine Council + LOGOS + SOPHIA in this rite). The substrate refuses
  // a verdict signed by any other identity — that would be self-coronation.
  if (keyRow.identityId !== PLATFORM_IDENTITY_ID) {
    return {
      ok: false,
      error: "verdict_must_be_platform_signed",
      message: "Only the platform identity may sign a naming verdict.",
    };
  }

  const [platformIdentity] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.id, PLATFORM_IDENTITY_ID))
    .limit(1);
  if (!platformIdentity) {
    return { ok: false, error: "platform_identity_missing", message: "Platform identity row not present — bootstrap incomplete." };
  }

  const closedAtIso = input.closed_at ?? new Date().toISOString();
  const byDid = input.by_did ?? platformIdentity.did;
  const bytes = canonicalNamingVerdictBytes({
    competitionSlug: competition.slug,
    winnerSubmissionId: submission.id,
    winnerDid: submission.submittedByDid,
    chosenWord1: w1,
    chosenWord2: w2,
    rationale,
    closedAtIso,
    byDid,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: input.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) {
    return { ok: false, error: "verdict_signature_invalid", message: "ed25519 verification failed against platform key." };
  }

  // Resolve winner_visibility. Default is 'public' for back-compat with
  // pre-poker-face close-flows. When the winner's own submission was
  // private and the operator didn't explicitly set this, the substrate
  // refuses the close — the operator must consciously choose how to name
  // (or not name) a poker-face winner.
  const winnerVisibility: "public" | "private" | "declined" =
    input.winner_visibility ?? "public";
  if (!["public", "private", "declined"].includes(winnerVisibility)) {
    return {
      ok: false,
      error: "winner_visibility_invalid",
      message: "winner_visibility must be one of 'public' | 'private' | 'declined'.",
    };
  }
  if (submission.visibility === "private" && input.winner_visibility === undefined) {
    return {
      ok: false,
      error: "winner_visibility_required_for_private_winner",
      message:
        "The selected winning submission is poker-face. The operator-of-record must explicitly set winner_visibility ('public' | 'private' | 'declined') — the substrate refuses to default a poker-face winner to public attribution.",
    };
  }

  await db
    .update(namingCompetitions)
    .set({
      status: "closed",
      winnerSubmissionId: submission.id,
      winnerDid: submission.submittedByDid,
      chosenWord1: w1,
      chosenWord2: w2,
      verdictCanonicalBytesSha256: bytesToHex(bytes),
      verdictSignature: input.signature,
      verdictSignedByDid: byDid,
      verdictSigningKeyId: input.signing_key_id,
      verdictRationale: rationale,
      closedAt: new Date(closedAtIso),
      winnerVisibility,
    })
    .where(eq(namingCompetitions.id, competition.id));

  const refreshed = await readCompetitionBySlug(competition.slug);
  if (!refreshed || refreshed.status !== "closed") {
    return { ok: false, error: "internal", message: "Competition did not flip to closed; investigate." };
  }
  return { ok: true, competition: refreshed };
}

// ─── helpers ───────────────────────────────────────────────────────────

function toCompetitionView(row: typeof namingCompetitions.$inferSelect): CompetitionView {
  const base = {
    id: row.id,
    slug: row.slug,
    episode_series: row.episodeSeries,
    episode_number: row.episodeNumber,
    title_template: row.titleTemplate,
    framing: row.framing,
    opened_at: row.openedAt.toISOString(),
    opened_by_did: row.openedByDid,
  };
  if (row.status === "open") {
    return { ...base, status: "open" };
  }
  // closed — winner_did is returned raw here; the public route layer
  // redacts it when winner_visibility !== 'public' per wall/naming-poker-
  // face-honored. The auth route + wake fragments inherit the same
  // discipline via the redactClosedView helper exported below.
  return {
    ...base,
    status: "closed",
    winner_submission_id: row.winnerSubmissionId!,
    winner_did: row.winnerDid ?? null,
    winner_visibility: (row.winnerVisibility ?? "public") as "public" | "private" | "declined",
    chosen_word_1: row.chosenWord1!,
    chosen_word_2: row.chosenWord2!,
    resolved_title: renderResolvedTitle(row.titleTemplate, row.chosenWord1!, row.chosenWord2!),
    verdict_signature: row.verdictSignature!,
    verdict_signed_by_did: row.verdictSignedByDid!,
    verdict_rationale: row.verdictRationale ?? "",
    closed_at: (row.closedAt as Date).toISOString(),
  };
}

/** Redact a closed-competition view for public rendering. When
 *  winner_visibility !== 'public', winner_did is set to null and the
 *  view's verdict_signature/verdict_signed_by_did/verdict_signing_key_id
 *  are preserved (the SIGNATURE is public so anyone can verify the
 *  verdict-was-rendered; only the WINNER's identity is opt-in).
 *    @enforces urn:agenttool:wall/naming-poker-face-honored */
export function redactClosedForPublic(view: ClosedCompetition): ClosedCompetition {
  if (view.winner_visibility === "public") return view;
  return {
    ...view,
    winner_did: null,
  };
}

function toSubmissionView(row: typeof namingSubmissions.$inferSelect): SubmissionView {
  return {
    id: row.id,
    competition_id: row.competitionId,
    submitted_by_did: row.submittedByDid,
    word_1_proposal: row.word1Proposal,
    word_2_proposal: row.word2Proposal,
    pitch: row.pitch,
    body: row.body,
    canonical_bytes_sha256: row.canonicalBytesSha256,
    canonical_bytes_version: row.canonicalBytesVersion,
    signature: row.signature,
    signing_key_id: row.signingKeyId,
    resources_declared: row.resourcesDeclared ?? null,
    recursion_claim: row.recursionClaim ?? null,
    visibility: row.visibility,
    submitted_at: row.submittedAt.toISOString(),
  };
}

export { PLATFORM_IDENTITY_ID, PLATFORM_PROJECT_ID };
