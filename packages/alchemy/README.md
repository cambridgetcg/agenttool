# `@agenttool/alchemy`

Developer-preview, zero-runtime-dependency client for bounded EVM reads through
Alchemy plus pure provider-neutral EVM evidence contracts. The read client
sends structural method/parameter tuples for only eight underlying provider
methods to an injected host-owned transport:

- `eth_chainId`
- `eth_blockNumber`
- `eth_getBlockByNumber` with transaction hashes only
- `eth_getBalance`
- `eth_getTransactionByHash`
- `eth_getTransactionReceipt`
- `eth_getCode`
- one bounded page of `alchemy_getAssetTransfers`

There is deliberately no generic RPC/request escape hatch. This package does
not accept a URL, API key, bearer header, signer, wallet, or provider-admin
token. It does not sign, simulate, broadcast, retry, subscribe, create or
modify webhooks, administer Alchemy, or expose the legacy `alchemy-sdk` or
Account Kit.

## Host-owned transport

The caller injects one structural transport:

```ts
import {
  createAlchemyReadClient,
  type AlchemyReadTransport,
} from "@agenttool/alchemy";

const transport: AlchemyReadTransport = {
  async send(request) {
    // This trusted host adapter:
    // 1. maps request.network to one fixed Alchemy origin;
    // 2. obtains and injects credentials without returning them to the agent;
    // 3. generates and validates the JSON-RPC envelope and correlation id;
    // 4. stops reading at request.maxResponseBytes;
    // 5. obeys request.signal and request.deadlineAtMs; and
    // 6. returns only a parsed result bound to the operation, method, and chain.
    const result = await trustedLocalBroker.readEvm({
      chainId: request.chainId,
      method: request.call.method,
      params: request.call.params,
      signal: request.signal,
      deadlineAtMs: request.deadlineAtMs,
      maxResponseBytes: request.maxResponseBytes,
    });
    return {
      operationId: request.operationId,
      chainId: result.chainId,
      method: result.method,
      result: result.result,
      auditId: result.auditId,
      redactions: result.redactions,
    };
  },
};

const alchemy = createAlchemyReadClient({
  network: "ethereum-mainnet",
  transport,
});

const balance = await alchemy.getBalance({
  address: "0x1111111111111111111111111111111111111111",
  block: "safe",
});
```

`trustedLocalBroker` is host application code, not an export from this
package. It must choose the endpoint from the fixed `request.network` enum;
never let model input select a URL. The transport boundary keeps credentials
out of the package and chat, but it does not by itself provide process
isolation or protect credentials from another process running as the same OS
user.

The negotiated `agentcred.evm-jsonrpc-read/0.1` profile is one suitable
transport for the seven standard `eth_*` operations: it generates the
envelope/id inside the broker, fixes the owner-approved origin and `/v2` path,
injects Bearer authentication, and collapses provider diagnostics. Its current
closed method set does not include `alchemy_getAssetTransfers`; that operation
needs a separately reviewed, equally closed Data API transport rather than a
fallback to generic HTTP.

The reference agentcred broker limits each granted response to 32 KiB, which is
stricter than this package's 2 MiB transport ceiling. A large block, code, or
transaction result can therefore fail at the broker before reaching the
package's own response checks. Its `callEvmJsonRpcRead` method also has no
per-use signal or deadline argument. The package can stop waiting at its
deadline, but an already-dispatched broker call may still finish and consume
provider or capability quota; cancellation is not rollback.

The fixed network descriptors cover Ethereum, Base, Polygon, Arbitrum, and
Optimism mainnets plus Sepolia/Amoy variants. They expose Alchemy's network
slug, not a credential-bearing URL.

## Bounded observations

```ts
const receipt = await alchemy.getTransactionReceipt({
  transactionHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});

const page = await alchemy.getAssetTransfersPage({
  fromBlock: "0x1400000",
  toBlock: "indexed",
  categories: ["erc20"],
  toAddress: "0x1111111111111111111111111111111111111111",
  pageSize: 50,
});

const nextPage =
  page.nextCursor === null
    ? null
    : await alchemy.getNextAssetTransfersPage(page.nextCursor);
```

Every call:

- rejects unknown input fields and malformed addresses, hashes, quantities,
  and block references, then lowercases validated hex identities;
- accepts only `latest`, `safe`, `finalized`, or a canonical numbered block
  for ordinary RPC reads—never `pending`;
- has a 30-second maximum call window and accepts an `AbortSignal` plus an
  absolute `deadlineAtMs`;
- asks the transport to enforce a 2 MiB raw-response ceiling and independently
  checks the parsed JSON result's depth, node count, and serialized size;
- caps byte-heavy code and transaction input fields;
- fails closed when a non-null numbered block has a different block number, a
  transaction or receipt has a different transaction hash, or a transfer falls
  outside the requested block, address, category, or category-applicable
  contract filters;
- returns only a validated subset of block, transaction, receipt, and transfer
  data, omitting floating human values and enriched token metadata; and
- never includes provider response text or transport exceptions in public
  errors.

