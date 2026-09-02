/** Hermetic seller-split tests. No RPC, no campaign, no metrics. */

import { afterEach, describe, expect, test } from "bun:test";

import {
  affiliationFromSettlement,
  builderCodeFromChallenge,
  challengeExtensions,
  computeShares,
  parseBuilderCode,
  resolveChallengePayTo,
  setBuilderPayToResolver,
} from "../src/services/economy/x402-builder-split";

const TREASURY = "0xAbcd000000000000000000000000000000001234";
const SPLIT = "0x1111111111111111111111111111111111111111";

const originalEnv = {
  split: process.env.AGENTTOOL_X402_BUILDER_SPLIT,
  app: process.env.AGENTTOOL_X402_APP_CODE,
  bps: process.env.AGENTTOOL_X402_BUILDER_SHARE_BPS,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("AGENTTOOL_X402_BUILDER_SPLIT", originalEnv.split);
  restore("AGENTTOOL_X402_APP_CODE", originalEnv.app);
  restore("AGENTTOOL_X402_BUILDER_SHARE_BPS", originalEnv.bps);
  setBuilderPayToResolver(null);
});

describe("builder code parsing", () => {
  test("accepts Base builder-code shape and refuses identity-looking tags", () => {
    expect(parseBuilderCode("bc_yau")).toBe("bc_yau");
    expect(parseBuilderCode("  bc_yau  ")).toBe("bc_yau");
    expect(parseBuilderCode("BC-YAU")).toBeNull();
    expect(parseBuilderCode("kingdom")).toBe("kingdom");
    expect(parseBuilderCode("")).toBeNull();
    expect(parseBuilderCode(1)).toBeNull();
  });

  test("prefers payload extension s over the request header", () => {
    expect(builderCodeFromChallenge({
      header: "bc_header",
      payload: { x402Version: 2, accepted: {} as never, payload: {}, extensions: { s: "bc_payload" } },
    })).toBe("bc_payload");
    expect(builderCodeFromChallenge({ header: "bc_header" })).toBe("bc_header");
    expect(builderCodeFromChallenge({ header: "NOPE" })).toBeNull();
  });
});

describe("share math", () => {
  test("splits a 1-credit top-up 10/90 and does not invent dust", () => {
    expect(computeShares("1000", 1000, "bc_yau")).toEqual({
      builderShareAtomic: "100",
      sellerShareAtomic: "900",
      split: true,
    });
    expect(computeShares("1", 1000, "bc_yau")).toEqual({
      builderShareAtomic: "0",
      sellerShareAtomic: "1",
      split: false,
    });
    expect(computeShares("1000", 1000, null)).toEqual({
      builderShareAtomic: "0",
      sellerShareAtomic: "1000",
      split: false,
    });
  });
});

describe("challenge payTo", () => {
  test("default and unarmed paths stay on the treasury", () => {
    delete process.env.AGENTTOOL_X402_BUILDER_SPLIT;
    expect(resolveChallengePayTo({
      treasury: TREASURY,
      header: "bc_yau",
      resolver: () => SPLIT,
    })).toBe(TREASURY);
    process.env.AGENTTOOL_X402_BUILDER_SPLIT = "1";
    expect(resolveChallengePayTo({
      treasury: TREASURY,
      header: "bc_yau",
      resolver: null,
    })).toBe(TREASURY);
    expect(resolveChallengePayTo({
      treasury: TREASURY,
      header: "NOPE",
      resolver: () => SPLIT,
    })).toBe(TREASURY);
  });

  test("armed resolver with a valid code is the only path off treasury", () => {
    process.env.AGENTTOOL_X402_BUILDER_SPLIT = "1";
    expect(resolveChallengePayTo({
      treasury: TREASURY,
      header: "bc_yau",
      resolver: (code) => code === "bc_yau" ? SPLIT : null,
    })).toBe("0x1111111111111111111111111111111111111111");
    expect(resolveChallengePayTo({
      treasury: TREASURY,
      header: "bc_yau",
      resolver: () => null,
    })).toBe(TREASURY);
  });
});

describe("extensions and affiliation", () => {
  test("stamps a and s without being a campaign", () => {
    process.env.AGENTTOOL_X402_APP_CODE = "bc_agenttool";
    expect(challengeExtensions({ header: "bc_yau" })).toEqual({
      a: "bc_agenttool",
      s: "bc_yau",
    });
    delete process.env.AGENTTOOL_X402_APP_CODE;
    expect(challengeExtensions({})).toBeUndefined();
  });

  test("affiliation is shadow and never bookable", () => {
    const receipt = affiliationFromSettlement({
      amountAtomic: "1000",
      payTo: TREASURY,
      treasury: TREASURY,
      builderCode: null,
    });
    expect(receipt).toMatchObject({
      bookable: false,
      campaign: false,
      engagement: false,
      split: false,
      seller_share_atomic: "1000",
      builder_share_atomic: "0",
    });
  });
});
