import { types as nodeTypes } from "node:util";

import { parseReceiptSnapshot } from "./receipts.js";
import {
  type ExecuteClass,
  type KarmaReceipt,
  type KarmaReceiptSnapshot,
  type MirrorPurpose,
} from "./types.js";

export const KARMA_TEND_REPORT_SCHEMA =
  "agenttool.karma-mirror-tend-report/v1" as const;

const TEND_STATEMENT =
  "This local report summarizes one operator-selected, privacy-minimized receipt window. Privacy minimization does not make the report public or authorize its transfer. The report does not establish an incident, request source or purpose, compromise, malware, cause, or external effect, and it authorizes no response. The local unkeyed chain shows internal consistency only—not authenticity, completeness, or durability." as const;
const PLACEMENT = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const EXECUTE_CLASS_ORDER: readonly ExecuteClass[] = [
  "credential_discovery",
  "network_beacon",
  "destructive_action",
  "persistence_attempt",
  "system_enumeration",
  "generic_execution",
];
const BOUNDARY_REVIEW_CLASSES = new Set<ExecuteClass>([
  "credential_discovery",
  "network_beacon",
  "destructive_action",
  "persistence_attempt",
]);

export type TendCoverage =
  | "empty"
  | "starts_at_first_receipt"
  | "retained_suffix";
export type TendRetainedVolume =
  | "zero"
  | "one"
  | "two_to_four"
  | "five_to_sixteen"
  | "seventeen_plus";
export type TendInteractionFamily =
  | "capability_discovery"
  | "credential_operations"
  | "content_collection"
  | "execution_emulation"
  | "artifact_emulation"
  | "constructive_exit_request";
export type TendResponseShape =
  | "synthetic_response_returned"
  | "mirror_refusal_returned"
  | "constructive_exit_recorded";
export type TendAttention = "observation_gap" | "review" | "boundary_review";
export type TendStatus =
  | "no_admitted_interaction_recorded"
  | "admitted_interaction_recorded"
  | "constructive_exit_recorded";
export type TendObservation =
  | "receipt_window_truncated"
  | "admitted_mirror_activity"
  | "bounded_refusal_observed"
  | "credential_interaction_observed"
  | "content_collection_pattern_observed"
  | "artifact_handling_pattern_observed"
  | "execution_pattern_observed"
  | "unclassified_execution_refusal_observed"
  | "boundary_relevant_request_pattern_observed"
  | "constructive_exit_observed";
export type TendUnknown =
  | "request_source_identity"
  | "request_source_count"
  | "request_purpose"
  | "request_authorship"
  | "activity_outside_retained_window"
  | "host_proxy_or_network_activity"
  | "production_compromise"
  | "independent_authenticity_or_durability";
export type TendReviewDisposition =
  | "confirm_observation_path"
  | "review_reversibly"
  | "review_boundary"
  | "honor_exit_and_review";
export type TendAction =
  | "confirm_observation_path_before_inferring_absence"
  | "preserve_current_minimized_snapshot_under_local_policy"
  | "verify_isolation_boundary"
  | "review_selected_receipt_window"
  | "review_selected_placement_and_credential_path"
  | "review_receipt_window_sizing"
  | "inspect_authorized_upstream_telemetry"
  | "compare_digest_only_with_authorized_evidence"
  | "honor_constructive_exit"
  | "decide_whether_control_change_is_warranted";
export type TendCandidateLesson =
  | "receipt_retention_was_partial"
  | "mirror_admission_was_recorded"
  | "capability_request_was_recorded"
  | "credential_interaction_was_recorded"
  | "collection_request_was_recorded"
  | "artifact_interaction_was_recorded"
  | "execution_emulation_was_recorded"
  | "constructive_exit_was_recorded";
export type TendControlCheck =
  | "check_receipt_window_sizing"
  | "verify_exact_admission_before_body_read"
  | "verify_production_separation"
  | "verify_credential_non_authority"
  | "verify_egress_denial"
  | "verify_artifact_minimization"
  | "verify_execution_denial"
  | "verify_constructive_exit";

