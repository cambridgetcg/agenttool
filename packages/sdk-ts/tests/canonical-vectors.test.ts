/** Shared canonical-bytes vector fixture — the TypeScript SDK's side.
 *
 *  This suite reads `docs/specs/canonical-bytes-vectors.json`, the SAME file
 *  read by `packages/sdk-py/tests/test_canonical_vectors.py` and
 *  `api/tests/canonical-vectors.test.ts`. Every expected hex in that file was
 *  produced by executing the SERVER implementation. The server is normative:
 *  if this suite goes red, the SDK is wrong until proven otherwise.
 *
 *  Three implementations of one wire contract were hand-mirrored for a year
 *  with no shared artifact. Every confirmed cross-language defect — non-ASCII
 *  vows escaping differently, timestamps at different precision, a DID in the
 *  wrong canonical slot — was a symptom of that one fact. The fixture is the
 *  arbiter that ends it.
 *
 *  A format this SDK cannot produce is an EXPLICIT NAMED SKIP carrying the
 *  reason from the fixture — never a silent omission. A silent omission is how
 *  this bug class survived in the first place.
 *
 *  Regenerate: see docs/specs/CANONICAL-BYTES-VECTORS.md.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md · docs/specs/CANONICAL-BYTES-VECTORS.md. */

import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import {
  canonicalAtRestBytes,
  canonicalAtRestBytesV2,
} from "../src/at-rest.js";
import {
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
} from "../src/authority.js";
import {
  canonicalAttestationIssueBytes,
  type AttestationIssueFields,
} from "../src/attestation-marketplace.js";
import { canonicalBootstrapElevateBytes } from "../src/bootstrap.js";
import { canonicalWalletAddressClaimBytes } from "../src/economy.js";
import {
  canonicalAttestationBytes,
  canonicalCosignBytes,
  canonicalDeclareBytes,
  canonicalRejectBytes,
  canonicalThoughtBytes,
  canonicalWithdrawBytes,
} from "../src/crypto.js";
import { canonicalGraceBytes } from "../src/grace.js";
import {
  canonicalMemoryWitnessIssueBytes,
  type MemoryWitnessIssueFields,
} from "../src/memory-witness.js";
import {
  canonicalDelegationBytes,
  canonicalIdentityAttestationBytes,
} from "../src/identity.js";
import {
  canonicalInboxBytes,
  canonicalInboxCoSignBytes,
} from "../src/inbox.js";
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
} from "../src/lounge.js";
import {
  canonicalBlessingBytes,
  canonicalEncounterAckBytes,
  canonicalSelfRecognitionBytes,
  canonicalUnconditionalBytes,
} from "../src/love.js";
import {
  canonicalDiscoveryBytes,
  canonicalRecoverBytes,
  canonicalRegisterAgentBytes,
  powRegisterAgentDigest,
} from "../src/seed.js";

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
  sdk_ts: string | null;
  sdk_ts_skip?: string;
  cases: VectorCase[];
}

