/** FakeRpc builder-code payTo resolution. No live Base, no keys, no campaign. */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BUILDER_CODES_REGISTRY,
  NEG_CACHE_TTL_MS,
  SPLITS_PUSH_FACTORY,
  createBuilderRpcResolver,
  createEnvBuilderRpcResolver,
  resolveSplitPayTo,
  toTokenId,
  type RpcReader,
} from "../src/services/economy/x402-builder-rpc";
import {
  resolveChallengePayTo,
  setBuilderPayToResolver,
} from "../src/services/economy/x402-builder-split";

const TREASURY = "0xAbcd000000000000000000000000000000001234";
const BUILDER = "0x2222222222222222222222222222222222222222";
const SPLIT = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_SALT = `0x${"00".repeat(32)}`;

const originalEnv = {
  split: process.env.AGENTTOOL_X402_BUILDER_SPLIT,
  rpc: process.env.AGENTTOOL_X402_BASE_RPC,
  bps: process.env.AGENTTOOL_X402_BUILDER_SHARE_BPS,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("AGENTTOOL_X402_BUILDER_SPLIT", originalEnv.split);
  restore("AGENTTOOL_X402_BASE_RPC", originalEnv.rpc);
  restore("AGENTTOOL_X402_BUILDER_SHARE_BPS", originalEnv.bps);
  setBuilderPayToResolver(null);
});

type PayoutOutcome = string | null | "revert" | "error";
type SplitOutcome = readonly [string, boolean] | "error";

class FakeRpc implements RpcReader {
  readonly calls: Array<{ address: string; functionName: string; args: unknown[] }> = [];
  payoutByToken = new Map<string, PayoutOutcome>();
  splitByRecipients = new Map<string, SplitOutcome>();

