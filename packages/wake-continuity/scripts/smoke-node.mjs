import {
  createAfterglowCapsule,
  createAfterglowContentDigestArtifact,
  createAfterglowHandoffFactReference,
  projectAfterglowLens,
  validateAfterglowCapsule,
  validateAfterglowLensAgainstCapsule,
} from "../dist/index.js";

const id = (character) => `sha256:${character.repeat(64)}`;
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

if (
  validateAfterglowCapsule(capsule).capsule_id !== capsule.capsule_id ||
  validateAfterglowLensAgainstCapsule(lens, capsule).lens_id !== lens.lens_id ||
  lens.heaven.automatic_entry !== false ||
  lens.carry[0]?.thread_ref !== id("2") ||
  artifact.kind !== "content_digest" ||
  artifact.digest !== capsule.capsule_id ||
  !fact.refs[0].endsWith(capsule.capsule_id)
) {
  process.exit(1);
}