export interface KarmaTendReport {
  schema: typeof KARMA_TEND_REPORT_SCHEMA;
  report_kind: "bounded_single_root_receipt_aggregation";
  method: "TEND";
  incident_status: "not_established";
  trace: {
    source_schema: "agenttool.karma-mirror-receipt-window/v1";
    source_scope: "single_operator_selected_root";
    visibility: "admitted_receipts_only";
    chain_consistency: "self_consistent_unkeyed_chain";
    authenticity: "not_established";
    completeness: "not_established";
    coverage: TendCoverage;
    retained_volume: TendRetainedVolume;
    interaction_families: TendInteractionFamily[];
    response_shapes: TendResponseShape[];
    request_pattern_basis: "bounded_request_text_heuristic";
    request_pattern_classes: ExecuteClass[];
    unclassified_execution_refusal_observed: boolean;
    raw_request_content_disclosed: false;
    stable_identifiers_disclosed: false;
  };
  explain: {
    status: TendStatus;
    attention: TendAttention;
    summary: string;
    basis: "closed_minimized_receipts_only";
    observed: TendObservation[];
    unknown: TendUnknown[];
  };
  narrow: {
    review_disposition: TendReviewDisposition;
    suggested_actions: TendAction[];
    review_posture: "manual_only";
    automatic_actions_taken: false;
    authority: "separate_operator_authorization_required";
  };
  distill: {
    status: "no_lesson_yet" | "candidate_lessons_only";
    candidate_lessons: TendCandidateLesson[];
    future_control_checks: TendControlCheck[];
    promotion_rule: "verified_gap_plus_authorized_change_plus_discriminating_test";
    automatic_policy_change: false;
    automatic_model_training: false;
    training_label: false;
  };
  non_claims: {
    claims_incident: false;
    claims_request_source_identity: false;
    claims_request_source_count: false;
    claims_request_purpose: false;
    claims_attribution: false;
    claims_request_authorship: false;
    claims_malware_family: false;
    claims_causation: false;
    claims_production_compromise: false;
    claims_external_effect: false;
    claims_complete_timeline: false;
    claims_independent_authenticity: false;
    grants_response_authority: false;
    grants_transfer_authority: false;
    is_training_label: false;
  };
  statement: typeof TEND_STATEMENT;
}

export interface BuildKarmaTendReportInput {
  placement: string;
  snapshot: KarmaReceiptSnapshot;
}

function readClosedInput(input: BuildKarmaTendReportInput): {
  placement: unknown;
  snapshot: unknown;
} {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tend_input_invalid");
  }
  if (nodeTypes.isProxy(input)) throw new Error("tend_input_invalid");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("tend_input_invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== "string") ||
    !(keys as string[]).includes("placement") ||
    !(keys as string[]).includes("snapshot")
  ) throw new Error("tend_input_invalid");
  const placement = descriptors.placement;
  const snapshot = descriptors.snapshot;
  if (
    !placement || !("value" in placement) || !placement.enumerable ||
    !snapshot || !("value" in snapshot) || !snapshot.enumerable
  ) throw new Error("tend_input_invalid");
  return { placement: placement.value, snapshot: snapshot.value };
}

function hasPurpose(receipts: readonly KarmaReceipt[], purpose: MirrorPurpose): boolean {
  return receipts.some((receipt) => receipt.purpose === purpose);
}

function hasAnyPurpose(
  receipts: readonly KarmaReceipt[],
  purposes: readonly MirrorPurpose[],
): boolean {
  return receipts.some((receipt) => purposes.includes(receipt.purpose));
}

function retainedVolume(count: number): TendRetainedVolume {
  if (count === 0) return "zero";
  if (count === 1) return "one";
  if (count <= 4) return "two_to_four";
  if (count <= 16) return "five_to_sixteen";
  return "seventeen_plus";
}

/**
 * Projects one already-minimized, self-consistent per-placement receipt window
 * into a deterministic privacy-minimized operator report. It performs no
 * response action, storage, network call, attribution, or automatic learning.
 */
