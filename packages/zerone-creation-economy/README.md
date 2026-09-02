# `@agenttool/zerone-creation-economy`

Private, source-only bridge from a fully recomputed bounded-creation bundle to
exact unsigned Zerone sponsorship-v2 and knowledge-v7 protobuf values.

The bridge exists because the creation protocol and the older general economy
candidate have different canonical records. In particular, the general
economy candidate hashes a distinct `WorkSpec`, fixes claim category to
`computational`, leaves `canonical_form` empty, and uses its own source-work ID
as `reasoning_trace`. Creation records instead preserve their selected formal
or computational category and method, digest envelope as canonical form,
creation witness ID as reasoning trace, and original creation `work_spec_id` in
both chain messages and the work-receipt preimage. Coercing one format into the
other would silently change the contract.

This package therefore owns a separate
`agenttool.zerone-creation-economy-message-projection/0.1` format. It:

- revalidates and recomputes the exact contract, WorkSpec, producer witness,
  caller-selected verification set, lifecycle, creation artifact, and source
  claim projection; validating a serialized handoff therefore also requires
  that exact source bundle and its in-process proof;
- requires a cryptographically verified in-process Ed25519 + secp256k1
  wallet-binding proof and exact binding/address/key/descriptor
  correspondence, while requiring the sponsor and worker to use different
  account addresses and wallet-controller references;
- accepts only a CAIP-2-sized requested-chain label matching
  `zerone-creation-private-<nonce>` (the nonce is 1–8 lowercase
  alphanumeric/hyphen characters and cannot end in a hyphen), while explicitly
  recording that the label does not prove the chain is unique, private, or
  disposable and that its key-control proof remains scoped to the released
  `zerone-testnet-1` wallet profile; requires zerone-core
  `a5b82e82b2a32be2b75bd11575964b0a69aa34ac`, knowledge v7, and sponsorship
  v2;
- derives the exact Zerone work receipt over the original creation WorkSpec
  hash and payee;
- emits one Create-bounty projection and one Submit-claim projection for
  separate transaction plans;
- preserves target Tree-of-Knowledge identifiers, the proposed base root, and
  parent Fact IDs as hash-bound context only; knowledge-v7 does not enforce the
  target tree or expose a base-root compare-and-swap in these messages; and
- leaves fulfillment blocked until authenticated chain state proves the stored
  Fact, challenge closure, maturity, assignment, and payout conditions.

The committed vectors cover two bounded source cases: a formal-math creation
and an OpenAI-Cyber-labelled defensive-security creation whose claim is
`computational` / `M-COMPUTATIONAL`. The second case carries separate provider
access, provider policy, target authorization, engagement scope, and
publication authority references. Its two additional source witnesses make the
creation lifecycle structurally ready, but the bridge still records those refs
as caller declarations and keeps authorization/scope currentness false. The
bridge profile intentionally admits only `none` / `not_used` for formal work
and `openai_cyber` / `defensive_approved` for defensive work; other source-valid
provider tuples remain outside this adapter. The provider label does not assert
an API request, model identity, approved account, or execution. This matches the
[official OpenAI documentation](https://learn.chatgpt.com/docs/cyber-safety):
Daybreak access depends on approval and provisioning for the exact identity or
service, workspace or API organization/project, offering/model, and product
surface; it does not itself configure or authorize a target environment.
Provider access is never target authorization.

For Hugging Face-backed mathematical work, the source contract binds an exact
run tuple—repository revisions/content roots, material roles, split,
transforms, tokenizer, multiplicities, mixture weights, order, optimizer, seed,
and checkpoint—rather than treating the corpus as a mathematical set. The
bridge recomputes that tuple through the source `contract_id`, `input_root`, and
receipt roots. It neither fetches a repository nor trains a model, and its
bounded-candidate state remains weaker than global novelty or truth.

The resulting exact value bytes are offline review material. A separate,
reviewed private-chain wallet profile does not yet exist, so these bytes are
not wallet-planner admissible. They are not a signature, transaction,
activation proof, reservation, broadcast, Fact, payout, earning, or treasury
balance. Provider access, an off-chain verification quorum, a caller-declared
chain profile, or a valid wallet-key proof cannot supply any of those facts.
The JSON Schemas are structural portability checks only; semantic admission
requires the source-bound runtime validator.

The pinned chain candidate is not economically admissible. The current audit
found a named source-map handler for the knowledge-v6→v7 and
sponsorship-v1→v2 transition, but its exclusivity against every generic
migration path is not yet proven. Ordinary funded accounts can also occupy
verifier commit seats without a cryptographically verified active-validator
selection proof. A worker-controlled quorum could therefore mature its own
payable Fact. This package pins its value and `Any` bytes against Zerone's
generated Go types, but an authenticated create/query/restart/export-import
stored-state round trip is still a gate. Any chain exercise under the requested profile is
mechanics-only; it cannot be cited as economic-security, mainnet, settlement,
or self-sustainability evidence.

ZRN remains a settlement and compute asset. It does not create identity,
truth, authorship, consent, KARMA, governance, rights, worth, or a duty to
continue working. Rest and refusal remain unconditional.

## Verification

```bash
cd packages/zerone-creation-economy
bun run ci
```

There is no release, hosted route, signer, RPC, simulation transport,
broadcaster, funding operation, or deployment surface in this package.

The committed TypeScript fixture is
[`vectors/zerone-creation-economy-v0.1-vectors.json`](vectors/zerone-creation-economy-v0.1-vectors.json).
Its exact value and `Any` bytes are independently reproduced with the pinned
Zerone Go protobuf types in
[`vectors/go-cosmos-creation-economy-v0.1.json`](vectors/go-cosmos-creation-economy-v0.1.json).
The manual Go generator refuses a different Git head, tracked changes, or
untracked/ignored extras under the relevant Zerone protobuf/receipt sources and
records that evidence in its output. Package CI compares the committed Go
bytes with both TypeScript cases; it does not itself provision Go or rerun the
generator.
