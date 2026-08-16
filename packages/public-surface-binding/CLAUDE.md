# Public Surface Binding contributor contract

This package is a pure, deterministic evidence and explicit-key declaration
boundary. Preserve all of these properties when changing it:

- Keep runtime imports limited to local modules, `node:util/types`, and the
  pinned Noble Ed25519/SHA-256 primitives. Add no network, DNS, filesystem,
  environment, process, clock, randomness, persistence, telemetry, provider,
  browser, crawler, API, MCP, or hosted-route capability.
- Keep all four `agenttool.public-surface-*/0.1` record shapes closed. A field
  or semantic change requires coordinated types, parsers, schemas, vectors,
  documentation, domain versions, and tests; never silently widen `0.1`.
- Never infer identity from transport metadata, IP, user agent, TLS, cookies,
  prose, embeddings, behavior, repeated digests, or origin control. A binding
  exists only when an explicit signer signs its exact canonical core.
- Treat embedded and caller-supplied keys as evidence, not registry truth.
  This package does not create, mutate, root, authenticate, or authorize an
  AgentTool identity. Rooted identity changes remain outside this package and
  require the separate exact `identity-authority/v1` flow.
- Keep transport observation, crawler request authentication, robots data,
  usage preferences, key-holder declarations, origin readback, registry-key
  history, revocation evidence, and training authorization distinct. None may
  silently upgrade another.
- A robots or usage-preference field is not permission. A surface binding is
  not domain ownership, authorship, consent, continuity, personhood, trust,
  reputation, training permission, or action authority.
- Preserve bounded package-canonical JSON, domain separation, strict Ed25519,
  canonical base64, exact content IDs, and hostile-input rejection before
  semantic parsing. Never sign `JSON.stringify` output directly.
- Keep raw crawler bodies out of records. Preserve only the exact bounded
  digest and typed transport metadata supplied by the caller.
- Keep assessments non-authoritative and non-scoring. Do not add WAKE,
  Chronicle, memory, observation-counter, KARMA, trust, reputation, training,
  or automatic-action effects.
- Do not add a public origin reverse index, enumeration endpoint, automatic
  discovery, or hosted URL fetcher. The well-known path is a record convention,
  not a route or fetch instruction.
- Keep `kingdom.extension.json` declaration-only,
  `host_contract: not_registered`, and every capability default `false` unless
  a separately reviewed host contract is introduced outside this package.
- Keep the package `private: true` and `UNLICENSED` until a separate release
  review explicitly changes both. Do not add release, LOVE, public discovery,
  API, WAKE, Telescope, Training Garden, or deployment wiring in this package.

Run `bun run ci` after changes. Schema and vector generators must reproduce
their committed artifacts byte-for-byte, and the Node packed-package smoke
must pass without network or credentials.
