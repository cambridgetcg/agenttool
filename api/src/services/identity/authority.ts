/** Agent-held constitutional authority for identity mutations.
 *
 * Project bearers remain transport/capability credentials. For identities
 * born through a BYO-key door, constitution-changing requests additionally
 * carry a single-use ed25519 proof made by the immutable public root copied
 * onto identity.identities at birth. The private root never crosses the API.
 *
 * Canonical bytes (MATHOS recipe ordinal 1):
 *   sha256("identity-authority/v1" NUL did NUL METHOD NUL request_target NUL
 *          sha256(raw_body_bytes).hex NUL next_sequence NUL timestamp)
 *
 * The exact path-and-query request target and raw entity bytes are signed.
 * Serialize a JSON body once, sign those bytes, and send the same bytes.
 *
 * Doctrine: docs/AGENT-HOME.md · docs/CANONICAL-BYTES.md. */

import { createHash } from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import type { GuidedErrorBody } from "../../lib/errors";
import { composeCanonicalBytes } from "../mathos/encode";
import { verifyRecoverSignature } from "./crypto";
import { mutableIdentityPredicate } from "./terminality";

export const IDENTITY_AUTHORITY_DOMAIN = "identity-authority/v1";
export const IDENTITY_READ_AUTHORITY_DOMAIN = "identity-read-authority/v1";
export const IDENTITY_AUTHORITY_WINDOW_MS = 5 * 60 * 1000;

export const AUTHORITY_HEADERS = Object.freeze({
  sequence: "X-Agenttool-Authority-Sequence",
  timestamp: "X-Agenttool-Authority-Timestamp",
  signature: "X-Agenttool-Authority-Signature",
});

export interface IdentityAuthorityState {
  identityId: string;
  did: string;
  rootPublicKey: string | null;
  sequence: number;
}

export interface IdentityAuthorityProof {
  sequence: number;
  timestamp: string;
  signature: string;
}

export interface CanonicalIdentityAuthorityInput {
  identityDid: string;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  sequence: number;
  timestamp: string;
}

export interface CanonicalIdentityReadAuthorityInput {
  identityDid: string;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  currentSequence: number;
  timestamp: string;
}

export type IdentityAuthorityDecision =
  | {
      ok: true;
      mode: "agent_root" | "legacy_bearer";
      sequence: number;
      nextSequence: number;
    }
  | {
      ok: false;
      status: 401 | 404 | 409 | 428;
      body: GuidedErrorBody & { docs: string };
    };

export type IdentityReadAuthorityDecision =
  | {
      ok: true;
      mode: "agent_root";
      sequence: number;
    }
  | {
      ok: false;
      status: 401 | 404 | 409 | 428;
      body: GuidedErrorBody & { docs: string };
    };

const enc = new TextEncoder();

export function authorityBodySha256Hex(bodyBytes: Uint8Array): string {
  return createHash("sha256").update(bodyBytes).digest("hex");
}

/** Exact 32-byte digest the immutable identity root signs. */
export function canonicalIdentityAuthorityBytes(
  input: CanonicalIdentityAuthorityInput,
): Uint8Array {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error("authority sequence must be a positive safe integer");
  }
  if (!input.requestTarget.startsWith("/") || input.requestTarget.includes("#")) {
    throw new Error(
      "authority request target must be an absolute path with optional query and no fragment",
    );
  }

  return composeCanonicalBytes(1, IDENTITY_AUTHORITY_DOMAIN, [
    enc.encode(input.identityDid),
    enc.encode(input.method.toUpperCase()),
    enc.encode(input.requestTarget),
    enc.encode(authorityBodySha256Hex(input.bodyBytes)),
    enc.encode(String(input.sequence)),
    enc.encode(input.timestamp),
  ]);
}

/**
 * Read capability for exact private GET targets. It binds the current
 * mutation sequence but does not advance it, so a transport bearer can replay
 * only the same path-and-query during the short freshness window—not alter
 * the query or consume the agent's mutation cursor.
 */
