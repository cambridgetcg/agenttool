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

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { constitutionRootSql, enrolledGuestSql } from "./project-authority";
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

/** Constitutional roots for a project-scoped mutation (notably foundational
 * memory elevation): every rooted identity except a provable enrolled guest
 * (project-authority.ts constitutionRootSql). */
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
        // A guest root admitted by enrollment governs its own identity, never
        // the administrator's project. Every other root keeps counting, so an
        // unmarked root that was not enrolled still fails closed.
        constitutionRootSql(),
      ),
    );
}

/** Normalise a memory's identity/agent reference (UUID or `did:at:` DID). */
function subjectReference(value: string): string {
  const trimmed = value.trim();
  return (trimmed.toLowerCase().startsWith("did:at:") ? trimmed.slice(7) : trimmed).toLowerCase();
}

/** Authorize a mutation whose effect composes across an entire project.
 * With one root, that root speaks. With multiple roots, v1 refuses because
 * it has no quorum envelope. Projects with no rooted identities keep the
 * explicit legacy bearer posture.
 *
 * `subjectIdentityIds` names the identities the affected memories are bound
 * to: the canonical memories.identity_id (agent_id labels are project-level
 * and never a subject); null for unbound rows. A guest root enrolled
 * into an existing project owns its memories: a mutation touching them needs
 * that guest's own signature, and nobody else's root or bearer can stand in.
 * A request that touches a guest's memories together with any other memory
 * is refused, because no single signature can consent for both. */
