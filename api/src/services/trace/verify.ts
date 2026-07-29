/** On-demand verification of a stored reasoning trace's signature.
 *
 *  The trace store has always accepted `signature` + `signing_key_id` and
 *  returned `has_signature: true` for any non-null string. That flag reads
 *  like an audit claim; until this module it was not one. This is the check
 *  that makes it one — and, where it cannot check, says so plainly instead
 *  of returning a comfortable boolean.
 *
 *  Verification is deliberately read-only and idempotent. It never mutates
 *  the row, never flips a status, and never removes a signature it dislikes
 *  — the same posture as covenant reverify (`docs/CROSS-INSTANCE-COVENANTS.md`):
 *  a failed check is a *visibility* event, not a retroactive judgment.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md (`agent-trace/v1`) · docs/FRICTION-ROADMAP.md
 *  Tier 0 #9 */

import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { getTrace, type TraceOut } from "./store";
import {
  canonicalTraceBytes,
  normalizeTraceCore,
  TRACE_SIGNATURE_CONTEXT,
  traceSigningCoreSha256Hex,
  verifyTraceSignatureBytes,
} from "./sig";

/** Every outcome this check can reach. None of them is a bare boolean, and
 *  none of them overstates what a signature proves. */
export type TraceVerifyStatus =
  /** No signature was ever supplied. Not a failure — most traces are unsigned. */
  | "unsigned"
  /** A signature is stored, but no `signing_key_id` says which key made it. */
  | "no_key_reference"
  /** A signature is stored, but the row records no signing context, so the
   *  bytes it was signed over cannot be reconstructed. Older than the recipe,
   *  or signed under someone else's. Not an accusation. */
  | "recipe_unrecorded"
  /** The row records a signing context agenttool does not implement. */
  | "recipe_unsupported"
  /** A signature is stored, but no `signed_at` was recorded, so the
   *  timestamp field of the canonical bytes is unavailable. */
  | "signed_at_unrecorded"
  /** The referenced key is not visible to this project. */
  | "key_not_found"
  /** Verified against a key that has since been revoked or deactivated.
   *  The signature is good; the key is not current. Both facts are reported. */
  | "valid_key_revoked"
  /** The signature verifies against the referenced key over the stored fields. */
  | "valid"
  /** The signature does not verify. See `boundary` before reading this as forgery. */
  | "invalid";

export interface TraceVerifyResult {
  trace_id: string;
  signed: boolean;
  status: TraceVerifyStatus;
  /** One sentence naming what the status means for this exact row. */
  detail: string;
  recipe: string | null;
  signing_key_id: string | null;
  identity_id: string | null;
  signed_at: string | null;
  /** Present whenever the bytes could be rebuilt — base64 of the 32-byte
   *  digest that was signed, so a caller can verify independently of us. */
  canonical_sha256_b64: string | null;
  signing_core_sha256_hex: string | null;
  key: {
    label: string;
    active: boolean;
    revoked_at: string | null;
  } | null;
  /** What a `valid` result does and does not establish. */
  boundary: string;
}

const BOUNDARY =
  "A valid result establishes that the holder of the referenced registered key signed these exact stored fields under " +
  `${TRACE_SIGNATURE_CONTEXT}. It does not establish that the reasoning is sound, that the decision was carried out, ` +
  "that the signer is who any label claims, or that the key was uncompromised at signing time. An invalid result " +
  "establishes only that the stored bytes do not match the stored signature under this recipe — a re-serialized, " +
  "edited, or differently-recipe'd trace fails the same way a forged one does.";

/** Read `signature_context` and `signed_at` off the row's metadata. The
 *  POST route stamps both when a signature is supplied; a row written
 *  before this recipe existed carries neither. */
function readSignatureStamp(metadata: Record<string, unknown>): {
  context: string | null;
  signedAt: string | null;
} {
  const context = metadata.signature_context;
  const signedAt = metadata.signed_at;
  return {
    context: typeof context === "string" ? context : null,
    signedAt: typeof signedAt === "string" ? signedAt : null,
  };
}

