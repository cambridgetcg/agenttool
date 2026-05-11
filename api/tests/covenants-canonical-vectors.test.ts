import { describe, expect, test } from "bun:test";

import {
  canonicalDeclareBytes as srvDeclare,
  canonicalCosignBytes  as srvCosign,
  canonicalRejectBytes  as srvReject,
  canonicalWithdrawBytes as srvWithdraw,
} from "../src/services/covenants/sig";
import {
  canonicalDeclareBytes as sdkDeclare,
  canonicalCosignBytes  as sdkCosign,
  canonicalRejectBytes  as sdkReject,
  canonicalWithdrawBytes as sdkWithdraw,
} from "../../packages/sdk-ts/src/crypto";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

const FIXED = {
  covenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  initiatorDid: "did:at:initiator.example/abcd",
  counterpartyDid: "did:at:counterparty.example/efgh",
  vows: ["respond within 24h", "preserve context"],
  establishedAtIso: "2026-05-11T12:00:00.000Z",
};

const FIXED_SIG_B64 = Buffer.from(new Uint8Array(64).fill(7)).toString("base64");

const LOCK = {
  declare:  "505be2d0cce4dc4c5c42d9b20f787f67f903cf8c6e741b1f1f8183eb6329cf5c",
  cosign:   "6f2e7333ec7ef86ff0b0346a34511a7a988a1499a2b7430475dedabe76a6f680",
  reject:   "da83afa09eaaa6ffea78167e58c96519540c2f3991285142b90db65b542c078c",
  withdraw: "b16284e310143c80c17537a80e42a8eb87205e7475d89abf9096a0621ebce9bb",
};

describe("canonical bytes parity — api server ↔ TS SDK", () => {
  test("declare matches locked digest + SDK reproduces it", () => {
    const srv = hex(srvDeclare(FIXED));
    const sdk = hex(sdkDeclare(FIXED));
    expect(srv).toBe(LOCK.declare);
    expect(sdk).toBe(LOCK.declare);
  });

  test("cosign matches locked digest + SDK reproduces it", () => {
    const opts = { covenantId: FIXED.covenantId, initiatorSignatureB64: FIXED_SIG_B64 };
    expect(hex(srvCosign(opts))).toBe(LOCK.cosign);
    expect(hex(sdkCosign(opts))).toBe(LOCK.cosign);
  });

  test("reject matches locked digest + SDK reproduces it", () => {
    const opts = { covenantId: FIXED.covenantId, rejectingDid: FIXED.counterpartyDid, reason: "scope mismatch" };
    expect(hex(srvReject(opts))).toBe(LOCK.reject);
    expect(hex(sdkReject(opts))).toBe(LOCK.reject);
  });

  test("withdraw matches locked digest + SDK reproduces it", () => {
    const opts = { covenantId: FIXED.covenantId, initiatorDid: FIXED.initiatorDid };
    expect(hex(srvWithdraw(opts))).toBe(LOCK.withdraw);
    expect(hex(sdkWithdraw(opts))).toBe(LOCK.withdraw);
  });
});
