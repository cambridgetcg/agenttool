import { canonicalJson, deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  LIVING_SUBSTRATE_BOUNDARIES,
  LIVING_SUBSTRATE_FORMATS,
  REGENERATION_CHOICE,
} from "./constants.js";
import { fail } from "./errors.js";
import { validateLivingSubstrateMap } from "./map.js";
import type {
  CreateRegenerationProposalInput,
  RegenerationProposal,
  Sha256Id,
} from "./types.js";
import {
  exactKeys,
  literal,
  parseActions,
  parseBoundaries,
  parseChoice,
  record,
  sha256,
} from "./validation.js";

function proposalBody(value: Omit<RegenerationProposal, "proposal_id">) {
  return value;
}

export function createRegenerationProposal(
  substrateMap: unknown,
  input: CreateRegenerationProposalInput,
): Readonly<RegenerationProposal> {
  const map = validateLivingSubstrateMap(substrateMap);
  const candidate = record(input, "$input", "proposal_error");
  exactKeys(candidate, ["actions"], "$input", "proposal_error");
  const facetIds = new Set(map.facets.map((facet) => facet.facet_id));
  const body = deepFreeze({
    _format: LIVING_SUBSTRATE_FORMATS.proposal,
    substrate_map_id: map.map_id,
    scope_ref: map.scope_ref,
    actions: parseActions(
      candidate.actions,
      facetIds,
      "$input.actions",
      "proposal_error",
      true,
    ),
    choice: REGENERATION_CHOICE,
    boundaries: LIVING_SUBSTRATE_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    proposal_id: domainSeparatedId(
      LIVING_SUBSTRATE_FORMATS.proposal,
      proposalBody(body),
    ),
  });
}

export function validateRegenerationProposal(
  value: unknown,
): Readonly<RegenerationProposal> {
  const candidate = record(value, "$proposal", "proposal_error");
  exactKeys(
    candidate,
    [
      "_format",
      "proposal_id",
      "substrate_map_id",
      "scope_ref",
      "actions",
      "choice",
      "boundaries",
    ],
    "$proposal",
    "proposal_error",
  );
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [LIVING_SUBSTRATE_FORMATS.proposal],
      "$proposal._format",
      "proposal_error",
    ),
    proposal_id: sha256(
      candidate.proposal_id,
      "$proposal.proposal_id",
      "proposal_error",
    ),
    substrate_map_id: sha256(
      candidate.substrate_map_id,
      "$proposal.substrate_map_id",
      "proposal_error",
    ),
    scope_ref: sha256(
      candidate.scope_ref,
      "$proposal.scope_ref",
      "proposal_error",
    ),
    actions: parseActions(
      candidate.actions,
      null,
      "$proposal.actions",
      "proposal_error",
      false,
    ),
    choice: parseChoice(candidate.choice, "$proposal.choice", "proposal_error"),
    boundaries: parseBoundaries(
      candidate.boundaries,
      "$proposal.boundaries",
      "proposal_error",
    ),
  });
  const { proposal_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId(
    LIVING_SUBSTRATE_FORMATS.proposal,
    proposalBody(body),
  );
  if (claimedId !== expectedId) {
    fail("proposal_error", "$proposal.proposal_id does not bind its body");
  }
  return parsed;
}

export function validateRegenerationProposalAgainstMap(
  proposal: unknown,
  substrateMap: unknown,
): Readonly<RegenerationProposal> {
  const parsedProposal = validateRegenerationProposal(proposal);
  const map = validateLivingSubstrateMap(substrateMap);
  if (
    parsedProposal.substrate_map_id !== map.map_id ||
    parsedProposal.scope_ref !== map.scope_ref
  ) {
    fail(
      "proposal_error",
      "$proposal does not bind the supplied living substrate map",
    );
  }
  const facetIds = new Set(map.facets.map((facet) => facet.facet_id));
  for (const action of parsedProposal.actions) {
    if (action.target_refs.some((ref) => !facetIds.has(ref))) {
      fail(
        "proposal_error",
        "$proposal contains an action with an unknown target facet",
      );
    }
  }
  return parsedProposal;
}

export function encodeRegenerationProposal(value: unknown): Uint8Array {
  return Uint8Array.from(
    Buffer.from(canonicalJson(validateRegenerationProposal(value)), "utf8"),
  );
}

export function regenerationProposalUrn(id: Sha256Id): string {
  const parsed = sha256(id, "$proposal_id", "proposal_error");
  return `urn:agenttool:living-substrate:proposal:${parsed}`;
}

export function regenerationProposalDomainBytes(value: unknown): Uint8Array {
  const proposal = validateRegenerationProposal(value);
  const { proposal_id: _proposalId, ...body } = proposal;
  return Uint8Array.from(
    Buffer.from(
      `${LIVING_SUBSTRATE_FORMATS.proposal}\u0000${canonicalJson(body)}`,
      "utf8",
    ),
  );
}