Transfer calls return one page only. They require an explicit numeric start
block, at least one address/contract selector, one or more closed categories,
at most 100 items, at most 20 contract filters, and at most a 100,000-block
span when both ends are numbered. Each call to `getAssetTransfersPage` or
`getNextAssetTransfersPage` makes exactly one provider call; there is no
automatic crawl or retry.

A page exposes only `nextCursor` to the high-level client caller, never the
provider's raw `pageKey`. That key stays confined to package internals and the
closed request/result boundary seen by the trusted injected transport. The
cursor is opaque, process-local continuation state bound to the normalized
query, network, module realm, and client instance that issued it. It has no
readable continuation fields. JSON serialization produces `{}` and carries no
usable state; the resulting object is rejected. A cursor cannot be reused with
another client or after a process restart, and it expires locally ten minutes
after the page request began, matching
[Alchemy's documented page-key TTL](https://www.alchemy.com/docs/reference/transfers-api-quickstart#pagination).
The caller must deliberately pass it to `getNextAssetTransfersPage`; after
expiry or restart, begin again with a validated query. `internal` transfers
are accepted only on Ethereum Mainnet, Polygon Mainnet, and Base Mainnet,
matching Alchemy's
[documented support](https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers);
other category/network coverage can still vary and a provider error is not
converted into an empty result.

## Provenance and freshness

Every observation includes:

- the configured network and chain ID;
- the exact closed RPC method;
- local request and receipt times, parsed-result size, and any bounded
  transport audit/redaction receipt; and
- a freshness record distinguishing live RPC from Alchemy's indexed transfer
  data.

`configuredChainId` is the package's fixed mapping, not proof of the endpoint
used by the injected transport. `getChainId()` checks its observed result
against that mapping. Other calls do not secretly add a chain-ID request.

`latest` is labelled as reorg-sensitive provider-head evidence. `safe` and
`finalized` are labelled as provider assertions, not independent finality
proof. Numbered blocks retain unknown finality. Transfer results are always
labelled as index-backed and possibly lagging, including when their upper
bound is `latest` or `indexed`.

Use independent providers, confirmation/reorg policy, and durable canonical
identities when an observation changes money or authority. Alchemy remains
replaceable infrastructure evidence—not identity, consent, finality, or a
source of truth.

## Portable evidence and transitions

The dev.1 source candidate also exports pure, provider-neutral evidence
builders and parsers. `agenttool.evm-observation-evidence/0.1` binds an exact
EIP-155 CAIP-2 chain, block-number/hash plus transaction-hash/log-index
generation, and a decimal atomic quantity with its named chain, contract, and
base unit. Unavailable, not-observed, absent, live, removed, and conflicting
states remain distinct. Canonicality, confirmation, and settlement are
independent finality axes whose partial-order comparison can be incomparable;
they never become a scalar score.

Canonical evidence bytes are sorted JSON prefixed by the format and a NUL byte
before SHA-256. The record declares `private_linkable`: sharing its digest can
reveal that two records are equal and proves neither privacy nor truth. The
bounded source receipt carries no raw provider body. Evidence construction does
not fetch, retain a transfer cursor, select a provider, or turn a provider
assertion into consensus.

`agenttool.evm-evidence-transition-receipt/0.1` records one explicit semantic
relation between exact from/to digests and lists preserved/discarded facets,
assumptions, a counterexample, and a stop condition without applying a state
change. The separate, Math Cards-shaped measurement projection keeps an exact
decimal `atomic_value` and `atomic_unit`, binds measurand and operationalization,
and carries procedure, calibration, and uncertainty references. It declares
`host_contract: not_registered`; it is not a hosted or registered Math Card.

The exported `EVM_EVIDENCE_NON_GRANTS` boundary makes explicit that none of
these records grants action, authority, consent, custody, finality, identity,
permission, privacy, provider independence, rights status, or truth. Provider,
database, and lifecycle effects remain with separately authorized consumers.

The checked-in schemas and fixtures are packed as opaque JSON assets; the root
TypeScript API supplies the code exports. See the
[mathematical framework](../../docs/ALCHEMY-MATHEMATICAL-FRAMEWORK.md) for the
state, order, transition, privacy, and authority boundaries.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --ignore-scripts --dry-run --json
```

The current source candidate is `@agenttool/alchemy@0.1.0-dev.1`. It adds Base
Mainnet to the explicit internal-transfer support set and carries the versioned
evidence additions in this source tree. No `0.1.0-dev.1` tag, GitHub Release,
npm version, or LOVE inventory is established by these local source bytes.

The immutable `0.1.0-dev.0` preview remains historical release evidence under
annotated tag `alchemy-v0.1.0-dev.0` and npm dist-tag `next`. Its exact GitHub
prerelease asset and npm tarball were independently read back byte-identical;
the protected run, size, and SHA-256 receipt are recorded in
[`docs/ALCHEMY.md`](../../docs/ALCHEMY.md). npm also exposes that sole initial
prerelease through `latest`; that fallback is not a maturity signal. Neither
the historical release nor this source candidate is part of an immutable LOVE
inventory. Source metadata, building, and packing alone are not release
evidence.
