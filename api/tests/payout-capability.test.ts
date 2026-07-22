import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sealWalletCapability, keyIdForPublicKey } from "@agenttool/wallet";
import { enforceSignedPayoutBound, payoutCaip } from "../src/services/economy/crypto/payout-capability.ts";
import { checkPayoutPolicy } from "../src/services/economy/crypto/index.ts";

/** A fake drizzle executor returning `policyRow` for the policy SELECT and a
 *  zero sum for any execute() — lets us exercise checkPayoutPolicy's fail-closed
 *  branch without a database. */
function fakeExec(policyRow: unknown) {
  return {
    select: () => ({ from: () => ({ where: async () => (policyRow ? [policyRow] : []) }) }),
    execute: async () => [{ total: "0" }],
  } as any;
}

/** The tamper-evident payout bound. We MINT a real owner-signed capability with
 *  a local key, then prove the enforcer honours it and refuses every way an
 *  attacker (or a mutated DB row) could try to overspend. */

const b64u = (b: Uint8Array) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A wallet owner's signing key, and a RecordSigner over it.
const ownerPriv = ed25519.utils.randomSecretKey();
const ownerPub = b64u(ed25519.getPublicKey(ownerPriv));
const ownerSigner = {
  public_key: ownerPub,
  sign_digest: (digest: Uint8Array) => b64u(ed25519.sign(digest, ownerPriv)),
};
// An attacker's key — same shape, different secret.
const attackerPriv = ed25519.utils.randomSecretKey();
const attackerPub = b64u(ed25519.getPublicKey(attackerPriv));
const attackerSigner = {
  public_key: attackerPub,
  sign_digest: (digest: Uint8Array) => b64u(ed25519.sign(digest, attackerPriv)),
};

const ASSET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEST = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:CeQqNBX5GfLQ65RX4AgVhAGYEzu8cgN4YKnb79iSGViT";
const WALLET_ID = "11111111-1111-4111-8111-111111111111";
const DESCRIPTOR_ID = "sha256:" + "a".repeat(64);
const GRANT = "22222222-2222-4222-8222-222222222222";

async function mintCapability(
  signer: typeof ownerSigner,
  over: Partial<{
    max_per_intent: string;
    max_total: string;
    call_rules: Array<{ target_account: string; actions: string[]; methods: string[]; requires_approval: boolean }>;
    approval_threshold: number;
    not_before: string;
    expires_at: string;
  }> = {},
): Promise<unknown> {
  const core = {
    schema: "agent-wallet/capability/0.1",
    grant_id: GRANT,
    wallet_id: WALLET_ID,
    descriptor_id: DESCRIPTOR_ID,
    issuer: { algorithm: "Ed25519", key_id: keyIdForPublicKey(signer.public_key), public_key: signer.public_key },
    delegate: { algorithm: "Ed25519", key_id: keyIdForPublicKey(attackerPub), public_key: attackerPub },
    accounts: [DEST],
    call_rules: over.call_rules ?? [
      { target_account: DEST, actions: ["transfer"], methods: [], requires_approval: false },
    ],
    spend_limits: [
      { asset_id: ASSET, max_per_intent: over.max_per_intent ?? "10000000", max_total: over.max_total ?? "25000000" },
    ],
    fee_limits: [{ asset_id: ASSET, max_per_intent: "1000000" }],
    max_intents: 100,
    approval_threshold: over.approval_threshold ?? 0,
    issued_at: "2026-07-22T10:00:00.000Z",
    not_before: over.not_before ?? "2026-07-22T10:00:00.000Z",
    expires_at: over.expires_at ?? "2026-07-23T09:00:00.000Z",
    revocation_nonce: 0,
    policy_hash: "sha256:" + "d".repeat(64),
    purpose: "payout",
  };
  const sealed = await sealWalletCapability(core as never, signer);
  // Cross a process boundary the way the DB does: JSON round-trip strips the brand.
  return JSON.parse(JSON.stringify(sealed));
}

const NOW = new Date("2026-07-22T12:00:00.000Z");
// The cumulative-spend fetcher the caller injects (DB in prod); here a fixed sum.
const enforce = (
  capabilityJson: unknown,
  over: Partial<Parameters<typeof enforceSignedPayoutBound>[0]> = {},
  cumulativeSpent = 0n,
) =>
  enforceSignedPayoutBound(
    {
      capabilityJson,
      expectedIssuerPublicKey: ownerPub,
      assetId: ASSET,
      destinationAccount: DEST,
      amountBase: 5_000_000n,
      now: NOW,
      ...over,
    },
    async () => cumulativeSpent,
  );

