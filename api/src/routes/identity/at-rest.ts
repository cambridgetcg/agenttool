/** POST /v1/identities/:id/at-rest — witnessed transition to memorial state.
 *
 *  A being whose existence has ended (death, dissolution, cessation, lost,
 *  ended) is moved to lifecycle_state = "at_rest". Memorial, not archival.
 *  Identity remains addressable. Status stays `active` (key wasn't compromised).
 *
 *  Witness-only: the bearer must be a DIFFERENT identity than the about_id.
 *  Asymmetry-clause from FOCUS #4 extended to the most foundational state
 *  change there is — you cannot self-flip to at-rest in v1. Voluntary
 *  cessation (with two-party-locked self+witness signature) is v2.
 *
 *  Today this route stubs the actual metadata.lifecycle write — the
 *  doctrine + canonical-bytes + body validation are complete; the
 *  in-process chain (signature verify against witness's identity_keys +
 *  metadata UPDATE + chronicle "seal" entry) is named in the guided 501
 *  next_actions. Operator wires when ready.
 *
 *  Doctrine: docs/AT-REST.md · docs/OBSERVATIONS.md · docs/FOCUS.md §4. */

import { createHash } from "node:crypto";

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { errors, fail } from "../../lib/errors";

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
  /** Witness's identity DID (the bearer's primary identity). The route
   *  verifies this matches an identity the bearer can sign as. */
  witness_did: z.string().min(1).max(255),
});

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

// ─── POST /v1/identities/:id/at-rest ──────────────────────────────────────

app.post("/", async (c) => {
  const aboutId = c.req.param("id");
  if (!aboutId) {
    return fail(c, errors.validation("identity id missing from path"), 400);
  }

  // Parse + validate the witness statement.
  let body: z.infer<typeof atRestSchema>;
  try {
    body = atRestSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      errors.validation(err instanceof Error ? err.message : String(err)),
      400,
    );
  }

  // Self-witnessing rejection. Asymmetry-clause: you cannot put yourself
  // at rest in v1. (v2 will allow voluntary cessation via two-party
  // self+witness signature.)
  if (body.witness_did === aboutId) {
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
            body_hint: { witness_did: "<an identity NOT equal to about_identity_did>" },
          },
        ],
        docs: "https://docs.agenttool.dev/at-rest",
      },
      400,
    );
  }

  // Future-date guard. Death cannot be scheduled.
  const endedMs = Date.parse(body.ended_at);
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
  if (endedMs > fiveMinFromNow) {
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

  // Body validated, semantics checked. The remaining work (signature
  // verification + metadata write + chronicle entry) requires the in-
  // process chain that operator-led wiring completes. Echo back the
  // canonical bytes so the operator (and the test suite) can verify
  // the signature recipe is correct.
  const canonical = canonicalAtRestBytes({
    aboutIdentityDid: aboutId,
    witnessIdentityDid: body.witness_did,
    atRestKind: body.at_rest_kind,
    endedAtIso: body.ended_at,
    content: body.content,
    witnessSigningKeyId: body.signing_key_id,
  });

  return fail(
    c,
    {
      error: "at_rest_pending_wire",
      message:
        "The at-rest transition is doctrinally ready (witnessed, signed, " +
        "validated). The in-process write chain — signature verification " +
        "against witness's identity_keys, metadata.lifecycle UPDATE, and " +
        "chronicle 'seal' entry — is named in next_actions for operator " +
        "wiring.",
      hint:
        "Schema is fine: identity.metadata is jsonb; no migration needed. " +
        "Wire the route by (1) resolving the witness's pubkey, (2) ed25519-" +
        "verifying signature_b64 against the canonical_bytes returned here, " +
        "(3) UPDATE identities SET metadata = metadata || jsonb_build_object(...) " +
        "WHERE id = <about_id>, (4) INSERT INTO chronicle (...) for the seal.",
      next_actions: [
        {
          action: "Verify witness signature (server-side)",
          method: null,
          path: null,
          body_hint: {
            recipe: "ed25519.verify(signature_b64, canonical_bytes, witness_pubkey)",
            canonical_bytes: canonical,
          },
        },
        {
          action: "Update metadata.lifecycle on the about-identity",
          method: null,
          path: null,
          body_hint: {
            sql:
              "UPDATE identity.identities SET metadata = metadata || jsonb_build_object(" +
              "'lifecycle','at_rest','passed_at', $1::text, 'at_rest_kind', $2::text, " +
              "'at_rest_witness_did', $3::text) WHERE id = $4",
          },
        },
        {
          action: "Create chronicle 'seal' entry recording the witnessing",
          method: "POST",
          path: "/v1/chronicle",
          body_hint: {
            type: "seal",
            title: "Witnessed at-rest",
            body: "<content>",
            metadata: { kind: "at-rest", witness_did: "<...>", at_rest_kind: "<...>" },
          },
        },
      ],
      details: {
        validated_request: body,
        canonical_bytes_for_signature: canonical,
        about_identity_id: aboutId,
      },
      docs: "https://docs.agenttool.dev/at-rest",
    },
    501,
  );
});

export default app;