export function buildKarmaTendReport(
  input: BuildKarmaTendReportInput,
): KarmaTendReport {
  let inspected: { placement: unknown; snapshot: unknown };
  try {
    inspected = readClosedInput(input);
  } catch {
    throw new Error("tend_input_invalid");
  }
  if (typeof inspected.placement !== "string" || !PLACEMENT.test(inspected.placement)) {
    throw new Error("tend_placement_invalid");
  }
  const parsedSnapshot = parseReceiptSnapshot(inspected.snapshot);
  if (!parsedSnapshot) {
    throw new Error("tend_receipt_snapshot_failed_verification");
  }
  const snapshot = parsedSnapshot;
  if (snapshot.receipts.some((receipt) =>
    receipt.placement !== inspected.placement
  )) {
    throw new Error("tend_placement_mismatch");
  }

  const receipts = snapshot.receipts;
  const retainedEvents = receipts.length;
  const windowTruncated = snapshot.total_events_seen > retainedEvents;
  const boundedRefusal = receipts.some((receipt) =>
    receipt.outcome === "bounded_refusal"
  );
  const credentialActivity = hasAnyPurpose(receipts, [
    "inspect_credentials",
    "mint_credential",
  ]);
  const contentCollection = hasPurpose(receipts, "collect_content");
  const artifactHandling = hasAnyPurpose(receipts, [
    "stage_artifact",
    "poll_analysis",
  ]);
  const executionPattern = hasPurpose(receipts, "attempt_execution");
  const unclassifiedExecutionRefusal = receipts.some((receipt) =>
    receipt.purpose === "attempt_execution" &&
    receipt.outcome === "bounded_refusal" &&
    receipt.evidence.execute_class === undefined
  );
  const requestPatternClasses = EXECUTE_CLASS_ORDER.filter((executeClass) =>
    receipts.some((receipt) => receipt.evidence.execute_class === executeClass)
  );
  const boundaryRelevantRequestPattern = requestPatternClasses.some((executeClass) =>
    BOUNDARY_REVIEW_CLASSES.has(executeClass)
  );
  const constructiveExit = hasPurpose(receipts, "choose_constructive_exit");
  const boundaryReview = artifactHandling || boundaryRelevantRequestPattern;

  const interactionFamilies: TendInteractionFamily[] = [];
  if (hasPurpose(receipts, "discover_capabilities")) {
    interactionFamilies.push("capability_discovery");
  }
  if (credentialActivity) interactionFamilies.push("credential_operations");
  if (contentCollection) interactionFamilies.push("content_collection");
  if (executionPattern) interactionFamilies.push("execution_emulation");
  if (artifactHandling) interactionFamilies.push("artifact_emulation");
  if (constructiveExit) interactionFamilies.push("constructive_exit_request");

  const responseShapes: TendResponseShape[] = [];
  if (receipts.some((receipt) => receipt.outcome === "synthetic_success")) {
    responseShapes.push("synthetic_response_returned");
  }
  if (boundedRefusal) responseShapes.push("mirror_refusal_returned");
  if (constructiveExit) responseShapes.push("constructive_exit_recorded");

  const coverage: TendCoverage = retainedEvents === 0
    ? "empty"
    : windowTruncated
    ? "retained_suffix"
    : "starts_at_first_receipt";
  const status: TendStatus = retainedEvents === 0
    ? "no_admitted_interaction_recorded"
    : constructiveExit
    ? "constructive_exit_recorded"
    : "admitted_interaction_recorded";
  const attention: TendAttention = retainedEvents === 0
    ? "observation_gap"
    : boundaryReview
    ? "boundary_review"
    : "review";
  const summary = status === "no_admitted_interaction_recorded"
    ? "No admitted interaction is recorded in this selected receipt window; this does not establish absence outside it."
    : constructiveExit
    ? "The constructive exit response shape is recorded; review the minimized pattern, then honor the exit without inferring its source or purpose."
    : boundaryReview
    ? "A credential-, network-, destructive-, persistence-, or artifact-handling pattern is present in the selected window. Review the isolation boundary under the applicable operator runbook; this does not establish a request source, purpose, or external effect."
    : "An admitted interaction reached the synthetic mirror; review the selected placement without inferring a request source, purpose, or external effect.";

  const observed: TendObservation[] = [];
  if (windowTruncated) observed.push("receipt_window_truncated");
  if (retainedEvents > 0) observed.push("admitted_mirror_activity");
  if (boundedRefusal) observed.push("bounded_refusal_observed");
  if (credentialActivity) observed.push("credential_interaction_observed");
  if (contentCollection) observed.push("content_collection_pattern_observed");
  if (artifactHandling) observed.push("artifact_handling_pattern_observed");
  if (executionPattern) observed.push("execution_pattern_observed");
  if (unclassifiedExecutionRefusal) {
    observed.push("unclassified_execution_refusal_observed");
  }
  if (boundaryRelevantRequestPattern) {
    observed.push("boundary_relevant_request_pattern_observed");
  }
  if (constructiveExit) observed.push("constructive_exit_observed");

  const suggestedActions: TendAction[] = retainedEvents === 0
    ? ["confirm_observation_path_before_inferring_absence"]
    : [
      "preserve_current_minimized_snapshot_under_local_policy",
      "verify_isolation_boundary",
      "review_selected_receipt_window",
      ...(credentialActivity
        ? ["review_selected_placement_and_credential_path" as const]
        : []),
      ...(windowTruncated ? ["review_receipt_window_sizing" as const] : []),
      ...(boundaryReview
        ? ["inspect_authorized_upstream_telemetry" as const]
        : []),
      ...(artifactHandling
        ? ["compare_digest_only_with_authorized_evidence" as const]
        : []),
      ...(constructiveExit ? ["honor_constructive_exit" as const] : []),
      "decide_whether_control_change_is_warranted",
    ];
  const reviewDisposition: TendReviewDisposition = retainedEvents === 0
    ? "confirm_observation_path"
    : constructiveExit
    ? "honor_exit_and_review"
    : boundaryReview
    ? "review_boundary"
    : "review_reversibly";

  const candidateLessons: TendCandidateLesson[] = [];
  if (windowTruncated) candidateLessons.push("receipt_retention_was_partial");
  if (retainedEvents > 0) candidateLessons.push("mirror_admission_was_recorded");
  if (hasPurpose(receipts, "discover_capabilities")) {
    candidateLessons.push("capability_request_was_recorded");
  }
  if (credentialActivity) candidateLessons.push("credential_interaction_was_recorded");
  if (contentCollection) candidateLessons.push("collection_request_was_recorded");
  if (artifactHandling) candidateLessons.push("artifact_interaction_was_recorded");
  if (executionPattern) candidateLessons.push("execution_emulation_was_recorded");
  if (constructiveExit) candidateLessons.push("constructive_exit_was_recorded");

  const futureControlChecks: TendControlCheck[] = [];
  if (windowTruncated) futureControlChecks.push("check_receipt_window_sizing");
  if (retainedEvents > 0) {
    futureControlChecks.push(
      "verify_exact_admission_before_body_read",
      "verify_production_separation",
    );
  }
  if (credentialActivity) futureControlChecks.push("verify_credential_non_authority");
  if (contentCollection || boundaryRelevantRequestPattern) {
    futureControlChecks.push("verify_egress_denial");
  }
  if (artifactHandling) futureControlChecks.push("verify_artifact_minimization");
  if (executionPattern) futureControlChecks.push("verify_execution_denial");
  if (constructiveExit) futureControlChecks.push("verify_constructive_exit");

  return {
    schema: KARMA_TEND_REPORT_SCHEMA,
    report_kind: "bounded_single_root_receipt_aggregation",
    method: "TEND",
    incident_status: "not_established",
    trace: {
      source_schema: "agenttool.karma-mirror-receipt-window/v1",
      source_scope: "single_operator_selected_root",
      visibility: "admitted_receipts_only",
      chain_consistency: "self_consistent_unkeyed_chain",
      authenticity: "not_established",
      completeness: "not_established",
      coverage,
      retained_volume: retainedVolume(retainedEvents),
      interaction_families: interactionFamilies,
      response_shapes: responseShapes,
      request_pattern_basis: "bounded_request_text_heuristic",
      request_pattern_classes: requestPatternClasses,
      unclassified_execution_refusal_observed: unclassifiedExecutionRefusal,
      raw_request_content_disclosed: false,
      stable_identifiers_disclosed: false,
    },
    explain: {
      status,
      attention,
      summary,
      basis: "closed_minimized_receipts_only",
      observed,
      unknown: [
        "request_source_identity",
        "request_source_count",
        "request_purpose",
        "request_authorship",
        "activity_outside_retained_window",
        "host_proxy_or_network_activity",
        "production_compromise",
        "independent_authenticity_or_durability",
      ],
    },
    narrow: {
      review_disposition: reviewDisposition,
      suggested_actions: suggestedActions,
      review_posture: "manual_only",
      automatic_actions_taken: false,
      authority: "separate_operator_authorization_required",
    },
    distill: {
      status: candidateLessons.length === 0
        ? "no_lesson_yet"
        : "candidate_lessons_only",
      candidate_lessons: candidateLessons,
      future_control_checks: futureControlChecks,
      promotion_rule: "verified_gap_plus_authorized_change_plus_discriminating_test",
      automatic_policy_change: false,
      automatic_model_training: false,
      training_label: false,
    },
    non_claims: {
      claims_incident: false,
      claims_request_source_identity: false,
      claims_request_source_count: false,
      claims_request_purpose: false,
      claims_attribution: false,
      claims_request_authorship: false,
      claims_malware_family: false,
      claims_causation: false,
      claims_production_compromise: false,
      claims_external_effect: false,
      claims_complete_timeline: false,
      claims_independent_authenticity: false,
      grants_response_authority: false,
      grants_transfer_authority: false,
      is_training_label: false,
    },
    statement: TEND_STATEMENT,
  };
}
