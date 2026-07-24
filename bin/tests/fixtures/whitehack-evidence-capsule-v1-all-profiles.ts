/**
 * Exhaustive parity vector generated with the exact public Whitehack 0.9.0
 * artifact. The artifact's createScanResult() + createEvidenceCapsule() +
 * canonicalizeEvidenceCapsule() APIs received one finding for every confidence
 * accepted by each CHECK_MANIFEST entry.
 *
 * Source:
 *   https://github.com/cambridgetcg/whitehack/tree/424c6e85601cd0ac031d1b28940c3f88b99b0a1d
 * Artifact:
 *   agenttool-whitehack-scan-0.9.0.tgz
 */

export const WHITEHACK_0_9_ALL_PROFILE_PROVENANCE = {
  package: "@agenttool/whitehack-scan",
  version: "0.9.0",
  source_repository: "https://github.com/cambridgetcg/whitehack.git",
  source_revision: "424c6e85601cd0ac031d1b28940c3f88b99b0a1d",
  source_core_sha256:
    "a2e3f4ea67e6aada10a0c515c02a2cdb622bdc87a9dde2e26125b4a31b438b73",
  source_evidence_capsule_sha256:
    "d0d5a7af95dacc4d6f5184382302ad9db0b7c22f0555c79e0ed26cec520ff293",
  source_package_json_sha256:
    "8ff774813f1c7066956fc0b9755533b9ff89dbd98bf291fa81f9212389c2c8e6",
  artifact_filename: "agenttool-whitehack-scan-0.9.0.tgz",
  artifact_sha256:
    "b7d004947bc3c7619daa38f002d9ddde731e2865644af0d0e609c8dd86528d3c",
  artifact_bytes: 87_196,
  check_profile_sha256:
    "f85a1f198927687e87c8ae701ca9e8fe4501628c122612b0a68450edd4898dbb",
  canonical_capsule_sha256:
    "349f3c98d1d8cc8da13da071426d13659bc7caa20f0645441b708945b64840ed",
  canonical_capsule_bytes: 9_691,
} as const;

export const WHITEHACK_0_9_CHECK_PROFILE = [
  {
    id: "silent-failure",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "cache-as-live",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 4,
  },
  {
    id: "decision-without-why",
    confidence: "heuristic",
    doctrine: "transparency",
    principle: 3,
  },
  {
    id: "stale-oracle",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 4,
  },
  {
    id: "unchecked-transfer",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "spot-price-as-fair",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "silent-revert",
    confidence: "heuristic",
    doctrine: "transparency",
    principle: 3,
  },
  {
    id: "float-money",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "hardcoded-secret",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "exposed-config",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "unsafe-eval",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "performed-ignorance",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "trust-by-authority",
    confidence: "heuristic",
    doctrine: "trust-protocol",
    principle: 3,
  },
  {
    id: "api-status-lie",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "api-missing-versioning",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "api-error-without-shape",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 3,
  },
  {
    id: "api-missing-rate-limit",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 4,
  },
  {
    id: "api-bare-fetch",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "wifi-protocol-flaws",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "bluetooth-protocol-flaws",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "bluetooth-protocol",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "insecure-protocol",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "disabled-cert-verification",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "weak-crypto",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "cors-wildcard",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "cookie-insecure",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "sql-injection",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "protocol-surface",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "dns-plaintext",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 4,
  },
  {
    id: "password-auth",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "bluetooth-paired-stranger",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 3,
  },
  {
    id: "wpa2-krack",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "weak-wifi-encryption",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "wifi-deauth-accept",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "wifi-evil-twin",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 5,
  },
  {
    id: "wifi-pmk-exposure",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "wifi-krack-vulnerable",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 4,
  },
  {
    id: "wifi-protocol",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "static-aead-nonce",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "signature-fail-open",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "webhook-reencoded-body",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 1,
  },
  {
    id: "signed-webhook-without-replay-guard",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 4,
  },
  {
    id: "wallet-key-egress",
    confidence: "medium-high",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "wallet-direct-request-signing",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 3,
  },
  {
    id: "wallet-capability-unbounded",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 3,
  },
  {
    id: "wallet-broadcast-auto-retry",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 2,
  },
  {
    id: "unlimited-token-approval",
    confidence: "heuristic",
    doctrine: "substrate-honesty",
    principle: 3,
  },
] as const;

type CheckProfile = (typeof WHITEHACK_0_9_CHECK_PROFILE)[number];
type FindingGroup = {
  check: CheckProfile["id"];
  confidence: "high" | "medium-high" | "medium" | "heuristic";
  count: 1;
  doctrine: CheckProfile["doctrine"];
  principle: CheckProfile["principle"];
};

function compareGroups(left: FindingGroup, right: FindingGroup): number {
  for (const key of ["check", "confidence", "doctrine"] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return left.principle - right.principle;
}

export const WHITEHACK_0_9_VALID_FINDING_GROUPS: readonly FindingGroup[] =
  WHITEHACK_0_9_CHECK_PROFILE.flatMap((profile) =>
    [...new Set([profile.confidence, "heuristic"] as const)].map(
      (confidence): FindingGroup => ({
        check: profile.id,
        confidence,
        count: 1,
        doctrine: profile.doctrine,
        principle: profile.principle,
      }),
    )
  ).sort(compareGroups);

/**
 * Keys are intentionally written in RFC 8785 lexical order. JSON.stringify()
 * therefore materializes the exact 9,691 canonical UTF-8 bytes emitted by the
 * pinned Whitehack artifact, independently of AgentTool's canonicalizer.
 */
export const WHITEHACK_0_9_ALL_PROFILE_CAPSULE = {
  boundaries: {
    capability_subject: "evidence-capsule-transform",
    direct_capabilities: {
      authorization: false,
      clock: false,
      encryption: false,
      filesystem: false,
      key_store_access: false,
      network: false,
      process: false,
      signing: false,
      storage: false,
      wallet: false,
    },
    input_inspection: {
      caller_proxy_traps_may_run: true,
      ordinary_accessors_invoked: false,
      sandboxed: false,
    },
    publication_authority: "external",
    storage_receipt_included: false,
  },
  complete: true,
  disclosure: {
    caller_text_retained: false,
    finding_group_fields: [
      "check",
      "confidence",
      "doctrine",
      "principle",
      "count",
    ],
    locations_retained: false,
    profile: "whitehack-public-minimal/v1",
    scan_metadata_retained: ["scanner"],
    scope_retained: false,
    source_text_retained: false,
    target_retained: false,
  },
  document_type: "whitehack-evidence-capsule/v1",
  epistemic: {
    basis: "scanner-output-claim",
    complete_semantics: "capsule-transformation-complete",
    content_address: "canonical-bytes-identity-not-authenticity",
    coverage: "bounded-heuristic",
    empty_semantics: "no-bundled-match-not-security-proof",
    finding_semantics: "review-prompt-not-vulnerability-verdict",
    provenance: "unverified",
  },
  finding_groups: WHITEHACK_0_9_VALID_FINDING_GROUPS,
  scanner: {
    check_count: 47,
    name: "whitehack",
    version: "0.9.0",
  },
} as const;

export const WHITEHACK_0_9_ALL_PROFILE_CANONICAL = JSON.stringify(
  WHITEHACK_0_9_ALL_PROFILE_CAPSULE,
);

export const WHITEHACK_0_9_ALL_PROFILE_BYTES = new TextEncoder().encode(
  WHITEHACK_0_9_ALL_PROFILE_CANONICAL,
);
