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
- Keep the public client to the eight closed methods in `AlchemyReadMethod`.
  Never add `rawRpc`, `request(method, params)`, model-supplied URLs, headers,
  credentials, signing, broadcasting, retries, or provider-admin operations.
- The injected transport receives only a fixed network identity, a closed
  method/parameter tuple, CAIP-2 binding, and cancellation/deadline/byte
  limits. It owns trusted endpoint mapping, credential injection, JSON-RPC
  envelope/id generation and validation, bounded streaming, status/provider
  error collapse, and returns only a parsed result rebound to the method and
  chain.
- Validate public objects with exact key sets at runtime. Keep address, hash,
  quantity, page, range, cursor, field, response, and deadline bounds explicit.
- Never receive or surface raw provider bodies, JSON-RPC messages/data, transport
  exceptions, URLs, headers, or credentials in errors.
- Preserve honest provenance. A configured chain ID is not endpoint proof;
  provider `safe`/`finalized` tags are assertions; numbered blocks have unknown
  finality; indexed transfers can lag.
- `getAssetTransfersPage` makes exactly one call. Do not add automatic
  pagination, polling, subscriptions, or retry. Keep provider-documented
  category/network restrictions explicit; never turn unsupported coverage into
  an empty result.
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
