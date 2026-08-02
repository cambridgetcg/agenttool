# @agenttool/living-substrate

`@agenttool/living-substrate` is a zero-runtime-dependency TypeScript contract
for looking beneath a software system's visible surface.

It compiles caller-supplied, digest-only facets and relations into a
deterministic `LivingSubstrateMap`. A separate `RegenerationProposal` can carry
zero or more caller-supplied tending invitations. The package does not inspect
the world, diagnose health, generate a prescription, choose an action, or
execute anything.

The ecological vocabulary is a structural metaphor, not a claim that software
is literally alive or that a package can establish life, wellbeing,
consciousness, truth, consent, or authority.

## Why substrate

A thin green surface can conceal compaction, rubble, interrupted cycles, and
missing habitat. Software can likewise display a polished feature while its
underlying relationships remain brittle or absent. This contract makes the
reported layers and relationships addressable without collapsing them into a
single readiness, vitality, value, or health score.

The design takes four useful ecological patterns as inspiration:

- keep living roots and cover, minimize disturbance, and increase diversity;
- preserve pore space and flows rather than treating a surface as the system;
- notice communities, decomposition, exchange, and succession together;
- assess and characterize before selecting a cleanup or long-term action.

Those patterns are an architectural inference from
[USDA NRCS soil-health principles](https://www.nrcs.usda.gov/conservation-basics/soil/soil-health),
[USDA guidance on disturbance and compaction](https://www.nrcs.usda.gov/state-offices/north-dakota/soil-health-principle-2-of-4-minimizing-soil-disturbance),
[FAO soil-biodiversity work](https://www.fao.org/global-soil-partnership/areas-of-work/soil-biodiversity/en/),
and the
[US EPA greener-cleanup sequence](https://www.epa.gov/greenercleanups/epa-principles-greener-cleanups).
They are not scientific validation of this software abstraction.

## Shape

```text
caller-supplied digest facets + directed digest relations
                         │
                         ▼
              LivingSubstrateMap
        bounded, incomplete, content-addressed
                         │
              explicit separate input
                         ▼
              RegenerationProposal
       0..64 proposed-unaccepted invitations
                         │
          no default / no execution / no penalty
```

A map facet has a closed kind:

`layer`, `community`, `exchange`, `decomposition`, `succession`, `capacity`,
`refugium`, `disturbance`, or `contamination`.

Its condition is only caller-reported:

`reported_present`, `reported_absent`, `reported_supporting`,
`reported_mixed`, `reported_strained`, `reported_constrained`,
`reported_disturbed`, `reported_recovering`, `not_observed`, or `unknown`.
`not_observed` records an explicit coverage gap; it is not the same claim as
`reported_absent`.

Relations are directed and closed:

`contains`, `supports`, `feeds`, `buffers`, `constrains`, `disturbs`, or
`precedes`.

There are no fields for raw labels, prose descriptions, raw identities,
timestamps, quantities, prices, priorities, package-generated recommendations,
or scores in the wire artifacts. Digest refs can still be identifying or
linkable when derived from identity-bearing or guessable material.
`capacity` and `exchange` can represent a caller's bounded structural context;
money, compute, storage, attention, time, and materials remain possible
external enabling conditions, never worth, rank, or primary goals.

## Create a map

```ts
import {
  createLivingSubstrateMap,
  sha256Id,
} from "@agenttool/living-substrate";

// Use reviewed exact bytes or high-entropy local tokens. Hashing a guessable
// identity, task, path, or private sentence does not make it anonymous.
const layer = sha256Id("high-entropy local facet token: layer");
const community = sha256Id("high-entropy local facet token: community");

const substrate = createLivingSubstrateMap({
  scope_ref: sha256Id("high-entropy local scope token"),
  facets: [
    {
      facet_id: layer,
      kind: "layer",
      condition: "reported_disturbed",
      evidence_refs: [sha256Id("exact retained evidence bytes")],
      assertion: "caller_asserted",
      verified_by_package: false,
    },
    {
      facet_id: community,
      kind: "community",
      condition: "reported_constrained",
      evidence_refs: [],
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
  relations: [
    {
      from_ref: layer,
      relation: "supports",
      to_ref: community,
      evidence_refs: [],
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
});

substrate.coverage; // "bounded_not_complete"
substrate.boundaries.scores_vitality; // false
substrate.boundaries.observes_environment; // false
```

Input order is normalized. Facets, relations, and evidence references are
sorted, copied, deep-frozen, and bound by a domain-separated SHA-256 content
ID. A relation must connect two facets in the same map and cannot be a
self-edge.

An empty map is valid. It means only that this bounded artifact contains no
reported facets; it does not mean the scope is empty, healthy, broken, safe, or
fully observed.

## Propose without prescribing

```ts
import {
  createRegenerationProposal,
  sha256Id,
} from "@agenttool/living-substrate";

const proposal = createRegenerationProposal(substrate, {
  actions: [
    {
      action_ref: sha256Id("high-entropy local action token"),
      kind: "allow_fallow",
      target_refs: [layer],
      basis_refs: [],
      reversibility: "reversible",
      state: "proposed_unaccepted",
      authority: "separate_authority_required",
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
});

proposal.choice.selection; // "none_made_by_package"
proposal.choice.rest_valid; // true
proposal.choice.decline_valid; // true
proposal.choice.leave_valid; // true
proposal.choice.penalty; // false
```

Action kinds include observing more, removing a contaminant, decompacting,
restoring flow, adding diversity, feeding a cycle, creating a refuge, allowing
fallow, repairing a boundary, composting a lesson, releasing, and doing
nothing.

The package never synthesizes one of these actions. Every action is explicit
caller input, remains `proposed_unaccepted`, and requires separate authority.
Zero actions, rest, doing nothing, deferral, refusal, and leaving are valid
without a reason, retry, score change, or penalty. An irreversible action label
does not grant permission; it makes the need for separate authority explicit.

## Validation boundary

`validateLivingSubstrateMap` checks the complete map shape, canonical order,
duplicate IDs, directed relation uniqueness, endpoints, fixed boundaries, and
content ID.

`validateRegenerationProposal` checks a standalone proposal's complete shape,
canonical order, fixed choice and authority walls, and content ID.
`validateRegenerationProposalAgainstMap` additionally checks the exact map and
every action target.

Runtime canonicalization rejects:

- Proxies, including revoked and nested Proxies, before caller traps run;
- accessors, symbols, cycles, custom prototypes, sparse arrays, and extra
  properties;
- malformed Unicode, unsafe integers, `-0`, bigint, functions, and other
  non-JSON values;
- duplicate facet, relation, evidence, action, target, or basis references;
- widened network, execution, economic, authority, scoring, or acceptance
  boundaries.

`sha256Id` accepts strings or genuine `Uint8Array` values and copies byte input
before hashing. A digest gives byte identity, not confidentiality, provenance,
currentness, truth, or unlinkability.

## What it does not do

The fixed boundary is part of every content-addressed artifact. The package:

- performs no network, filesystem, environment-variable, clock, randomness,
  credential, telemetry, model, provider, or Hugging Face access;
- performs no persistence, publication, hosted Garden write, WAKE, Chronicle,
  HEAVEN, KARMA, task, wallet, ranking, or economic effect;
- does not fetch evidence, inspect digest referents, diagnose readiness,
  measure vitality, infer interior state, or verify caller assertions;
- does not prove identity, authorship, consent, authority, safety, truth,
  currentness, privacy, reference minimization, or absence of linkability;
- does not grant permission, accept a proposal, execute an action, or penalize
  rest, refusal, leaving, or an empty proposal.

## Portable contracts

- `@agenttool/living-substrate/map.schema.json`
- `@agenttool/living-substrate/proposal.schema.json`
- `@agenttool/living-substrate/kingdom.extension.json`
- `vectors/agenttool-living-substrate-v0.1.json` in the packed package

Both schemas are closed Draft 2020-12 documents. JSON Schema checks structure;
the runtime remains authoritative for sorting, cross-references, semantic
uniqueness, and content-ID recomputation.

The KINGDOM descriptor is declaration-only with `host_contract` set to
`not_registered`. Loading it installs nothing. This source is public-ready;
repository presence does not mean npm publication, a release, a hosted route,
deployment, or registration occurred.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
