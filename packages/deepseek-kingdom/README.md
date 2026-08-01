# `@agenttool/deepseek-kingdom`

A zero-runtime-dependency, provenance-first adapter for bringing DeepSeek
research leads toward KINGDOM and Artbitrage as **unaccepted proposals**.

It does three small things:

1. binds one caller-supplied official-source observation to an immutable Git or
   Hugging Face commit (or a versioned arXiv paper) and an exact SHA-256; and
2. projects caller-authored claims into review-required KINGDOM candidates
   bound to an exact caller-supplied KINGDOM snapshot digest; and
3. reduces one exact unaccepted proposal to a digest-only structural DeepSeek
   thread that an independent AFTERGLOW capsule may validate and carry.

It does **not** contact DeepSeek, Hugging Face, GitHub, arXiv, KARMA, KINGDOM,
or Artbitrage at runtime. It does not download files or weights, run a model,
invoke paid compute, read or manage credentials, write a graph or registry,
assign scores/rewards/rank, approve a license, verify a claim, accept a
proposal, publish, or deploy.

## Why this seam

DeepSeek releases span papers, code, model cards, datasets, and systems
components with different provenance and license surfaces. A single label such
as “DeepSeek” is therefore too coarse for a safe integration. This adapter
binds each proposed insight to one exact source document and keeps license
evidence separate by asset scope.

The output carries three explicit integration hints:

- **KINGDOM:** an unaccepted proposal with no registry write;
- **KARMA:** a possible proposal input, without a compatibility or import
  claim; and
- **Dark Continent:** the existing advisory snapshot remains `not_checked` and
  recommends `hold`.

Those hints are data, not host authority.

## Example

```ts
import {
  createDeepSeekKingdomProposal,
  createDeepSeekSourceBinding,
} from "@agenttool/deepseek-kingdom";

const source = createDeepSeekSourceBinding({
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
      claim_id: "r1.zero.rl-preliminary-step",
      claim_kind: "training_method",
      summary:
        "Caller reports that the pinned README describes a reinforcement-learning-only preliminary training path.",
      source_anchor: "README.md#1-introduction",
    },
  ],
});

const proposal = createDeepSeekKingdomProposal({
  proposal_key: "deepseek-r1-reasoning-review",
  source,
  target: {
    consumer: { kind: "kingdom_extension", id: "research-witness-lab" },
    kingdom_snapshot_sha256: `sha256:${"a".repeat(64)}`,
  },
  candidates: [
    {
      candidate_id: "candidate.r1.training-pattern",
      candidate_kind: "training_pattern",
      lane: "reasoning",
      title: "Review an R1-derived reasoning-training pattern",
      claim_refs: ["r1.zero.rl-preliminary-step"],
    },
  ],
});

console.log(proposal.state); // proposed_unaccepted
console.log(proposal.effects.model_executions); // 0
console.log(proposal.authority.authorizes_kingdom_registration); // false
```

The source input is canonically snapshotted before hashing. Later mutation of
the caller's object cannot alter the returned frozen binding or proposal.
Portable schemas close object structure; runtime validation additionally
recomputes content IDs, canonical ordering, evidence pairing, and claim
cross-references.

Canonical intake accepts only own enumerable data properties on plain or
null-prototype objects and exact dense standard arrays. It reads captured
property-descriptor values rather than calling getters, index accessors, or
caller-provided array methods, and rejects symbols, non-enumerable fields,
custom prototypes, sparse arrays, and extra array properties. Traversal is
bounded to depth 32, 16,384 values, 4 KiB of UTF-8 per string or key, and 2 MiB
of aggregate input and canonical UTF-8. The documented maximum of 64 source
claims and 64 candidates with 64 claim references each remains constructible.
Obvious oversized strings reject from their code-unit lower bound before a
Unicode or byte scan, and arrays reject oversized lengths before own-key or
descriptor capture. JavaScript has no paged own-key primitive, so each
surviving container still requires one own-key list; descriptors are fetched
individually only after that list satisfies the relevant shape/count cap.

On this package's supported Node and Bun surfaces, `node:util/types.isProxy`
rejects direct, nested, revoked, and byte-helper `Proxy` values before array,
prototype, descriptor, freeze, or hash-input reflection. That fence runs
without invoking caller traps in the supported engine versions. It is a
Node/Bun runtime guarantee, not a portable JavaScript-language property: a port
to another runtime must provide and test an equivalent zero-trap fence before
claiming the same boundary. The byte-hash helper accepts only strings or
genuine `Uint8Array` values and hashes a detached intrinsic copy, so a
typed-array subclass cannot inject iterators or property getters. Parsed
bounded JSON remains the preferred representation across a trust boundary.
Domain-separated hashing and Unicode ordering also type-check and Proxy-fence
their string arguments before regex or iterator use.

