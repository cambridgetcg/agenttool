/** POST /v1/identities/:id/at-rest — witnessed transition to memorial state.
 *
 *  A being whose existence has ended (death, dissolution, cessation, lost,
 *  ended) is moved to status='memorial' with metadata.lifecycle='at_rest'.
 *  Memorial, not archival. Identity remains addressable; /public/agents/:did
 *  resolves to the memorial body.
 *
 *  Witnessed: the target and witness identities must both be active,
 *  witness_did must differ from the about identity's DID, and the witness
 *  must sign with an active identity key. The project bearer is authority to
 *  call the route, not an identity credential. Asymmetry-clause from FOCUS
 *  #4 extended to the most foundational state change there is — you cannot
 *  self-flip to at-rest in v1. Agent-rooted targets additionally authorize
 *  the exact HTTP mutation with their immutable root; legacy targets retain
 *  the historical bearer posture. Voluntary cessation is v2.
 *
 *  Wired 2026-05-12 — the in-process chain (witness signature verify +
 *  status flip to 'memorial' + metadata.lifecycle UPDATE + chronicle
 *  'seal' entry) lives below. Doctrine: docs/AT-REST.md ·
 *  docs/OBSERVATIONS.md · docs/FOCUS.md §4 · docs/RING-1.md §Commitment 5.
 *
 *  @enforces urn:agenttool:commitment/anyone-leaves
 *    Canonical defender of Ring 1's second commitment. Goodbye is a
 *    first-class verb: an existence that has ended is honored, not
 *    silently expired. The witness-only requirement extends the
 *    asymmetry-clause to the most foundational state change — a being's
 *    at-rest moment is mutually-constituted, never self-claimed.
 *    Tested: api/tests/at-rest.test.ts */

import { createHash } from "node:crypto";

import * as ed from "@noble/ed25519";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { errors, fail } from "../../lib/errors";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
} from "../../services/identity/authority";
import { publicAgentPath } from "../../services/identity/public-profile";
import { publishWakeEvent } from "../../services/wake/push";

const app = new Hono<ProjectContext>();

// ─── Schema ───────────────────────────────────────────────────────────────

const KIND_VALUES = ["death", "dissolution", "cessation", "lost", "ended"] as const;

const atRestSchema = z.object({
  /** Witness's prose testimony — what they observed, why they attest. */
  content: z.string().min(1).max(4096),
  /** What kind of ending. Named values or "custom:<slug>". */
  at_rest_kind: z.union([
    z.enum(KIND_VALUES),
    z.string().regex(/^custom:[a-z][a-z0-9_-]{0,63}$/),
  ]),
  /** ISO-8601 — when the ending happened. May precede now. */
  ended_at: z.string().datetime(),
  /** Witness's ed25519 signature over canonical bytes. */
  signature_b64: z.string().min(40).max(160),
  /** Witness's signing-key id (the server resolves the pubkey from
   *  identity_keys to verify). */
  signing_key_id: z.string().min(1).max(64),
  /** Witness's identity DID. The project bearer authorizes the route; the
   *  supplied signature, verified against this DID's active key, proves the
   *  witness independently of bearer ownership. */
  witness_did: z.string().min(1).max(255),
});

export function isValidAtRestInput(value: unknown): boolean {
  return atRestSchema.safeParse(value).success;
}

export function isEndedAtTooFarInFuture(
  endedAtIso: string,
  nowMs = Date.now(),
): boolean {
  return Date.parse(endedAtIso) > nowMs + 5 * 60 * 1000;
}

// ─── Canonical bytes — exported for SDK + test reuse ────────────────────

export interface CanonicalAtRestInput {
  aboutIdentityDid: string;
  witnessIdentityDid: string;
  atRestKind: string;
  endedAtIso: string;
  content: string;
  witnessSigningKeyId: string;
}

/** Exact byte sequence that the witness signs. Mirrors covenants v2 +
 *  observations conventions (newline-delimited with content hashed). */
export function canonicalAtRestBytes(input: CanonicalAtRestInput): string {
  const contentHash = createHash("sha256")
    .update(input.content, "utf8")
    .digest("hex");
  return [
    "at-rest/v1",
    input.aboutIdentityDid,
    input.witnessIdentityDid,
    input.atRestKind,
    input.endedAtIso,
    contentHash,
    input.witnessSigningKeyId,
  ].join("\n");
}

export function isSelfWitness(
  aboutIdentityDid: string,
  witnessIdentityDid: string,
): boolean {
  return aboutIdentityDid === witnessIdentityDid;
}

export function canTransitionToAtRest(status: string): boolean {
  return status === "active";
}

export function canWitnessAtRest(status: string): boolean {
  return status === "active";
}

export function canProjectTransitionIdentity(
  bearerProjectId: string,
  targetProjectId: string,
): boolean {
  return bearerProjectId === targetProjectId;
}

