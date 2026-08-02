import {
  LIVING_SUBSTRATE_RELATIONS,
  LivingSubstrateError,
  createLivingSubstrateMap,
  createRegenerationProposal,
  sha256Id,
  validateLivingSubstrateMap,
  validateRegenerationProposalAgainstMap,
} from "../dist/index.js";

const facets = Array.from({ length: 64 }, (_, index) => ({
  facet_id: sha256Id(`smoke-facet:${String(index)}`),
  kind: index % 2 === 0 ? "community" : "layer",
  condition: index % 3 === 0 ? "reported_recovering" : "unknown",
  evidence_refs: [],
  assertion: "caller_asserted",
  verified_by_package: false,
}));
const relations = [];
for (let from = 0; from < facets.length && relations.length < 256; from += 1) {
  for (let to = 0; to < facets.length && relations.length < 256; to += 1) {
    if (from === to) continue;
    relations.push({
      from_ref: facets[from].facet_id,
      relation:
        LIVING_SUBSTRATE_RELATIONS[
          (from + to) % LIVING_SUBSTRATE_RELATIONS.length
        ],
      to_ref: facets[to].facet_id,
      evidence_refs: [],
      assertion: "caller_asserted",
      verified_by_package: false,
    });
  }
}
const map = createLivingSubstrateMap({
  scope_ref: sha256Id("smoke-scope"),
  facets: [...facets].reverse(),
  relations: [...relations].reverse(),
});
const proposal = createRegenerationProposal(map, {
  actions: Array.from({ length: 64 }, (_, index) => ({
    action_ref: sha256Id(`smoke-action:${String(index)}`),
    kind: index % 2 === 0 ? "observe_more" : "allow_fallow",
    target_refs: [facets[index].facet_id],
    basis_refs: [],
    reversibility: "reversible",
    state: "proposed_unaccepted",
    authority: "separate_authority_required",
    assertion: "caller_asserted",
    verified_by_package: false,
  })).reverse(),
});
const emptyProposal = createRegenerationProposal(
  createLivingSubstrateMap({
    scope_ref: sha256Id("empty-scope"),
    facets: [],
    relations: [],
  }),
  { actions: [] },
);

let traps = 0;
const trap = () => {
  traps += 1;
  throw new Error("Proxy trap executed");
};
const hostile = new Proxy(
  {},
  {
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    ownKeys: trap,
  },
);
let hostileRejected = false;
try {
  createLivingSubstrateMap(hostile);
} catch (error) {
  hostileRejected = error instanceof LivingSubstrateError && traps === 0;
}

if (
  validateLivingSubstrateMap(map).map_id !== map.map_id ||
  validateRegenerationProposalAgainstMap(proposal, map).proposal_id !==
    proposal.proposal_id ||
  map.facets.length !== 64 ||
  map.relations.length !== 256 ||
  proposal.actions.length !== 64 ||
  emptyProposal.actions.length !== 0 ||
  emptyProposal.choice.rest_valid !== true ||
  emptyProposal.choice.penalty !== false ||
  map.boundaries.network !== false ||
  map.boundaries.scores_vitality !== false ||
  !hostileRejected
) {
  process.exit(1);
}