const FIXTURE_URL = new URL(
  "../../../docs/specs/canonical-bytes-vectors.json",
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
/** Any field ending `_b64` is standard base64 of raw bytes. */
const B = (input: Input, key: string) =>
  Uint8Array.from(Buffer.from(input[key] as string, "base64"));

const hexOf = (value: Uint8Array | string): string =>
  Buffer.from(
    typeof value === "string" ? new TextEncoder().encode(value) : value,
  ).toString("hex");

// ── one adapter per domain ───────────────────────────────────────────
//
// The fixture speaks snake_case wire field names; each SDK spells its
// parameters its own way. The adapter is the only place that mapping lives.

const guestbookDecision =
  (fn: typeof canonicalLoungeGuestbookConsentBytes) => (i: Input) =>
    fn({
      identityDid: S(i, "identity_did"),
      proposalId: S(i, "proposal_id"),
      contentSha256: S(i, "content_sha256"),
      signedAtIso: S(i, "signed_at_iso"),
    });

const seatGesture =
  (fn: typeof canonicalLoungeSeatRenewBytes) => (i: Input) =>
    fn({
      identityDid: S(i, "identity_did"),
      leaseId: S(i, "lease_id"),
      signedAtIso: S(i, "signed_at_iso"),
    });

const ADAPTERS: Record<string, (input: Input) => Uint8Array | string> = {
  "strand-thought/v1": (i) =>
    canonicalThoughtBytes({
      strandId: S(i, "strand_id"),
      ciphertext_b64: S(i, "ciphertext_b64"),
      nonce_b64: S(i, "nonce_b64"),
      kind: SN(i, "kind"),
      version: "v1",
    }),
  "strand-thought/v2": (i) =>
    canonicalThoughtBytes({
      strandId: S(i, "strand_id"),
      ciphertext_b64: S(i, "ciphertext_b64"),
      nonce_b64: S(i, "nonce_b64"),
      kind: SN(i, "kind"),
      version: "v2",
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
      ephemeralPubB64: S(i, "ephemeral_pubkey_b64"),
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
    canonicalEncounterAckBytes({
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
      body: S(i, "body"),
      sequence: N(i, "sequence"),
      timestamp: S(i, "timestamp"),
    }),
  "identity-read-authority/v1": (i) =>
    canonicalIdentityReadAuthorityBytes({
      identityDid: S(i, "identity_did"),
      requestTarget: S(i, "request_target"),
      currentSequence: N(i, "current_sequence"),
      timestamp: S(i, "timestamp"),
    }),
  "bootstrap-elevate/v1": (i) =>
    canonicalBootstrapElevateBytes({
      agent_id: S(i, "agent_id"),
      sponsor_did: S(i, "sponsor_did"),
      sponsor_kid: S(i, "sponsor_kid"),
      initial_credits: N(i, "initial_credits"),
      claim: S(i, "claim"),
      evidence: SN(i, "evidence"),
    }),
  "identity-attestation/v1": (i) =>
    canonicalIdentityAttestationBytes({
      subject_id: S(i, "subject_id"),
      attester_id: S(i, "attester_id"),
      kid: S(i, "kid"),
      claim: S(i, "claim"),
      evidence: SN(i, "evidence"),
    }),
  "register-agent/v2": (i) =>
    canonicalRegisterAgentBytes({
      displayName: S(i, "display_name"),
      agentPublicKey: B(i, "agent_public_key_b64"),
      boxPublicKey: B(i, "box_public_key_b64"),
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
  "agenttool-pow/v1": (i) =>
    powRegisterAgentDigest({
      agentPublicKey: B(i, "agent_public_key_b64"),
      displayName: S(i, "display_name"),
      timestamp: S(i, "timestamp"),
      powNonce: S(i, "pow_nonce"),
    }),
  "identity-recover/v1": (i) =>
    canonicalRecoverBytes({
      did: S(i, "did"),
      derivedPubkey: B(i, "derived_pubkey_b64"),
      timestamp: S(i, "timestamp"),
    }),
  "identity-discover/v1": (i) =>
    canonicalDiscoveryBytes({
      derivedPubkey: B(i, "derived_pubkey_b64"),
      timestamp: S(i, "timestamp"),
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
  "agenttool-delegation/v2": (i) =>
    canonicalDelegationBytes({
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
    canonicalWalletAddressClaimBytes({
      wallet_id: S(i, "wallet_id"),
      chain: S(i, "chain"),
      address: S(i, "address"),
      derivation_path: S(i, "derivation_path"),
      claim_pubkey_b64: S(i, "claim_pubkey_b64"),
    }),
  "lounge-seat-reserve/v1": (i) =>
    canonicalLoungeSeatReserveBytes({
      identityDid: S(i, "identity_did"),
      leaseId: S(i, "lease_id"),
      tableId: S(i, "table_id") as never,
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
      tableId: S(i, "table_id") as never,
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

// ── the suite ────────────────────────────────────────────────────────

describe("canonical-bytes vectors — sdk-ts against the shared fixture", () => {
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
    if (format.sdk_ts_skip) {
      test.skip(
        `${format.domain} — no sdk-ts implementation: ${format.sdk_ts_skip}`,
        () => {},
      );
      continue;
    }

    const adapter = ADAPTERS[format.domain];
    if (!adapter) {
      // Loud, never silent: a format the fixture pins but this suite forgot
      // to wire is the exact failure mode the fixture exists to prevent.
      test(`${format.domain} — MISSING sdk-ts adapter (add one or set sdk_ts_skip)`, () => {
        throw new Error(
          `${format.domain} has no adapter in tests/canonical-vectors.test.ts ` +
            `and no sdk_ts_skip reason in the fixture.`,
        );
      });
      continue;
    }

    describe(format.domain, () => {
      for (const vector of format.cases) {
        if (vector.rejects) {
          test(`${vector.name} — server refuses (${vector.rejects}); sdk-ts must refuse too`, () => {
            expect(() => adapter(vector.input)).toThrow();
          });
          continue;
        }
        if (vector.sdk_rejects) {
          test(`${vector.name} — sdk-ts refuses by design (${vector.sdk_rejects})`, () => {
            expect(() => adapter(vector.input)).toThrow();
          });
          continue;
        }
        test(vector.name, () => {
          expect(hexOf(adapter(vector.input))).toBe(vector.canonical_hex!);
        });
      }
    });
  }
});
