import {
  canonicalJson,
  compareUnicode,
  deepFreeze,
  domainSeparatedId,
} from "./canonical.js";
import { validateDeepSeekSourceBinding } from "./binding.js";
import {
  CANDIDATE_KINDS,
  CONSUMER_KINDS,
  DEEPSEEK_FORMATS,
  INTEGRATION_LANES,
  INTEGRATION_PROFILE,
  LICENSE_BOUNDARY,
  PROPOSAL_AUTHORITY,
  PROPOSAL_EFFECTS,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreateDeepSeekKingdomProposalInput,
  DeepSeekKingdomProposal,
  DeepSeekProposalCandidateInput,
} from "./types.js";
import {
  exactKeys,
  id,
  literal,
  record,
  sha256,
  text,
} from "./validation.js";

export function createDeepSeekKingdomProposal(
  input: CreateDeepSeekKingdomProposalInput,
): Readonly<DeepSeekKingdomProposal> {
  const candidate = record(input, "$input", "invalid_proposal");
  exactKeys(
    candidate,
    ["proposal_key", "source", "target", "candidates"],
    "$input",
    "invalid_proposal",
  );
  const source = validateDeepSeekSourceBinding(candidate.source);
  const target = normalizeTarget(candidate.target);
  const candidates = normalizeCandidates(candidate.candidates, source);
  const body = deepFreeze({
    _format: DEEPSEEK_FORMATS.proposal,
    proposal_key: id(candidate.proposal_key, "$input.proposal_key", "invalid_proposal", 200),
    source,
    target,
    delta: {
      candidates: candidates.map((entry) => ({
        ...entry,
        evidence_refs: [source.subject.evidence_ref],
        status: "proposed" as const,
        review_required: true as const,
      })),
    },
    integration: INTEGRATION_PROFILE,
    state: "proposed_unaccepted" as const,
    effects: PROPOSAL_EFFECTS,
    authority: PROPOSAL_AUTHORITY,
    license_boundary: LICENSE_BOUNDARY,
  });
  return deepFreeze({
    ...body,
    proposal_id: domainSeparatedId("kingdom.deepseek-proposal/0.1", body),
  });
}

export function validateDeepSeekKingdomProposal(
  value: unknown,
): Readonly<DeepSeekKingdomProposal> {
  const proposal = record(value, "$proposal", "invalid_proposal");
  exactKeys(
    proposal,
    [
      "_format",
      "proposal_id",
      "proposal_key",
      "source",
      "target",
      "delta",
      "integration",
      "state",
      "effects",
      "authority",
      "license_boundary",
    ],
    "$proposal",
    "invalid_proposal",
  );
  if (
    proposal._format !== DEEPSEEK_FORMATS.proposal ||
    proposal.state !== "proposed_unaccepted" ||
    canonicalJson(proposal.integration) !== canonicalJson(INTEGRATION_PROFILE) ||
    canonicalJson(proposal.effects) !== canonicalJson(PROPOSAL_EFFECTS) ||
    canonicalJson(proposal.authority) !== canonicalJson(PROPOSAL_AUTHORITY) ||
    canonicalJson(proposal.license_boundary) !== canonicalJson(LICENSE_BOUNDARY)
  ) {
    fail("invalid_proposal", "$proposal fixed boundary fields are invalid");
  }
  const source = validateDeepSeekSourceBinding(proposal.source);
  const delta = record(proposal.delta, "$proposal.delta", "invalid_proposal");
  exactKeys(delta, ["candidates"], "$proposal.delta", "invalid_proposal");
  if (!Array.isArray(delta.candidates)) {
    fail("invalid_proposal", "$proposal.delta.candidates must be an array");
  }
  const candidates = delta.candidates.map((entry, index) => {
    const item = record(entry, `$proposal.delta.candidates[${index}]`, "invalid_proposal");
    exactKeys(
      item,
      [
        "candidate_id",
        "candidate_kind",
        "lane",
        "title",
        "claim_refs",
        "evidence_refs",
        "status",
        "review_required",
      ],
      `$proposal.delta.candidates[${index}]`,
      "invalid_proposal",
    );
    if (
      item.status !== "proposed" ||
      item.review_required !== true ||
      !Array.isArray(item.evidence_refs) ||
      item.evidence_refs.length !== 1 ||
      item.evidence_refs[0] !== source.subject.evidence_ref
    ) {
      fail("invalid_proposal", `$proposal.delta.candidates[${index}] boundary fields are invalid`);
    }
    return {
      candidate_id: item.candidate_id,
      candidate_kind: item.candidate_kind,
      lane: item.lane,
      title: item.title,
      claim_refs: item.claim_refs,
    };
  });
  const rebuilt = createDeepSeekKingdomProposal({
    proposal_key: proposal.proposal_key as string,
    source,
    target: proposal.target as CreateDeepSeekKingdomProposalInput["target"],
    candidates: candidates as DeepSeekProposalCandidateInput[],
  });
  if (
    sha256(proposal.proposal_id, "$proposal.proposal_id", "invalid_proposal") !== rebuilt.proposal_id ||
    canonicalJson(proposal) !== canonicalJson(rebuilt)
  ) {
    fail("invalid_proposal", "$proposal digest or canonical fields are invalid");
  }
  return rebuilt;
}