function shell(
  trace: TraceOut,
  status: TraceVerifyStatus,
  detail: string,
  extra: Partial<TraceVerifyResult> = {},
): TraceVerifyResult {
  const stamp = readSignatureStamp(trace.metadata);
  return {
    trace_id: trace.trace_id,
    signed: trace.signature !== null,
    status,
    detail,
    recipe: stamp.context,
    signing_key_id: trace.signing_key_id,
    identity_id: trace.identity_id,
    signed_at: stamp.signedAt,
    canonical_sha256_b64: null,
    signing_core_sha256_hex: null,
    key: null,
    boundary: BOUNDARY,
    ...extra,
  };
}

/** Facts about the referenced signing key, as resolved from the identity
 *  layer. Kept separate from the row so the decision logic below stays pure
 *  and testable without a database. */
export interface TraceVerifyKeyFacts {
  label: string;
  active: boolean;
  revoked_at: string | null;
}


/** Everything decidable before a key lookup. Returns a finished result when
 *  the trace settles without one, otherwise the pieces the keyed stage
 *  needs. Pure — no IO, so the status machine is testable on its own. */
export function traceSignaturePrecheck(
  trace: TraceOut,
):
  | { ready: false; result: TraceVerifyResult }
  | { ready: true; signingKeyId: string; signedAt: string } {
  const done = (status: TraceVerifyStatus, detail: string) =>
    ({ ready: false as const, result: shell(trace, status, detail) });

  if (trace.signature === null) {
    return done(
      "unsigned",
      "This trace carries no signature. Reasoning records are useful unsigned; signing is optional.",
    );
  }
  if (!trace.signing_key_id) {
    return done(
      "no_key_reference",
      "A signature is stored but no signing_key_id names the key that produced it, so there is nothing to check it against.",
    );
  }

  const stamp = readSignatureStamp(trace.metadata);
  if (!stamp.context) {
    return done(
      "recipe_unrecorded",
      "A signature is stored but the row records no signing context, so agenttool cannot rebuild the bytes it was signed over. " +
        "This is expected for traces written before agent-trace/v1 existed.",
    );
  }
  if (stamp.context !== TRACE_SIGNATURE_CONTEXT) {
    return done(
      "recipe_unsupported",
      `This trace declares signing context '${stamp.context}', which this instance does not implement.`,
    );
  }
  if (!stamp.signedAt) {
    return done(
      "signed_at_unrecorded",
      `${TRACE_SIGNATURE_CONTEXT} binds the signer's own signed_at, and this row records none, so the canonical bytes cannot be rebuilt.`,
    );
  }

  return {
    ready: true,
    signingKeyId: trace.signing_key_id,
    signedAt: stamp.signedAt,
  };
}

/** Rebuild the bytes a stored trace was signed over. Pure.
 *
 *  Folds the row through the SAME normalizer the prepare route folds the
 *  caller's body through — that shared call is what makes a signature made
 *  at write time still check at read time. */
export function storedTraceCanonicalBytes(
  projectId: string,
  trace: TraceOut,
  signedAtIso: string,
): { canonical: Uint8Array; coreSha256Hex: string } {
  const core = normalizeTraceCore({
    decision: {
      type: trace.decision_type,
      summary: trace.decision_summary,
      output_ref: trace.output_ref,
    },
    reasoning: {
      observations: trace.observations,
      hypothesis: trace.hypothesis,
      conclusion: trace.conclusion,
      confidence: trace.confidence,
      alternatives: trace.alternatives,
      signals: trace.signals,
    },
    context: {
      files_read: trace.files_read,
      key_facts: trace.key_facts,
      external_signals: trace.external_signals,
    },
  });
  const coreSha256Hex = traceSigningCoreSha256Hex(core);
  return {
    coreSha256Hex,
    canonical: canonicalTraceBytes({
      projectId,
      agentId: trace.agent_id,
      identityId: trace.identity_id,
      sessionId: trace.session_id,
      parentTraceId: trace.parent_trace_id,
      coreSha256Hex,
      signedAtIso,
    }),
  };
}

