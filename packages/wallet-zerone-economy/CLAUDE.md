# Zerone economy wallet candidate guide

This directory is a private, source-only candidate. Read the root `AGENTS.md`,
root `CLAUDE.md`, `packages/wallet/CLAUDE.md`,
`packages/wallet-zerone/CLAUDE.md`, and
`packages/zerone-agent-economy/CLAUDE.md` before changing it.

## Non-negotiable boundary

- Never change or reinterpret released `@agenttool/wallet-zerone@0.1.2` from
  this package. The released two-message allowlist and transport semantics are
  immutable here.
- Keep this package `private: true`, development-versioned, source-only, and
  blocked from live use until the exact candidate is independently activated
  on the selected chain. Do not add publishing or deployment configuration.
- A `ZeroneEconomyActivationObservation` is caller-supplied structural
  evidence. Its required `currentness_proven: false` is deliberate: accepting
  the record does not establish that a network is live, current, honest, or
  reachable.
- Pin zerone-core commit
  `a5b82e82b2a32be2b75bd11575964b0a69aa34ac`, Cosmos SDK `v0.53.8`,
  sponsorship consensus version `2`, and knowledge consensus version `7`
  together. Drift must fail closed; never substitute a branch name or tag.
- Admit only the canonical unique order
  `MsgCreateBountyOrder -> MsgSubmitClaim -> MsgFulfillBounty`, with any
  non-empty increasing subset. Reject duplicates, reordering, unknown fields,
  non-minimal protobuf, and non-canonical default encodings.
- Treat the checked-in three-message bundle as byte-order/parity evidence only.
  It is not a viable same-transaction lifecycle because Fact verification,
  challenge, and maturity occur between Submit and Fulfill. Ordinary execution
  plans contain one lifecycle message; any multi-message plan needs an
  independently valid atomic rationale and exact successful simulation.
- Derive actors, module targets, payload hashes, reserved spend, and economic
  effects from strict decoding of canonical protobuf value bytes. Caller JSON
  is correspondence evidence, never effect authority.
- Every decoded actor must equal the Wallet intent source and the address
  derived from its compressed secp256k1 signer. Calls must target the exact
  Cosmos module accounts produced by `authtypes.NewModuleAddress("sponsorship")`
  and `authtypes.NewModuleAddress("knowledge")`.
- Create reserves `price_per_artifact * target_count`; Submit reserves the
  review-fee stake; Fulfill is fee-only and only requests a conditional inbound
  payout. Never describe requested fulfillment as earned, finalized, or
  received money.
- Preserve exact `Any`, `TxBody`, one-signer `AuthInfo`, `SignDoc`, simulation
  `TxRaw` with one empty signature, and signed `TxRaw` construction. Signatures
  are compact 64-byte, lower-S secp256k1 over SHA-256 of the exact SignDoc.
- Never authorize from a bare simulation result. Require the closed canonical
  planner-owned simulation-evidence record, domain-separated strict Ed25519
  signature by the verified Wallet receipt's exact adapter key, matching
  content/record IDs, exact plan/intent/simulation/empty-`TxRaw` hashes,
  source/chain, result fields, block reference, and receipt timestamps. Reload
  verification must restore its runtime brand before binding.
- Require `requested_at` to equal the branded Wallet authorization's
  `checked_at` and lie in `[evidence.simulated_at, evidence.valid_until)`. This
  is caller-supplied structural time because the package has no clock. Never
  imply it proves freshness: the durable host must invoke its signer
  immediately and reject/replace a request retained past `valid_until`.
- Preserve in-process brands for plans, simulation bindings, signing requests,
  verified simulation evidence, and verified transactions. Only the signed
  evidence record has an explicit reload verifier; a host must revalidate it
  and reconstruct the process-local plan/binding/request steps after a process
  boundary.
- Do not add a key, mnemonic, seed, signer implementation, endpoint, RPC/query
  client, simulation transport, broadcast, retry, custody, persistence,
  reservation, sequence lock, sticky-unknown state, or confirmation loop.
- ZRN is settlement and compute only. It does not establish identity, truth,
  KARMA/reputation, governance, worth, rights, or a duty to keep working.

## Pinned gas policy

At the exact candidate, `MsgSubmitClaim` is mapped to `100,000` gas.
`MsgCreateBountyOrder` and `MsgFulfillBounty` are absent from the ante map and
therefore each use the `22,222` fallback. Ordered requirements sum, clamp to a
minimum of `22,222`, and must not exceed the `11,111,111` transaction cap. The
declared fee is positive `uzrn`, at least one `uzrn` per declared gas unit,
and within the verified Wallet intent's fee ceiling. Simulation skips this
decorator and cannot weaken the local floor.

## Verification

```bash
bun run ci
bun scripts/regenerate-simulation-evidence-vector.ts --check
ZERONE_CORE_CHECKOUT=/path/to/exact/zerone-core \
  ./scripts/regenerate-go-cosmos-vector.sh --check
```

The Go fixture must run from the exact pinned zerone-core commit and remain an
independent source of generated protobuf, Cosmos transaction/signature, gas,
and module-account parity. It performs no RPC, broadcast, deployment, or
other state change.