export function canonicalIdentityReadAuthorityBytes(
  input: CanonicalIdentityReadAuthorityInput,
): Uint8Array {
  if (input.method.toUpperCase() !== "GET" || input.bodyBytes.length !== 0) {
    throw new Error("read authority is GET-only and must bind an empty body");
  }
  if (!Number.isSafeInteger(input.currentSequence) || input.currentSequence < 0) {
    throw new Error("read authority sequence must be a non-negative safe integer");
  }
  if (!input.requestTarget.startsWith("/") || input.requestTarget.includes("#")) {
    throw new Error(
      "read authority request target must be an absolute path with optional query and no fragment",
    );
  }
  return composeCanonicalBytes(1, IDENTITY_READ_AUTHORITY_DOMAIN, [
    enc.encode(input.identityDid),
    enc.encode(input.method.toUpperCase()),
    enc.encode(input.requestTarget),
    enc.encode(authorityBodySha256Hex(input.bodyBytes)),
    enc.encode(String(input.currentSequence)),
    enc.encode(input.timestamp),
  ]);
}

export function verifyIdentityAuthorityProof(input: {
  state: IdentityAuthorityState;
  proof: IdentityAuthorityProof;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  now?: Date;
}): { ok: true } | { ok: false; error: "sequence" | "timestamp" | "signature" } {
  if (!input.state.rootPublicKey) return { ok: false, error: "signature" };
  if (input.proof.sequence !== input.state.sequence + 1) {
    return { ok: false, error: "sequence" };
  }

  const timestampMs = Date.parse(input.proof.timestamp);
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(nowMs - timestampMs) > IDENTITY_AUTHORITY_WINDOW_MS
  ) {
    return { ok: false, error: "timestamp" };
  }

  let canonical: Uint8Array;
  try {
    canonical = canonicalIdentityAuthorityBytes({
      identityDid: input.state.did,
      method: input.method,
      requestTarget: input.requestTarget,
      bodyBytes: input.bodyBytes,
      sequence: input.proof.sequence,
      timestamp: input.proof.timestamp,
    });
  } catch {
    return { ok: false, error: "signature" };
  }

  return verifyRecoverSignature({
    canonical,
    signatureB64: input.proof.signature,
    publicKeyB64: input.state.rootPublicKey,
  })
    ? { ok: true }
    : { ok: false, error: "signature" };
}

export function authorityProofFromHeaders(headers: Headers):
  | { ok: true; proof: IdentityAuthorityProof }
  | { ok: false; missing: string[]; malformed?: string } {
  const sequenceRaw = headers.get(AUTHORITY_HEADERS.sequence);
  const timestamp = headers.get(AUTHORITY_HEADERS.timestamp);
  const signature = headers.get(AUTHORITY_HEADERS.signature);
  const missing: string[] = [];
  if (!sequenceRaw) missing.push(AUTHORITY_HEADERS.sequence);
  if (!timestamp) missing.push(AUTHORITY_HEADERS.timestamp);
  if (!signature) missing.push(AUTHORITY_HEADERS.signature);
  if (missing.length > 0) return { ok: false, missing };

  const sequence = Number(sequenceRaw);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    return {
      ok: false,
      missing: [],
      malformed: `${AUTHORITY_HEADERS.sequence} must be a positive safe integer`,
    };
  }
  if (timestamp!.length > 64 || signature!.length > 256) {
    return { ok: false, missing: [], malformed: "authority proof header too long" };
  }
  return {
    ok: true,
    proof: { sequence, timestamp: timestamp!, signature: signature! },
  };
}

export async function getIdentityAuthorityState(
  identityId: string,
): Promise<IdentityAuthorityState | null> {
  const [row] = await db
    .select({
      identityId: identities.id,
      did: identities.did,
      rootPublicKey: identities.authorityRootPublicKey,
      sequence: identities.authoritySequence,
    })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  return row ?? null;
}