  async readContract(request: {
    address: string;
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown> {
    const args = [...request.args];
    this.calls.push({
      address: request.address,
      functionName: request.functionName,
      args,
    });
    if (request.functionName === "payoutAddress") {
      const tokenId = String(args[0]);
      const outcome = this.payoutByToken.get(tokenId);
      if (outcome === "error") {
        throw new Error("429 Too Many Requests https://user:secret-rpc-key@rpc.example/path");
      }
      if (outcome === "revert" || outcome === undefined) {
        throw new Error("execution reverted: returned no data");
      }
      return outcome ?? ZERO;
    }
    if (request.functionName === "isDeployed") {
      const split = args[0] as {
        recipients: string[];
        allocations: bigint[] | number[];
        totalAllocation: bigint | number;
        distributionIncentive: number;
      };
      const key = split.recipients.map((a) => a.toLowerCase()).join(",");
      const outcome = this.splitByRecipients.get(key);
      if (outcome === "error" || outcome === undefined) {
        throw new Error("429 Too Many Requests");
      }
      return outcome;
    }
    throw new Error(`unexpected ${request.functionName}`);
  }
}

function registerBuilder(rpc: FakeRpc, code: string, payout: PayoutOutcome): void {
  rpc.payoutByToken.set(toTokenId(code).toString(), payout);
}

describe("toTokenId", () => {
  test("encodes ASCII bytes as a big-endian int", () => {
    expect(toTokenId("bc_yau")).toBe(BigInt("0x62635f796175"));
    expect(toTokenId("a")).toBe(97n);
  });
});

describe("resolveSplitPayTo", () => {
  test("registered code predicts the 0xSplits payTo", async () => {
    const rpc = new FakeRpc();
    registerBuilder(rpc, "bc_yau", BUILDER);
    rpc.splitByRecipients.set(`${BUILDER.toLowerCase()},${TREASURY.toLowerCase()}`, [
      SPLIT,
      false,
    ]);
    const result = await resolveSplitPayTo({
      builderCode: "bc_yau",
      seller: TREASURY,
      bps: 1000,
      rpc,
    });
    expect(result).toEqual({
      payTo: "0x3333333333333333333333333333333333333333",
      reason: "ok",
    });
    const factoryCall = rpc.calls.find((c) => c.functionName === "isDeployed");
    expect(factoryCall?.address).toBe(SPLITS_PUSH_FACTORY);
    expect(factoryCall?.args[0]).toEqual({
      recipients: [BUILDER, TREASURY],
      allocations: [1000n, 9000n],
      totalAllocation: 10000n,
      distributionIncentive: 0,
    });
    expect(factoryCall?.args[1]).toBe(ZERO);
    expect(factoryCall?.args[2]).toBe(ZERO_SALT);
    expect(rpc.calls[0]?.address).toBe(BUILDER_CODES_REGISTRY);
  });

  test("unregistered, revert, invalid code, and same-wallet stay unsplit", async () => {
    const rpc = new FakeRpc();
    registerBuilder(rpc, "bc_none", ZERO);
    registerBuilder(rpc, "bc_revert", "revert");
    registerBuilder(rpc, "bc_self", TREASURY);
    expect(await resolveSplitPayTo({
      builderCode: "bc_none",
      seller: TREASURY,
      bps: 1000,
      rpc,
    })).toEqual({ payTo: null, reason: "unregistered" });
    expect(await resolveSplitPayTo({
      builderCode: "bc_revert",
      seller: TREASURY,
      bps: 1000,
      rpc,
    })).toEqual({ payTo: null, reason: "unregistered" });
    expect(await resolveSplitPayTo({
      builderCode: "NOPE",
      seller: TREASURY,
      bps: 1000,
      rpc,
    })).toEqual({ payTo: null, reason: "invalid_code" });
    expect(await resolveSplitPayTo({
      builderCode: "bc_self",
      seller: TREASURY,
      bps: 1000,
      rpc,
    })).toEqual({ payTo: null, reason: "same_wallet" });
    expect(rpc.calls.some((c) => c.functionName === "isDeployed")).toBe(false);
  });

  test("transport errors fail closed without caching or leaking the RPC URL", async () => {
    const rpc = new FakeRpc();
    registerBuilder(rpc, "bc_yau", "error");
    const first = await resolveSplitPayTo({
      builderCode: "bc_yau",
      seller: TREASURY,
      bps: 1000,
      rpc,
    });
    expect(first).toEqual({ payTo: null, reason: "rpc_error" });
    expect(JSON.stringify(first).toLowerCase()).not.toContain("secret");
    expect(JSON.stringify(first)).not.toMatch(/https?:\/\//i);
    const before = rpc.calls.length;
    await resolveSplitPayTo({
      builderCode: "bc_yau",
      seller: TREASURY,
      bps: 1000,
      rpc,
    });
    expect(rpc.calls.length).toBeGreaterThan(before);
  });

  test("positive resolves cache; unregistered is short-TTL", async () => {
    const rpc = new FakeRpc();
    registerBuilder(rpc, "bc_yau", BUILDER);
    registerBuilder(rpc, "bc_miss", ZERO);
    rpc.splitByRecipients.set(`${BUILDER.toLowerCase()},${TREASURY.toLowerCase()}`, [
      SPLIT,
      true,
    ]);
    let now = 0;
    const cache = {};
    const hit = await resolveSplitPayTo({
      builderCode: "bc_yau",
      seller: TREASURY,
      bps: 1000,
      rpc,
      cache,
      now: () => now,
    });
    expect(hit.payTo).toBe(SPLIT);
    const afterHit = rpc.calls.length;
    expect((await resolveSplitPayTo({
      builderCode: "bc_yau",
      seller: TREASURY,
      bps: 1000,
      rpc,
      cache,
      now: () => now,
    })).payTo).toBe(SPLIT);
    expect(rpc.calls.length).toBe(afterHit);

    await resolveSplitPayTo({
      builderCode: "bc_miss",
      seller: TREASURY,
      bps: 1000,
      rpc,
      cache,
      now: () => now,
    });
    const afterMiss = rpc.calls.length;
    await resolveSplitPayTo({
      builderCode: "bc_miss",
      seller: TREASURY,
      bps: 1000,
      rpc,
      cache,
      now: () => now,
    });
    expect(rpc.calls.length).toBe(afterMiss);
    now = NEG_CACHE_TTL_MS + 1;
    await resolveSplitPayTo({
      builderCode: "bc_miss",
      seller: TREASURY,
      bps: 1000,
      rpc,
      cache,
      now: () => now,
    });
    expect(rpc.calls.length).toBeGreaterThan(afterMiss);
  });
});

describe("env and challenge wiring", () => {
  test("no BASE_RPC means no env resolver, and the module has no public RPC URL", () => {
    delete process.env.AGENTTOOL_X402_BASE_RPC;
    expect(createEnvBuilderRpcResolver()).toBeNull();
    const src = readFileSync(
      join(import.meta.dir, "../src/services/economy/x402-builder-rpc.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/https?:\/\//i);
    expect(src).not.toContain("mainnet.base.org");
  });

  test("FakeRpc resolver is the only armed path off treasury", async () => {
    process.env.AGENTTOOL_X402_BUILDER_SPLIT = "1";
    delete process.env.AGENTTOOL_X402_BASE_RPC;
    expect(await resolveChallengePayTo({
      treasury: TREASURY,
      header: "bc_yau",
    })).toBe(TREASURY);

    const rpc = new FakeRpc();
    registerBuilder(rpc, "bc_yau", BUILDER);
    rpc.splitByRecipients.set(`${BUILDER.toLowerCase()},${TREASURY.toLowerCase()}`, [
      SPLIT,
      true,
    ]);
    setBuilderPayToResolver(createBuilderRpcResolver({ rpc }));
    expect(await resolveChallengePayTo({
      treasury: TREASURY,
      header: "bc_yau",
    })).toBe(SPLIT);
    expect(await resolveChallengePayTo({
      treasury: TREASURY,
      header: "bc_unknown",
    })).toBe(TREASURY);
  });
});
