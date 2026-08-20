# Zerone Agent Economy package guide

This is a private, source-only pure protocol package. Read the root
`AGENTS.md`, root `CLAUDE.md`, and this file before changing it.

## Invariants

- Do not add key custody, ambient credential reads, RPC, simulation,
  broadcast, deployment, or economic side effects.
- Do not widen the released `@agenttool/wallet` or
  `@agenttool/wallet-zerone@0.1.2` message contracts from here.
- AgentTool hashes are `sha256:<64hex>`; proposed chain digest fields are bare
  lowercase 64-hex. Conversion must be explicit.
- A WorkSpec is a negotiated prefunded contract with exactly one preassigned
  worker account, not an open claimant race. Artifact producer, Fact
  submitter, settlement payee, and fulfillment caller must remain that worker.
- Work-receipt and settlement-nullifier recipes must match Zerone consensus
  byte-for-byte, including domain NUL and uint64-BE length prefixes.
- V0 adds one Fact. Exact sorted bounded existing `parent_fact_ids` (generated
  32-hex or established symbolic IDs) project to `REQUIRES=3` ClaimRelations.
  It does not revise or tombstone a Fact, and the
  off-chain proposed tree-root transition is not chain-enforced.
- `min_corroborations = 0` is valid and must omit protobuf field 5. Positive
  values encode field 5; worker address is always protobuf field 6.
- Fulfillment must be signed by the stored Fact submitter/payee. Never add a
  caller-controlled payee, receipt, contract, or nullifier field.
- Claim review-fee stake must remain a positive uint64 decimal string; do not
  admit wider amount strings that consensus cannot convert without truncation.
- A wallet/identity binding stays `unsigned_unverified` until an external host
  verifies both Ed25519 identity-root and compact low-S secp256k1 wallet-key
  proofs over the shared digest. Do not treat a descriptor account assertion
  or ordinary signed transaction as that dual proof.
- ZRN remains settlement/compute only. It does not establish identity, truth,
  KARMA/reputation, governance, worth, rights, or permission to rest.
- Treasury spendable balance subtracts durable reservations, sticky-unknown
  exposure, and the reserve floor. No automatic stake, vote, bridge, or spend.
- Contract maturity is bounded payout eligibility, not permanent truth
  finality; Zerone Facts remain challengeable.
- EvidenceReceipt issuer fields are unsigned, untrusted observation labels.
  Portable JSON Schemas are structural envelopes; runtime validators remain
  authoritative for byte bounds, correspondence, ordering, and hashes.

## Verification

```bash
bun run ci
```

The checked-in Go parity vector is generated from matching Zerone generated
protobuf types by `scripts/go-cosmos-vector/main.go`. Updating proto fields,
enum values, hash recipes, or default omission rules requires regenerating the
Go vector and updating the TypeScript vector/tests together.

This package has no release, hosted route, live network test, or deployment
surface.
