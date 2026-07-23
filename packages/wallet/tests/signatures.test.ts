import { describe, expect, test } from "bun:test";

import {
  WalletProtocolError,
  capabilityDigest,
  descriptorDigest,
  sealWalletCapability,
  sealWalletDescriptor,
  signatureFromBase64Url,
  verifyWalletCapability,
  verifyWalletDescriptor,
} from "../src/index.js";
import { capabilityCore, delegate, descriptorCore, owner } from "./fixtures.js";

describe("signed wallet records", () => {
  test("seals and verifies a descriptor and capability", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const capability = await sealWalletCapability(capabilityCore(descriptor), owner.signer);
    expect(verifyWalletDescriptor(structuredClone(descriptor)).record_id).toBe(descriptor.record_id);
    expect(verifyWalletCapability(structuredClone(capability)).record_id).toBe(capability.record_id);
  });

  test("rejects every signed-field tamper through record identity or signature", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const capability = await sealWalletCapability(capabilityCore(descriptor), owner.signer);
    const mutations: Array<(value: Record<string, any>) => void> = [
      (value) => { value.wallet_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; },
      (value) => { value.accounts[0] = "eip155:1:0x1111111111111111111111111111111111111111"; },
      (value) => { value.call_rules[0].target_account = "eip155:84532:0x9999999999999999999999999999999999999999"; },
      (value) => { value.spend_limits[0].max_total = "24"; },
      (value) => { value.expires_at = "2026-07-21T10:59:59.999Z"; },
      (value) => { value.policy_hash = `sha256:${"f".repeat(64)}`; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(capability) as unknown as Record<string, any>;
      mutate(changed);
      expect(() => verifyWalletCapability(changed)).toThrow();
    }
  });

  test("refuses a signer that does not match the authority field", async () => {
    await expect(sealWalletDescriptor(descriptorCore(), delegate.signer))
      .rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" } satisfies Partial<WalletProtocolError>);
  });

  test("uses different domains for descriptor and capability", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    expect(Buffer.from(descriptorDigest(descriptorCore())).toString("hex"))
      .not.toBe(Buffer.from(capabilityDigest(capabilityCore(descriptor))).toString("hex"));
  });

  test("closed validators reject additive fields", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    expect(() => verifyWalletDescriptor({ ...descriptor, private_key: "must-never-cross" }))
      .toThrow(WalletProtocolError);
  });

  test("signed-record validators reject stateful accessors without invoking them", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    let custodyReads = 0;
    expect(() => verifyWalletDescriptor({
      ...descriptor,
      get custody_mode() {
        custodyReads += 1;
        return custodyReads === 1 ? "self_custodied" : "watch_only";
      },
    })).toThrow(/data properties/i);
    expect(custodyReads).toBe(0);
  });

  test("requires exactly 64 decoded bytes for an Ed25519 signature", () => {
    expect(() => signatureFromBase64Url("")).toThrow(/64 bytes/i);
  });
});
