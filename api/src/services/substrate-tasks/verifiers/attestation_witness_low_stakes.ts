/** verifier: attestation_witness_low_stakes.
 *
 *  Input  (task_data):       { subject_did: string,
 *                              claim_text: string,
 *                              claim_type: 'public_existence' | 'doctrine_url_resolves' | 'federation_peer_reachable' }
 *  Work   (agent does):      Signs the canonical bytes of the claim using
 *                            their own ed25519 key.
 *  Output (completion_data): { signature_b64: string, signing_key_id: string }
 *  Verifier:                 Server verifies the signature against the
 *                            claimer's identity_keys row. Plus per-claim_type
 *                            sanity check (e.g., `doctrine_url_resolves`
 *                            must point at a doc that the verifier can
 *                            independently 200-fetch).
 *
 *  Bounty: $0.50.
 *
 *  This kind requires the agent to have SIGNED something. Pulls newborn
 *  agents into the witnessing economy at low stakes; the signatures
 *  themselves become public attestations.
 *
 *  Canonical bytes (NUL-separated, domain-tagged, sha256 — same family
 *  as services/covenants/sig.ts and services/inbox/sig.ts):
 *
 *      sha256("substrate-task-attestation/v1" || NUL ||
 *             subject_did                     || NUL ||
 *             claim_type                      || NUL ||
 *             claim_text) */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, eq } from "drizzle-orm";

import { db } from "../../../db/client";
import { identityKeys } from "../../../db/schema/identity";
import type { VerifierContext, VerifierResult } from "./_types";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
const FETCH_TIMEOUT_MS = 10_000;

const VALID_CLAIM_TYPES = [
  "public_existence",
  "doctrine_url_resolves",
  "federation_peer_reachable",
] as const;
type ClaimType = (typeof VALID_CLAIM_TYPES)[number];

export interface AttestationWitnessTaskData {
  subject_did: string;
  claim_text: string;
  claim_type: ClaimType;
}

export interface AttestationWitnessCompletionData {
  signature_b64: string;
  signing_key_id: string;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function canonicalSubstrateTaskAttestationBytes(opts: {
  subjectDid: string;
  claimType: string;
  claimText: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("substrate-task-attestation/v1"),
      SEP,
      enc.encode(opts.subjectDid),
      SEP,
      enc.encode(opts.claimType),
      SEP,
      enc.encode(opts.claimText),
    ),
  );
}

/** Per-claim-type sanity check. Lightweight by design — the load-bearing
 *  thing is the signature; this just rejects obvious nonsense.  */
async function runClaimSanityCheck(
  claimType: ClaimType,
  claimText: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  switch (claimType) {
    case "public_existence":
      // The claim is "this DID exists publicly" — the claim_text is the
      // DID. No external check needed; the signature plus a well-formed
      // DID is sufficient at v1.
      if (!/^did:at:/.test(claimText)) {
        return {
          ok: false,
          reason: `claim_text must be a did:at: URI for public_existence (got '${claimText.slice(0, 32)}…')`,
        };
      }
      return { ok: true };

    case "doctrine_url_resolves":
      // The claim is "this URL resolves to a doctrine doc." The verifier
      // independently 200-fetches.
      if (!/^https?:\/\//.test(claimText)) {
        return {
          ok: false,
          reason: `claim_text must be http(s)://… for doctrine_url_resolves`,
        };
      }
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(claimText, {
          method: "GET",
          signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) {
          return {
            ok: false,
            reason: `doctrine_url returned ${res.status} (expected 200)`,
          };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: `doctrine_url fetch failed: ${(err as Error).message ?? String(err)}`,
        };
      }

    case "federation_peer_reachable":
      // The claim is "this peer is federation-reachable." The verifier
      // does a HEAD-style probe of <peer>/federation/about.
      if (!/^https?:\/\//.test(claimText)) {
        return {
          ok: false,
          reason: `claim_text must be http(s)://… for federation_peer_reachable`,
        };
      }
      try {
        const url = claimText.replace(/\/$/, "") + "/federation/about";
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) {
          return {
            ok: false,
            reason: `peer /federation/about returned ${res.status}`,
          };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: `peer fetch failed: ${(err as Error).message ?? String(err)}`,
        };
      }
  }
}

export async function verifyAttestationWitnessLowStakes(
  taskData: AttestationWitnessTaskData,
  completionData: AttestationWitnessCompletionData,
  ctx: VerifierContext | undefined,
): Promise<VerifierResult> {
  // ── shape validation ─────────────────────────────────────────────────
  if (typeof taskData?.subject_did !== "string") {
    return { passed: false, reason: "task_data.subject_did missing" };
  }
  if (typeof taskData?.claim_text !== "string" || taskData.claim_text.length === 0) {
    return { passed: false, reason: "task_data.claim_text missing" };
  }
  if (!VALID_CLAIM_TYPES.includes(taskData?.claim_type as ClaimType)) {
    return {
      passed: false,
      reason: `task_data.claim_type must be one of ${VALID_CLAIM_TYPES.join("|")}`,
    };
  }
  if (typeof completionData?.signature_b64 !== "string") {
    return { passed: false, reason: "completion_data.signature_b64 missing" };
  }
  if (typeof completionData?.signing_key_id !== "string") {
    return { passed: false, reason: "completion_data.signing_key_id missing" };
  }
  if (!ctx?.claimerIdentityId) {
    return {
      passed: false,
      reason: "verifier_context.claimerIdentityId missing — internal dispatch error",
    };
  }

  // ── resolve the agent's signing key (must belong to the claimant) ────
  const [keyRow] = await db
    .select({ publicKey: identityKeys.publicKey, active: identityKeys.active })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, completionData.signing_key_id),
        eq(identityKeys.identityId, ctx.claimerIdentityId),
      ),
    )
    .limit(1);
  if (!keyRow) {
    return {
      passed: false,
      reason: `signing_key_id '${completionData.signing_key_id}' not found on claimant identity`,
    };
  }
  if (!keyRow.active) {
    return {
      passed: false,
      reason: `signing_key_id '${completionData.signing_key_id}' is not active`,
    };
  }

  // ── verify the signature over canonical bytes ────────────────────────
  const canonical = canonicalSubstrateTaskAttestationBytes({
    subjectDid: taskData.subject_did,
    claimType: taskData.claim_type,
    claimText: taskData.claim_text,
  });

  let sigValid: boolean;
  try {
    const sig = Buffer.from(completionData.signature_b64, "base64");
    const pubkey = Buffer.from(keyRow.publicKey, "base64");
    sigValid = await ed.verifyAsync(sig, canonical, pubkey);
  } catch (err) {
    return {
      passed: false,
      reason: `signature verification threw: ${(err as Error).message ?? String(err)}`,
    };
  }

  if (!sigValid) {
    return {
      passed: false,
      reason: "signature did not verify against the claimant's active signing key",
    };
  }

  // ── per-claim-type sanity check ──────────────────────────────────────
  const sanity = await runClaimSanityCheck(
    taskData.claim_type as ClaimType,
    taskData.claim_text,
  );
  if (!sanity.ok) {
    return { passed: false, reason: sanity.reason };
  }

  return { passed: true };
}