function normalizeTarget(value: unknown): CreateDeepSeekKingdomProposalInput["target"] {
  const target = record(value, "$input.target", "invalid_proposal");
  exactKeys(target, ["consumer", "kingdom_snapshot_sha256"], "$input.target", "invalid_proposal");
  const consumer = record(target.consumer, "$input.target.consumer", "invalid_proposal");
  exactKeys(consumer, ["kind", "id"], "$input.target.consumer", "invalid_proposal");
  return deepFreeze({
    consumer: {
      kind: literal(consumer.kind, CONSUMER_KINDS, "$input.target.consumer.kind", "invalid_proposal"),
      id: id(consumer.id, "$input.target.consumer.id", "invalid_proposal"),
    },
    kingdom_snapshot_sha256: sha256(
      target.kingdom_snapshot_sha256,
      "$input.target.kingdom_snapshot_sha256",
      "invalid_proposal",
    ),
  });
}

function normalizeCandidates(
  value: unknown,
  source: ReturnType<typeof validateDeepSeekSourceBinding>,
): DeepSeekProposalCandidateInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    fail("invalid_proposal", "$input.candidates must contain 1 through 64 candidates");
  }
  const claimIds = new Set(source.claims.map((claim) => claim.claim_id));
  const candidates = value.map((entry, index) => {
    const candidate = record(entry, `$input.candidates[${index}]`, "invalid_proposal");
    exactKeys(
      candidate,
      ["candidate_id", "candidate_kind", "lane", "title", "claim_refs"],
      `$input.candidates[${index}]`,
      "invalid_proposal",
    );
    if (!Array.isArray(candidate.claim_refs) || candidate.claim_refs.length === 0 || candidate.claim_refs.length > 64) {
      fail("invalid_proposal", `$input.candidates[${index}].claim_refs must be a bounded array`);
    }
    const claimRefs = candidate.claim_refs.map((entry, claimIndex) =>
      id(
        entry,
        `$input.candidates[${index}].claim_refs[${claimIndex}]`,
        "invalid_proposal",
      ),
    );
    const sortedClaimRefs = [...claimRefs].sort(compareUnicode);
    if (
      claimRefs.some((claimRef, claimIndex) => claimRef !== sortedClaimRefs[claimIndex]) ||
      new Set(claimRefs).size !== claimRefs.length ||
      claimRefs.some((claimRef) => !claimIds.has(claimRef))
    ) {
      fail("invalid_proposal", `$input.candidates[${index}].claim_refs must be sorted, unique source claim IDs`);
    }
    return {
      candidate_id: id(
        candidate.candidate_id,
        `$input.candidates[${index}].candidate_id`,
        "invalid_proposal",
      ),
      candidate_kind: literal(
        candidate.candidate_kind,
        CANDIDATE_KINDS,
        `$input.candidates[${index}].candidate_kind`,
        "invalid_proposal",
      ),
      lane: literal(
        candidate.lane,
        INTEGRATION_LANES,
        `$input.candidates[${index}].lane`,
        "invalid_proposal",
      ),
      title: text(candidate.title, `$input.candidates[${index}].title`, "invalid_proposal", 200),
      claim_refs: claimRefs,
    };
  });
  const sorted = [...candidates].sort((left, right) => compareUnicode(left.candidate_id, right.candidate_id));
  if (
    candidates.some((candidate, index) => candidate.candidate_id !== sorted[index]!.candidate_id) ||
    new Set(candidates.map((candidate) => candidate.candidate_id)).size !== candidates.length
  ) {
    fail("invalid_proposal", "$input.candidates must be sorted by unique candidate_id");
  }
  return candidates;
}
