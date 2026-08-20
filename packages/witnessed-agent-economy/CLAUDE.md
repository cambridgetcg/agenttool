# Witnessed Agent Economy contributor contract

This package is a pure, source-only projection of selected AgentTool facts into
the zero-effect `kingdom.witnessed-agent-economy/0.1` shadow contract.

- Keep it offline and deterministic: no network, database, filesystem, clock,
  randomness, credentials, RPC, transaction broadcast, payment, hosted route,
  MCP, SDK, WAKE mutation, migration, deployment, or background process.
- The current `/v1/wake` response is never an input. `PUBLIC WAKE CONTRACT` is
  a new, closed, root-signed record containing four public roots only.
- Reuse and verify exact AgentTool source records where they exist. A projection
  must not turn a digest or signature into identity, consent, truth, competence,
  quality, reputation, authority, settlement finality, or global state.
- Settlement leaves use the existing `settlement-receipt/v1` canonical digest
  recipe and preserve its HMAC buyer reference. Never substitute a raw buyer
  identity or an unhashed DID.
- Capability nullifiers express the identifier a future consensus host would
  consume. This package does not consume it and must never call local durable
  usage global.
- Every shared counter, height, sequence, revision, and monetary amount is a
  canonical unsigned decimal string. Do not introduce JSON numbers for these.
- Merkle trees are RFC 6962 SHA-256 trees: `0x00` leaves, `0x01` nodes, and
  `SHA256(empty)` for the empty root. Do not duplicate an odd final leaf.
- Keep all formats closed. Any semantic change requires a new protocol version,
  schema, signing/hash domain, vectors, docs, and tests.
- Preserve explicit zero-effect and non-claim walls. No score, KARMA receipt,
  NEN invocation, or Zerone transaction is produced here.
- Keep the package private and UNLICENSED. No release or integration wiring is
  part of this slice.

Run `bun run ci` after changes. Deterministic schema and vector generators must
reproduce committed artifacts byte-for-byte.
