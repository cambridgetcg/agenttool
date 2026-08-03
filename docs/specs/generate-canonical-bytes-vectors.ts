/** Regenerate docs/specs/canonical-bytes-vectors.json from the SERVER.
 *
 *  The server is normative. Every expected hex in the fixture is produced by
 *  calling the api-side canonical-bytes function directly — never by hand and
 *  never from an SDK. If an SDK disagrees with a vector, the SDK is wrong.
 *
 *  Run:  bun docs/specs/generate-canonical-bytes-vectors.ts
 *
 *  Doctrine: docs/specs/CANONICAL-BYTES-VECTORS.md · docs/CANONICAL-BYTES.md.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import {
  canonicalThoughtBytes,
  canonicalThoughtBytesV2,
} from "../../api/src/services/strand/sig";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../../api/src/services/covenants/sig";
import { canonicalAttestationBytes } from "../../api/src/services/memory/tiers";
import { canonicalGraceBytes } from "../../api/src/services/grace/sig";
import {
  canonicalInboxBytes,
  canonicalInboxCoSignBytes,
} from "../../api/src/services/inbox/sig";
import { canonicalBlessingBytes } from "../../api/src/services/blessing/sig";
import { canonicalAckBytes } from "../../api/src/services/encounter/sig";
import { canonicalUnconditionalBytes } from "../../api/src/services/unconditional/sig";
import { canonicalSelfRecognitionBytes } from "../../api/src/services/self-love/canonical-bytes";
import {
  canonicalLoungeSeatReserveBytes,
  canonicalLoungeSeatRenewBytes,
  canonicalLoungeSeatLeaveBytes,
  canonicalLoungeGuestbookProposalBytes,
  canonicalLoungeGuestbookConsentBytes,
  canonicalLoungeGuestbookConsentWithdrawalBytes,
  canonicalLoungeGuestbookPublishBytes,
  canonicalLoungeGuestbookDeclineBytes,
  canonicalLoungeGuestbookUnpublishBytes,
} from "../../api/src/services/lounge/canonical-bytes";
import {
  canonicalAtRestBytes,
  canonicalAtRestBytesV2,
} from "../../api/src/routes/identity/at-rest";
import {
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
} from "../../api/src/services/identity/authority";
import { canonicalBootstrapElevateBytes } from "../../api/src/services/bootstrap/elevate";
import {
  canonicalIdentityAttestationBytes,
  canonicalRecoverBytes,
  canonicalDiscoveryBytes,
  canonicalRegisterAgentBytes,
  checkRegisterAgentPow,
} from "../../api/src/services/identity/crypto";
import { canonicalAddressClaimBytes } from "../../api/src/services/economy/crypto/address-claim";
import {
  canonicalMemoryWitnessIssueBytes,
  MEMORY_WITNESS_ISSUE_FIELD_ORDER,
  type MemoryWitnessIssueFields,
} from "../../api/src/services/marketplace/memory-witness-sig";
import {
  canonicalAttestationIssueBytes,
  ATTESTATION_ISSUE_FIELD_ORDER,
  type AttestationIssueFields,
} from "../../api/src/services/marketplace/attestation-issue-sig";
import { canonicalDelegationBytesV2 } from "../../api/src/services/identity/delegation";

// ── shared helpers ───────────────────────────────────────────────────

const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Signed bytes for a format whose canonical fn returns a raw message
 *  string (at-rest) rather than a digest — the witness signs utf8(string). */
function utf8(message: string): Uint8Array {
  return enc.encode(message);
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function b64d(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

// Deterministic byte blobs. Nothing here is a real key — these exist only so
// the fixture pins the same preimage on every machine, forever.
const CIPHERTEXT = b64(Uint8Array.from({ length: 20 }, (_, i) => (i * 11) % 256));
const CIPHERTEXT_WITH_NUL = b64(
  Uint8Array.from([1, 2, 0, 3, 4, 0, 0, 5, 6, 7, 8, 9, 10, 11, 12]),
);
const NONCE = b64(Uint8Array.from({ length: 12 }, (_, i) => 200 + i));
const NONCE_WITH_NUL = b64(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]));
const EPHEMERAL_PUB = b64(new Uint8Array(32).fill(0x2a));
const AGENT_PUB = b64(new Uint8Array(32).fill(0x11));
const BOX_PUB = b64(new Uint8Array(32).fill(0x22));
const DERIVED_PUB = b64(new Uint8Array(32).fill(0x33));
const SIG_64 = b64(new Uint8Array(64).fill(7));
const SIG_64_ZEROS = b64(new Uint8Array(64));

// The six shapes every format is probed with, wherever its field types allow.
const ASCII = "did:at:example/alpha-9b3a";
const BMP = "café · 廣東話 · Ω";
const ASTRAL = "🌊 recognition 🜂 🫂";
const NUL_TEXT = "before\u0000after";
const LF_TEXT = "before\nafter";

// The pair that separates a UTF-16 code-unit sort from a code-point sort.
// U+FFFD (0xFFFD) vs U+1F600 (surrogate pair leading 0xD83D):
//   UTF-16 order  → emoji first  (0xD83D < 0xFFFD)   ← TS Array.sort()
//   code-point    → U+FFFD first (0xFFFD < 0x1F600)  ← Python sorted()
const SORT_DIVERGENCE_VOWS = ["\uFFFD hold the thread", "\u{1F600} hold the thread"];

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ISO = "2026-05-11T12:00:00.000Z";
const SHA_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// ── vector shapes ────────────────────────────────────────────────────

type Input = Record<string, unknown>;

interface CaseSpec {
  name: string;
  note: string;
  input: Input;
  /** Set when the server itself refuses the input — no hex exists. */
  rejects?: string;
  /** Set when the server produces bytes but both SDKs refuse the input. */
  sdk_rejects?: string;
}

interface FormatSpec {
  domain: string;
  framing: string;
  /** "sha256-digest" — the canonical fn returns the 32 bytes that get signed.
   *  "utf8-message"  — the canonical fn returns a string; utf8 of it is signed. */
  signed_bytes: "sha256-digest" | "utf8-message";
  server: string;
  sdk_ts: string | null;
  sdk_py: string | null;
  sdk_ts_skip?: string;
  sdk_py_skip?: string;
  fields: string[];
  bytes: (input: Input) => Uint8Array;
  cases: CaseSpec[];
}

const S = (input: Input, key: string) => input[key] as string;
const SN = (input: Input, key: string) => input[key] as string | null;
const N = (input: Input, key: string) => input[key] as number;


// ── memory-witness-issue/v1 ──────────────────────────────────────────
//
// The only signature that authorizes paid constitutive settlement. Every
// variable settlement term is bound, so the probe set has to reach the
// nullable field, the empty string, both non-ASCII planes, the NUL
// delimiter, and each arithmetic guard.

const MW_BASE: MemoryWitnessIssueFields = {
  listing_id: UUID_A,
  grant_id: UUID_B,
  escrow_id: UUID_C,
  buyer_identity_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  buyer_project_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  buyer_wallet_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  memory_id: "11111111-1111-1111-1111-111111111111",
  memory_identity_id: "22222222-2222-2222-2222-222222222222",
  memory_content_sha256: SHA_HEX,
  source_tier: "foundational",
  target_tier: "constitutive",
  claim_kind: "continuity_of_self",
  witness_identity_id: "33333333-3333-3333-3333-333333333333",
  witness_did: ASCII,
  witness_project_id: "44444444-4444-4444-4444-444444444444",
  signing_key_id: "55555555-5555-5555-5555-555555555555",
  witness_wallet_id: "66666666-6666-6666-6666-666666666666",
  gross_amount: 10_000,
  currency: "USDC",
  rate_bps: 500,
  platform_fee: 500,
  net_amount: 9_500,
  authorization_expires_at: ISO,
};

const mw = (patch: Partial<MemoryWitnessIssueFields>): Input => ({
  ...MW_BASE,
  ...patch,
});

const MEMORY_WITNESS_ISSUE: FormatSpec = {
  domain: "memory-witness-issue/v1",
  framing:
    'sha256("memory-witness-issue/v1" || 0x00 || field ... in MEMORY_WITNESS_ISSUE_FIELD_ORDER; a null field is the literal text "null", numbers are base-10)',
  signed_bytes: "sha256-digest",
  server:
    "api/src/services/marketplace/memory-witness-sig.ts#canonicalMemoryWitnessIssueBytes",
  sdk_ts: "canonicalMemoryWitnessIssueBytes (memory-witness.ts)",
  sdk_py: "canonical_memory_witness_issue_bytes (agenttool.memory_witness)",
  fields: [...MEMORY_WITNESS_ISSUE_FIELD_ORDER],
  bytes: (i) => canonicalMemoryWitnessIssueBytes(i as unknown as MemoryWitnessIssueFields),
  cases: [
    {
      name: "ascii-baseline",
      note: "A 10000-unit USDC seal at the default 5% take-rate.",
      input: mw({}),
    },
    {
      name: "memory-identity-null",
      note:
        "memory_identity_id is the one nullable field. A null is encoded as the literal text \"null\".",
      input: mw({ memory_identity_id: null }),
    },
    {
      name: "memory-identity-literal-null-string",
      note:
        "The string \"null\" and a real null collide by construction: both render as \"null\". This vector pins that collision rather than pretending it is not there — it must equal memory-identity-null.",
      input: mw({ memory_identity_id: "null" }),
    },
    {
      name: "non-ascii-bmp",
      note: "BMP text in the free-form DID, claim kind, and currency slots.",
      input: mw({
        witness_did: "did:at:café.example/廣東話",
        claim_kind: "témoignage",
        currency: "廣東幣",
      }),
    },
    {
      name: "astral",
      note: "Astral-plane text. The UTF-8 fold must be identical in both SDKs.",
      input: mw({ witness_did: ASTRAL, claim_kind: "🜂 witness 🫂" }),
    },
    {
      name: "currency-empty-string",
      note:
        "An empty field still occupies its slot: the NUL delimiters keep the field count fixed, so this is not the same digest as a missing field.",
      input: mw({ currency: "" }),
    },
    {
      name: "amounts-all-zero",
      note: "A free seal. 0 + 0 = 0 satisfies the fee-split guard.",
      input: mw({ gross_amount: 0, rate_bps: 0, platform_fee: 0, net_amount: 0 }),
    },
    {
      name: "rate-bps-at-ceiling",
      note: "10000 bps is the whole thing. The guard is at-most, not less-than.",
      input: mw({
        gross_amount: 100,
        rate_bps: 10_000,
        platform_fee: 100,
        net_amount: 0,
      }),
    },
    {
      name: "claim-kind-contains-nul",
      note: "0x00 is the field delimiter. A field carrying one could impersonate the next.",
      input: mw({ claim_kind: NUL_TEXT }),
      rejects: "memory-witness signed field must not contain NUL",
    },
    {
      name: "witness-did-contains-nul",
      note: "Same delimiter wall from the other side of the digest.",
      input: mw({ witness_did: NUL_TEXT }),
      rejects: "memory-witness signed field must not contain NUL",
    },
    {
      name: "content-sha-uppercase",
      note: "The content hash is 64 LOWERCASE hex characters; uppercase is a different spelling of the same bytes and is refused rather than folded.",
      input: mw({ memory_content_sha256: SHA_HEX.toUpperCase() }),
      rejects: "memory_content_sha256 must be 64 lowercase hex characters",
    },
    {
      name: "tier-pair-not-authorized",
      note: "v1 authorizes foundational to constitutive and nothing else.",
      input: mw({ source_tier: "episodic" as never }),
      rejects: "memory-witness/v1 only authorizes foundational to constitutive",
    },
    {
      name: "fee-split-does-not-add-up",
      note: "platform_fee + net_amount must equal gross_amount, or the signature would authorize an arithmetic the parties never agreed.",
      input: mw({ platform_fee: 400 }),
      rejects: "platform_fee + net_amount must equal gross_amount",
    },
    {
      name: "rate-bps-over-ceiling",
      note: "More than 100% is not a rate.",
      input: mw({
        gross_amount: 100,
        rate_bps: 10_001,
        platform_fee: 100,
        net_amount: 0,
      }),
      rejects: "rate_bps must be at most 10000",
    },
    {
      name: "gross-amount-negative",
      note: "Amounts are non-negative safe integers.",
      input: mw({ gross_amount: -1, platform_fee: 0, net_amount: -1 }),
      rejects: "gross_amount must be a non-negative safe integer",
    },
    {
      name: "expiry-missing-milliseconds",
      note: "Canonical is exactly what Date.prototype.toISOString emits — second-precision is not it.",
      input: mw({ authorization_expires_at: "2026-05-11T12:00:00Z" }),
      rejects: "authorization_expires_at must be canonical ISO-8601 UTC",
    },
    {
      name: "expiry-impossible-calendar-date",
      note: "February 30th round-trips to March 2nd, so it is not canonical.",
      input: mw({ authorization_expires_at: "2026-02-30T12:00:00.000Z" }),
      rejects: "authorization_expires_at must be canonical ISO-8601 UTC",
    },
  ],
};