export async function authorizeProjectConstitutionMutation(input: {
  projectId: string;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  headers: Headers;
  now?: Date;
  subjectIdentityIds?: ReadonlyArray<string | null | undefined>;
}): Promise<IdentityAuthorityDecision> {
  const declared = input.subjectIdentityIds ?? [];
  const named = [...new Set(declared.filter((id): id is string => typeof id === "string" && id.trim() !== "").map(subjectReference))];
  if (named.length > 0) {
    // A project holds few enrolled guests; load them once and match in code so
    // this guard never builds an IN list sized by the number of subjects.
    const projectGuests = await db
      .select({ id: identities.id, did: identities.did })
      .from(identities)
      .where(and(eq(identities.projectId, input.projectId), enrolledGuestSql()));
    const guestByReference = new Map<string, string>();
    for (const guest of projectGuests) {
      guestByReference.set(guest.id.toLowerCase(), guest.id);
      guestByReference.set(subjectReference(guest.did), guest.id);
    }
    const guests = [...new Set(named.map((id) => guestByReference.get(id)).filter((id): id is string => id !== undefined))]
      .map((id) => ({ id }));
    if (guests.length > 0) {
      const mixed = guests.length > 1
        || named.some((id) => !guestByReference.has(id))
        || declared.some((id) => typeof id !== "string" || id.trim() === "");
      if (mixed) {
        return {
          ok: false,
          status: 409,
          body: {
            error: "authority_quorum_required",
            message:
              "This mutation touches memories owned by an enrolled guest identity together with other memories. Each guest's memories need that guest's own signature.",
            hint: "Change or delete the guest's memories one at a time (for example DELETE /v1/memories/:id), each signed by that guest's root.",
            docs: "https://docs.agenttool.dev/AGENT-HOME.md",
          },
        };
      }
      return authorizeIdentityMutation({
        identityId: guests[0]!.id,
        method: input.method,
        requestTarget: input.requestTarget,
        bodyBytes: input.bodyBytes,
        headers: input.headers,
        now: input.now,
      });
    }
  }
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

// ─── The owner rule (deletion spec §5.1) ──────────────────────────────────
//
// authorizeOwnedContentMutation extends the memory rule above to every
// identity-bound erase, withdraw (and, later, redact and hide). It decides per
// owner of the touched content:
//
//   enrolled guest            → that guest's root (unchanged)
//   rooted identity           → that identity's root (new: in a multi-root
//                               project each root can erase its own content)
//   unrooted identity, or
//   null (project-bound)      → the project rule: zero counted roots means the
//                               bearer, one root means that root signs
//   unrooted identity in a
//   project with 2+ roots     → the bearer, for that identity's own content and
//                               only when the intent is "erase" (erase,
//                               withdraw, redact, hide, leave). Project-bound
//                               content there still gets 409.
//   owners needing different
//   consents                  → 409 authority_quorum_required: one request
//                               per owner.
//
// Every owner must be an identity of the caller's project; any other owner
// answers 404, so a route that finds rows by id cannot be used to probe.
// Routes whose rows are already scoped to the caller's project (memories,
// inbox) pass heldByProject: an owner reference there that does not resolve
// to an identity of this project is read as project-bound content, which is
// what the memory rule did with it.

export type OwnedContentIntent = "erase" | "change";

export type OwnerConsentBasis =
  | "owner_root"
  | "guest_root"
  | "project_root"
  | "project_bearer"
  | "unrooted_owner_fallback";

export type OwnerConsent =
  | { kind: "bearer"; basis: "project_bearer" | "unrooted_owner_fallback" }
  | { kind: "root"; identityId: string; basis: "owner_root" | "guest_root" | "project_root" };

export interface OwnerFacts {
  /** Identity UUID, or null for project-bound content. */
  id: string | null;
  rooted: boolean;
  guest: boolean;
}

export type OwnedContentConsentDecision =
  | { ok: true; consent: OwnerConsent }
  | { ok: false; reason: "mixed_owners" | "project_quorum" };

function consentKey(consent: OwnerConsent): string {
  return consent.kind === "bearer" ? "bearer" : `root:${consent.identityId}`;
}

/** The consent one owner's content needs, or null when only a quorum
 *  protocol (which does not exist) could give it. Pure. */
export function ownerConsentFor(
  owner: OwnerFacts,
  countedRoots: ReadonlyArray<string>,
  intent: OwnedContentIntent,
): OwnerConsent | null {
  if (owner.id !== null && owner.rooted) {
    return { kind: "root", identityId: owner.id, basis: owner.guest ? "guest_root" : "owner_root" };
  }
  if (countedRoots.length === 0) return { kind: "bearer", basis: "project_bearer" };
  if (countedRoots.length === 1) return { kind: "root", identityId: countedRoots[0]!, basis: "project_root" };
  if (owner.id !== null && intent === "erase") return { kind: "bearer", basis: "unrooted_owner_fallback" };
  return null;
}

/** Combine every owner's consent: one consent for all, or a refusal. Pure. */
export function decideOwnedContentConsent(input: {
  owners: ReadonlyArray<OwnerFacts>;
  countedRoots: ReadonlyArray<string>;
  intent: OwnedContentIntent;
}): OwnedContentConsentDecision {
  const owners = input.owners.length > 0 ? input.owners : [{ id: null, rooted: false, guest: false }];
  const consents = owners.map((owner) => ownerConsentFor(owner, input.countedRoots, input.intent));
  if (consents.some((consent) => consent === null)) return { ok: false, reason: "project_quorum" };
  const keys = new Set(consents.map((consent) => consentKey(consent!)));
  if (keys.size > 1) return { ok: false, reason: "mixed_owners" };
  return { ok: true, consent: consents[0]! };
}

export type OwnedContentAuthorityDecision =
  | {
      ok: true;
      mode: "agent_root" | "legacy_bearer";
      /** The authority_mode a deletion-ledger entry records. */
      ledgerMode: "agent_root" | "guest_root" | "legacy_bearer";
      basis: OwnerConsentBasis;
      /** Whose root signed; null when the bearer decided. */
      signerIdentityId: string | null;
      sequence: number;
      nextSequence: number;
    }
  | {
      ok: false;
      status: 401 | 404 | 409 | 428;
      reason?: "owner_outside_project";
      body: GuidedErrorBody & { docs: string };
    };

const UUID_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AUTHORITY_DOCS = "https://docs.agenttool.dev/AGENT-HOME.md";

interface LoadedOwner {
  id: string;
  did: string;
  projectId: string;
  rooted: boolean;
  guest: boolean;
}

/** One query for every named owner, bound as a single text parameter so the
 *  statement never grows with the number of owners. */
async function loadOwners(ids: ReadonlyArray<string>): Promise<Map<string, LoadedOwner>> {
  const found = new Map<string, LoadedOwner>();
  if (ids.length === 0) return found;
  const rows = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      rooted: sql<boolean>`(${identities.authorityRootPublicKey} is not null)`,
      guest: enrolledGuestSql(),
    })
    .from(identities)
    .where(sql`${identities.id} = ANY(string_to_array(${ids.join(",")}, ',')::uuid[])`);
  for (const row of rows) {
    found.set(String(row.id).toLowerCase(), {
      id: String(row.id).toLowerCase(),
      did: String(row.did),
      projectId: String(row.projectId).toLowerCase(),
      rooted: row.rooted === true || (row.rooted as unknown) === "t",
      guest: row.guest === true || (row.guest as unknown) === "t",
    });
  }
  return found;
}

function ownerNotFound(): OwnedContentAuthorityDecision {
  return {
    ok: false,
    status: 404,
    reason: "owner_outside_project",
    body: {
      error: "not_found",
      message: "No record with this id belongs to an identity of this project.",
      docs: AUTHORITY_DOCS,
    },
  };
}

