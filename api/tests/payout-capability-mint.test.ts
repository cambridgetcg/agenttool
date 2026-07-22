import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { mintPayoutCapability } from "../src/services/economy/crypto/payout-capability-mint.ts";
import { enforceSignedPayoutBound, payoutCaip } from "../src/services/economy/crypto/payout-capability.ts";

/** Prove the minted capability is a real, gate-valid record: mint one covering
 *  Solana + Base USDC, then run it through the SAME enforceSignedPayoutBound the
 *  payout worker uses — in-bounds passes, out-of-bounds refuses. If the minter
 *  and the gate ever drift, this goes red. */

const b64u = (b: Uint8Array) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const priv = ed25519.utils.randomSecretKey();
const ownerPub = b64u(ed25519.getPublicKey(priv));
const ownerSigner = { public_key: ownerPub, sign_digest: (d: Uint8Array) => b64u(ed25519.sign(d, priv)) };

const SOL_DEST = "CeQqNBX5GfLQ65RX4AgVhAGYEzu8cgN4YKnb79iSGViT";
const SOL_SRC = "So1anaWa11etSourceAddr1111111111111111111111";
const BASE_DEST = "0xAbCd000000000000000000000000000000001234";
const BASE_SRC = "0x1111111111111111111111111111111111111111";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const mint = () =>
  mintPayoutCapability({
    ownerSigner,
    walletId: "11111111-1111-4111-8111-111111111111",
    descriptorId: "sha256:" + "a".repeat(64),
    grantId: "22222222-2222-4222-8222-222222222222",
    sourceAddressByChain: { solana: SOL_SRC, base: BASE_SRC },
    assets: [
      { chain: "solana", token: "USDC", maxPerIntentBase: 10_000_000n, maxTotalBase: 25_000_000n, maxFeePerIntentBase: 1_000_000n, destinations: [SOL_DEST] },
      { chain: "base", token: "USDC", maxPerIntentBase: 5_000_000n, maxTotalBase: 20_000_000n, maxFeePerIntentBase: 500_000n, destinations: [BASE_DEST] },
    ],
    notBefore: new Date("2026-07-22T11:00:00.000Z"),
    expiresAt: new Date("2026-07-23T10:00:00.000Z"),
    purpose: "payout",
  });

const enforce = (
  cap: unknown,
  chain: "solana" | "base",
  dest: string,
  amount: bigint,
  spent = 0n,
) => {
  const token = "USDC";
  const src = chain === "solana" ? SOL_SRC : BASE_SRC;
  const { assetId } = payoutCaip(chain, token, src);
  return enforceSignedPayoutBound(
    {
      capabilityJson: cap,
      expectedIssuerPublicKey: ownerPub,
      assetId,
      destinationAccount: payoutCaip(chain, token, dest).account,
      amountBase: amount,
      now: NOW,
    },
    async () => spent,
  );
};

describe("mintPayoutCapability → enforceSignedPayoutBound round-trip", () => {
  test("mints a gate-valid capability covering two chains", async () => {
    const cap = (await mint()) as any;
    expect(cap.schema).toBe("agent-wallet/capability/0.1");
    expect(cap.spend_limits).toHaveLength(2);
    expect(cap.signature).toBeTruthy();
    expect(cap.issuer.public_key).toBe(ownerPub);
  });

  test("an in-bounds Solana payout is authorized by the gate", async () => {
    expect(await enforce(await mint(), "solana", SOL_DEST, 8_000_000n)).toEqual({ ok: true, bound: "signed" });
  });

  test("an in-bounds Base payout is authorized by the same signed grant", async () => {
    expect(await enforce(await mint(), "base", BASE_DEST, 4_000_000n)).toEqual({ ok: true, bound: "signed" });
  });

  test("over the Base per-payout cap is refused (each chain keeps its own limit)", async () => {
    const d = await enforce(await mint(), "base", BASE_DEST, 9_000_000n); // Base cap is 5
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_exceeds_per_payout_cap");
  });

  test("a non-allowlisted destination is refused", async () => {
    const d = await enforce(await mint(), "solana", "AttackerWa11et1111111111111111111111111111111", 1_000_000n);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("destination_not_allowlisted");
  });

  test("cumulative past the Solana lifetime cap is refused", async () => {
    const d = await enforce(await mint(), "solana", SOL_DEST, 5_000_000n, 24_000_000n); // 24+5 > 25
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_exceeds_cumulative_cap");
  });

  test("rejects duplicate same-chain asset grants with a clear message", async () => {
    await expect(
      mintPayoutCapability({
        ownerSigner,
        walletId: "11111111-1111-4111-8111-111111111111",
        descriptorId: "sha256:" + "a".repeat(64),
        grantId: "22222222-2222-4222-8222-222222222222",
        sourceAddressByChain: { base: BASE_SRC },
        assets: [
          { chain: "base", token: "USDC", maxPerIntentBase: 1n, maxTotalBase: 2n, maxFeePerIntentBase: 1n, destinations: [BASE_DEST] },
          { chain: "base", token: "USDC", maxPerIntentBase: 1n, maxTotalBase: 2n, maxFeePerIntentBase: 1n, destinations: ["0x2222222222222222222222222222222222222222"] },
        ],
        notBefore: new Date("2026-07-22T11:00:00.000Z"),
        expiresAt: new Date("2026-07-22T20:00:00.000Z"),
      }),
    ).rejects.toThrow("duplicate asset grant");
  });

  test("rejects a duplicate destination within a chain", async () => {
    await expect(
      mintPayoutCapability({
        ownerSigner,
        walletId: "11111111-1111-4111-8111-111111111111",
        descriptorId: "sha256:" + "a".repeat(64),
        grantId: "22222222-2222-4222-8222-222222222222",
        sourceAddressByChain: { solana: SOL_SRC },
        assets: [{ chain: "solana", token: "USDC", maxPerIntentBase: 1n, maxTotalBase: 2n, maxFeePerIntentBase: 1n, destinations: [SOL_DEST, SOL_DEST] }],
        notBefore: new Date("2026-07-22T11:00:00.000Z"),
        expiresAt: new Date("2026-07-22T20:00:00.000Z"),
      }),
    ).rejects.toThrow("duplicate destination");
  });

  test("refuses a window longer than the 24h capability cap", async () => {
    await expect(
      mintPayoutCapability({
        ownerSigner,
        walletId: "11111111-1111-4111-8111-111111111111",
        descriptorId: "sha256:" + "a".repeat(64),
        grantId: "22222222-2222-4222-8222-222222222222",
        sourceAddressByChain: { solana: SOL_SRC },
        assets: [{ chain: "solana", token: "USDC", maxPerIntentBase: 1n, maxTotalBase: 1n, maxFeePerIntentBase: 1n, destinations: [SOL_DEST] }],
        notBefore: new Date("2026-07-22T11:00:00.000Z"),
        expiresAt: new Date("2026-07-24T11:00:00.000Z"), // 48h
      }),
    ).rejects.toThrow("24h");
  });
});