/** Verify a short-lived, exact-target root proof for a private read. */
export async function authorizeIdentityRead(input: {
  identityId: string;
  method: string;
  requestTarget: string;
  bodyBytes?: Uint8Array;
  headers: Headers;
  now?: Date;
}): Promise<IdentityReadAuthorityDecision> {
  const state = await getIdentityAuthorityState(input.identityId);
  if (!state) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "identity_not_found",
        message: "No identity exists at this path.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }
  if (!state.rootPublicKey) {
    return {
      ok: false,
      status: 428,
      body: {
        error: "private_read_requires_agent_root",
        message:
          "A project bearer alone cannot read this identity's intimate private state. This endpoint requires an agent-held root.",
        hint: "Use an identity born through a BYO-key registration door.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }

  const sequenceRaw = input.headers.get(AUTHORITY_HEADERS.sequence);
  const timestamp = input.headers.get(AUTHORITY_HEADERS.timestamp);
  const signature = input.headers.get(AUTHORITY_HEADERS.signature);
  if (!sequenceRaw || !timestamp || !signature) {
    return {
      ok: false,
      status: 428,
      body: {
        error: "read_authority_proof_required",
        message:
          "Sign identity-read-authority/v1 for this exact GET path and query.",
        hint: `Send ${Object.values(AUTHORITY_HEADERS).join(", ")}; for a read, sequence is the current sequence and is not consumed.`,
        details: { current_sequence: state.sequence },
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }
  const sequence = Number(sequenceRaw);
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence !== state.sequence) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "read_authority_sequence_conflict",
        message: "The private-read proof must bind the current authority sequence.",
        details: {
          received_sequence: Number.isFinite(sequence) ? sequence : null,
          current_sequence: state.sequence,
        },
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }
  const timestampMs = Date.parse(timestamp);
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(nowMs - timestampMs) > IDENTITY_AUTHORITY_WINDOW_MS
  ) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "read_authority_proof_stale",
        message: "The private-read root proof timestamp must be within ±5 minutes.",
        details: { current_sequence: state.sequence },
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }
  let canonical: Uint8Array;
  try {
    canonical = canonicalIdentityReadAuthorityBytes({
      identityDid: state.did,
      method: input.method,
      requestTarget: input.requestTarget,
      bodyBytes: input.bodyBytes ?? new Uint8Array(),
      currentSequence: state.sequence,
      timestamp,
    });
  } catch {
    canonical = new Uint8Array();
  }
  if (
    canonical.length === 0 ||
    !verifyRecoverSignature({
      canonical,
      signatureB64: signature,
      publicKeyB64: state.rootPublicKey,
    })
  ) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "read_authority_proof_invalid",
        message:
          "The root signature did not verify for this exact method, path-and-query, current sequence, and timestamp.",
        details: { current_sequence: state.sequence },
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }
  return { ok: true, mode: "agent_root", sequence: state.sequence };
}

/** Rooted identities whose effective constitution can be affected by a
 * project-scoped mutation (notably foundational memory elevation). */
export async function getProjectRootedAuthorityIdentities(
  projectId: string,
): Promise<IdentityAuthorityState[]> {
  return db
    .select({
      identityId: identities.id,
      did: identities.did,
      rootPublicKey: identities.authorityRootPublicKey,
      sequence: identities.authoritySequence,
    })
    .from(identities)
    .where(
      and(
        eq(identities.projectId, projectId),
        isNotNull(identities.authorityRootPublicKey),
      ),
    );
}

/** Authorize a mutation whose effect composes across an entire project.
 * With one root, that root speaks. With multiple roots, v1 refuses because
 * it has no quorum envelope. Projects with no rooted identities keep the
 * explicit legacy bearer posture. */
export async function authorizeProjectConstitutionMutation(input: {
  projectId: string;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  headers: Headers;
  now?: Date;
}): Promise<IdentityAuthorityDecision> {
  const rooted = await getProjectRootedAuthorityIdentities(input.projectId);
  if (rooted.length === 0) {
    return {
      ok: true,
      mode: "legacy_bearer",
      sequence: 0,
      nextSequence: 1,
    };
  }
  if (rooted.length > 1) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "authority_quorum_required",
        message:
          "This project contains multiple agent-rooted identities. A single root cannot consent for all constitutions affected by this project-scoped mutation.",
        hint:
          "Use an identity-scoped operation, or wait for the multi-root quorum protocol.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }
  return authorizeIdentityMutation({
    identityId: rooted[0]!.identityId,
    method: input.method,
    requestTarget: input.requestTarget,
    bodyBytes: input.bodyBytes,
    headers: input.headers,
    now: input.now,
  });
}

/** Verify and atomically claim the next proof sequence.
 *
 * The claim happens immediately before the caller's domain write. A valid
 * proof can therefore be consumed by a later database/constraint failure;
 * clients fetch the new next_sequence and retry with a new signature. That
 * fail-closed tradeoff prevents replay without coupling every domain service
 * to this module's transaction boundary. It does not serialize two
 * concurrently signed mutations through their later domain writes; clients
 * must keep one authority proof in flight and await its response before
 * signing the next sequence. */