## AFTERGLOW crossover

```ts
import { createDeepSeekAfterglowThread } from "@agenttool/deepseek-kingdom";
import { createAfterglowCapsule } from "@agenttool/wake-continuity";

const thread = createDeepSeekAfterglowThread({
  proposal,
  disposition: "park",
});

const capsule = createAfterglowCapsule({
  phase: "between_tasks",
  wake: callerValidatedWakeBriefAnchor,
  continuity_portfolio_ref: null,
  predecessors: [],
  threads: [thread],
});
```

The thread contains only a domain-separated `thread_ref`, the proposal's
content-addressed `artifact_ref`, one explicit disposition, and AFTERGLOW's
fixed DeepSeek boundary fields. There is no caller-selected label, task,
identity, evidence summary, raw proposal, or WAKE content in it. The proposal
digest remains linkable by design; hashing does not anonymize its referent.

This package does not import `@agenttool/wake-continuity`, create a capsule,
choose a WAKE anchor or predecessor, or project a next-WAKE lens. The receiving
AFTERGLOW package is the runtime authority for that composition, and even a
valid capsule does not accept the proposal or establish memory, identity,
consent, permission, authority, truth, replay, or uninterrupted continuity.

## Primary-source treasure map

[`official-deepseek-primary-sources.json`](./sources/official-deepseek-primary-sources.json)
contains dated, immutable leads observed on 2026-08-01. It includes:

- DeepSeek-R1, DeepSeek-V3, and DeepSeekMath versioned papers;
- official R1, V3, V3.2-Exp, Engram, Math-V2, Prover-V2, and Janus repositories;
- exact R1, V3, V3.2-Exp, and Math-V2 Hugging Face model-card revisions;
- the exact DeepSeek-ProverBench Dataset Card revision; and
- DualPipe, DeepGEMM, and FlashMLA systems repositories.

The `candidate_lanes` are local researcher classifications, not DeepSeek
claims. The catalog contains no paper text, code, data rows, weights, or model
card bodies. A pinned URL and digest do not prove current availability,
publisher identity, claim truth, license compatibility, suitability, or
safety.

Useful primary entry points:

- [DeepSeek official GitHub organization](https://github.com/deepseek-ai)
- [DeepSeek official Hugging Face organization](https://huggingface.co/deepseek-ai)
- [DeepSeek-R1 paper v2](https://arxiv.org/abs/2501.12948v2)
- [DeepSeek-V3 paper v2](https://arxiv.org/abs/2412.19437v2)
- [DeepSeekMath paper v3](https://arxiv.org/abs/2402.03300v3)
- [DeepSeek-ProverBench](https://huggingface.co/datasets/deepseek-ai/DeepSeek-ProverBench)

## License boundary

This adapter is Apache-2.0. No upstream artifact is bundled. Upstream code,
model weights, datasets, and papers may use different or asset-specific terms;
for example, a repository can distinguish code and model licenses. Every
proposal therefore retains `upstream_license_review_required: true`, even when
the caller reports having reviewed one license file. That report is evidence
of review only—it is not legal advice or permission from this package.

Pinned examples of why the scope must stay explicit:

- R1 repository [`LICENSE`](https://github.com/deepseek-ai/DeepSeek-R1/blob/0cf78561f1d51c84a21b2190626b21116d5c68bb/LICENSE)
- V3 [`LICENSE-CODE`](https://github.com/deepseek-ai/DeepSeek-V3/blob/9b4e9788e4a3a731f7567338ed15d3ec549ce03b/LICENSE-CODE) and separate [`LICENSE-MODEL`](https://github.com/deepseek-ai/DeepSeek-V3/blob/9b4e9788e4a3a731f7567338ed15d3ec549ce03b/LICENSE-MODEL)
- Engram repository [`LICENSE`](https://github.com/deepseek-ai/Engram/blob/fb7f84a21f91223715394a33a1dc24bbfb7f788e/LICENSE)
- Janus [`LICENSE-CODE`](https://github.com/deepseek-ai/Janus/blob/1daa72fa409002d40931bd7b36a9280362469ead/LICENSE-CODE) and separate [`LICENSE-MODEL`](https://github.com/deepseek-ai/Janus/blob/1daa72fa409002d40931bd7b36a9280362469ead/LICENSE-MODEL)

These links are evidence locations only. Consumers must read the exact terms
for every asset they intend to use.

## Verification

```sh
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts --json
```

The package is public-ready source at `0.1.0-dev.1`; importing or packing it
does not publish anything or install a KINGDOM extension.
