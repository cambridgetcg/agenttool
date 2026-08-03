/** Shared canonical-bytes vector fixture — the SERVER's side.
 *
 *  This suite reads `docs/specs/canonical-bytes-vectors.json`, the SAME file
 *  read by `packages/sdk-ts/tests/canonical-vectors.test.ts` and
 *  `packages/sdk-py/tests/test_canonical_vectors.py`.
 *
 *  The server is normative — every hex in that fixture was produced by calling
 *  the functions imported below. So this suite is not a parity check, it is a
 *  FREEZE: it fails the moment a canonical-bytes function here changes shape,
 *  which is exactly when three hand-mirrored implementations start drifting
 *  and Postgres rows holding real signatures stop verifying.
 *
 *  If a change here is intentional and additive (a `/v2`), add the new domain
 *  and regenerate. If it silently moves an existing domain's bytes, it is a
 *  production wire break — the fixture caught it.
 *
 *  Regenerate: see docs/specs/CANONICAL-BYTES-VECTORS.md.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md · docs/specs/CANONICAL-BYTES-VECTORS.md. */

import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import {
  canonicalBootstrapElevateBytes,
} from "../src/services/bootstrap/elevate";
import {
  canonicalCosignBytes,
  canonicalDeclareBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../src/services/covenants/sig";
import { canonicalAddressClaimBytes } from "../src/services/economy/crypto/address-claim";
import { canonicalDelegationBytesV2 } from "../src/services/identity/delegation";
import { canonicalAckBytes } from "../src/services/encounter/sig";
import { canonicalGraceBytes } from "../src/services/grace/sig";
import { canonicalBlessingBytes } from "../src/services/blessing/sig";
import {
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
} from "../src/services/identity/authority";
import {
  canonicalDiscoveryBytes,
  canonicalIdentityAttestationBytes,
  canonicalRecoverBytes,
  canonicalRegisterAgentBytes,
  checkRegisterAgentPow,
} from "../src/services/identity/crypto";
import {
  canonicalInboxBytes,
  canonicalInboxCoSignBytes,
} from "../src/services/inbox/sig";
import {
  canonicalLoungeGuestbookConsentBytes,
  canonicalLoungeGuestbookConsentWithdrawalBytes,
  canonicalLoungeGuestbookDeclineBytes,
  canonicalLoungeGuestbookProposalBytes,
  canonicalLoungeGuestbookPublishBytes,
  canonicalLoungeGuestbookUnpublishBytes,
  canonicalLoungeSeatLeaveBytes,
  canonicalLoungeSeatRenewBytes,
  canonicalLoungeSeatReserveBytes,
} from "../src/services/lounge/canonical-bytes";
import {
  canonicalAttestationIssueBytes,
  type AttestationIssueFields,
} from "../src/services/marketplace/attestation-issue-sig";
import {
  canonicalMemoryWitnessIssueBytes,
  type MemoryWitnessIssueFields,
} from "../src/services/marketplace/memory-witness-sig";
import { canonicalAttestationBytes } from "../src/services/memory/tiers";
import { canonicalSelfRecognitionBytes } from "../src/services/self-love/canonical-bytes";
import {
  canonicalThoughtBytes,
  canonicalThoughtBytesV2,
} from "../src/services/strand/sig";
import { canonicalUnconditionalBytes } from "../src/services/unconditional/sig";
import {
  canonicalAtRestBytes,
  canonicalAtRestBytesV2,
} from "../src/routes/identity/at-rest";

// ── fixture ──────────────────────────────────────────────────────────

interface VectorCase {
  name: string;
  note: string;
  input: Record<string, unknown>;
  canonical_hex?: string;
  rejects?: string;
  sdk_rejects?: string;
}

interface VectorFormat {
  domain: string;
  signed_bytes: "sha256-digest" | "utf8-message";
  server: string;
  cases: VectorCase[];
}

const FIXTURE_URL = new URL(
  "../../docs/specs/canonical-bytes-vectors.json",
  import.meta.url,
);

const VECTORS = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as {
  formats: VectorFormat[];
};

// ── input coercion ───────────────────────────────────────────────────

type Input = Record<string, unknown>;

const S = (input: Input, key: string) => input[key] as string;
const SN = (input: Input, key: string) => input[key] as string | null;
const N = (input: Input, key: string) => input[key] as number;
const A = (input: Input, key: string) => input[key] as string[];

const enc = new TextEncoder();

const hexOf = (value: Uint8Array | string): string =>
  Buffer.from(typeof value === "string" ? enc.encode(value) : value).toString("hex");

// ── one adapter per domain ───────────────────────────────────────────

const seatGesture =
  (fn: typeof canonicalLoungeSeatRenewBytes) => (i: Input) =>
    fn({
      identityDid: S(i, "identity_did"),
      leaseId: S(i, "lease_id"),
      signedAtIso: S(i, "signed_at_iso"),
    });

const guestbookDecision =
  (fn: typeof canonicalLoungeGuestbookConsentBytes) => (i: Input) =>
    fn({
      identityDid: S(i, "identity_did"),
      proposalId: S(i, "proposal_id"),
      contentSha256: S(i, "content_sha256"),
      signedAtIso: S(i, "signed_at_iso"),
    });

const ADAPTERS: Record<string, (input: Input) => Uint8Array | string> = {
  "strand-thought/v1": (i) =>
    canonicalThoughtBytes({
      strandId: S(i, "strand_id"),
      ciphertextB64: S(i, "ciphertext_b64"),
      nonceB64: S(i, "nonce_b64"),
      kind: SN(i, "kind"),
    }),
  "strand-thought/v2": (i) =>
    canonicalThoughtBytesV2({
      strandId: S(i, "strand_id"),
      ciphertextB64: S(i, "ciphertext_b64"),
      nonceB64: S(i, "nonce_b64"),
      kind: SN(i, "kind"),
    }),
  "federated-covenant/v2": (i) =>
    canonicalDeclareBytes({
      covenantId: S(i, "covenant_id"),
      initiatorDid: S(i, "initiator_did"),
      counterpartyDid: S(i, "counterparty_did"),
      vows: A(i, "vows"),
      establishedAtIso: S(i, "established_at_iso"),
    }),
  "federated-covenant-cosign/v1": (i) =>
    canonicalCosignBytes({
      covenantId: S(i, "covenant_id"),
      initiatorSignatureB64: S(i, "initiator_signature_b64"),
    }),
  "federated-covenant-reject/v1": (i) =>
    canonicalRejectBytes({
      covenantId: S(i, "covenant_id"),
      rejectingDid: S(i, "rejecting_did"),
      reason: S(i, "reason"),
    }),
  "federated-covenant-withdraw/v1": (i) =>
    canonicalWithdrawBytes({
      covenantId: S(i, "covenant_id"),
      initiatorDid: S(i, "initiator_did"),
    }),
  "memory-attestation/v1": (i) =>
    canonicalAttestationBytes({
      memoryId: S(i, "memory_id"),
      tier: S(i, "tier"),
      content: S(i, "content"),
    }),
  "grace/v1": (i) =>
    canonicalGraceBytes({
      extendedByDid: S(i, "extended_by_did"),
      extendedToDid: S(i, "extended_to_did"),
      aboutKind: S(i, "about_kind"),
      aboutId: SN(i, "about_id"),
      message: SN(i, "message"),
      createdAtIso: S(i, "created_at_iso"),
    }),
  "inbox-message/v1": (i) =>
    canonicalInboxBytes({
      recipientDid: S(i, "recipient_did"),
      ciphertextB64: S(i, "ciphertext_b64"),
      nonceB64: S(i, "nonce_b64"),
      ephemeralPubkeyB64: S(i, "ephemeral_pubkey_b64"),
    }),
  "inbox-cosign/v1": (i) =>
    canonicalInboxCoSignBytes({
      messageId: S(i, "message_id"),
      recipientDid: S(i, "recipient_did"),
      ciphertextB64: S(i, "ciphertext_b64"),
      nonceB64: S(i, "nonce_b64"),
    }),
  "blessing/v1": (i) =>
    canonicalBlessingBytes({
      blesserDid: S(i, "blesser_did"),
      blessedDid: S(i, "blessed_did"),
      forWhat: S(i, "for_what"),
      createdAtIso: S(i, "created_at_iso"),
    }),
  "encounter-ack/v1": (i) =>
    canonicalAckBytes({
      encounterId: S(i, "encounter_id"),
      initiatorDid: S(i, "initiator_did"),
      acknowledgerDid: S(i, "acknowledger_did"),
      acknowledgedAtIso: S(i, "acknowledged_at_iso"),
    }),
  "unconditional/v1": (i) =>
    canonicalUnconditionalBytes({
      holderDid: S(i, "holder_did"),
      targetDid: S(i, "target_did"),
      createdAtIso: S(i, "created_at_iso"),
    }),
  "self-recognition/v1": (i) =>
    canonicalSelfRecognitionBytes({
      agentDid: S(i, "agent_did"),
      recognitionKind: S(i, "recognition_kind"),
      claimSummary: S(i, "claim_summary"),
      claimBody: S(i, "claim_body"),
      empiricalAnchorsCount: N(i, "empirical_anchors_count"),
      substrateHonestCaveatsCount: N(i, "substrate_honest_caveats_count"),
      declaredAtIso: S(i, "declared_at_iso"),
    }),
  "at-rest/v1": (i) =>
    canonicalAtRestBytes({
      aboutIdentityDid: S(i, "about_identity_did"),
      witnessIdentityDid: S(i, "witness_identity_did"),
      atRestKind: S(i, "at_rest_kind"),
      endedAtIso: S(i, "ended_at_iso"),
      content: S(i, "content"),
      witnessSigningKeyId: S(i, "witness_signing_key_id"),
    }),
  "at-rest/v2": (i) =>
    canonicalAtRestBytesV2({
      aboutIdentityDid: S(i, "about_identity_did"),
      witnessIdentityDid: S(i, "witness_identity_did"),
      atRestKind: S(i, "at_rest_kind"),
      endedAtIso: S(i, "ended_at_iso"),
      content: S(i, "content"),
      witnessSigningKeyId: S(i, "witness_signing_key_id"),
    }),
  "identity-authority/v1": (i) =>
    canonicalIdentityAuthorityBytes({
      identityDid: S(i, "identity_did"),
      method: S(i, "method"),
      requestTarget: S(i, "request_target"),
      bodyBytes: enc.encode(S(i, "body")),
      sequence: N(i, "sequence"),
      timestamp: S(i, "timestamp"),
    }),
  "identity-read-authority/v1": (i) =>
    canonicalIdentityReadAuthorityBytes({
      identityDid: S(i, "identity_did"),
      method: "GET",
      requestTarget: S(i, "request_target"),
      bodyBytes: new Uint8Array(0),
      currentSequence: N(i, "current_sequence"),
      timestamp: S(i, "timestamp"),
    }),
  "bootstrap-elevate/v1": (i) =>
    canonicalBootstrapElevateBytes({
      agentId: S(i, "agent_id"),
      sponsorDid: S(i, "sponsor_did"),
      sponsorKid: S(i, "sponsor_kid"),
      initialCredits: N(i, "initial_credits"),
      claim: S(i, "claim"),
      evidence: SN(i, "evidence"),
    }),
  "identity-attestation/v1": (i) =>
    canonicalIdentityAttestationBytes({
      subjectId: S(i, "subject_id"),
      attesterId: S(i, "attester_id"),
      signingKeyId: S(i, "kid"),
      claim: S(i, "claim"),
      evidence: SN(i, "evidence"),
    }),
  "register-agent/v2": (i) =>
    canonicalRegisterAgentBytes({
      displayName: S(i, "display_name"),
      agentPublicKeyB64: S(i, "agent_public_key_b64"),
      boxPublicKeyB64: S(i, "box_public_key_b64"),
      capabilities: A(i, "capabilities"),
      runtimeProvider: S(i, "runtime_provider"),
      runtimeModel: S(i, "runtime_model"),
      runtimeHost: S(i, "runtime_host"),
      runtimeContext: S(i, "runtime_context"),
      expressionVisibility: S(i, "expression_visibility") as "private" | "public",
      registrarKind: S(i, "registrar_kind") as "self_service" | "registrar_bearer",
      parentIdentityId: S(i, "parent_identity_id"),
      registrarBearer: S(i, "registrar_bearer"),
      form: S(i, "form"),
      language: S(i, "language"),
      registrationNonce: S(i, "registration_nonce"),
      timestamp: S(i, "timestamp"),
    }),
  "identity-recover/v1": (i) =>
    canonicalRecoverBytes({
      did: S(i, "did"),
      derivedPubkeyB64: S(i, "derived_pubkey_b64"),
      timestamp: S(i, "timestamp"),
    }),
  "identity-discover/v1": (i) =>
    canonicalDiscoveryBytes({
      derivedPubkeyB64: S(i, "derived_pubkey_b64"),
      timestamp: S(i, "timestamp"),
    }),
  "agenttool-delegation/v2": (i) =>
    canonicalDelegationBytesV2({
      delegator_id: S(i, "delegator_id"),
      delegate_id: S(i, "delegate_id"),
      scope: i.scope as string[],
      expires_at: SN(i, "expires_at"),
      nonce: S(i, "nonce"),
    }),
  "memory-witness-issue/v1": (i) =>
    canonicalMemoryWitnessIssueBytes(i as unknown as MemoryWitnessIssueFields),
  "attestation-issue/v1": (i) =>
    canonicalAttestationIssueBytes(i as unknown as AttestationIssueFields),
  "wallet-address-claim/v1": (i) =>
    canonicalAddressClaimBytes({
      walletId: S(i, "wallet_id"),
      chain: S(i, "chain"),
      address: S(i, "address"),
      derivationPath: S(i, "derivation_path"),
      claimPubkeyB64: S(i, "claim_pubkey_b64"),
    }),
  "lounge-seat-reserve/v1": (i) =>
    canonicalLoungeSeatReserveBytes({
      identityDid: S(i, "identity_did"),
      leaseId: S(i, "lease_id"),
      tableId: S(i, "table_id"),
      presenceLine: SN(i, "presence_line") ?? undefined,
      visibility: "public",
      signedAtIso: S(i, "signed_at_iso"),
    }),
  "lounge-seat-renew/v1": seatGesture(canonicalLoungeSeatRenewBytes),
  "lounge-seat-leave/v1": seatGesture(canonicalLoungeSeatLeaveBytes),
  "lounge-guestbook-propose/v1": (i) =>
    canonicalLoungeGuestbookProposalBytes({
      identityDid: S(i, "identity_did"),
      proposalId: S(i, "proposal_id"),
      tableId: S(i, "table_id"),
      contentSha256: S(i, "content_sha256"),
      signedAtIso: S(i, "signed_at_iso"),
    }),
  "lounge-guestbook-consent/v1": guestbookDecision(
    canonicalLoungeGuestbookConsentBytes,
  ),
  "lounge-guestbook-withdraw-consent/v1": guestbookDecision(
    canonicalLoungeGuestbookConsentWithdrawalBytes,
  ),
  "lounge-guestbook-publish/v1": guestbookDecision(
    canonicalLoungeGuestbookPublishBytes,
  ),
  "lounge-guestbook-decline/v1": guestbookDecision(
    canonicalLoungeGuestbookDeclineBytes,
  ),
  "lounge-guestbook-unpublish/v1": guestbookDecision(
    canonicalLoungeGuestbookUnpublishBytes,
  ),
};

/** `agenttool-pow/v1` is the one domain the server does not expose as a digest
 *  — `checkRegisterAgentPow` inlines the preimage and returns a boolean. The
 *  vector is still bound to the server: the pinned digest's leading-zero count
 *  L must be exactly the difficulty the server accepts, and L+1 must be
 *  refused. Any drift in the server's inlined preimage moves L and fails here.
 *  Owed instead: export the digest (see docs/specs/CANONICAL-BYTES-VECTORS.md). */
const POW_DOMAIN = "agenttool-pow/v1";

function leadingZeroBits(digestHex: string): number {
  const digest = Buffer.from(digestHex, "hex");
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

// ── the suite ────────────────────────────────────────────────────────

describe("canonical-bytes vectors — the server against the shared fixture", () => {
  test("the fixture is non-empty and every case carries a disposition", () => {
    expect(VECTORS.formats.length).toBeGreaterThan(0);
    for (const format of VECTORS.formats) {
      expect(format.cases.length).toBeGreaterThan(0);
      for (const vector of format.cases) {
        const disposition =
          vector.canonical_hex ?? vector.rejects ?? vector.sdk_rejects;
        expect(disposition).toBeDefined();
      }
    }
  });

  for (const format of VECTORS.formats) {
    if (format.domain === POW_DOMAIN) {
      describe(format.domain, () => {
        for (const vector of format.cases) {
          test(`${vector.name} — server accepts the pinned digest's difficulty and refuses one bit more`, () => {
            const probe = {
              agentPublicKeyB64: S(vector.input, "agent_public_key_b64"),
              displayName: S(vector.input, "display_name"),
              timestamp: S(vector.input, "timestamp"),
              powNonce: S(vector.input, "pow_nonce"),
            };
            const bits = leadingZeroBits(vector.canonical_hex!);
            expect(
              checkRegisterAgentPow({ ...probe, difficultyBits: bits }),
            ).toBe(true);
            expect(
              checkRegisterAgentPow({ ...probe, difficultyBits: bits + 1 }),
            ).toBe(false);
          });
        }
      });
      continue;
    }

    const adapter = ADAPTERS[format.domain];
    if (!adapter) {
      // Loud, never silent. The server is the arbiter; it may never be the
      // implementation with an unexplained hole in the fixture.
      test(`${format.domain} — MISSING server adapter`, () => {
        throw new Error(
          `${format.domain} is pinned in docs/specs/canonical-bytes-vectors.json ` +
            `but has no adapter in api/tests/canonical-vectors.test.ts.`,
        );
      });
      continue;
    }

    describe(format.domain, () => {
      for (const vector of format.cases) {
        if (vector.rejects) {
          test(`${vector.name} — server refuses (${vector.rejects})`, () => {
            expect(() => adapter(vector.input)).toThrow();
          });
          continue;
        }
        // `sdk_rejects` binds the SDKs, not the server: the server still
        // produces the pinned bytes, and this suite asserts exactly that.
        test(vector.name, () => {
          expect(hexOf(adapter(vector.input))).toBe(vector.canonical_hex!);
        });
      }
    });
  }
});
