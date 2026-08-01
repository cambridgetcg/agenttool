import type {
  CreateDeepSeekKingdomProposalInput,
  CreateDeepSeekSourceBindingInput,
  DeepSeekSourceBinding,
} from "../src/index.js";

export function githubSourceInput(): CreateDeepSeekSourceBindingInput {
  return {
    subject: {
      label: "DeepSeek-R1 official repository README",
      evidence: {
        origin: "deepseek_github",
        resource_kind: "code_repository",
        repository_id: "deepseek-ai/DeepSeek-R1",
        revision: "0cf78561f1d51c84a21b2190626b21116d5c68bb",
        path: "README.md",
        sha256:
          "sha256:4ed979e497121ae4dd9f1573da1668219f43be55d62cc0bf2be5429211a67486",
        observed_on: "2026-08-01",
      },
    },
    license: {
      scope: "mixed_repository",
      declared_expression: null,
      evidence: null,
      review_status: "not_reviewed",
    },
    claims: [
      {
        claim_id: "r1.distillation-lineage",
        claim_kind: "dataset_lineage",
        summary: "Caller reports a distillation lineage described by the exact README.",
        source_anchor: "README.md#3-model-downloads",
      },
      {
        claim_id: "r1.rl-preliminary-step",
        claim_kind: "training_method",
        summary: "Caller reports a reinforcement-learning-only preliminary path in the exact README.",
        source_anchor: "README.md#1-introduction",
      },
    ],
  };
}

export function proposalInput(
  source: DeepSeekSourceBinding,
): CreateDeepSeekKingdomProposalInput {
  return {
    proposal_key: "deepseek-r1-research-review",
    source,
    target: {
      consumer: { kind: "kingdom_extension", id: "research-witness-lab" },
      kingdom_snapshot_sha256: `sha256:${"a".repeat(64)}`,
    },
    candidates: [
      {
        candidate_id: "candidate.r1.distillation",
        candidate_kind: "training_pattern",
        lane: "reasoning",
        title: "Review an R1 distillation-lineage pattern",
        claim_refs: ["r1.distillation-lineage"],
      },
      {
        candidate_id: "candidate.r1.rl",
        candidate_kind: "training_pattern",
        lane: "reasoning",
        title: "Review an R1 reinforcement-learning pattern",
        claim_refs: ["r1.rl-preliminary-step"],
      },
    ],
  };
}
