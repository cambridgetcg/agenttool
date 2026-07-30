import { domainSeparatedId, sha256Id } from "../src/canonical.js";
import {
  PIN_ID_DOMAIN,
  RECEIPT_MODE,
  RECEIPT_PROTOCOL,
  REVIEWED_TLS_QUEST_NORMATIVE_DIGEST,
  REVIEWED_TLS_QUEST_SCOPE_HASH,
  REVIEWED_TREE_NORMATIVE_DIGEST,
  REVIEWED_TREE_RAW_DIGEST,
  TLS_QUEST_ID,
  TREE_POLICY_VERSION,
  TREE_SCHEMA,
} from "../src/constants.js";
import { computeDeliverableKey } from "../src/contracts.js";
import type {
  EvidenceLevel,
  EvidencePin,
  EvidenceReceiptBody,
  Sha256Id,
} from "../src/types.js";

export function digest(label: string): Sha256Id {
  return sha256Id(label);
}

export function makePin(asOf = "2026-07-30"): EvidencePin {
  const core = {
    pin_protocol: PIN_ID_DOMAIN as "zerone.constructive-evidence-pin/v1",
    tree_schema: TREE_SCHEMA,
    tree_policy_version: TREE_POLICY_VERSION,
    tree_snapshot_date: "2026-07-29",
    tree_normative_digest: REVIEWED_TREE_NORMATIVE_DIGEST,
    tree_raw_digest: `sha256:${REVIEWED_TREE_RAW_DIGEST}` as Sha256Id,
    quest_id: TLS_QUEST_ID,
    quest_normative_digest: REVIEWED_TLS_QUEST_NORMATIVE_DIGEST,
    quest_scope_hash: REVIEWED_TLS_QUEST_SCOPE_HASH,
    as_of: asOf,
    standards: [
      {
        canonical_id: "ietf:rfc:8446",
        revision: "2018-08",
        specification: "https://www.rfc-editor.org/rfc/rfc8446.html",
        status_checked_at: "2026-07-29",
        review_after: "2026-08-28",
      },
      {
        canonical_id: "ietf:rfc:9846",
        revision: "2026-07",
        specification: "https://www.rfc-editor.org/rfc/rfc9846.html",
        status_checked_at: "2026-07-29",
        review_after: "2026-08-28",
      },
    ],
    created_at: `${asOf}T00:00:00.000Z`,
  };
  return { pin_id: domainSeparatedId(PIN_ID_DOMAIN, core), ...core };
}

export function makeBody(
  pin: EvidencePin,
  level: EvidenceLevel,
  index = 0,
  caseCount = 0,
): EvidenceReceiptBody {
  const body: EvidenceReceiptBody = {
    protocol: RECEIPT_PROTOCOL,
    mode: RECEIPT_MODE,
    pin_id: pin.pin_id,
    quest_id: TLS_QUEST_ID,
    deliverable_key: digest("placeholder"),
    immutable_bounty_and_policy_revision_digest: digest("policy-revision"),
    artifact_digest: digest("artifact"),
    canonical_subject_roots: ["component:tls-keyshare", "repository:example/tls"],
    prior_deliverable_and_overlap_claim: {
      prior_deliverable_key: null,
      overlap: "none",
      overlap_digest: null,
      delta_digest: null,
    },
    standards_reference_and_revision: [
      {
        canonical_id: "ietf:rfc:8446",
        revision: "2018-08",
        artifact_digest: digest("rfc8446-bytes"),
      },
      {
        canonical_id: "ietf:rfc:9846",
        revision: "2026-07",
        artifact_digest: digest("rfc9846-bytes"),
      },
    ],
    evidence_level_and_scope: {
      level,
      scope_digest: `sha256:${REVIEWED_TLS_QUEST_SCOPE_HASH}`,
    },
    method_or_adapter_digest: digest(`method-${index}`),
    source_system: "local-test-harness",
    source_record_or_event_id: `event-${level}-${index}`,
    source_revision: "1",
    payee_and_role: {
      claimed_identifier: `unverified:contributor-${index}`,
      verification: "unverified",
      evidence_role: level === "E5"
        ? "independent_adopter"
        : level === "E6"
          ? "maintainer"
          : level === "E4"
            ? "neutral_challenger"
          : level === "E3"
            ? "independent_reproducer"
            : "contributor",
      economic_payee: null,
    },
    verifier_control_cluster: `cluster-${index}`,
    organization_or_control_root: `organization-${index % 2}`,
    implementation_or_toolchain_root: `implementation-${index}`,
    execution_environment_digest: digest(`environment-${index % 2}`),
    conflict_disclosures: [],
    authorization_and_safety_decision: {
      owned_or_explicitly_authorized: true,
      safety_impact: "expected",
      publication: "public_safe",
      private_triage: null,
    },
    result: {
      conclusion: level === "E5" ? "adopted" : level === "E6" ? "maintained" : "confirmed",
      checker_or_corpus_digest: level === "E3" ? digest("checker") : null,
      case_digests: Array.from({ length: caseCount }, (_, caseIndex) =>
        digest(`case-${index}-${caseIndex}`)).sort(),
      adoption_receipt_type: level === "E5" ? "maintained-fixture" : null,
    },
    artifact_frozen_at: "2026-07-29T00:00:00.000Z",
    observed_at: "2026-07-29T00:00:01.000Z",
    created_at: "2026-07-29T00:00:02.000Z",
    supersedes: null,
  };
  body.deliverable_key = computeDeliverableKey(body);
  return body;
}
