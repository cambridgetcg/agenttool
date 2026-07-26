# `@agenttool/alchemy`

Developer-preview, zero-runtime-dependency observation client for bounded EVM
reads through Alchemy. It sends structural method/parameter tuples for only
eight underlying provider methods to an injected host-owned transport:

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
are accepted only on Ethereum Mainnet and Polygon Mainnet, matching Alchemy's
documented support; other category/network coverage can still vary and a
provider error is not converted into an empty result.

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

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --ignore-scripts --dry-run --json
```

The allowlisted optional npm identity for this developer preview is
`@agenttool/alchemy@0.1.0-dev.0`, annotated tag `alchemy-v0.1.0-dev.0`, under
dist-tag `next`. Source metadata, building, and packing are not release
evidence; verify the protected workflow receipt and public exact-byte checks.
This package remains npm-only and is not part of an immutable LOVE inventory.
