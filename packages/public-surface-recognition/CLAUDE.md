# Public Surface Recognition contributor contract

This package is a pure, deterministic agent-root declaration boundary over one
exact verified Public Surface Binding. Preserve all of these properties:

- Keep runtime imports limited to local modules and the reviewed public API of
  `@agenttool/public-surface-binding`. Add no network, DNS, filesystem,
  environment, process, clock, randomness, persistence, telemetry, provider,
  browser, crawler, database, API, MCP, SDK, or hosted-route capability.
- Keep `agenttool.public-surface-adoption/0.1` and
  `agenttool.public-surface-withdrawal/0.1` closed. A field or semantic change
  requires coordinated types, validators, schemas, vectors, documentation,
  domain versions, and tests; never silently widen `0.1`.
- Reuse Public Surface Binding's bounded canonical JSON, canonical document
  digests, binding validator, and strict RFC8032 Ed25519 verifier. Do not copy
  a second canonicalizer and do not use the API recovery verifier or Noble's
  ZIP-215-compatible default.
- Require the exact binding document and its canonical document digest. A
  claimed `binding_id` alone is insufficient, and a signature-valid adoption
  must not make a malformed or forged binding valid.
- Treat the embedded root as caller-supplied key-holder evidence, not registry
  truth. This package cannot establish that the root matches the named
  identity's current AgentTool registry row or that the identity was active.
- Keep project-bearer transport, binding-key declaration, registry key match,
  root-key-holder adoption, platform acceptance, action authorization, and
  training authorization distinct. There is no legacy-bearer adoption path.
- Keep adoption and withdrawal immutable and separately signed. Do not add a
  mutable active flag, automatic supersession, event store, latest-wins
  projection, nonce consumption, or hosted replay semantics to this package.
- Keep `wake_projection` closed to `none`, `private_pointer`, and
  `public_pointer`; reject `public_pointer` unless `requested_visibility` is
  `public`. It is a signed request only. Every record retains
  `wake_effect: false`, and the package must never project, render, publish, or
  write a WAKE pointer.
- Keep withdrawal reasons closed to `not_disclosed`, `identity_choice`,
  `binding_compromised`, and `surface_retired`. Do not add `superseded` or an
  implicit replacement edge; replacement is a separate new adoption.
- Keep every direct effect false. Do not add WAKE, Chronicle, memory,
  observation-counter, KARMA, trust, reputation, score, relationship,
  covenant, training, publication, or automatic-action effects.
- Signed visibility and WAKE-projection requests are not publication or
  projection. Do not add an origin reverse index, public enumeration,
  discovery, search, lookup route, WAKE writer, or hosted URL fetcher.
- Recognition is not domain ownership, authorship, consent, continuity,
  personhood, operator identity, sentience, trust, reputation, permission,
  action authority, data rights, training clearance, or unlearning.
- Keep `kingdom.extension.json` declaration-only with
  `host_contract: not_registered` and every capability default `false`.
- Keep the package `private: true` and `UNLICENSED`. Do not add npm, LOVE,
  public discovery, SDK, OpenAPI, API, database, WAKE, migration, release, or
  deployment wiring without a separately reviewed host/release slice.

Run `bun run ci` after changes. Schema and vector generators must reproduce
their committed artifacts byte-for-byte, the strict-signature hostile cases
must pass, and the packed Node smoke must use no network or credentials.