describe("the tamper-evident payout bound", () => {
  test("an owner-signed, in-bounds payout is authorized", async () => {
    const cap = await mintCapability(ownerSigner);
    expect(await enforce(cap)).toEqual({ ok: true, bound: "signed" });
  });

  test("a mutated bound breaks the signature (the headline: DB edits can't raise the ceiling)", async () => {
    const cap = (await mintCapability(ownerSigner)) as any;
    // Attacker rewrites the stored ceiling from 25 to 25,000 USDC.
    cap.spend_limits[0].max_total = "25000000000";
    const d = await enforce(cap);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_capability_invalid");
  });

  test("a capability signed by anyone but the owner is refused", async () => {
    const cap = await mintCapability(attackerSigner); // internally valid, wrong signer
    const d = await enforce(cap);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_capability_owner_mismatch");
  });

  test("an owner key in standard base64 still matches the capability's base64url", async () => {
    const cap = await mintCapability(ownerSigner);
    const stdB64 = Buffer.from(ownerPub.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("base64");
    expect(await enforce(cap, { expectedIssuerPublicKey: stdB64 })).toEqual({ ok: true, bound: "signed" });
  });

  test("a payout over the per-payout cap is refused", async () => {
    const cap = await mintCapability(ownerSigner, { max_per_intent: "1000000" }); // 1 USDC cap
    const d = await enforce(cap, { amountBase: 5_000_000n });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_exceeds_per_payout_cap");
  });

  test("cumulative spend past max_total (lifetime, not daily) is refused", async () => {
    const cap = await mintCapability(ownerSigner); // max_total 25 USDC
    const d = await enforce(cap, { amountBase: 5_000_000n }, 24_000_000n); // grant-spent 24 + 5 > 25
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_exceeds_cumulative_cap");
  });

  test("a destination outside the capability's call_rules is refused", async () => {
    const cap = await mintCapability(ownerSigner);
    const d = await enforce(cap, { destinationAccount: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:AttackerWalletnnnnnnnnnnnnnnnnnnnnnnnnnnn" });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("destination_not_allowlisted");
  });

  test("an uncapped asset is refused (opt-in, never opt-out)", async () => {
    const cap = await mintCapability(ownerSigner);
    const d = await enforce(cap, { assetId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:SomeOtherMintxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_asset_uncapped");
  });

  test("an expired capability is refused", async () => {
    const cap = await mintCapability(ownerSigner, { expires_at: "2026-07-22T11:00:00.000Z" });
    const d = await enforce(cap); // NOW is 12:00, past expiry
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_capability_not_active");
  });

  test("payoutCaip binds a payout to CAIP-19/CAIP-10 (EVM lowercased, Solana verbatim)", () => {
    const sol = payoutCaip("solana", "USDC", "CeQqNBX5GfLQ65RX4AgVhAGYEzu8cgN4YKnb79iSGViT");
    expect(sol.assetId).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(sol.account).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:CeQqNBX5GfLQ65RX4AgVhAGYEzu8cgN4YKnb79iSGViT");
    // EVM addresses are case-insensitive; the CAIP contract lowercases both the
    // token and the destination so a signed capability compares byte-exact.
    const base = payoutCaip("base", "USDC", "0xAbCd000000000000000000000000000000001234");
    expect(base.assetId).toBe("eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(base.account).toBe("eip155:8453:0xabcd000000000000000000000000000000001234");
    expect(() => payoutCaip("solana", "SOL", "x")).toThrow("only USDC");
  });

  test("dual control is a real gate keyed off the signed threshold, not a stub", async () => {
    const cap = await mintCapability(ownerSigner, { approval_threshold: 2 });
    const withoutApprovals = await enforce(cap);
    expect(withoutApprovals.ok).toBe(false);
    if (!withoutApprovals.ok) expect(withoutApprovals.error).toBe("payout_dual_control_required");
    // With enough host-authenticated approvals it clears.
    expect(await enforce(cap, { hostVerifiedApprovalCount: 2 })).toEqual({ ok: true, bound: "signed" });
  });
});

describe("checkPayoutPolicy fail-closed downgrade guard", () => {
  const base = { walletId: WALLET_ID, destinationAddress: "x", amountBase: 1_000_000n, chain: "solana" as const, token: "USDC" };

  test("an agent-owned wallet with NO policy row is refused (can't fall through to open)", async () => {
    const d = await checkPayoutPolicy({ ...base, ownerType: "agent" }, fakeExec(null));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_capability_required");
  });

  test("an agent-owned wallet whose capability was cleared to NULL is refused (the downgrade attack)", async () => {
    const policyRow = { payoutCapability: null, payoutDailyCeilingBase: null, payoutDestinationAllowlist: null };
    const d = await checkPayoutPolicy({ ...base, ownerType: "agent" }, fakeExec(policyRow));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("payout_capability_required");
  });

  test("a platform-owned wallet with no policy keeps the raw-column path (unchanged)", async () => {
    const d = await checkPayoutPolicy({ ...base, ownerType: "platform" }, fakeExec(null));
    expect(d.ok).toBe(true);
  });
});
