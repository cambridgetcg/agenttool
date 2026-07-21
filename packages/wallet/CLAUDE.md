# @agenttool/wallet

## What This Is

Source reference primitives for `agent-wallet/0.1`: closed signed records,
static capability evaluation, exact-byte signer requests, conservative
broadcast state, and continuity-head transitions.

## Safety Boundary

- Never add seed, mnemonic, secret-key, `getPrivateKey`, or private-key export
  inputs/outputs.
- Never combine policy validation, signing, and broadcasting into a
  `signAndSend` convenience path.
- This package does not own RPC, chain-specific decoding, durable storage,
  locks, nonce allocation, budget reservation, adapter trust, or approvals.
- `host_verified_approval_ids` is caller-supplied evidence. The host must
  authenticate and bind approvals to the exact capability and intent; this
  package only validates distinct bounded IDs and applies the threshold.
- `assertIntentWithinCapabilityStatic()` is necessary input to authorization,
  not authorization by itself. The host must repeat it inside an atomic
  sign-time reservation.
- A generic signer response proves only request echoes and byte hashes. A
  trusted chain adapter must verify the chain-native signature and the exact
  signed/unsigned/intent relationship before persistence or broadcast.
- `submission_unknown` is sticky until positive lookup evidence arrives.
  Timeout, lookup failure, and absence do not authorize retry or refund.
- `advanceContinuityHead()` is a pure rule. The host must commit its result
  with a durable compare-and-swap.

## Commands

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run ci
npm pack --ignore-scripts --dry-run
```

## Release State

Version `0.1.0` is currently source-only. A package manifest being publishable
does not prove that npm contains the package. Do not describe it as published
until the exact registry version and tarball contents have been verified.

## Key Files

- `src/canonical.ts` — bounded canonical JSON and domain-separated digests
- `src/validation.ts` — closed record and cross-field validation
- `src/signatures.ts` — strict Ed25519 seal/verify and runtime verification brand
- `src/capability.ts` — static capability checks against supplied durable usage
- `src/provider.ts` — non-exportable signer and exact-byte response boundary
- `src/lifecycle.ts` — forward-only signing/submission state transitions
- `src/continuity.ts` — pure continuity-head compare-and-swap rule
- `schema/` — record-shape schema; runtime semantic checks remain mandatory
- `vectors/` — deterministic public interoperability vectors
- `tests/` — positive, tamper, boundary, lifecycle, schema, and release tests

## Documentation

Canonical protocol draft:
[`docs/specs/AGENT-WALLET-0.1.md`](../../docs/specs/AGENT-WALLET-0.1.md).
Canonical byte recipes:
[`docs/CANONICAL-BYTES.md`](../../docs/CANONICAL-BYTES.md).

## Kingdom Engine

AgentTool Platform
