import { describe, expect, test } from "bun:test";

import type {
  CompleteDepositWatchInput,
  DepositWatchStore,
  DepositWatchTargetBinding,
} from "../src/services/economy/crypto/deposit-watch";
import { createDepositWatchWorker } from "../src/workers/deposit-watch/reconcile";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const TARGETS: readonly DepositWatchTargetBinding[] = [
  {
    provider: "alchemy",
    chain: "base",
    network: "testnet",
    state: "active",
    targetFingerprint: "a".repeat(64),
    targetRevision: 3,
  },
];

class EmptyStore implements DepositWatchStore {
  readonly claimInputs: Array<
    Parameters<DepositWatchStore["claimDue"]>[0]
  > = [];

  async claimDue(
    input: Parameters<DepositWatchStore["claimDue"]>[0],
  ) {
    this.claimInputs.push(input);
    return [];
  }

  async complete(_input: CompleteDepositWatchInput): Promise<boolean> {
    return false;
  }
}

describe("deposit-watch worker preparation gate", () => {
  test("prepares every batch, retries failure, and never claims early", async () => {
    const store = new EmptyStore();
    let prepareCalls = 0;
    const worker = createDepositWatchWorker({
      owner: "test-worker:prepare",
      store,
      targets: TARGETS,
      reconciler: async () => ({ kind: "mutation_accepted" }),
      prepare: async () => {
        prepareCalls += 1;
        if (prepareCalls === 1) throw new Error("bounded fixture failure");
      },
      now: () => NOW,
    });

    const first = worker.runOnce();
    const overlapping = worker.runOnce();
    expect(overlapping).toBe(first);
    await expect(first).rejects.toThrow("bounded fixture failure");
    expect(store.claimInputs).toHaveLength(0);

    await expect(worker.runOnce()).resolves.toMatchObject({ claimed: 0 });
    expect(prepareCalls).toBe(2);
    expect(store.claimInputs).toHaveLength(1);
    expect(store.claimInputs[0]?.targets).toBe(TARGETS);

    await worker.runOnce();
    expect(prepareCalls).toBe(3);
    expect(store.claimInputs).toHaveLength(2);
  });
});