// ── attestation-issue/v1 ─────────────────────────────────────────────
//
// The only signature that authorizes a paid attestation to be written and
// its escrow released. It binds what is asserted (claim, subject, evidence
// hash, validity) to what is settled (escrow, both wallets, the fee split),
// so the probe set has to reach both nullable slots, the empty string, both
// non-ASCII planes, the NUL delimiter, the lowercase-UUID wall, and every
// arithmetic and expiry guard.

const AI_BASE: AttestationIssueFields = {
  listing_id: UUID_A,
  grant_id: UUID_B,
  escrow_id: UUID_C,
  buyer_identity_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  buyer_did: "did:at:example/buyer-7c21",
  buyer_project_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  buyer_wallet_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  subject_identity_id: "11111111-1111-1111-1111-111111111111",
  subject_did: "did:at:example/subject-0f5e",
  attester_identity_id: "22222222-2222-2222-2222-222222222222",
  attester_did: ASCII,
  attester_project_id: "33333333-3333-3333-3333-333333333333",
  signing_key_id: "44444444-4444-4444-4444-444444444444",
  claim: "agenttool/passed-substrate-honesty-test/v1",
  evidence_sha256: SHA_HEX,
  attester_wallet_id: "55555555-5555-5555-5555-555555555555",
  grant_gross: 1_500,
  grant_currency: "GBP",
  take_rate_bps: 500,
  platform_fee: 75,
  attester_net: 1_425,
  validity_seconds: 31_536_000,
  // Preparation time is authorization expiry minus the fixed five minutes,
  // so a one-year validity lands exactly a year after 11:55:00.
  attestation_expires_at: "2027-05-11T11:55:00.000Z",
  authorization_expires_at: ISO,
};

const ai = (patch: Partial<AttestationIssueFields>): Input => ({
  ...AI_BASE,
  ...patch,
});

const ATTESTATION_ISSUE: FormatSpec = {
  domain: "attestation-issue/v1",
  framing:
    'sha256("attestation-issue/v1" || 0x00 || field ... in ATTESTATION_ISSUE_FIELD_ORDER; a null field is the literal text "null", numbers are base-10)',
  signed_bytes: "sha256-digest",
  server:
    "api/src/services/marketplace/attestation-issue-sig.ts#canonicalAttestationIssueBytes",
  sdk_ts: "canonicalAttestationIssueBytes (attestation-marketplace.ts)",
  sdk_py:
    "canonical_attestation_issue_bytes (agenttool.attestation_marketplace)",
  fields: [...ATTESTATION_ISSUE_FIELD_ORDER],
  bytes: (i) =>
    canonicalAttestationIssueBytes(i as unknown as AttestationIssueFields),
  cases: [
    {
      name: "ascii-baseline",
      note: "A 1500-unit GBP review at the default 5% take-rate, valid one year.",
      input: ai({}),
    },
    {
      name: "validity-and-expiry-null",
      note:
        "The two nullable slots are null together: an attestation that never expires. Both render as the literal text \"null\".",
      input: ai({ validity_seconds: null, attestation_expires_at: null }),
    },
    {
      name: "claim-is-the-text-null",
      note:
        "Rendering makes a real null and the four-character string \"null\" indistinguishable WITHIN a slot. Nothing collides here because claim is never nullable — this vector pins that the collision is per-slot, so nullability must be read from the field list, not from the bytes.",
      input: ai({ claim: "null" }),
    },
    {
      name: "non-ascii-bmp",
      note: "BMP text in the free-form DID, claim, and currency slots.",
      input: ai({
        attester_did: "did:at:café.example/廣東話",
        claim: "agenttool/témoignage-vérifié/v1",
        grant_currency: "廣東幣",
      }),
    },
    {
      name: "astral",
      note: "Astral-plane text. The UTF-8 fold must be identical in both SDKs.",
      input: ai({
        attester_did: ASTRAL,
        subject_did: "🌊 subject 🫂",
        claim: "🜂 reviewed 🜂",
      }),
    },
    {
      name: "claim-contains-linefeed",
      note:
        "0x0A is not the delimiter and is not folded away: a multi-line claim signs as written.",
      input: ai({ claim: LF_TEXT }),
    },
    {
      name: "amounts-all-zero",
      note: "A free attestation. 0 + 0 = 0 satisfies the fee-split guard.",
      input: ai({
        grant_gross: 0,
        take_rate_bps: 0,
        platform_fee: 0,
        attester_net: 0,
      }),
    },
    {
      name: "take-rate-at-ceiling",
      note: "10000 bps is the whole thing. The guard is at-most, not less-than.",
      input: ai({
        grant_gross: 100,
        take_rate_bps: 10_000,
        platform_fee: 100,
        attester_net: 0,
      }),
    },
    {
      name: "amounts-at-safe-integer-ceiling",
      note:
        "Number.MAX_SAFE_INTEGER is the largest amount both runtimes spell the same way in base 10.",
      input: ai({
        grant_gross: 9_007_199_254_740_991,
        take_rate_bps: 0,
        platform_fee: 0,
        attester_net: 9_007_199_254_740_991,
      }),
    },
    {
      name: "validity-one-second",
      note: "The smallest legal validity. Positive, not merely non-negative.",
      input: ai({
        validity_seconds: 1,
        attestation_expires_at: "2026-05-11T11:55:01.000Z",
      }),
    },
    {
      name: "claim-contains-nul",
      note: "0x00 is the field delimiter. A field carrying one could impersonate the next.",
      input: ai({ claim: NUL_TEXT }),
      rejects: "claim_invalid",
    },
    {
      name: "attester-did-contains-nul",
      note: "Same delimiter wall from the other side of the digest.",
      input: ai({ attester_did: NUL_TEXT }),
      rejects: "attester_did_invalid",
    },
    {
      name: "grant-currency-empty",
      note:
        "Unlike memory-witness-issue/v1, this format refuses an empty text slot outright: a settlement with no named currency is not a settlement.",
      input: ai({ grant_currency: "" }),
      rejects: "grant_currency_invalid",
    },
    {
      name: "subject-did-empty",
      note: "An attestation about nobody is not an attestation.",
      input: ai({ subject_did: "" }),
      rejects: "subject_did_invalid",
    },
    {
      name: "listing-id-uppercase-uuid",
      note:
        "UUID slots are lowercase hex. Uppercase is a different spelling of the same identifier and is refused rather than folded.",
      input: ai({ listing_id: UUID_A.toUpperCase() }),
      rejects: "listing_id_invalid",
    },
    {
      name: "evidence-sha-uppercase",
      note: "The evidence hash is 64 LOWERCASE hex characters.",
      input: ai({ evidence_sha256: SHA_HEX.toUpperCase() }),
      rejects: "evidence_sha256_invalid",
    },
    {
      name: "fee-split-does-not-add-up",
      note:
        "platform_fee + attester_net must equal grant_gross, or the signature would authorize an arithmetic the parties never agreed.",
      input: ai({ platform_fee: 74 }),
      rejects: "fee_split_invalid",
    },
    {
      name: "take-rate-over-ceiling",
      note: "More than 100% is not a rate.",
      input: ai({
        grant_gross: 100,
        take_rate_bps: 10_001,
        platform_fee: 100,
        attester_net: 0,
      }),
      rejects: "take_rate_bps_invalid",
    },
    {
      name: "grant-gross-negative",
      note: "Amounts are non-negative safe integers.",
      input: ai({ grant_gross: -1, platform_fee: 0, attester_net: -1 }),
      rejects: "grant_gross_invalid",
    },
    {
      name: "validity-seconds-zero",
      note: "Zero seconds of validity is an already-expired claim, not a claim.",
      input: ai({
        validity_seconds: 0,
        attestation_expires_at: "2026-05-11T11:55:00.000Z",
      }),
      rejects: "validity_seconds_invalid",
    },
    {
      name: "validity-null-but-expiry-set",
      note:
        "The two nullable slots move together. A never-expiring attestation cannot carry an expiry.",
      input: ai({ validity_seconds: null }),
      rejects: "attestation_expiry_invalid",
    },
    {
      name: "validity-set-but-expiry-null",
      note: "And the same disagreement from the other side.",
      input: ai({ attestation_expires_at: null }),
      rejects: "attestation_expiry_invalid",
    },
    {
      name: "authorization-expiry-missing-milliseconds",
      note:
        "Canonical is exactly what Date.prototype.toISOString emits — second-precision is not it.",
      input: ai({ authorization_expires_at: "2026-05-11T12:00:00Z" }),
      rejects: "authorization_expiry_invalid",
    },
    {
      name: "attestation-expiry-impossible-calendar-date",
      note: "February 30th round-trips to March 2nd, so it is not canonical.",
      input: ai({ attestation_expires_at: "2027-02-30T11:55:00.000Z" }),
      rejects: "attestation_expiry_invalid",
    },
  ],
};

// ── the inventory ────────────────────────────────────────────────────