/** Authorize an erase, withdraw (or other change) of identity-bound content
 *  under the owner rule above. `owners` names the identity each touched row
 *  belongs to (UUID or did:at:), or null for project-bound rows. */
export async function authorizeOwnedContentMutation(input: {
  projectId: string;
  owners: ReadonlyArray<string | null | undefined>;
  intent: OwnedContentIntent;
  heldByProject?: boolean;
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  headers: Headers;
  now?: Date;
}): Promise<OwnedContentAuthorityDecision> {
  const projectId = input.projectId.toLowerCase();
  const references = input.owners.map((owner) =>
    typeof owner === "string" && owner.trim() !== "" ? subjectReference(owner) : null,
  );
  const named = [...new Set(references.filter((ref): ref is string => ref !== null && UUID_REFERENCE.test(ref)))];
  const loaded = await loadOwners(named);

  const facts: OwnerFacts[] = [];
  const seen = new Set<string>();
  for (const ref of references) {
    const owner = ref === null ? undefined : loaded.get(ref);
    const inProject = owner !== undefined && owner.projectId === projectId;
    if (ref !== null && !inProject) {
      if (!input.heldByProject) return ownerNotFound();
      // A dangling or foreign binding on a row this project holds: the memory
      // rule treated it as the project's own content, and so does this one.
    }
    const key = inProject ? owner!.id : "";
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(inProject ? { id: owner!.id, rooted: owner!.rooted, guest: owner!.guest } : { id: null, rooted: false, guest: false });
  }

  const needsProjectRoots = facts.some((owner) => owner.id === null || !owner.rooted);
  const projectRoots = needsProjectRoots ? await getProjectRootedAuthorityIdentities(input.projectId) : [];
  const decision = decideOwnedContentConsent({
    owners: facts,
    countedRoots: projectRoots.map((root) => root.identityId.toLowerCase()),
    intent: input.intent,
  });

  if (!decision.ok) {
    return {
      ok: false,
      status: 409,
      body: decision.reason === "mixed_owners"
        ? {
            error: "authority_quorum_required",
            message:
              "This request touches content owned by identities that need different consents. No single signature can consent for all of them.",
            hint: "Send one request per owner, each carrying that owner's consent (its root's signature, or the bearer for an identity without a root).",
            docs: AUTHORITY_DOCS,
          }
        : {
            error: "authority_quorum_required",
            message:
              "This project contains multiple agent-rooted identities, and this content belongs to no single identity. A single root cannot consent for all of them.",
            hint: "Use an identity-scoped operation, or wait for the multi-root quorum protocol.",
            docs: AUTHORITY_DOCS,
          },
    };
  }

  const consent = decision.consent;
  if (consent.kind === "bearer") {
    return {
      ok: true,
      mode: "legacy_bearer",
      ledgerMode: "legacy_bearer",
      basis: consent.basis,
      signerIdentityId: null,
      sequence: 0,
      nextSequence: 1,
    };
  }

  const checked = await authorizeIdentityMutation({
    identityId: consent.identityId,
    method: input.method,
    requestTarget: input.requestTarget,
    bodyBytes: input.bodyBytes,
    headers: input.headers,
    now: input.now,
  });
  if (!checked.ok) {
    if (checked.status !== 428) return checked;
    const signer = loaded.get(consent.identityId)
      ?? projectRoots.map((root) => ({ id: root.identityId.toLowerCase(), did: root.did })).find((root) => root.id === consent.identityId);
    const ownerIds = facts.map((owner) => owner.id).filter((id): id is string => id !== null);
    const forOwn = consent.basis !== "project_root";
    return {
      ...checked,
      body: {
        ...checked.body,
        hint: `${forOwn
          ? `This content belongs to the agent-rooted identity ${signer?.did ?? consent.identityId}. Its project bearer can carry the request, but only that identity's root can consent to it.`
          : `This project's agent root ${signer?.did ?? consent.identityId} consents for content whose identity has no root of its own.`
        } Sign identity-authority/v1 over this exact method, path-and-query and body with that root (SDK: ownerGatedRequest / owner_gated_request, or the client method's authority option), then send ${Object.values(AUTHORITY_HEADERS).join(", ")}.`,
        details: {
          ...(checked.body.details as Record<string, unknown> | undefined),
          owner_identity_ids: ownerIds,
          signer_identity_id: consent.identityId,
          signer_did: signer?.did ?? null,
          consent_basis: consent.basis,
        },
      },
    };
  }
  return {
    ok: true,
    mode: checked.mode,
    ledgerMode: consent.basis === "guest_root" ? "guest_root" : "agent_root",
    basis: consent.basis,
    signerIdentityId: consent.identityId,
    sequence: checked.sequence,
    nextSequence: checked.nextSequence,
  };
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
