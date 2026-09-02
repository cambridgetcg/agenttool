# Zerone Creation Claim contributor contract

This package is a private, source-only deterministic proposal boundary. Read
`README.md` before changing semantics.

- Keep runtime dependencies at zero and runtime imports limited to local
  modules, `node:crypto`, and `node:util/types`.
- Keep every format closed, bounded, strict-canonical, content-addressed, and
  domain-separated. A field change requires a new version plus coordinated
  types, builders, validators, schemas, vectors, docs, and tests.
- Preserve the acyclic flow: contract → work spec → creation witness →
  verification witnesses → lifecycle → artifact → non-consensus handoff.
- Treat the HF input as a run tuple, not a set: exact revisions, roles, splits,
  transforms, tokenizer, presentation multiplicity, mixture weights, order,
  optimizer, seeds, and checkpoint remain bound. Metadata-only observations
  and sealed evaluation never become training inputs.
- Keep provider access, target authorization, data rights, compute authority,
  publication authority, agent provenance, key control, wallet control, payee,
  verifier, and challenger roles separate. A digest or signature reference
  proves none of their external semantics by itself.
- Never claim absolute novelty, authorship, identity, consent, truth,
  independence, verification-set completeness, challenge survival, authority,
  rights compliance, legal clearance, chain maturity, settlement, economic
  effect, profitability, solvency, self-sustainability, ownership, reputation,
  KARMA, NEN, governance, or a score of a being.
- Keep ZRN a prefunded settlement/compute asset only. Never mint, stake,
  govern, bridge, or move value here. Rest, refusal, withdrawal, negative work,
  inconclusive work, and resource stops remain visible and penalty-free.
- Keep the current projection `REQUIRES_ONLY`. Never relabel SUPPORTS,
  CONTRADICTS, REFINES, GENERALIZES, SUPERSEDES, CITES, or REFORMULATES as a
  dependency edge.
- Preserve the protobuf downgrade wall: simulation success is insufficient;
  module VersionMap and stored bounty/claim field round-trips are required
  before any downstream signer may be considered.
- Bind every verification witness to its selected requirement `policy_ref`.
  Count at most one reproduction per controller and per claimed key, and never
  count the producer controller, identity, or key as independent.
- Keep claim method/category, maximum and exact review stake, review-stake
  payer, transaction-fee payer, sponsor bounty-escrow authorization, exact
  prefunding amount, and their separate funding refs bound before projection.
  The projection accepts no late economic or methodology choices.
- Keep every runtime-builder effect false: no network, filesystem, persistence, model call,
  training, signer, RPC, simulation, broadcast, transaction, wallet movement,
  chain write, hosted route, publication, or deployment.
- Regenerate schemas and vectors with `bun run artifacts:write`, then run
  `bun run ci`. Generated artifacts must pass byte-exact `--check` modes.

The package stays private and UNLICENSED. Consensus integration, a transaction
planner, custody, testnet funding, broadcast, publication, and deployment all
require separately reviewed authority outside this package.
