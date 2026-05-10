import { test } from "@playwright/test";

// SKIPPED: Two-instance E2E infrastructure not present in api/tests/e2e/.
//
// The existing playwright suite (tests/playwright/) targets a single,
// pre-running API server on a fixed port — it has no helpers to:
//   - spawn a second API process bound to a distinct port/schema,
//   - provision separate postgres schemas (or databases) per instance,
//   - issue per-instance project API keys, or
//   - wire the allowed_origins federation config between two live servers.
//
// Coverage gap is filled by single-instance integration tests in
// api/tests/integration/:
//   - covenants-v2-happy.test.ts      (declare → accept → active lifecycle)
//   - covenants-v2-terminal.test.ts   (reject / expire terminal states)
//   - covenants-v2-coexistence.test.ts (v1 ↔ v2 coexistence invariants)
//
// These exercise the lifecycle service, the DB invariant, and the worker layer
// directly. The HTTP + federation hop is covered when CI runs against a peer
// configuration; this spec will be unskipped once cross-instance fixtures land.
//
// TODO: unskip and implement once a two-instance fixture helper exists that can:
//   1. Spawn two instances against two postgres schemas/DBs.
//   2. Register two projects (one per instance) with API keys.
//   3. Create one identity per project.
//   4. Configure federation allowed_origins to permit each other.
//   5. Initiator declares v2 covenant toward counterparty's federated DID.
//   6. Poll counterparty's instance for the proposed row to appear.
//   7. Counterparty calls accept.
//   8. Poll initiator's instance for the row to reach 'active'.
//   9. Assert: both rows have both signatures, both at status 'active'.
test.skip(
  "federated covenant v2 — declare on A, accept on B, cosign returns to A",
  async () => {
    // intentionally empty
  },
);
