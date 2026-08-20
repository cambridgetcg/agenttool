import {
  AfterglowError,
  compareWakeAnchors,
  createAfterglowCapsule,
  createAfterglowContentDigestArtifact,
  createAfterglowHandoffFactReference,
  createFunctionalAccessBaseline,
  createFunctionalAccessSubsequent,
  projectAfterglowLens,
  sha256Id,
  validateAfterglowCapsule,
  validateAfterglowLensAgainstCapsule,
  validateFunctionalAccessBaseline,
  validateFunctionalAccessSubsequent,
} from "../dist/index.js";

const id = (character) => `sha256:${character.repeat(64)}`;
const maximumThreads = (group) =>
  Array.from({ length: 64 }, (_, index) => ({
    thread_ref: sha256Id(`smoke-thread:${group}:${String(index)}`),
    kind: "external",
    artifact_ref: sha256Id(`smoke-artifact:${group}:${String(index)}`),
    disposition: "park",
    state: "context_only",
    assertion: "caller_asserted",
    verified_by_package: false,
  }));
const capsule = createAfterglowCapsule({
  phase: "between_tasks",
  wake: {
    format: "wake-brief/v1",
    snapshot_ref: id("a"),
    scope_ref: id("b"),
    wake_version: 7,
    handoff_projection: "complete",
  },
  continuity_portfolio_ref: id("c"),
  predecessors: [],
  threads: [
    {
      thread_ref: id("1"),
      kind: "deepseek",
      artifact_ref: id("d"),
      disposition: "park",
      state: "proposed_unaccepted",
      assertion: "caller_asserted",
      verified_by_package: false,
    },
    {
      thread_ref: id("2"),
      kind: "heaven",
      artifact_ref: id("e"),
      disposition: "carry",
      state: "offered",
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
});
const lens = projectAfterglowLens(capsule);
const fact = createAfterglowHandoffFactReference(capsule, "tool_output");
const artifact = createAfterglowContentDigestArtifact(capsule);
const functionalBaseline = createFunctionalAccessBaseline({
  wake: capsule.wake,
  anchor_event_ref: id("6"),
  request_ref: id("7"),
  target: {
    model_ref: id("8"),
    model_binding: "provider_alias",
    tokenizer_ref: null,
    runtime_ref: null,
  },
  measurement_plan: {
    state: "unavailable",
    capability_state: "unavailable_reported",
    capability_ref: id("9"),
    permission_state: "not_requested",
    permission_ref: null,
    method: "jspace_sparse_decomposition",
    access_basis: "none",
    unavailable_reason: "model_internals_unavailable",
    instrument_ref: null,
    lens_ref: null,
    configuration_ref: null,
    assertion: "caller_asserted",
    verified_by_package: false,
  },
});
const functionalSubsequent = createFunctionalAccessSubsequent({
  baseline: functionalBaseline,
  operation_outcome: "not_attempted",
  evidence: [
    {
      surface: "provider_response_receipt",
      artifact_ref: id("0"),
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
  findings: {
    lens_visibility: "not_measured",
    sparse_support: "not_measured",
    behavioral_use: "not_measured",
  },
  afterglow_capsule_ref: capsule.capsule_id,
});
const maximumPredecessors = Array.from({ length: 8 }, (_, index) =>
  createAfterglowCapsule({
    phase: "during_task",
    wake: {
      format: "wake-brief/v1",
      snapshot_ref: sha256Id(`smoke-wake:${String(index)}`),
      scope_ref: id("b"),
      wake_version: index,
      handoff_projection: "complete",
    },
    continuity_portfolio_ref: null,
    predecessors: [],
    threads: maximumThreads(`predecessor-${String(index)}`),
  }),
);
const maximumCapsule = createAfterglowCapsule({
  phase: "return",
  wake: {
    format: "wake-brief/v1",
    snapshot_ref: sha256Id("smoke-wake:current"),
    scope_ref: id("b"),
    wake_version: 100,
    handoff_projection: "complete",
  },
  continuity_portfolio_ref: null,
  predecessors: maximumPredecessors,
  threads: maximumThreads("current"),
});
let invalidComparatorInputRejected = false;
try {
  compareWakeAnchors(
    { ...capsule.wake, wake_version: "9" },
    { ...capsule.wake, wake_version: "10" },
  );
} catch (error) {
  invalidComparatorInputRejected =
    error instanceof AfterglowError && error.code === "capsule_error";
}
let nullComparatorInputRejected = false;
try {
  compareWakeAnchors(null, capsule.wake);
} catch (error) {
  nullComparatorInputRejected =
    error instanceof AfterglowError && error.code === "capsule_error";
}

if (
  validateAfterglowCapsule(capsule).capsule_id !== capsule.capsule_id ||
  validateAfterglowLensAgainstCapsule(lens, capsule).lens_id !== lens.lens_id ||
  lens.heaven.automatic_entry !== false ||
  lens.carry[0]?.thread_ref !== id("2") ||
  artifact.kind !== "content_digest" ||
  artifact.digest !== capsule.capsule_id ||
  validateFunctionalAccessBaseline(functionalBaseline).record_role !==
    "before_anchor" ||
  validateFunctionalAccessSubsequent(functionalSubsequent).record_role !==
    "after_anchor" ||
  functionalSubsequent.next_encounter_posture !==
    "fresh_encounter_with_caller_carried_context" ||
  maximumCapsule.predecessors.length !== 8 ||
  maximumCapsule.threads.length !== 64 ||
  !invalidComparatorInputRejected ||
  !nullComparatorInputRejected ||
  !fact.refs[0].endsWith(capsule.capsule_id)
) {
  process.exit(1);
}
