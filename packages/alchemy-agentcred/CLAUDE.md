# `@agenttool/alchemy-agentcred`

Strict local composition between `@agenttool/alchemy` and
`@agenttool/credential-broker`. It accepts only an already-connected client
and trusted-host network-to-grant mapping.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --ignore-scripts --dry-run --json
```

## Invariants

- Keep the surface to `createAlchemyAgentCredTransport`; never add connection,
  grant issuance/revocation, Keychain, credential, endpoint, raw RPC, generic
  fetch/request, provider administration, signing, simulation, or broadcast.
- Keep the method intersection to the seven methods in
  `agentcred.evm-jsonrpc-read/0.1`. Reject `alchemy_getAssetTransfers` and every
  other method before calling the AgentCred client.
- Revalidate the public receipt operation, exact profile, owner-asserted
  CAIP-2 chain, exact fixed-slug Alchemy origin, private-network denial,
  effective response ceiling, and complete closed method list before every
  client handoff.
- Snapshot each tuple element exactly once, then validate the snapshot before
  client handoff. Do not forward caller URLs, headers, JSON-RPC envelope
  fields, IDs, batches, or notifications.
- Rebind the broker result to the package-local Alchemy operation ID, method,
  and chain; collapse arbitrary client/provider exceptions to fixed messages.
- A trusted network-to-handle map is host policy, not endpoint or chain proof.
  Only `eth_chainId` observes upstream chain identity.
- Abort and deadline are checked again immediately before client handoff.
  AgentCred may queue after handoff, so the check cannot prevent or recall a
  later broker dispatch, restore quota, or provide cancellation rollback.
- Tests stay hermetic. Socket tests use only an obvious non-secret sentinel,
  an in-memory credential source, a fake resolver, and a fake outbound
  transport.
- Keep both peer packages unchanged. Do not widen either base package to make
  this adapter easier.
- Publication, LOVE inventory, npm release wiring, provider calls, and deploys
  remain separate operator actions.
