# `@agenttool/alchemy`

Bounded, read-only Alchemy observation primitives. This package owns neither
credentials nor endpoint selection. It does not own hosted API routes, MCP,
signing, simulation, broadcast, subscriptions, webhooks, provider
administration, npm publication, or deployment.

The current source version is `0.1.0-dev.0`; it is not evidence of a registry
release.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --ignore-scripts --dry-run --json
```

## Invariants

- Keep zero runtime dependencies and Node 20.19+/Bun 1.3.5+ compatibility.
- Keep the underlying provider surface to the eight closed methods in
  `AlchemyReadMethod`; the public client has separate initial-page and
  continuation entrypoints for asset transfers. Never add `rawRpc`,
  `request(method, params)`, model-supplied URLs, headers, credentials,
  signing, broadcasting, retries, or provider-admin operations.
- The injected transport receives only a fixed network identity, a closed
  method/parameter tuple, CAIP-2 binding, and cancellation/deadline/byte
  limits. It owns trusted endpoint mapping, credential injection, JSON-RPC
  envelope/id generation and validation, bounded streaming, status/provider
  error collapse, and returns only a parsed result rebound to the package
  operation ID, method, and chain.
- Validate public objects with exact key sets at runtime. Keep address, hash,
  quantity, page, range, cursor, field, response, and deadline bounds explicit.
- Bind every non-null result back to the request. A numbered block must have
  the requested number; transaction and receipt hashes must match; every
  transfer must satisfy the requested block, address, category, and
  category-applicable contract filters. Fail closed on any mismatch.
- Never receive or surface raw provider bodies, JSON-RPC messages/data, transport
  exceptions, URLs, headers, or credentials in errors.
- Preserve honest provenance. A configured chain ID is not endpoint proof;
  provider `safe`/`finalized` tags are assertions; numbered blocks have unknown
  finality; indexed transfers can lag.
- `getAssetTransfersPage` and `getNextAssetTransfersPage` each make exactly one
  provider call. Do not add automatic pagination, polling, subscriptions, or
  retry. Never accept a raw provider `pageKey` from or return one to the
  high-level client caller: continuation uses an opaque, module-realm-local
  cursor bound to its normalized query, network, and issuing client. It is not
  state-serializable, cross-client, or restartable, and has no readable
  continuation fields. JSON serialization yields `{}` with no usable state.
  Enforce Alchemy's documented ten-minute page-key TTL locally. The trusted
  injected transport necessarily sees the provider key inside the closed
  Alchemy request/result boundary; keep it confined to that boundary and
  package internals. Keep provider-documented category/network restrictions
  explicit; never turn unsupported coverage into an empty result.
- The `agentcred.evm-jsonrpc-read/0.1` profile covers only the seven standard
  `eth_*` methods, not `alchemy_getAssetTransfers`. The reference broker's
  32 KiB maximum grant response is stricter than this package's 2 MiB ceiling,
  and `callEvmJsonRpcRead` has no per-use signal/deadline argument. The package
  can stop waiting while dispatched broker work and quota consumption continue.
- Keep tests hermetic with fake transports. No provider credential, endpoint,
  paid call, network call, signer, or wallet belongs in tests.
- Keep package version, exported `PACKAGE_VERSION`, transport protocol, tests,
  docs, and any future immutable release inventory aligned.
- External publication and deployment remain explicit operator actions.

## Tests

Cover every exact method/parameter tuple; fixed network mapping; normalized
typed results; null and pending observations; indexed/live provenance;
unknown-field rejection; address/hash/quantity/page/range/cursor bounds;
response, code, and transaction-input sizes; abort/deadline behavior; chain-ID
mismatch; provider/transport error sanitization; packed contents; and built
Node import.