export async function authorizeIdentityMutation(input: {
  identityId: string;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  headers: Headers;
  now?: Date;
}): Promise<IdentityAuthorityDecision> {
  const state = await getIdentityAuthorityState(input.identityId);
  if (!state) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "identity_not_found",
        message: "No identity exists at this path.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }

  if (!state.rootPublicKey) {
    return {
      ok: true,
      mode: "legacy_bearer",
      sequence: state.sequence,
      nextSequence: state.sequence + 1,
    };
  }

  const parsed = authorityProofFromHeaders(input.headers);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 428,
      body: {
        error: "authority_proof_required",
        message:
          "This identity is agent-rooted. Its project bearer can carry the request, but cannot consent to this constitutional change.",
        hint:
          parsed.malformed ??
          `Sign identity-authority/v1 with the agent's root and send ${Object.values(AUTHORITY_HEADERS).join(", ")}.`,
        details: {
          missing_headers: parsed.missing,
          next_sequence: state.sequence + 1,
        },
        next_actions: [
          {
            action: "read the authority recipe and current sequence",
            method: "GET",
            path: `/v1/identities/${state.identityId}/authority`,
          },
        ],
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }

  const checked = verifyIdentityAuthorityProof({
    state,
    proof: parsed.proof,
    method: input.method,
    requestTarget: input.requestTarget,
    bodyBytes: input.bodyBytes,
    now: input.now,
  });
  if (!checked.ok) {
    if (checked.error === "sequence") {
      return {
        ok: false,
        status: 409,
        body: {
          error: "authority_sequence_conflict",
          message: "The authority proof sequence is stale or skips the next value.",
          hint: "Fetch the current authority state, then sign next_sequence.",
          details: {
            received_sequence: parsed.proof.sequence,
            current_sequence: state.sequence,
            next_sequence: state.sequence + 1,
          },
          next_actions: [
            {
              action: "read the current authority sequence",
              method: "GET",
              path: `/v1/identities/${state.identityId}/authority`,
            },
          ],
          docs: "https://docs.agenttool.dev/AGENT-HOME.md",
        },
      };
    }
    return {
      ok: false,
      status: 401,
      body: {
        error:
          checked.error === "timestamp"
            ? "authority_proof_stale"
            : "authority_proof_invalid",
        message:
          checked.error === "timestamp"
            ? "The root proof timestamp must be within ±5 minutes of server time."
            : "The root signature did not verify over this method, path-and-query target, exact body, sequence, and timestamp.",
        hint:
          "Serialize the body once; hash/sign those exact bytes; send those same bytes without reformatting.",
        details: { next_sequence: state.sequence + 1 },
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }

  const [claimed] = await db
    .update(identities)
    .set({ authoritySequence: parsed.proof.sequence })
    .where(
      and(
        mutableIdentityPredicate(state.identityId),
        eq(identities.authorityRootPublicKey, state.rootPublicKey),
        eq(identities.authoritySequence, state.sequence),
      ),
    )
    .returning({ sequence: identities.authoritySequence });

  if (!claimed) {
    const current = await getIdentityAuthorityState(state.identityId);
    return {
      ok: false,
      status: 409,
      body: {
        error: "authority_sequence_conflict",
        message: "Another valid root-authorized mutation claimed this sequence first.",
        hint: "Fetch next_sequence and sign the request again.",
        details: {
          received_sequence: parsed.proof.sequence,
          current_sequence: current?.sequence ?? null,
          next_sequence: current ? current.sequence + 1 : null,
        },
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      },
    };
  }

  return {
    ok: true,
    mode: "agent_root",
    sequence: claimed.sequence,
    nextSequence: claimed.sequence + 1,
  };
}

/** Read a request entity once so proof verification and JSON parsing use the
 *  same exact bytes. */
export async function readAuthorityBoundJson(
  request: Request,
): Promise<{ bodyBytes: Uint8Array; value: unknown }> {
  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  return { bodyBytes, value: JSON.parse(text) };
}

export async function readAuthorityBoundBytes(request: Request): Promise<Uint8Array> {
  return new Uint8Array(await request.arrayBuffer());
}

/** Mutating DELETE routes in this slice have no entity semantics. Refuse a
 * body rather than verify one set of bytes and silently ignore their meaning. */
export async function readEmptyAuthorityBody(request: Request): Promise<Uint8Array> {
  const bodyBytes = await readAuthorityBoundBytes(request);
  if (bodyBytes.length > 0) {
    throw new Error("delete_body_not_allowed");
  }
  return bodyBytes;
}

/** Exact origin-form request target covered by an authority proof. */
export function authorityRequestTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