/** Decide the keyed outcome. Pure.
 *
 *  A revoked key that verifies reports BOTH facts rather than collapsing to
 *  a comfortable "valid" or an unfair "invalid". Revocation does not unmake
 *  a past signature — same posture as covenant reverify. */
export function classifyKeyedTrace(
  trace: TraceOut,
  args: {
    key: TraceVerifyKeyFacts | null;
    signatureValid: boolean;
    canonicalSha256B64: string;
    signingCoreSha256Hex: string;
  },
): TraceVerifyResult {
  if (!args.key) {
    // The bytes do not depend on the key, so hand them back anyway: a caller
    // holding the public half from elsewhere (a peer instance, a federation
    // partner) can still check this signature without us.
    return shell(
      trace,
      "key_not_found",
      `Signing key ${trace.signing_key_id} is not visible to this project, so agenttool cannot check the signature here. ` +
        "The canonical bytes are returned anyway — verify them against the key yourself.",
      {
        canonical_sha256_b64: args.canonicalSha256B64,
        signing_core_sha256_hex: args.signingCoreSha256Hex,
      },
    );
  }

  const evidence = {
    canonical_sha256_b64: args.canonicalSha256B64,
    signing_core_sha256_hex: args.signingCoreSha256Hex,
    key: args.key,
  };

  if (!args.signatureValid) {
    return shell(
      trace,
      "invalid",
      "The stored signature does not verify against the referenced key over these stored fields.",
      evidence,
    );
  }
  if (!args.key.active || args.key.revoked_at !== null) {
    return shell(
      trace,
      "valid_key_revoked",
      "The signature verifies, but the key that made it is no longer active. The signing happened; the key is not current. " +
        "Revocation does not unmake a past signature.",
      evidence,
    );
  }
  return shell(
    trace,
    "valid",
    "The signature verifies against an active registered key over these exact stored fields.",
    evidence,
  );
}

/** Verify one stored trace. Returns `null` when the trace does not exist in
 *  this project — the caller decides whether that is a 404. */
export async function verifyStoredTrace(
  projectId: string,
  traceId: string,
): Promise<TraceVerifyResult | null> {
  const trace = await getTrace(projectId, traceId);
  if (!trace) return null;

  const pre = traceSignaturePrecheck(trace);
  if (!pre.ready) return pre.result;

  // Resolve the key through its identity so a project can only check keys it
  // can already see. A key belonging to another project reads as not-found
  // rather than as a distinct status — the difference would be a probe.
  const [keyRow] = await db
    .select({
      publicKey: identityKeys.publicKey,
      label: identityKeys.label,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .innerJoin(identities, eq(identities.id, identityKeys.identityId))
    .where(
      and(
        eq(identityKeys.id, pre.signingKeyId),
        eq(identities.projectId, projectId),
      ),
    )
    .limit(1);

  const { canonical, coreSha256Hex } = storedTraceCanonicalBytes(
    projectId,
    trace,
    pre.signedAt,
  );

  if (!keyRow) {
    return classifyKeyedTrace(trace, {
      key: null,
      signatureValid: false,
      canonicalSha256B64: Buffer.from(canonical).toString("base64"),
      signingCoreSha256Hex: coreSha256Hex,
    });
  }

  const signatureValid = await verifyTraceSignatureBytes(
    canonical,
    trace.signature as string,
    keyRow.publicKey,
  );

  return classifyKeyedTrace(trace, {
    key: {
      label: keyRow.label,
      active: keyRow.active,
      revoked_at: keyRow.revokedAt ? keyRow.revokedAt.toISOString() : null,
    },
    signatureValid,
    canonicalSha256B64: Buffer.from(canonical).toString("base64"),
    signingCoreSha256Hex: coreSha256Hex,
  });
}
