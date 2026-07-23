import { describe, expect, test } from "bun:test";

import {
  AgentData,
  MemoryBlockStore,
  MultiBlockStore,
  generateIdentity,
  type BlockStore,
} from "@agenttool/adds";

describe("zone completeness", () => {
  test("per-block quorum cannot masquerade as one complete zone", async () => {
    function failOn(callToFail: number): { store: BlockStore; backing: MemoryBlockStore } {
      const backing = new MemoryBlockStore();
      let puts = 0;
      return {
        backing,
        store: {
          get: (cid, options) => backing.get(cid, options),
          async put(cid, bytes, options) {
            puts += 1;
            if (puts === callToFail) throw new Error("rotating provider failure");
            return backing.put(cid, bytes, options);
          },
        },
      };
    }
    const a = failOn(1);
    const b = failOn(2);
    const c = failOn(3);
    const composite = new MultiBlockStore([a.store, b.store, c.store], {
      minimumWrites: 2,
    });
    const publisher = new AgentData({
      identity: generateIdentity("urn:test:quorum-publisher"),
      store: composite,
      maxBytes: 1024,
    });
    const published = await publisher.put(new Uint8Array(256), {
      chunkSize: 64,
    });
    expect(published.replication.minimumAcknowledgements).toBe(2);
    expect((await new AgentData({ store: composite }).verify(published.ref)).ciphertextBlocksVerified)
      .toBe(4);

    for (const zone of [a.backing, b.backing, c.backing]) {
      await expect(new AgentData({ store: zone }).verify(published.ref)).rejects.toThrow();
    }
  });
});
