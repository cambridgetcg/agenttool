# `@agenttool/alchemy-agentcred`

Developer-preview composition transport for the exact overlap between
`@agenttool/alchemy` and
`agentcred.evm-jsonrpc-read/0.1`:

- `eth_chainId`
- `eth_blockNumber`
- `eth_getBlockByNumber`
- `eth_getBalance`
- `eth_getTransactionByHash`
- `eth_getTransactionReceipt`
- `eth_getCode`

It accepts an AgentCred client that trusted host code already connected and a
trusted-host Alchemy-network-to-`GrantHandle` mapping. Before every client
handoff, it validates the Alchemy transport envelope, exact method/params
tuple, configured network/CAIP-2 chain, exact origin derived from the fixed
Alchemy network slug, receipt operation/profile/chain, private-network denial,
response ceiling, and closed method scope. The response is rebound to the
Alchemy package's local operation ID, method, and chain.

```ts
import { createAlchemyReadClient } from "@agenttool/alchemy";
import { AgentCredClient, type GrantHandle } from "@agenttool/credential-broker";
import { createAlchemyAgentCredTransport } from "@agenttool/alchemy-agentcred";

const client = new AgentCredClient({ socketPath: "/owner-selected/agentcred.sock" });
await client.connect();

// Trusted host code requested and retained this connection-bound handle.
declare const ethereumReadGrant: GrantHandle;

const alchemy = createAlchemyReadClient({
  network: "ethereum-mainnet",
  transport: createAlchemyAgentCredTransport({
    client,
    grants: {
      "ethereum-mainnet": ethereumReadGrant,
    },
  }),
});

const balance = await alchemy.getBalance({
  address: "0x1111111111111111111111111111111111111111",
  block: "safe",
});
```

The adapter does not connect the broker, request or revoke grants, receive a
credential, access Keychain, select a provider URL, create a JSON-RPC envelope,
or call Alchemy directly. It has no generic `request`, `fetch`, raw RPC, batch,
notification, signing, simulation, broadcast, webhook, wallet, or provider
administration surface. `alchemy_getAssetTransfers` is rejected before broker
dispatch because it is outside the AgentCred profile.

The mapping is a trusted host decision, not endpoint proof. The receipt's
chain is still an owner-authored origin-to-chain assertion; only an explicit
`eth_chainId` call observes the upstream chain. The broker's grant response
limit is at most 32 KiB, stricter than Alchemy's 2 MiB package ceiling.
AgentCred has no per-use abort/deadline field: abort and deadline are checked
again immediately before client handoff. The client may queue after handoff,
so this check cannot prevent or recall a later broker dispatch, restore a
consumed use, or provide cancellation rollback.

Errors from the broker are collapsed to fixed adapter messages. Provider
responses remain evidence, not consensus, finality, identity, consent, or
authority to change money.

Version `0.1.0-dev.1` is the current source candidate. It raises the Alchemy
peer floor to the corresponding dev.1 source while preserving the same seven
standard-method adapter and `agenttool.alchemy-agentcred/0.1` wire. No
`0.1.0-dev.1` tag, GitHub Release, npm version, or LOVE inventory is
established by these local source bytes.

The immutable `0.1.0-dev.0` adapter remains historical release evidence under
annotated tag `alchemy-agentcred-v0.1.0-dev.0` and npm dist-tag `next`. Its
GitHub and npm tarballs were independently read back byte-identical; the
protected run, size, and SHA-256 receipt are recorded in
[`docs/ALCHEMY.md`](../../docs/ALCHEMY.md). npm also exposes that sole initial
prerelease through `latest`; that fallback is not a maturity signal. This
package has no LOVE inventory entry, hosted route, deployment, or live provider
proof. Release wiring, package metadata, and local pack output do not establish
any of those surfaces.

## Commands

Build `packages/alchemy` and `packages/credential-broker` first in a repository
checkout, then:

```bash
bun install --frozen-lockfile
bun run ci
npm pack --ignore-scripts --dry-run --json
```