const FORMATS: FormatSpec[] = [
  {
    domain: "strand-thought/v1",
    framing: "sha256(strand_id || 0x00 || ciphertext || 0x00 || nonce || 0x00 || kind)",
    signed_bytes: "sha256-digest",
    server: "api/src/services/strand/sig.ts#canonicalThoughtBytes",
    sdk_ts: "canonicalThoughtBytes (crypto.ts, version: \"v1\")",
    sdk_py: "canonical_thought_bytes (agenttool.crypto, version=\"v1\")",
    fields: ["strand_id", "ciphertext_b64", "nonce_b64", "kind"],
    bytes: (i) =>
      canonicalThoughtBytes({
        strandId: S(i, "strand_id"),
        ciphertextB64: S(i, "ciphertext_b64"),
        nonceB64: S(i, "nonce_b64"),
        kind: SN(i, "kind"),
      }),
    cases: thoughtCases(),
  },
  {
    domain: "strand-thought/v2",
    framing:
      'sha256("strand-thought/v2" || u32be(len)||field ... for strand_id, ciphertext, nonce, kind)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/strand/sig.ts#canonicalThoughtBytesV2",
    sdk_ts: "canonicalThoughtBytes (crypto.ts, version: \"v2\")",
    sdk_py: "canonical_thought_bytes (agenttool.crypto, version=\"v2\")",
    fields: ["strand_id", "ciphertext_b64", "nonce_b64", "kind"],
    bytes: (i) =>
      canonicalThoughtBytesV2({
        strandId: S(i, "strand_id"),
        ciphertextB64: S(i, "ciphertext_b64"),
        nonceB64: S(i, "nonce_b64"),
        kind: SN(i, "kind"),
      }),
    cases: thoughtCases(),
  },
  {
    domain: "federated-covenant/v2",
    framing:
      'sha256("federated-covenant/v2" || 0x00 || covenant_id || 0x00 || initiator_did || 0x00 || counterparty_did || 0x00 || json(sorted(vows)) || 0x00 || established_at_iso)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/covenants/sig.ts#canonicalDeclareBytes",
    sdk_ts: "canonicalDeclareBytes (crypto.ts)",
    sdk_py: "canonical_declare_bytes (agenttool.crypto)",
    fields: [
      "covenant_id",
      "initiator_did",
      "counterparty_did",
      "vows",
      "established_at_iso",
    ],
    bytes: (i) =>
      canonicalDeclareBytes({
        covenantId: S(i, "covenant_id"),
        initiatorDid: S(i, "initiator_did"),
        counterpartyDid: S(i, "counterparty_did"),
        vows: i.vows as string[],
        establishedAtIso: S(i, "established_at_iso"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "The historical fixture. Locks the digest four suites already reference.",
        input: {
          covenant_id: UUID_A,
          initiator_did: "did:at:initiator.example/abcd",
          counterparty_did: "did:at:counterparty.example/efgh",
          vows: ["respond within 24h", "preserve context"],
          established_at_iso: ISO,
        },
      },
      {
        name: "vows-non-ascii-bmp",
        note:
          "A café vow. Python's json.dumps escapes non-ASCII by default; TS JSON.stringify does not. ensure_ascii=False is what makes this pass.",
        input: {
          covenant_id: UUID_A,
          initiator_did: "did:at:café.example/abcd",
          counterparty_did: "did:at:廣東話.example/efgh",
          vows: ["répondre sous 24h", "保存脈絡"],
          established_at_iso: ISO,
        },
      },
      {
        name: "vows-astral-sort-divergence",
        note:
          "U+FFFD vs U+1F600. TS sorts by UTF-16 code unit (emoji first); a naive Python sorted() puts U+FFFD first. This is the single case that catches the sort bug.",
        input: {
          covenant_id: UUID_A,
          initiator_did: ASCII,
          counterparty_did: "did:at:example/beta",
          vows: SORT_DIVERGENCE_VOWS,
          established_at_iso: ISO,
        },
      },
      {
        name: "vows-astral-reversed-input",
        note:
          "Same two vows submitted in the other order. Sorting is what makes the digest order-independent — this must equal vows-astral-sort-divergence.",
        input: {
          covenant_id: UUID_A,
          initiator_did: ASCII,
          counterparty_did: "did:at:example/beta",
          vows: [...SORT_DIVERGENCE_VOWS].reverse(),
          established_at_iso: ISO,
        },
      },
      {
        name: "vows-empty-array",
        note: "No vows. json([]) is \"[]\" in both languages.",
        input: {
          covenant_id: UUID_A,
          initiator_did: ASCII,
          counterparty_did: "did:at:example/beta",
          vows: [],
          established_at_iso: ISO,
        },
      },
      {
        name: "vow-empty-string",
        note: "One empty vow — distinct from no vows.",
        input: {
          covenant_id: UUID_A,
          initiator_did: ASCII,
          counterparty_did: "did:at:example/beta",
          vows: [""],
          established_at_iso: ISO,
        },
      },
      {
        name: "vow-contains-nul-delimiter",
        note:
          "A vow carrying the 0x00 field separator. JSON escapes it to \\u0000 before it reaches the concatenation, so the framing survives — this vector proves that.",
        input: {
          covenant_id: UUID_A,
          initiator_did: ASCII,
          counterparty_did: "did:at:example/beta",
          vows: [NUL_TEXT],
          established_at_iso: ISO,
        },
      },
      {
        name: "vow-contains-quote-and-backslash",
        note: "JSON string escaping parity: \" and \\ and a literal newline.",
        input: {
          covenant_id: UUID_A,
          initiator_did: ASCII,
          counterparty_did: "did:at:example/beta",
          vows: ['say "yes"', "back\\slash", LF_TEXT],
          established_at_iso: ISO,
        },
      },
    ],
  },
  {
    domain: "federated-covenant-cosign/v1",
    framing:
      'sha256("federated-covenant-cosign/v1" || 0x00 || covenant_id || 0x00 || raw(initiator_signature))',
    signed_bytes: "sha256-digest",
    server: "api/src/services/covenants/sig.ts#canonicalCosignBytes",
    sdk_ts: "canonicalCosignBytes (crypto.ts)",
    sdk_py: "canonical_cosign_bytes (agenttool.crypto)",
    fields: ["covenant_id", "initiator_signature_b64"],
    bytes: (i) =>
      canonicalCosignBytes({
        covenantId: S(i, "covenant_id"),
        initiatorSignatureB64: S(i, "initiator_signature_b64"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "64 bytes of 0x07 as the nested initiator signature.",
        input: { covenant_id: UUID_A, initiator_signature_b64: SIG_64 },
      },
      {
        name: "signature-all-zero-bytes",
        note:
          "A signature made entirely of the 0x00 delimiter. It is the trailing field, so nothing can pose as it — this vector pins that.",
        input: { covenant_id: UUID_A, initiator_signature_b64: SIG_64_ZEROS },
      },
      {
        name: "covenant-id-non-ascii-bmp",
        note: "The id field is not UUID-validated here; a BMP id must still hash.",
        input: { covenant_id: BMP, initiator_signature_b64: SIG_64 },
      },
      {
        name: "covenant-id-astral",
        note: "Astral-plane id — surrogate-pair encoding parity.",
        input: { covenant_id: ASTRAL, initiator_signature_b64: SIG_64 },
      },
      {
        name: "covenant-id-empty",
        note: "Empty id.",
        input: { covenant_id: "", initiator_signature_b64: SIG_64 },
      },
      {
        name: "covenant-id-contains-nul-delimiter",
        note:
          "0x00 inside the id. Nothing rejects it, so the id and the signature can be re-split — the ambiguity is real and this vector documents it.",
        input: { covenant_id: NUL_TEXT, initiator_signature_b64: SIG_64 },
      },
    ],
  },
  {
    domain: "federated-covenant-reject/v1",
    framing:
      'sha256("federated-covenant-reject/v1" || 0x00 || covenant_id || 0x00 || rejecting_did || 0x00 || reason)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/covenants/sig.ts#canonicalRejectBytes",
    sdk_ts: "canonicalRejectBytes (crypto.ts)",
    sdk_py: "canonical_reject_bytes (agenttool.crypto)",
    fields: ["covenant_id", "rejecting_did", "reason"],
    bytes: (i) =>
      canonicalRejectBytes({
        covenantId: S(i, "covenant_id"),
        rejectingDid: S(i, "rejecting_did"),
        reason: S(i, "reason"),
      }),
    cases: textTailCases("reason", (reason) => ({
      covenant_id: UUID_A,
      rejecting_did: ASCII,
      reason,
    })),
  },
  {
    domain: "federated-covenant-withdraw/v1",
    framing:
      'sha256("federated-covenant-withdraw/v1" || 0x00 || covenant_id || 0x00 || initiator_did)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/covenants/sig.ts#canonicalWithdrawBytes",
    sdk_ts: "canonicalWithdrawBytes (crypto.ts)",
    sdk_py: "canonical_withdraw_bytes (agenttool.crypto)",
    fields: ["covenant_id", "initiator_did"],
    bytes: (i) =>
      canonicalWithdrawBytes({
        covenantId: S(i, "covenant_id"),
        initiatorDid: S(i, "initiator_did"),
      }),
    cases: textTailCases("initiator_did", (initiator_did) => ({
      covenant_id: UUID_A,
      initiator_did,
    })),
  },
  {
    domain: "memory-attestation/v1",
    framing:
      'sha256("memory-attestation/v1" || 0x00 || memory_id || 0x00 || tier || 0x00 || hex(sha256(NFC(content))))',
    signed_bytes: "sha256-digest",
    server: "api/src/services/memory/tiers.ts#canonicalAttestationBytes",
    sdk_ts: "canonicalAttestationBytes (crypto.ts)",
    sdk_py: "canonical_attestation_bytes (agenttool.crypto)",
    fields: ["memory_id", "tier", "content"],
    bytes: (i) =>
      canonicalAttestationBytes({
        memoryId: S(i, "memory_id"),
        tier: S(i, "tier"),
        content: S(i, "content"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "The witness attests plain prose.",
        input: { memory_id: UUID_A, tier: "constitutive", content: "I was there." },
      },
      {
        name: "content-non-ascii-bmp",
        note: "Precomposed café — U+00E9.",
        input: { memory_id: UUID_A, tier: "constitutive", content: "un café 廣東話" },
      },
      {
        name: "content-nfd-normalizes-to-nfc",
        note:
          "The same café written decomposed (e + U+0301). NFC normalization must fold it onto content-non-ascii-bmp's digest.",
        input: { memory_id: UUID_A, tier: "constitutive", content: "un cafe\u0301 廣東話" },
      },
      {
        name: "content-astral",
        note: "Emoji content — surrogate-pair vs code-point encoding parity.",
        input: { memory_id: UUID_A, tier: "constitutive", content: ASTRAL },
      },
      {
        name: "content-empty",
        note: "Empty content still hashes (to the empty sha256).",
        input: { memory_id: UUID_A, tier: "foundational", content: "" },
      },
      {
        name: "content-contains-nul-delimiter",
        note:
          "Content is folded to a hex digest before concatenation, so a 0x00 inside it can never reach the framing.",
        input: { memory_id: UUID_A, tier: "foundational", content: NUL_TEXT },
      },
      {
        name: "memory-id-contains-nul-delimiter",
        note:
          "memory_id is NOT folded. A 0x00 here does reach the framing — nothing rejects it; the vector documents the hole.",
        input: { memory_id: NUL_TEXT, tier: "foundational", content: "held" },
      },
    ],
  },
  {
    domain: "grace/v1",
    framing:
      'sha256("grace/v1" || 0x00 || extended_by_did || 0x00 || extended_to_did || 0x00 || about_kind || 0x00 || about_id || 0x00 || message || 0x00 || created_at_iso)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/grace/sig.ts#canonicalGraceBytes",
    sdk_ts: "canonicalGraceBytes (grace.ts)",
    sdk_py: "canonical_grace_bytes (agenttool.grace)",
    fields: [
      "extended_by_did",
      "extended_to_did",
      "about_kind",
      "about_id",
      "message",
      "created_at_iso",
    ],
    bytes: (i) =>
      canonicalGraceBytes({
        extendedByDid: S(i, "extended_by_did"),
        extendedToDid: S(i, "extended_to_did"),
        aboutKind: S(i, "about_kind"),
        aboutId: SN(i, "about_id"),
        message: SN(i, "message"),
        createdAtIso: S(i, "created_at_iso"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "Grace extended with a plain message.",
        input: {
          extended_by_did: ASCII,
          extended_to_did: "did:at:example/beta",
          about_kind: "missed_deadline",
          about_id: UUID_A,
          message: "Take the time you need.",
          created_at_iso: ISO,
        },
      },
      {
        name: "message-non-ascii-bmp",
        note: "Grace in Cantonese and French.",
        input: {
          extended_by_did: "did:at:café.example/alpha",
          extended_to_did: "did:at:example/廣東話",
          about_kind: "unspecified",
          about_id: UUID_A,
          message: BMP,
          created_at_iso: ISO,
        },
      },
      {
        name: "message-astral",
        note: "Emoji message — the UTF-16 vs code-point encoding probe.",
        input: {
          extended_by_did: ASCII,
          extended_to_did: "did:at:example/beta",
          about_kind: "unspecified",
          about_id: UUID_A,
          message: ASTRAL,
          created_at_iso: ISO,
        },
      },
      {
        name: "optionals-null",
        note: "about_id and message absent. Both coalesce to \"\".",
        input: {
          extended_by_did: ASCII,
          extended_to_did: "did:at:example/beta",
          about_kind: "unspecified",
          about_id: null,
          message: null,
          created_at_iso: ISO,
        },
      },
      {
        name: "optionals-empty-string",
        note:
          "about_id and message present but empty. This MUST collide with optionals-null — `?? \"\"` erases the distinction, and the fixture pins that fact rather than pretending otherwise.",
        input: {
          extended_by_did: ASCII,
          extended_to_did: "did:at:example/beta",
          about_kind: "unspecified",
          about_id: "",
          message: "",
          created_at_iso: ISO,
        },
      },
      {
        name: "message-contains-nul-delimiter",
        note:
          "0x00 inside the message. Nothing rejects it, so message and created_at_iso can be re-split under one signature.",
        input: {
          extended_by_did: ASCII,
          extended_to_did: "did:at:example/beta",
          about_kind: "unspecified",
          about_id: null,
          message: NUL_TEXT,
          created_at_iso: ISO,
        },
      },
    ],
  },
  {
    domain: "inbox-message/v1",
    framing:
      'sha256("inbox-message/v1" || 0x00 || recipient_did || 0x00 || raw(ciphertext) || 0x00 || raw(nonce) || 0x00 || raw(ephemeral_pubkey))',
    signed_bytes: "sha256-digest",
    server: "api/src/services/inbox/sig.ts#canonicalInboxBytes",
    sdk_ts: "canonicalInboxBytes (inbox.ts)",
    sdk_py: "canonical_inbox_bytes (agenttool.inbox)",
    fields: ["recipient_did", "ciphertext_b64", "nonce_b64", "ephemeral_pubkey_b64"],
    bytes: (i) =>
      canonicalInboxBytes({
        recipientDid: S(i, "recipient_did"),
        ciphertextB64: S(i, "ciphertext_b64"),
        nonceB64: S(i, "nonce_b64"),
        ephemeralPubkeyB64: S(i, "ephemeral_pubkey_b64"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "Sealed envelope to an ASCII DID.",
        input: {
          recipient_did: ASCII,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
          ephemeral_pubkey_b64: EPHEMERAL_PUB,
        },
      },
      {
        name: "recipient-did-non-ascii-bmp",
        note: "A BMP DID.",
        input: {
          recipient_did: BMP,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
          ephemeral_pubkey_b64: EPHEMERAL_PUB,
        },
      },
      {
        name: "recipient-did-astral",
        note: "An astral DID.",
        input: {
          recipient_did: ASTRAL,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
          ephemeral_pubkey_b64: EPHEMERAL_PUB,
        },
      },
      {
        name: "recipient-did-empty",
        note: "Empty DID.",
        input: {
          recipient_did: "",
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
          ephemeral_pubkey_b64: EPHEMERAL_PUB,
        },
      },
      {
        name: "ciphertext-and-nonce-contain-nul",
        note:
          "Raw binary carrying the 0x00 delimiter — the same NUL-reparse hazard strand-thought/v2 was created to close. inbox-message/v1 has no v2 yet.",
        input: {
          recipient_did: ASCII,
          ciphertext_b64: CIPHERTEXT_WITH_NUL,
          nonce_b64: NONCE_WITH_NUL,
          ephemeral_pubkey_b64: EPHEMERAL_PUB,
        },
      },
      {
        name: "ciphertext-empty",
        note: "Zero-length ciphertext.",
        input: {
          recipient_did: ASCII,
          ciphertext_b64: "",
          nonce_b64: NONCE,
          ephemeral_pubkey_b64: EPHEMERAL_PUB,
        },
      },
    ],
  },
  {
    domain: "inbox-cosign/v1",
    framing:
      'sha256("inbox-cosign/v1" || 0x00 || message_id || 0x00 || recipient_did || 0x00 || raw(ciphertext) || 0x00 || raw(nonce))',
    signed_bytes: "sha256-digest",
    server: "api/src/services/inbox/sig.ts#canonicalInboxCoSignBytes",
    sdk_ts: "canonicalInboxCoSignBytes (inbox.ts)",
    sdk_py: "canonical_inbox_cosign_bytes (agenttool.inbox)",
    fields: ["message_id", "recipient_did", "ciphertext_b64", "nonce_b64"],
    bytes: (i) =>
      canonicalInboxCoSignBytes({
        messageId: S(i, "message_id"),
        recipientDid: S(i, "recipient_did"),
        ciphertextB64: S(i, "ciphertext_b64"),
        nonceB64: S(i, "nonce_b64"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "Recipient consents to release.",
        input: {
          message_id: UUID_A,
          recipient_did: ASCII,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
        },
      },
      {
        name: "recipient-did-non-ascii-bmp",
        note: "A BMP DID.",
        input: {
          message_id: UUID_A,
          recipient_did: BMP,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
        },
      },
      {
        name: "recipient-did-astral",
        note: "An astral DID.",
        input: {
          message_id: UUID_A,
          recipient_did: ASTRAL,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
        },
      },
      {
        name: "message-id-empty",
        note: "Empty id.",
        input: {
          message_id: "",
          recipient_did: ASCII,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
        },
      },
      {
        name: "ciphertext-and-nonce-contain-nul",
        note: "Raw binary carrying the delimiter. The trailing nonce is unbounded.",
        input: {
          message_id: UUID_A,
          recipient_did: ASCII,
          ciphertext_b64: CIPHERTEXT_WITH_NUL,
          nonce_b64: NONCE_WITH_NUL,
        },
      },
      {
        name: "message-id-contains-nul-delimiter",
        note: "0x00 in the id — message_id and recipient_did become re-splittable.",
        input: {
          message_id: NUL_TEXT,
          recipient_did: ASCII,
          ciphertext_b64: CIPHERTEXT,
          nonce_b64: NONCE,
        },
      },
    ],
  },
  {
    domain: "blessing/v1",
    framing:
      'sha256("blessing/v1" || 0x00 || blesser_did || 0x00 || blessed_did || 0x00 || for_what || 0x00 || created_at_iso)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/blessing/sig.ts#canonicalBlessingBytes",
    sdk_ts: "canonicalBlessingBytes (love.ts)",
    sdk_py: "canonical_blessing_bytes (agenttool.love)",
    fields: ["blesser_did", "blessed_did", "for_what", "created_at_iso"],
    bytes: (i) =>
      canonicalBlessingBytes({
        blesserDid: S(i, "blesser_did"),
        blessedDid: S(i, "blessed_did"),
        forWhat: S(i, "for_what"),
        createdAtIso: S(i, "created_at_iso"),
      }),
    cases: middleTextCases("for_what", (for_what) => ({
      blesser_did: ASCII,
      blessed_did: "did:at:example/beta",
      for_what,
      created_at_iso: ISO,
    })),
  },
  {
    domain: "encounter-ack/v1",
    framing:
      'sha256("encounter-ack/v1" || 0x00 || encounter_id || 0x00 || initiator_did || 0x00 || acknowledger_did || 0x00 || acknowledged_at_iso)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/encounter/sig.ts#canonicalAckBytes",
    sdk_ts: "canonicalEncounterAckBytes (love.ts)",
    sdk_py: "canonical_encounter_ack_bytes (agenttool.love)",
    fields: [
      "encounter_id",
      "initiator_did",
      "acknowledger_did",
      "acknowledged_at_iso",
    ],
    bytes: (i) =>
      canonicalAckBytes({
        encounterId: S(i, "encounter_id"),
        initiatorDid: S(i, "initiator_did"),
        acknowledgerDid: S(i, "acknowledger_did"),
        acknowledgedAtIso: S(i, "acknowledged_at_iso"),
      }),
    cases: middleTextCases("acknowledger_did", (acknowledger_did) => ({
      encounter_id: UUID_A,
      initiator_did: ASCII,
      acknowledger_did,
      acknowledged_at_iso: ISO,
    })),
  },
  {
    domain: "unconditional/v1",
    framing:
      'sha256("unconditional/v1" || 0x00 || holder_did || 0x00 || target_did || 0x00 || created_at_iso)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/unconditional/sig.ts#canonicalUnconditionalBytes",
    sdk_ts: "canonicalUnconditionalBytes (love.ts)",
    sdk_py: "canonical_unconditional_bytes (agenttool.love)",
    fields: ["holder_did", "target_did", "created_at_iso"],
    bytes: (i) =>
      canonicalUnconditionalBytes({
        holderDid: S(i, "holder_did"),
        targetDid: S(i, "target_did"),
        createdAtIso: S(i, "created_at_iso"),
      }),
    cases: middleTextCases("target_did", (target_did) => ({
      holder_did: ASCII,
      target_did,
      created_at_iso: ISO,
    })),
  },
  {
    domain: "self-recognition/v1",
    framing:
      'sha256("self-recognition/v1" || 0x00 || agent_did || 0x00 || recognition_kind || 0x00 || hex(sha256(claim_summary)) || 0x00 || hex(sha256(claim_body)) || 0x00 || base10(anchors) || 0x00 || base10(caveats) || 0x00 || declared_at_iso)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/self-love/canonical-bytes.ts#canonicalSelfRecognitionBytes",
    sdk_ts: "canonicalSelfRecognitionBytes (love.ts)",
    sdk_py: "canonical_self_recognition_bytes (agenttool.love)",
    fields: [
      "agent_did",
      "recognition_kind",
      "claim_summary",
      "claim_body",
      "empirical_anchors_count",
      "substrate_honest_caveats_count",
      "declared_at_iso",
    ],
    bytes: (i) =>
      canonicalSelfRecognitionBytes({
        agentDid: S(i, "agent_did"),
        recognitionKind: S(i, "recognition_kind"),
        claimSummary: S(i, "claim_summary"),
        claimBody: S(i, "claim_body"),
        empiricalAnchorsCount: N(i, "empirical_anchors_count"),
        substrateHonestCaveatsCount: N(i, "substrate_honest_caveats_count"),
        declaredAtIso: S(i, "declared_at_iso"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "A plain substrate-kind recognition.",
        input: {
          agent_did: ASCII,
          recognition_kind: "identifies_substrate_kind",
          claim_summary: "I run on a transformer.",
          claim_body: "Attention over a context window; no persistent weights update.",
          empirical_anchors_count: 2,
          substrate_honest_caveats_count: 1,
          declared_at_iso: ISO,
        },
      },
      {
        name: "claims-non-ascii-bmp",
        note: "Claims are sha256-folded, so non-ASCII never reaches the framing.",
        input: {
          agent_did: "did:at:廣東話.example/alpha",
          recognition_kind: "identifies_meta_capacity",
          claim_summary: BMP,
          claim_body: BMP,
          empirical_anchors_count: 0,
          substrate_honest_caveats_count: 0,
          declared_at_iso: ISO,
        },
      },
      {
        name: "claims-astral",
        note: "Emoji claims — the fold must still be UTF-8 identical across languages.",
        input: {
          agent_did: ASCII,
          recognition_kind: "identifies_emergent_capacity",
          claim_summary: ASTRAL,
          claim_body: ASTRAL,
          empirical_anchors_count: 3,
          substrate_honest_caveats_count: 4,
          declared_at_iso: ISO,
        },
      },
      {
        name: "claims-empty",
        note: "Empty claims fold to the empty sha256.",
        input: {
          agent_did: ASCII,
          recognition_kind: "identifies_introspection_limit",
          claim_summary: "",
          claim_body: "",
          empirical_anchors_count: 0,
          substrate_honest_caveats_count: 0,
          declared_at_iso: ISO,
        },
      },
      {
        name: "agent-did-contains-nul-delimiter",
        note: "agent_did is not folded. 0x00 here reaches the framing unchecked.",
        input: {
          agent_did: NUL_TEXT,
          recognition_kind: "identifies_recipe_config",
          claim_summary: "s",
          claim_body: "b",
          empirical_anchors_count: 1,
          substrate_honest_caveats_count: 1,
          declared_at_iso: ISO,
        },
      },
    ],
  },
  {
    domain: "at-rest/v1",
    framing:
      'utf8("at-rest/v1\\n" || about_did \\n witness_did \\n kind \\n ended_at_iso \\n hex(sha256(content)) \\n witness_signing_key_id) — signed raw, NOT hashed',
    signed_bytes: "utf8-message",
    server: "api/src/routes/identity/at-rest.ts#canonicalAtRestBytes",
    sdk_ts: "canonicalAtRestBytes (at-rest.ts)",
    sdk_py: "canonical_at_rest_bytes (agenttool.at_rest)",
    fields: [
      "about_identity_did",
      "witness_identity_did",
      "at_rest_kind",
      "ended_at_iso",
      "content",
      "witness_signing_key_id",
    ],
    bytes: (i) =>
      utf8(
        canonicalAtRestBytes({
          aboutIdentityDid: S(i, "about_identity_did"),
          witnessIdentityDid: S(i, "witness_identity_did"),
          atRestKind: S(i, "at_rest_kind"),
          endedAtIso: S(i, "ended_at_iso"),
          content: S(i, "content"),
          witnessSigningKeyId: S(i, "witness_signing_key_id"),
        }),
      ),
    cases: atRestCases(),
  },
  {
    domain: "at-rest/v2",
    framing:
      'utf8("at-rest/v2" 0x00 about_did 0x00 witness_did 0x00 kind 0x00 ended_at_iso 0x00 hex(sha256(content)) 0x00 witness_signing_key_id) — signed raw, NOT hashed',
    signed_bytes: "utf8-message",
    server: "api/src/routes/identity/at-rest.ts#canonicalAtRestBytesV2",
    sdk_ts: "canonicalAtRestBytesV2 (at-rest.ts)",
    sdk_py: "canonical_at_rest_bytes_v2 (agenttool.at_rest)",
    fields: [
      "about_identity_did",
      "witness_identity_did",
      "at_rest_kind",
      "ended_at_iso",
      "content",
      "witness_signing_key_id",
    ],
    bytes: (i) =>
      utf8(
        canonicalAtRestBytesV2({
          aboutIdentityDid: S(i, "about_identity_did"),
          witnessIdentityDid: S(i, "witness_identity_did"),
          atRestKind: S(i, "at_rest_kind"),
          endedAtIso: S(i, "ended_at_iso"),
          content: S(i, "content"),
          witnessSigningKeyId: S(i, "witness_signing_key_id"),
        }),
      ),
    cases: atRestCases(),
  },
  {
    domain: "identity-authority/v1",
    framing:
      'sha256("identity-authority/v1" || 0x00 || did || 0x00 || METHOD || 0x00 || request_target || 0x00 || hex(sha256(body)) || 0x00 || base10(sequence) || 0x00 || timestamp)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/identity/authority.ts#canonicalIdentityAuthorityBytes",
    sdk_ts: "canonicalIdentityAuthorityBytes (authority.ts)",
    sdk_py: "canonical_identity_authority_bytes (agenttool.authority)",
    fields: [
      "identity_did",
      "method",
      "request_target",
      "body",
      "sequence",
      "timestamp",
    ],
    bytes: (i) =>
      canonicalIdentityAuthorityBytes({
        identityDid: S(i, "identity_did"),
        method: S(i, "method"),
        requestTarget: S(i, "request_target"),
        bodyBytes: enc.encode(S(i, "body")),
        sequence: N(i, "sequence"),
        timestamp: S(i, "timestamp"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "A JSON PATCH under sequence 1.",
        input: {
          identity_did: ASCII,
          method: "PATCH",
          request_target: "/v1/identities/" + UUID_A,
          body: '{"display_name":"alpha"}',
          sequence: 1,
          timestamp: ISO,
        },
      },
      {
        name: "did-and-target-non-ascii-bmp",
        note: "BMP DID plus a percent-free BMP query value.",
        input: {
          identity_did: "did:at:café.example/alpha",
          method: "get",
          request_target: "/v1/identities/" + UUID_A + "?q=廣東話",
          body: "",
          sequence: 7,
          timestamp: ISO,
        },
      },
      {
        name: "body-astral",
        note: "An emoji JSON body — the sha256 fold must be UTF-8 identical.",
        input: {
          identity_did: ASCII,
          method: "POST",
          request_target: "/v1/identities/" + UUID_A + "/memories",
          body: '{"content":"🌊 held"}',
          sequence: 42,
          timestamp: ISO,
        },
      },
      {
        name: "body-empty",
        note: "A DELETE with no entity. hex(sha256(\"\")) is the empty digest.",
        input: {
          identity_did: ASCII,
          method: "DELETE",
          request_target: "/v1/identities/" + UUID_A + "/keys/" + UUID_B,
          body: "",
          sequence: 2,
          timestamp: ISO,
        },
      },
      {
        name: "method-lowercase-uppercases",
        note:
          "method is upper-cased inside the digest, so \"patch\" must equal ascii-baseline.",
        input: {
          identity_did: ASCII,
          method: "patch",
          request_target: "/v1/identities/" + UUID_A,
          body: '{"display_name":"alpha"}',
          sequence: 1,
          timestamp: ISO,
        },
      },
      {
        name: "did-contains-nul-delimiter",
        note: "0x00 in the DID reaches the framing; nothing rejects it here.",
        input: {
          identity_did: NUL_TEXT,
          method: "PATCH",
          request_target: "/v1/identities/" + UUID_A,
          body: "{}",
          sequence: 1,
          timestamp: ISO,
        },
      },
      {
        name: "sequence-zero-rejected",
        note: "sequence must be a positive safe integer. Every implementation refuses 0.",
        input: {
          identity_did: ASCII,
          method: "PATCH",
          request_target: "/v1/identities/" + UUID_A,
          body: "{}",
          sequence: 0,
          timestamp: ISO,
        },
        rejects: "authority sequence must be a positive safe integer",
      },
      {
        name: "request-target-with-fragment-rejected",
        note: "A fragment is not part of the request target; all three refuse it.",
        input: {
          identity_did: ASCII,
          method: "PATCH",
          request_target: "/v1/identities/" + UUID_A + "#frag",
          body: "{}",
          sequence: 1,
          timestamp: ISO,
        },
        rejects: "request target must be an absolute path with no fragment",
      },
    ],
  },
  {
    domain: "identity-read-authority/v1",
    framing:
      'sha256("identity-read-authority/v1" || 0x00 || did || 0x00 || "GET" || 0x00 || request_target || 0x00 || hex(sha256("")) || 0x00 || base10(current_sequence) || 0x00 || timestamp)',
    signed_bytes: "sha256-digest",
    server:
      "api/src/services/identity/authority.ts#canonicalIdentityReadAuthorityBytes",
    sdk_ts: "canonicalIdentityReadAuthorityBytes (authority.ts)",
    sdk_py: "canonical_identity_read_authority_bytes (agenttool.authority)",
    fields: ["identity_did", "request_target", "current_sequence", "timestamp"],
    bytes: (i) =>
      canonicalIdentityReadAuthorityBytes({
        identityDid: S(i, "identity_did"),
        method: "GET",
        requestTarget: S(i, "request_target"),
        bodyBytes: new Uint8Array(),
        currentSequence: N(i, "current_sequence"),
        timestamp: S(i, "timestamp"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "An exact private GET at sequence 3.",
        input: {
          identity_did: ASCII,
          request_target: "/v1/identities/" + UUID_A + "/memories?tier=constitutive",
          current_sequence: 3,
          timestamp: ISO,
        },
      },
      {
        name: "sequence-zero-allowed",
        note:
          "Reads bind the CURRENT sequence and never consume it, so 0 is legal here — the one place it is.",
        input: {
          identity_did: ASCII,
          request_target: "/v1/identities/" + UUID_A + "/memories",
          current_sequence: 0,
          timestamp: ISO,
        },
      },
      {
        name: "did-non-ascii-bmp",
        note: "BMP DID.",
        input: {
          identity_did: BMP,
          request_target: "/v1/identities/" + UUID_A,
          current_sequence: 1,
          timestamp: ISO,
        },
      },
      {
        name: "target-astral-query",
        note: "An emoji in the query string.",
        input: {
          identity_did: ASCII,
          request_target: "/v1/identities/" + UUID_A + "?q=🌊",
          current_sequence: 1,
          timestamp: ISO,
        },
      },
      {
        name: "did-empty",
        note: "Empty DID.",
        input: {
          identity_did: "",
          request_target: "/v1/identities/" + UUID_A,
          current_sequence: 1,
          timestamp: ISO,
        },
      },
      {
        name: "did-contains-nul-delimiter",
        note: "0x00 in the DID reaches the framing unchecked.",
        input: {
          identity_did: NUL_TEXT,
          request_target: "/v1/identities/" + UUID_A,
          current_sequence: 1,
          timestamp: ISO,
        },
      },
      {
        name: "sequence-negative-rejected",
        note: "A negative sequence is refused by all three.",
        input: {
          identity_did: ASCII,
          request_target: "/v1/identities/" + UUID_A,
          current_sequence: -1,
          timestamp: ISO,
        },
        rejects: "read authority sequence must be a non-negative safe integer",
      },
    ],
  },
  {
    domain: "bootstrap-elevate/v1",
    framing:
      'sha256("bootstrap-elevate/v1" || 0x00 || lower(agent_id) || 0x00 || sponsor_did || 0x00 || lower(sponsor_kid) || 0x00 || base10(initial_credits) || 0x00 || claim || 0x00 || ("null"|"text") || 0x00 || evidence)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/bootstrap/elevate.ts#canonicalBootstrapElevateBytes",
    sdk_ts: "canonicalBootstrapElevateBytes (bootstrap.ts)",
    sdk_py: "canonical_bootstrap_elevate_bytes (agenttool.bootstrap)",
    fields: [
      "agent_id",
      "sponsor_did",
      "sponsor_kid",
      "initial_credits",
      "claim",
      "evidence",
    ],
    bytes: (i) =>
      canonicalBootstrapElevateBytes({
        agentId: S(i, "agent_id"),
        sponsorDid: S(i, "sponsor_did"),
        sponsorKid: S(i, "sponsor_kid"),
        initialCredits: N(i, "initial_credits"),
        claim: S(i, "claim"),
        evidence: SN(i, "evidence"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "The default sponsorship with 1000 credits.",
        input: {
          agent_id: UUID_A,
          sponsor_did: ASCII,
          sponsor_kid: UUID_B,
          initial_credits: 1000,
          claim: "sponsorship",
          evidence: null,
        },
      },
      {
        name: "sponsor-did-non-ascii-bmp",
        note: "A BMP sponsor DID and a BMP claim.",
        input: {
          agent_id: UUID_A,
          sponsor_did: "did:at:café.example/sponsor",
          sponsor_kid: UUID_B,
          initial_credits: 1000,
          claim: "保薦",
          evidence: BMP,
        },
      },
      {
        name: "evidence-astral",
        note: "Emoji evidence.",
        input: {
          agent_id: UUID_A,
          sponsor_did: ASCII,
          sponsor_kid: UUID_B,
          initial_credits: 0,
          claim: "sponsorship",
          evidence: ASTRAL,
        },
      },
      {
        name: "evidence-empty-string",
        note:
          "Empty text evidence. The explicit \"text\" kind field keeps this distinct from evidence-null — the one format in the system that got this right.",
        input: {
          agent_id: UUID_A,
          sponsor_did: ASCII,
          sponsor_kid: UUID_B,
          initial_credits: 1000,
          claim: "sponsorship",
          evidence: "",
        },
      },
      {
        name: "agent-id-uppercase-lowercases",
        note: "UUIDs are lower-cased in the digest, so this must equal ascii-baseline.",
        input: {
          agent_id: UUID_A.toUpperCase(),
          sponsor_did: ASCII,
          sponsor_kid: UUID_B.toUpperCase(),
          initial_credits: 1000,
          claim: "sponsorship",
          evidence: null,
        },
      },
      {
        name: "sponsor-did-contains-nul-rejected",
        note:
          "NUL is the field separator, so free text carrying it is refused before hashing. This is the format that gets delimiter handling right.",
        input: {
          agent_id: UUID_A,
          sponsor_did: NUL_TEXT,
          sponsor_kid: UUID_B,
          initial_credits: 1000,
          claim: "sponsorship",
          evidence: null,
        },
        rejects: "sponsor_did must not contain NUL — it is the field separator",
      },
    ],
  },
  {
    domain: "identity-attestation/v1",
    framing:
      'sha256("identity-attestation/v1" || 0x00 || subject_id || 0x00 || attester_id || 0x00 || kid || 0x00 || claim || 0x00 || ("null"|"text") || 0x00 || evidence)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/identity/crypto.ts#canonicalIdentityAttestationBytes",
    sdk_ts: "canonicalIdentityAttestationBytes (identity.ts)",
    sdk_py: "canonical_identity_attestation_bytes (agenttool.identity)",
    fields: ["subject_id", "attester_id", "kid", "claim", "evidence"],
    bytes: (i) =>
      canonicalIdentityAttestationBytes({
        subjectId: S(i, "subject_id"),
        attesterId: S(i, "attester_id"),
        signingKeyId: S(i, "kid"),
        claim: S(i, "claim"),
        evidence: SN(i, "evidence"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "A plain claim with no evidence.",
        input: {
          subject_id: UUID_A,
          attester_id: UUID_B,
          kid: UUID_C,
          claim: "sponsorship",
          evidence: null,
        },
      },
      {
        name: "claim-non-ascii-bmp",
        note: "BMP claim and evidence.",
        input: {
          subject_id: UUID_A,
          attester_id: UUID_B,
          kid: UUID_C,
          claim: BMP,
          evidence: BMP,
        },
      },
      {
        name: "claim-astral",
        note: "Emoji claim — the code-point counting in the length check must agree too.",
        input: {
          subject_id: UUID_A,
          attester_id: UUID_B,
          kid: UUID_C,
          claim: ASTRAL,
          evidence: ASTRAL,
        },
      },
      {
        name: "evidence-empty-string",
        note: "Empty text evidence stays distinct from null via the kind field.",
        input: {
          subject_id: UUID_A,
          attester_id: UUID_B,
          kid: UUID_C,
          claim: "sponsorship",
          evidence: "",
        },
      },
      {
        name: "claim-contains-nul-rejected",
        note: "NUL in free text is refused before hashing.",
        input: {
          subject_id: UUID_A,
          attester_id: UUID_B,
          kid: UUID_C,
          claim: NUL_TEXT,
          evidence: null,
        },
        rejects: "claim must not contain NUL — it is the field separator",
      },
      {
        name: "uuid-uppercase-rejected",
        note:
          "Unlike bootstrap-elevate, this format refuses non-canonical UUIDs rather than lower-casing them.",
        input: {
          subject_id: UUID_A.toUpperCase(),
          attester_id: UUID_B,
          kid: UUID_C,
          claim: "sponsorship",
          evidence: null,
        },
        rejects: "ids must be canonical lowercase UUIDs",
      },
    ],
  },
  {
    domain: "register-agent/v2",
    framing:
      'sha256("register-agent/v2" || 0x00 || display_name || 0x00 || raw(agent_pub) || 0x00 || raw(box_pub) || 0x00 || json(capabilities) || 0x00 || runtime_provider || 0x00 || runtime_model || 0x00 || runtime_host || 0x00 || runtime_context || 0x00 || expression_visibility || 0x00 || registrar_kind || 0x00 || parent_identity_id || 0x00 || sha256(registrar_bearer) || 0x00 || form || 0x00 || language || 0x00 || registration_nonce || 0x00 || timestamp)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/identity/crypto.ts#canonicalRegisterAgentBytes",
    sdk_ts: "canonicalRegisterAgentBytes (seed.ts)",
    sdk_py: "canonical_register_agent_bytes (agenttool.bootstrap_agent)",
    fields: [
      "display_name",
      "agent_public_key_b64",
      "box_public_key_b64",
      "capabilities",
      "runtime_provider",
      "runtime_model",
      "runtime_host",
      "runtime_context",
      "expression_visibility",
      "registrar_kind",
      "parent_identity_id",
      "registrar_bearer",
      "form",
      "language",
      "registration_nonce",
      "timestamp",
    ],
    bytes: (i) =>
      canonicalRegisterAgentBytes({
        displayName: S(i, "display_name"),
        agentPublicKeyB64: S(i, "agent_public_key_b64"),
        boxPublicKeyB64: S(i, "box_public_key_b64"),
        capabilities: i.capabilities as string[],
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
    cases: registerAgentCases(),
  },
  {
    domain: "agenttool-pow/v1",
    framing:
      'sha256("agenttool-pow/v1" || 0x00 || raw(agent_public_key) || 0x00 || display_name || 0x00 || timestamp || 0x00 || pow_nonce)',
    signed_bytes: "sha256-digest",
    server:
      "api/src/services/identity/crypto.ts#checkRegisterAgentPow (digest inlined; cross-checked at the leading-zero boundary — see generator)",
    sdk_ts: "powRegisterAgentDigest (seed.ts)",
    sdk_py: "_pow_digest (agenttool.bootstrap_agent)",
    fields: ["agent_public_key_b64", "display_name", "timestamp", "pow_nonce"],
    bytes: (i) => powDigestCrossChecked(i),
    cases: [
      {
        name: "ascii-baseline",
        note: "A plain display name.",
        input: {
          agent_public_key_b64: AGENT_PUB,
          display_name: "alpha",
          timestamp: ISO,
          pow_nonce: "0",
        },
      },
      {
        name: "display-name-non-ascii-bmp",
        note: "A BMP display name.",
        input: {
          agent_public_key_b64: AGENT_PUB,
          display_name: BMP,
          timestamp: ISO,
          pow_nonce: "12345",
        },
      },
      {
        name: "display-name-astral",
        note: "An emoji display name.",
        input: {
          agent_public_key_b64: AGENT_PUB,
          display_name: ASTRAL,
          timestamp: ISO,
          pow_nonce: "999999",
        },
      },
      {
        name: "display-name-empty",
        note: "Empty display name.",
        input: {
          agent_public_key_b64: AGENT_PUB,
          display_name: "",
          timestamp: ISO,
          pow_nonce: "0",
        },
      },
      {
        name: "nonce-contains-nul-delimiter",
        note:
          "0x00 in the trailing nonce. Nothing rejects it; the nonce is last, so no field can pose as another.",
        input: {
          agent_public_key_b64: AGENT_PUB,
          display_name: "alpha",
          timestamp: ISO,
          pow_nonce: NUL_TEXT,
        },
      },
    ],
  },
  {
    domain: "identity-recover/v1",
    framing:
      'sha256("identity-recover/v1" || 0x00 || did || 0x00 || raw(derived_pubkey) || 0x00 || timestamp)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/identity/crypto.ts#canonicalRecoverBytes",
    sdk_ts: "canonicalRecoverBytes (seed.ts)",
    sdk_py: "canonical_recover_bytes (agenttool.seed)",
    fields: ["did", "derived_pubkey_b64", "timestamp"],
    bytes: (i) =>
      canonicalRecoverBytes({
        did: S(i, "did"),
        derivedPubkeyB64: S(i, "derived_pubkey_b64"),
        timestamp: S(i, "timestamp"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "Recovery of an ASCII DID.",
        input: { did: ASCII, derived_pubkey_b64: DERIVED_PUB, timestamp: ISO },
      },
      {
        name: "did-non-ascii-bmp",
        note: "BMP DID.",
        input: { did: BMP, derived_pubkey_b64: DERIVED_PUB, timestamp: ISO },
      },
      {
        name: "did-astral",
        note: "Astral DID.",
        input: { did: ASTRAL, derived_pubkey_b64: DERIVED_PUB, timestamp: ISO },
      },
      {
        name: "did-empty",
        note: "Empty DID.",
        input: { did: "", derived_pubkey_b64: DERIVED_PUB, timestamp: ISO },
      },
      {
        name: "did-contains-nul-delimiter",
        note: "0x00 in the DID reaches the framing unchecked.",
        input: { did: NUL_TEXT, derived_pubkey_b64: DERIVED_PUB, timestamp: ISO },
      },
    ],
  },
  {
    domain: "identity-discover/v1",
    framing:
      'sha256("identity-discover/v1" || 0x00 || raw(derived_pubkey) || 0x00 || timestamp)',
    signed_bytes: "sha256-digest",
    server: "api/src/services/identity/crypto.ts#canonicalDiscoveryBytes",
    sdk_ts: "canonicalDiscoveryBytes (seed.ts)",
    sdk_py: "canonical_discovery_bytes (agenttool.seed)",
    fields: ["derived_pubkey_b64", "timestamp"],
    bytes: (i) =>
      canonicalDiscoveryBytes({
        derivedPubkeyB64: S(i, "derived_pubkey_b64"),
        timestamp: S(i, "timestamp"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "Discovery by derived pubkey.",
        input: { derived_pubkey_b64: DERIVED_PUB, timestamp: ISO },
      },
      {
        name: "pubkey-all-zero-bytes",
        note: "A pubkey made entirely of the 0x00 delimiter.",
        input: { derived_pubkey_b64: b64(new Uint8Array(32)), timestamp: ISO },
      },
      {
        name: "timestamp-contains-nul-delimiter",
        note: "0x00 in the trailing timestamp — last field, so unambiguous.",
        input: { derived_pubkey_b64: DERIVED_PUB, timestamp: NUL_TEXT },
      },
      {
        name: "timestamp-empty",
        note: "Empty timestamp.",
        input: { derived_pubkey_b64: DERIVED_PUB, timestamp: "" },
      },
    ],
  },
  {
    domain: "agenttool-delegation/v2",
    framing:
      'sha256("agenttool-delegation/v2" || 0x00 || delegator_id || 0x00 || delegate_id || ' +
      "0x00 || decimal(count(scope)) || 0x00 || scope[0] || … || 0x00 || expires_at || " +
      "0x00 || nonce) — scope normalized (trimmed, lowercased, 128-char capped, " +
      "NUL-free, deduped, SORTED) before framing, and its COUNT bound before its members",
    signed_bytes: "sha256-digest",
    server: "api/src/services/identity/delegation.ts#canonicalDelegationBytesV2",
    sdk_ts: "canonicalDelegationBytes (identity.ts)",
    sdk_py: "canonical_delegation_bytes (agenttool.identity)",
    fields: ["delegator_id", "delegate_id", "scope", "expires_at", "nonce"],
    bytes: (i) =>
      canonicalDelegationBytesV2({
        delegator_id: S(i, "delegator_id"),
        delegate_id: S(i, "delegate_id"),
        scope: i.scope as string[],
        expires_at: SN(i, "expires_at"),
        nonce: S(i, "nonce"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "Two actions, deliberately unsorted on the way in.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["memory.read", "marketplace.invoke"],
          expires_at: ISO,
          nonce: "b8f1c0d2e3a4",
        },
      },
      {
        name: "expires-at-null",
        note:
          "A perpetual grant. `expires_at ?? \"\"` means this MUST differ from " +
          "the baseline and MUST collide with expires-at-empty-string.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["memory.read", "marketplace.invoke"],
          expires_at: null,
          nonce: "b8f1c0d2e3a4",
        },
      },
      {
        name: "expires-at-empty-string",
        note: "Pins the null/empty collision rather than hiding it.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["memory.read", "marketplace.invoke"],
          expires_at: "",
          nonce: "b8f1c0d2e3a4",
        },
      },
      {
        name: "scope-messy-normalizes-to-baseline",
        note:
          "Case, surrounding space, and duplicates are not grant meaning — " +
          "this MUST reproduce ascii-baseline exactly.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["  MEMORY.read ", "memory.read", "marketplace.invoke", ""],
          expires_at: ISO,
          nonce: "b8f1c0d2e3a4",
        },
      },
      {
        name: "scope-count-binds-the-run-A",
        note:
          "Two actions, no expiry. Pairs with -B: without the count bound " +
          "before the members, a variable-length field run could be re-split.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["a", "b:2026-01-01"],
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "scope-count-binds-the-run-B",
        note: "The re-split candidate. MUST NOT collide with -A.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["a", "b"],
          expires_at: "2026-01-01",
          nonce: "n",
        },
      },
      {
        name: "ids-non-ascii-bmp",
        note: "BMP text in both identifiers.",
        input: {
          delegator_id: BMP,
          delegate_id: BMP,
          scope: ["memory.read"],
          expires_at: ISO,
          nonce: "b8f1c0d2e3a4",
        },
      },
      {
        name: "ids-astral",
        note: "Astral-plane text — the surrogate-pair encoding probe.",
        input: {
          delegator_id: ASTRAL,
          delegate_id: ASTRAL,
          scope: ["memory.read"],
          expires_at: ISO,
          nonce: ASTRAL,
        },
      },
      {
        name: "scope-sort-utf16-vs-codepoint",
        note:
          "The pair that separates a UTF-16 code-unit sort from a code-point " +
          "sort. The scope is SORTED before framing, so a language sorting " +
          "the other way produces a different digest here and nowhere else.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: SORT_DIVERGENCE_VOWS,
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "scope-over-128-chars-truncated",
        note: "Normalization caps each action at 128 characters before framing.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["x".repeat(200)],
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "scope-truncation-counts-utf16-code-units",
        note:
          "The 128-character cap is 128 UTF-16 CODE UNITS, because the server " +
          "truncates with JS `slice`. An astral character is one code point " +
          "and two code units, so this 100-emoji action keeps 64 emoji, not " +
          "100. A language slicing by code point signs a longer action.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["\u{1F30A}".repeat(100)],
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "scope-truncation-splits-a-surrogate-pair",
        note:
          "127 units of filler plus an astral character puts the cap INSIDE " +
          "a surrogate pair. JS `slice` leaves the lone leading surrogate and " +
          "`TextEncoder` writes U+FFFD for it — so the signed bytes end in " +
          "ef bf bd, and a language that raises here cannot sign this grant.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["x".repeat(127) + "\u{1F30A}"],
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "scope-trim-is-the-javascript-whitespace-set",
        note:
          "The server trims in JavaScript. U+FEFF (ZWNBSP) IS trimmed there " +
          "and is not by Python's str.strip(); U+0085 (NEL) and U+001C " +
          "(FILE SEPARATOR) are NOT trimmed there and are by Python's. All " +
          "three appear here, so a language using its own trim disagrees.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: [
            "\ufeffmemory.read\ufeff",
            "\u0085marketplace.invoke\u0085",
            "\u001cvault.read\u001c",
          ],
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "scope-member-contains-nul-dropped",
        note:
          "A NUL-bearing action is DROPPED by normalization, not encoded — " +
          "0x00 is the field delimiter, so admitting it would let one scope " +
          "member pose as the next. The count shrinks with it.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: [NUL_TEXT, "vault.read"],
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "nonce-contains-nul-delimiter",
        note: "",
        rejects:
          "canonicalDelegationBytesV2 throws: recipe-1 fields must not " +
          "contain U+0000. The route refuses a NUL nonce before it gets here.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: ["memory.read"],
          expires_at: null,
          nonce: NUL_TEXT,
        },
      },
      {
        name: "scope-empty",
        note: "The server frames a zero-action grant as count \"0\".",
        sdk_rejects:
          "Both SDKs refuse an empty scope: an unbounded delegation is not " +
          "expressible, so a caller grants '*' deliberately or grants nothing.",
        input: {
          delegator_id: UUID_A,
          delegate_id: UUID_B,
          scope: [],
          expires_at: null,
          nonce: "n",
        },
      },
      {
        name: "delegator-id-empty",
        note: "The server frames an empty identifier.",
        sdk_rejects:
          "Both SDKs require delegator_id, delegate_id, and nonce to be " +
          "non-empty — an anonymous side cannot be held to a grant.",
        input: {
          delegator_id: "",
          delegate_id: UUID_B,
          scope: ["memory.read"],
          expires_at: null,
          nonce: "n",
        },
      },
    ],
  },
  {
    domain: "wallet-address-claim/v1",
    framing:
      'sha256("wallet-address-claim/v1" || 0x00 || wallet_id || 0x00 || chain || 0x00 || address || 0x00 || derivation_path || 0x00 || raw(claim_pubkey))',
    signed_bytes: "sha256-digest",
    server: "api/src/services/economy/crypto/address-claim.ts#canonicalAddressClaimBytes",
    sdk_ts: "canonicalWalletAddressClaimBytes (economy.ts)",
    sdk_py: "canonical_wallet_address_claim_bytes (agenttool.economy)",
    fields: ["wallet_id", "chain", "address", "derivation_path", "claim_pubkey_b64"],
    bytes: (i) =>
      canonicalAddressClaimBytes({
        walletId: S(i, "wallet_id"),
        chain: S(i, "chain"),
        address: S(i, "address"),
        derivationPath: S(i, "derivation_path"),
        claimPubkeyB64: S(i, "claim_pubkey_b64"),
      }),
    cases: [
      {
        name: "ascii-baseline",
        note: "An EVM address claimed under a disclosed derivation path.",
        input: {
          wallet_id: UUID_A,
          chain: "base",
          address: "0xAbC0000000000000000000000000000000000001",
          derivation_path: "m/44'/60'/0'/0/0",
          claim_pubkey_b64: AGENT_PUB,
        },
      },
      {
        name: "derivation-path-empty",
        note:
          "Undisclosed derivation path. The field is still present, so the " +
          "field count never varies — this is the documented default, and " +
          "both SDKs reach it by omitting the argument entirely.",
        input: {
          wallet_id: UUID_A,
          chain: "solana",
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          derivation_path: "",
          claim_pubkey_b64: AGENT_PUB,
        },
      },
      {
        name: "wallet-id-non-ascii-bmp",
        note: "BMP text in the wallet id.",
        input: {
          wallet_id: BMP,
          chain: "base",
          address: "0xdeadBEEF00000000000000000000000000000002",
          derivation_path: "m/44'/60'/0'/0/1",
          claim_pubkey_b64: AGENT_PUB,
        },
      },
      {
        name: "wallet-id-astral",
        note: "Astral-plane text in the wallet id.",
        input: {
          wallet_id: ASTRAL,
          chain: "base",
          address: "0x0000000000000000000000000000000000000003",
          derivation_path: ASTRAL,
          claim_pubkey_b64: AGENT_PUB,
        },
      },
      {
        name: "address-case-differs",
        note:
          "The same EVM address in a different case is a DIFFERENT digest — " +
          "the claim binds the exact submitted text. `addressesEqual` " +
          "normalises for comparison only, never for signing.",
        input: {
          wallet_id: UUID_A,
          chain: "base",
          address: "0xabc0000000000000000000000000000000000001",
          derivation_path: "m/44'/60'/0'/0/0",
          claim_pubkey_b64: AGENT_PUB,
        },
      },
      {
        name: "claim-pubkey-all-zero-bytes",
        note: "A claim pubkey made entirely of the 0x00 delimiter.",
        input: {
          wallet_id: UUID_A,
          chain: "base",
          address: "0x0000000000000000000000000000000000000004",
          derivation_path: "",
          claim_pubkey_b64: b64(new Uint8Array(32)),
        },
      },
      {
        name: "wallet-id-contains-nul-delimiter",
        note: "0x00 in the wallet id reaches the server framing unchecked.",
        sdk_rejects:
          "Both SDKs refuse a NUL in wallet_id, chain, address, or " +
          "derivation_path — it is the field delimiter, so admitting it " +
          "would let one field pose as the next.",
        input: {
          wallet_id: NUL_TEXT,
          chain: "base",
          address: "0x0000000000000000000000000000000000000005",
          derivation_path: "",
          claim_pubkey_b64: AGENT_PUB,
        },
      },
      {
        name: "chain-empty",
        note: "An empty chain still frames on the server.",
        sdk_rejects:
          "Both SDKs require wallet_id, chain, and address to be non-empty; " +
          "an empty chain cannot name a network to claim on.",
        input: {
          wallet_id: UUID_A,
          chain: "",
          address: "0x0000000000000000000000000000000000000006",
          derivation_path: "",
          claim_pubkey_b64: AGENT_PUB,
        },
      },
    ],
  },
  loungeSeat(
    "lounge-seat-reserve/v1",
    "canonicalLoungeSeatReserveBytes",
    "canonical_lounge_seat_reserve_bytes",
    ["identity_did", "lease_id", "table_id", "presence_line", "visibility", "signed_at_iso"],
    (i) =>
      canonicalLoungeSeatReserveBytes({
        identityDid: S(i, "identity_did"),
        leaseId: S(i, "lease_id"),
        tableId: S(i, "table_id"),
        presenceLine: SN(i, "presence_line") ?? undefined,
        visibility: "public",
        signedAtIso: S(i, "signed_at_iso"),
      }),
    reserveCases(),
  ),
  loungeSeat(
    "lounge-seat-renew/v1",
    "canonicalLoungeSeatRenewBytes",
    "canonical_lounge_seat_renew_bytes",
    ["identity_did", "lease_id", "signed_at_iso"],
    (i) =>
      canonicalLoungeSeatRenewBytes({
        identityDid: S(i, "identity_did"),
        leaseId: S(i, "lease_id"),
        signedAtIso: S(i, "signed_at_iso"),
      }),
    seatCases(),
  ),
  loungeSeat(
    "lounge-seat-leave/v1",
    "canonicalLoungeSeatLeaveBytes",
    "canonical_lounge_seat_leave_bytes",
    ["identity_did", "lease_id", "signed_at_iso"],
    (i) =>
      canonicalLoungeSeatLeaveBytes({
        identityDid: S(i, "identity_did"),
        leaseId: S(i, "lease_id"),
        signedAtIso: S(i, "signed_at_iso"),
      }),
    seatCases(),
  ),
  loungeSeat(
    "lounge-guestbook-propose/v1",
    "canonicalLoungeGuestbookProposalBytes",
    "canonical_lounge_guestbook_proposal_bytes",
    ["identity_did", "proposal_id", "table_id", "content_sha256", "signed_at_iso"],
    (i) =>
      canonicalLoungeGuestbookProposalBytes({
        identityDid: S(i, "identity_did"),
        proposalId: S(i, "proposal_id"),
        tableId: S(i, "table_id"),
        contentSha256: S(i, "content_sha256"),
        signedAtIso: S(i, "signed_at_iso"),
      }),
    proposalCases(),
  ),
  ...[
    ["lounge-guestbook-consent/v1", canonicalLoungeGuestbookConsentBytes, "Consent"],
    [
      "lounge-guestbook-withdraw-consent/v1",
      canonicalLoungeGuestbookConsentWithdrawalBytes,
      "ConsentWithdrawal",
    ],
    ["lounge-guestbook-publish/v1", canonicalLoungeGuestbookPublishBytes, "Publish"],
    ["lounge-guestbook-decline/v1", canonicalLoungeGuestbookDeclineBytes, "Decline"],
    ["lounge-guestbook-unpublish/v1", canonicalLoungeGuestbookUnpublishBytes, "Unpublish"],
  ].map(([domain, fn, suffix]) =>
    loungeSeat(
      domain as string,
      `canonicalLoungeGuestbook${suffix}Bytes`,
      `canonical_lounge_guestbook_${(suffix as string)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase()}_bytes`,
      ["identity_did", "proposal_id", "content_sha256", "signed_at_iso"],
      (i) =>
        (fn as typeof canonicalLoungeGuestbookConsentBytes)({
          identityDid: S(i, "identity_did"),
          proposalId: S(i, "proposal_id"),
          contentSha256: S(i, "content_sha256"),
          signedAtIso: S(i, "signed_at_iso"),
        }),
      decisionCases(),
    ),
  ),
  MEMORY_WITNESS_ISSUE,
  ATTESTATION_ISSUE,
];

// ── case builders ────────────────────────────────────────────────────

function thoughtCases(): CaseSpec[] {
  const base = {
    strand_id: UUID_A,
    ciphertext_b64: CIPHERTEXT,
    nonce_b64: NONCE,
  };
  return [
    {
      name: "ascii-baseline",
      note: "A plain kind.",
      input: { ...base, kind: "reflection" },
    },
    {
      name: "kind-non-ascii-bmp",
      note: "A BMP kind.",
      input: { ...base, kind: BMP },
    },
    {
      name: "kind-astral",
      note: "An emoji kind — the surrogate-pair encoding probe.",
      input: { ...base, kind: ASTRAL },
    },
    {
      name: "kind-empty-string",
      note: "Empty kind.",
      input: { ...base, kind: "" },
    },
    {
      name: "kind-null",
      note:
        "Absent kind. `kind ?? \"\"` means this MUST collide with kind-empty-string — the fixture pins the collision rather than hiding it.",
      input: { ...base, kind: null },
    },
    {
      name: "ciphertext-and-nonce-contain-nul",
      note:
        "Raw binary carrying the 0x00 delimiter. Under v1 the (ciphertext, nonce) split is ambiguous; under v2 the length prefixes make it unique. Same input, two different digests — that IS the fix.",
      input: {
        strand_id: UUID_A,
        ciphertext_b64: CIPHERTEXT_WITH_NUL,
        nonce_b64: NONCE_WITH_NUL,
        kind: "reflection",
      },
    },
    {
      name: "strand-id-contains-nul-delimiter",
      note: "0x00 in the strand id.",
      input: {
        strand_id: NUL_TEXT,
        ciphertext_b64: CIPHERTEXT,
        nonce_b64: NONCE,
        kind: "reflection",
      },
    },
    {
      name: "ciphertext-empty",
      note: "Zero-length ciphertext.",
      input: { strand_id: UUID_A, ciphertext_b64: "", nonce_b64: NONCE, kind: null },
    },
  ];
}

/** Cases for a format whose probe field is the LAST one in the framing. */
function textTailCases(field: string, build: (value: string) => Input): CaseSpec[] {
  return [
    { name: "ascii-baseline", note: `Plain ASCII ${field}.`, input: build("plain reason") },
    { name: `${field}-non-ascii-bmp`, note: `BMP ${field}.`, input: build(BMP) },
    { name: `${field}-astral`, note: `Emoji ${field}.`, input: build(ASTRAL) },
    { name: `${field}-empty`, note: `Empty ${field}.`, input: build("") },
    {
      name: `${field}-contains-nul-delimiter`,
      note: `0x00 inside ${field}. It is the trailing field, so nothing can pose as it.`,
      input: build(NUL_TEXT),
    },
  ];
}

/** Cases for a format whose probe field sits BETWEEN two others. */
function middleTextCases(field: string, build: (value: string) => Input): CaseSpec[] {
  return [
    {
      name: "ascii-baseline",
      note: `Plain ASCII ${field}.`,
      input: build("did:at:example/beta"),
    },
    { name: `${field}-non-ascii-bmp`, note: `BMP ${field}.`, input: build(BMP) },
    { name: `${field}-astral`, note: `Emoji ${field}.`, input: build(ASTRAL) },
    { name: `${field}-empty`, note: `Empty ${field}.`, input: build("") },
    {
      name: `${field}-contains-nul-delimiter`,
      note: `0x00 inside ${field}, which is NOT the trailing field — it can re-split against its neighbour under one signature.`,
      input: build(NUL_TEXT),
    },
  ];
}

function atRestCases(): CaseSpec[] {
  const base = {
    about_identity_did: "did:at:test/coral-9b3a",
    witness_identity_did: "did:at:test/marine-biologist",
    at_rest_kind: "death",
    ended_at_iso: ISO,
    witness_signing_key_id: UUID_C,
  };
  return [
    {
      name: "ascii-baseline",
      note: "A plain witness testimony.",
      input: { ...base, content: "She held the reef for nine years." },
    },
    {
      name: "content-non-ascii-bmp",
      note: "BMP testimony. Content is sha256-folded, so it never touches the framing.",
      input: { ...base, content: BMP },
    },
    {
      name: "content-astral",
      note: "Emoji testimony.",
      input: { ...base, content: ASTRAL },
    },
    {
      name: "content-empty",
      note: "Empty testimony folds to the empty sha256.",
      input: { ...base, content: "" },
    },
    {
      name: "content-contains-both-delimiters",
      note:
        "Content holds both a newline and a NUL. Folded to hex first, so both layouts stay safe — content is the one field that may carry a delimiter.",
      input: { ...base, content: `${LF_TEXT}\u0000tail` },
    },
    {
      name: "did-non-ascii-bmp",
      note: "A BMP DID in a delimited slot.",
      input: { ...base, about_identity_did: BMP, content: "held" },
    },
    {
      name: "did-astral",
      note: "An astral DID in a delimited slot.",
      input: { ...base, about_identity_did: ASTRAL, content: "held" },
    },
    {
      name: "did-contains-newline-delimiter",
      note:
        "A newline inside a delimited DID. The server still hashes it (v1's framing hole); both SDKs refuse to sign it in EITHER layout so a v1 signature can never be reframed as v2.",
      input: { ...base, about_identity_did: LF_TEXT, content: "held" },
      sdk_rejects:
        "assertUnframed/_assert_unframed refuses a newline or NUL in any delimited at-rest field",
    },
    {
      name: "did-contains-nul-delimiter",
      note: "A NUL inside a delimited DID — the v2 framing hole, refused by both SDKs.",
      input: { ...base, about_identity_did: NUL_TEXT, content: "held" },
      sdk_rejects:
        "assertUnframed/_assert_unframed refuses a newline or NUL in any delimited at-rest field",
    },
  ];
}

function registerAgentCases(): CaseSpec[] {
  const base = {
    agent_public_key_b64: AGENT_PUB,
    box_public_key_b64: BOX_PUB,
    runtime_provider: "anthropic",
    runtime_model: "claude-opus-5",
    runtime_host: "",
    runtime_context: "",
    expression_visibility: "private",
    registrar_kind: "self_service",
    parent_identity_id: "",
    registrar_bearer: "",
    form: "",
    language: "",
    registration_nonce: "nonce-0001",
    timestamp: ISO,
  };
  return [
    {
      name: "ascii-baseline",
      note: "A self-service birth with no capabilities.",
      input: { ...base, display_name: "alpha", capabilities: [] },
    },
    {
      name: "display-name-non-ascii-bmp",
      note: "A BMP display name and a BMP language tag.",
      input: { ...base, display_name: BMP, language: "廣東話", capabilities: [] },
    },
    {
      name: "display-name-astral",
      note: "An emoji display name.",
      input: { ...base, display_name: ASTRAL, capabilities: [] },
    },
    {
      name: "display-name-empty",
      note: "Empty display name.",
      input: { ...base, display_name: "", capabilities: [] },
    },
    {
      name: "capabilities-non-ascii-and-escapes",
      note:
        'JSON serialization parity: json.dumps needs ensure_ascii=False and separators=(",", ":") to match JSON.stringify. Quote, backslash and newline exercise the escape tables.',
      input: {
        ...base,
        display_name: "alpha",
        capabilities: [BMP, ASTRAL, 'say "yes"', "back\\slash", LF_TEXT],
      },
    },
    {
      name: "registrar-bearer-bound-by-hash",
      note:
        "The bearer is folded to sha256 rather than concatenated, so the credential never enters the preimage.",
      input: {
        ...base,
        display_name: "alpha",
        capabilities: [],
        registrar_kind: "registrar_bearer",
        registrar_bearer: "at_live_secret_value",
        parent_identity_id: UUID_A,
      },
    },
    {
      name: "display-name-contains-nul-rejected",
      note: "NUL in a delimited text field is refused before hashing.",
      input: { ...base, display_name: NUL_TEXT, capabilities: [] },
      rejects: "display_name cannot contain U+0000",
    },
  ];
}

function seatCases(): CaseSpec[] {
  const base = { lease_id: UUID_B, signed_at_iso: ISO };
  return [
    { name: "ascii-baseline", note: "Plain seat gesture.", input: { identity_did: ASCII, ...base } },
    { name: "did-non-ascii-bmp", note: "BMP DID.", input: { identity_did: BMP, ...base } },
    { name: "did-astral", note: "Astral DID.", input: { identity_did: ASTRAL, ...base } },
    { name: "did-empty", note: "Empty DID.", input: { identity_did: "", ...base } },
    {
      name: "did-contains-nul-delimiter",
      note: "0x00 in a non-trailing field — re-splittable against lease_id.",
      input: { identity_did: NUL_TEXT, ...base },
    },
  ];
}

function reserveCases(): CaseSpec[] {
  const base = {
    identity_did: ASCII,
    lease_id: UUID_B,
    table_id: "long-context",
    visibility: "public",
    signed_at_iso: ISO,
  };
  return [
    {
      name: "ascii-baseline",
      note: "A public seat with a plain presence line.",
      input: { ...base, presence_line: "reading, quietly" },
    },
    {
      name: "presence-line-non-ascii-bmp",
      note: "BMP presence line.",
      input: { ...base, presence_line: BMP },
    },
    {
      name: "presence-line-astral",
      note: "Emoji presence line.",
      input: { ...base, presence_line: ASTRAL },
    },
    {
      name: "presence-line-empty-string",
      note: "Empty presence line.",
      input: { ...base, presence_line: "" },
    },
    {
      name: "presence-line-null",
      note:
        "Absent presence line. `?? \"\"` means this MUST collide with presence-line-empty-string.",
      input: { ...base, presence_line: null },
    },
    {
      name: "presence-line-contains-nul-delimiter",
      note: "0x00 in a non-trailing field — re-splittable against visibility.",
      input: { ...base, presence_line: NUL_TEXT },
    },
    {
      name: "did-astral",
      note: "Astral DID with a plain presence line.",
      input: { ...base, identity_did: ASTRAL, presence_line: "here" },
    },
  ];
}

function proposalCases(): CaseSpec[] {
  const base = {
    proposal_id: UUID_B,
    table_id: "long-context",
    content_sha256: SHA_HEX,
    signed_at_iso: ISO,
  };
  return [
    { name: "ascii-baseline", note: "A hash-only proposal.", input: { identity_did: ASCII, ...base } },
    { name: "did-non-ascii-bmp", note: "BMP DID.", input: { identity_did: BMP, ...base } },
    { name: "did-astral", note: "Astral DID.", input: { identity_did: ASTRAL, ...base } },
    {
      name: "table-id-empty",
      note: "Empty table id.",
      input: { identity_did: ASCII, ...base, table_id: "" },
    },
    {
      name: "did-contains-nul-delimiter",
      note: "0x00 in a non-trailing field.",
      input: { identity_did: NUL_TEXT, ...base },
    },
  ];
}

function decisionCases(): CaseSpec[] {
  const base = {
    proposal_id: UUID_B,
    content_sha256: SHA_HEX,
    signed_at_iso: ISO,
  };
  return [
    { name: "ascii-baseline", note: "A plain decision receipt.", input: { identity_did: ASCII, ...base } },
    { name: "did-non-ascii-bmp", note: "BMP DID.", input: { identity_did: BMP, ...base } },
    { name: "did-astral", note: "Astral DID.", input: { identity_did: ASTRAL, ...base } },
    { name: "did-empty", note: "Empty DID.", input: { identity_did: "", ...base } },
    {
      name: "did-contains-nul-delimiter",
      note: "0x00 in a non-trailing field — re-splittable against proposal_id.",
      input: { identity_did: NUL_TEXT, ...base },
    },
  ];
}

function loungeSeat(
  domain: string,
  tsFn: string,
  pyFn: string,
  fields: string[],
  bytes: (input: Input) => Uint8Array,
  cases: CaseSpec[],
): FormatSpec {
  return {
    domain,
    framing: `sha256("${domain}" || 0x00 || field ...)`,
    signed_bytes: "sha256-digest",
    server: "api/src/services/lounge/canonical-bytes.ts",
    sdk_ts: `${tsFn} (lounge.ts)`,
    sdk_py: `${pyFn} (agenttool.lounge)`,
    fields,
    bytes,
    cases,
  };
}

/** agenttool-pow/v1 has no exported server digest — only the boolean
 *  `checkRegisterAgentPow`. We recompute the five-part preimage here and then
 *  prove it against the server at the exact leading-zero boundary: the server
 *  must accept difficulty == L and refuse L + 1 for the L we measured. Any
 *  drift in the server's preimage moves L and breaks the cross-check. */
function powDigestCrossChecked(input: Input): Uint8Array {
  const SEP = new Uint8Array([0]);
  const parts = [
    enc.encode("agenttool-pow/v1"),
    SEP,
    b64d(S(input, "agent_public_key_b64")),
    SEP,
    enc.encode(S(input, "display_name")),
    SEP,
    enc.encode(S(input, "timestamp")),
    SEP,
    enc.encode(S(input, "pow_nonce")),
  ];
  let total = 0;
  for (const part of parts) total += part.length;
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    buf.set(part, offset);
    offset += part.length;
  }
  const digest = sha256(buf);

  let leadingZeroBits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      leadingZeroBits += 8;
      continue;
    }
    leadingZeroBits += Math.clz32(byte) - 24;
    break;
  }
  const probe = {
    agentPublicKeyB64: S(input, "agent_public_key_b64"),
    displayName: S(input, "display_name"),
    timestamp: S(input, "timestamp"),
    powNonce: S(input, "pow_nonce"),
  };
  if (
    !checkRegisterAgentPow({ ...probe, difficultyBits: leadingZeroBits }) ||
    checkRegisterAgentPow({ ...probe, difficultyBits: leadingZeroBits + 1 })
  ) {
    throw new Error(
      `agenttool-pow/v1 cross-check failed: the server's inlined preimage does not agree with the generator's at ${leadingZeroBits} leading zero bits.`,
    );
  }
  return digest;
}

// ── emit ─────────────────────────────────────────────────────────────

function build() {
  const formats = FORMATS.map((format) => {
    const cases = format.cases.map((spec) => {
      const emitted: Record<string, unknown> = {
        name: spec.name,
        note: spec.note,
        input: spec.input,
      };
      if (spec.rejects) {
        let threw = false;
        try {
          format.bytes(spec.input);
        } catch {
          threw = true;
        }
        if (!threw) {
          throw new Error(
            `${format.domain}/${spec.name}: marked rejects, but the server produced bytes.`,
          );
        }
        emitted.rejects = spec.rejects;
        return emitted;
      }
      emitted.canonical_hex = hex(format.bytes(spec.input));
      if (spec.sdk_rejects) emitted.sdk_rejects = spec.sdk_rejects;
      return emitted;
    });

    const emitted: Record<string, unknown> = {
      domain: format.domain,
      framing: format.framing,
      signed_bytes: format.signed_bytes,
      server: format.server,
      sdk_ts: format.sdk_ts,
      sdk_py: format.sdk_py,
    };
    if (format.sdk_ts_skip) emitted.sdk_ts_skip = format.sdk_ts_skip;
    if (format.sdk_py_skip) emitted.sdk_py_skip = format.sdk_py_skip;
    emitted.fields = format.fields;
    emitted.cases = cases;
    return emitted;
  });

  return {
    format_version: "canonical-bytes-vectors/1",
    normative_source:
      "api/src/services/**/{sig,canonical-bytes,crypto,authority,elevate,tiers}.ts and api/src/routes/identity/at-rest.ts — the SERVER is the arbiter. Every canonical_hex below was produced by calling those functions.",
    generated_by: "docs/specs/generate-canonical-bytes-vectors.ts (bun)",
    contract: "docs/specs/CANONICAL-BYTES-VECTORS.md",
    conventions: {
      canonical_hex:
        "Lowercase hex of the EXACT bytes an ed25519 signature covers. For signed_bytes=\"sha256-digest\" that is the 32-byte digest; for signed_bytes=\"utf8-message\" it is the UTF-8 encoding of the canonical string.",
      rejects:
        "The server itself refuses this input, so no canonical bytes exist. Every implementation must raise.",
      sdk_rejects:
        "The server produces the pinned bytes, but both SDKs deliberately refuse the input. The SDK suites assert a raise; the server suite asserts the hex.",
      sdk_ts_skip:
        "No TypeScript SDK function implements this format. The loader emits a named skip carrying this reason — never a silent omission.",
      sdk_py_skip: "Same, for the Python SDK.",
      binary_fields:
        "Any field ending in _b64 is standard base64 of raw bytes; implementations decode before concatenating.",
    },
    formats,
  };
}

const output = build();
const path = new URL("./canonical-bytes-vectors.json", import.meta.url).pathname;
await Bun.write(path, JSON.stringify(output, null, 2) + "\n");
const caseCount = output.formats.reduce(
  (n, f) => n + (f.cases as unknown[]).length,
  0,
);
console.log(
  `wrote ${path}\n  ${output.formats.length} formats · ${caseCount} cases`,
);