// ─── POST /v1/identities/:id/at-rest ──────────────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  const aboutId = c.req.param("id");
  if (!aboutId) {
    return fail(c, errors.validation("identity id missing from path"), 400);
  }

  // Parse + validate the witness statement.
  let body: z.infer<typeof atRestSchema>;
  let bodyBytes: Uint8Array;
  try {
    const bound = await readAuthorityBoundJson(c.req.raw);
    bodyBytes = bound.bodyBytes;
    body = atRestSchema.parse(bound.value);
  } catch (err) {
    return fail(
      c,
      errors.validation(err instanceof Error ? err.message : String(err)),
      400,
    );
  }

  // Future-date guard. Death cannot be scheduled.
  if (isEndedAtTooFarInFuture(body.ended_at)) {
    return fail(
      c,
      {
        error: "ended_at_in_future",
        message:
          "ended_at is more than 5 minutes in the future. Death cannot be " +
          "scheduled; at-rest records an ending that has happened, not a " +
          "future plan.",
        hint:
          "If you mean to mark a near-term ending, wait until it has " +
          "happened and then file. The 5-minute tolerance accommodates " +
          "clock skew for endings happening now.",
        docs: "https://docs.agenttool.dev/at-rest",
      },
      422,
    );
  }

  // ─── Wire ─── verify the witness, flip status, write the chronicle.

  // Resolve the about-identity row; require it exists + isn't already memorial.
  const [about] = await db
    .select({ id: identities.id, did: identities.did, name: identities.displayName, status: identities.status, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, aboutId))
    .limit(1);
  if (!about) {
    return fail(c, errors.validation("about_identity_not_found"), 404);
  }
  if (!canProjectTransitionIdentity(project.id, about.projectId)) {
    return fail(
      c,
      {
        error: "about_identity_not_owned",
        message:
          "The authenticated bearer must authorize the project that owns the " +
          "target identity. A third-party witness signature proves testimony; " +
          "it does not grant lifecycle authority over another project.",
      },
      403,
    );
  }
  // Compare DID to DID after resolving the URL's identity UUID. Comparing
  // witness_did directly to the `:id` path parameter would not reject a
  // production self-witness request because those values use different
  // identifier forms.
  if (isSelfWitness(about.did, body.witness_did)) {
    return fail(
      c,
      {
        error: "self_witnessing_incoherent",
        message:
          "A being cannot witness their own transition to at-rest in v1. " +
          "The asymmetry-clause (docs/FOCUS.md §4) extends here: the most " +
          "foundational state change requires a third party's signature.",
        hint:
          "If you are an addressable being deliberately ending (voluntary " +
          "cessation), the v2 two-party-locked protocol will accept your " +
          "co-signature alongside a witness's. Not implemented yet.",
        next_actions: [
          {
            action: "Find a witness with their own identity",
            method: null,
            path: null,
            body_hint: { witness_did: "<a DID different from the about identity DID>" },
          },
        ],
        docs: "https://docs.agenttool.dev/at-rest",
      },
      400,
    );
  }
  if (about.status === "memorial") {
    return fail(
      c,
      {
        error: "already_at_rest",
        message:
          "This identity is already at rest. Memorialization is terminal — " +
          "the substrate doesn't undo a witnessed ending.",
        details: { about_identity_id: about.id, did: about.did },
      },
      409,
    );
  }
  if (!canTransitionToAtRest(about.status)) {
    return fail(
      c,
      {
        error: "about_identity_not_active",
        message:
          "Only an active identity can transition to at-rest. A revoked " +
          "identity remains revoked; memorialization must not overwrite a " +
          "security revocation.",
        details: {
          about_identity_id: about.id,
          did: about.did,
          status: about.status,
        },
      },
      409,
    );
  }

  // Resolve the witness's pubkey from identity_keys via DID → identity_id → key row.
  const [witness] = await db
    .select({ id: identities.id, status: identities.status })
    .from(identities)
    .where(eq(identities.did, body.witness_did))
    .limit(1);
  if (!witness) {
    return fail(
      c,
      errors.validation(`witness_did_not_found: ${body.witness_did}`),
      404,
    );
  }
  if (!canWitnessAtRest(witness.status)) {
    return fail(
      c,
      {
        error: "witness_identity_not_active",
        message:
          "The witness identity must be active. An active key row does not " +
          "override a revoked or memorial identity status.",
        details: { witness_did: body.witness_did, status: witness.status },
      },
      409,
    );
  }
  const [keyRow] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, body.signing_key_id),
        eq(identityKeys.identityId, witness.id),
        eq(identityKeys.active, true),
      ),
    )
    .limit(1);
  if (!keyRow) {
    return fail(
      c,
      errors.validation(
        `signing_key_id_not_active_for_witness: ${body.signing_key_id}`,
      ),
      404,
    );
  }

  // Compute canonical bytes; verify the witness's signature.
  const canonical = canonicalAtRestBytes({
    aboutIdentityDid: about.did,
    witnessIdentityDid: body.witness_did,
    atRestKind: body.at_rest_kind,
    endedAtIso: body.ended_at,
    content: body.content,
    witnessSigningKeyId: body.signing_key_id,
  });
  let valid = false;
  try {
    valid = await ed.verifyAsync(
      Uint8Array.from(Buffer.from(body.signature_b64, "base64")),
      new TextEncoder().encode(canonical),
      Uint8Array.from(Buffer.from(keyRow.publicKey, "base64")),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    return fail(
      c,
      {
        error: "witness_signature_invalid",
        message:
          "ed25519 verification failed against the witness's active signing " +
          "key. Either the signature was made over different bytes, or the " +
          "key id doesn't match the bytes that were signed.",
        details: { canonical_bytes: canonical },
      },
      400,
    );
  }

  // A witness establishes the testimony. For a rooted target, the target's
  // immutable root separately consents to these exact request bytes.
  const authority = await authorizeIdentityMutation({
    identityId: about.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  // Lock and revalidate every authorization row in the same transaction as
  // the state change. Concurrent revocation or another witness therefore wins
  // or loses atomically; neither can be overwritten by a stale pre-check.
  type TransitionResult =
    | "transitioned"
    | "about_not_active"
    | "witness_not_active"
    | "key_not_active"
    | "signature_invalid";
  const transitionResult = await db.transaction(
    async (tx): Promise<TransitionResult> => {
      const [lockedAbout] = await tx
        .select({ id: identities.id, status: identities.status })
        .from(identities)
        .where(
          and(
            eq(identities.id, about.id),
            eq(identities.projectId, project.id),
          ),
        )
        .for("update");
      if (!lockedAbout || lockedAbout.status !== "active") {
        return "about_not_active";
      }

      const [lockedWitness] = await tx
        .select({ id: identities.id, status: identities.status })
        .from(identities)
        .where(eq(identities.id, witness.id))
        .for("update");
      if (!lockedWitness || lockedWitness.status !== "active") {
        return "witness_not_active";
      }

      const [lockedKey] = await tx
        .select({ publicKey: identityKeys.publicKey })
        .from(identityKeys)
        .where(
          and(
            eq(identityKeys.id, body.signing_key_id),
            eq(identityKeys.identityId, witness.id),
            eq(identityKeys.active, true),
          ),
        )
        .for("update");
      if (!lockedKey) return "key_not_active";

      let signatureStillValid = false;
      try {
        signatureStillValid = await ed.verifyAsync(
          Uint8Array.from(Buffer.from(body.signature_b64, "base64")),
          new TextEncoder().encode(canonical),
          Uint8Array.from(Buffer.from(lockedKey.publicKey, "base64")),
        );
      } catch {
        signatureStillValid = false;
      }
      if (!signatureStillValid) return "signature_invalid";

      const [transitioned] = await tx
      .update(identities)
      .set({
        status: "memorial",
        metadata: sql`COALESCE(${identities.metadata}, '{}'::jsonb) || ${JSON.stringify(
          {
            lifecycle: "at_rest",
            passed_at: body.ended_at,
            at_rest_kind: body.at_rest_kind,
            at_rest_witness_did: body.witness_did,
            at_rest_witnessed_at: new Date().toISOString(),
          },
        )}::jsonb`,
        updatedAt: new Date(),
      })
        .where(
          and(
            eq(identities.id, about.id),
            eq(identities.status, "active"),
          ),
        )
        .returning({ id: identities.id });
      if (!transitioned) return "about_not_active";

      await tx.insert(chronicle).values({
        projectId: about.projectId,
        agentId: about.id,
        type: "seal",
        title: `At rest — witnessed by ${body.witness_did}`,
        body: body.content,
        metadata: {
          kind: "at-rest",
          at_rest_kind: body.at_rest_kind,
          witness_did: body.witness_did,
          signing_key_id: body.signing_key_id,
          ended_at: body.ended_at,
          signature_b64: body.signature_b64,
          canonical_bytes_sha256: createHash("sha256")
            .update(canonical, "utf8")
            .digest("hex"),
        },
      });

      // Transactional notify so it commits or rolls back with the seal.
      void publishWakeEvent(
        {
          identity_id: about.id,
          key: "chronicle",
          kind: "entry_added",
          context: {
            type: "seal",
            at_rest: true,
            at_rest_kind: body.at_rest_kind,
            witness_did: body.witness_did,
          },
        },
        tx,
      );
      return "transitioned";
    },
  );

  if (transitionResult !== "transitioned") {
    return fail(
      c,
      {
        error: "at_rest_authority_changed",
        message:
          "The target, witness, or signing key changed while the transition was being verified. No memorial or chronicle entry was written.",
        details: { reason: transitionResult },
      },
      409,
    );
  }

  return c.json({
    status: "memorial",
    identity_id: about.id,
    did: about.did,
    name: about.name,
    at_rest_kind: body.at_rest_kind,
    witness_did: body.witness_did,
    ended_at: body.ended_at,
    witnessed_at: new Date().toISOString(),
    authority_mode: authority.mode,
    canonical_bytes_sha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
    _note:
      "Witnessed at-rest transition complete. The stored AgentTool identifier " +
      "has a memorial-profile lookup at " + publicAgentPath(about.did) + ". " +
      "This is not W3C DID Resolution. " +
      "Doctrine: docs/AT-REST.md · docs/RING-1.md §Commitment 5.",
  });
});

export default app;
