/** payout-capability-mint.ts — author one owner-signed capability that bounds
 *  payout across every chain at once.
 *
 *  The payout gate (payout-capability.ts) enforces an owner-signed
 *  `agent-wallet/0.1` capability, but authoring that record by hand is
 *  error-prone (canonical CAIP-19 asset ids, per-chain call_rules, the ≤24h
 *  lifetime cap, sha256 key/policy ids). This helper builds + seals it from a
 *  plain per-asset spec, reusing the SAME payoutCaip() mapping the gate uses, so
 *  a single signed grant caps Solana + EVM USDC together and drops straight into
 *  economy.policies.payout_capability.
 *
 *  Owner-side by design: the caller injects the wallet owner's signer
 *  (public_key + sign_digest). No private key is handled here or on the server.
 */
import { keyIdForPublicKey, sealWalletCapability } from "@agenttool/wallet";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { payoutCaip } from "./payout-capability";
import type { Chain } from "./chains";

/** The wallet library's signer contract: a public key + a digest signer. */
export interface RecordSigner {
  readonly public_key: string; // base64url ed25519
  sign_digest(digest: Uint8Array): Promise<string> | string;
}

export interface PayoutAssetGrant {
  chain: Chain;
  token: string; // "USDC"
  /** Per-payout ceiling in the asset's base units (USDC: 1 USDC = 1_000_000). */
  maxPerIntentBase: bigint;
  /** Lifetime cumulative ceiling over the grant, base units. */
  maxTotalBase: bigint;
  /** Per-payout fee ceiling, base units. */
  maxFeePerIntentBase: bigint;
  /** Allowlisted destination addresses (chain-native form). */
  destinations: string[];
}

export interface MintPayoutCapabilityInput {
  ownerSigner: RecordSigner;
  walletId: string; // uuid
  descriptorId: string; // sha256:... of the wallet descriptor
  grantId: string; // uuid
  /** Source account(s) the grant may spend FROM, per chain (chain-native addr). */
  sourceAddressByChain: Partial<Record<Chain, string>>;
  assets: PayoutAssetGrant[];
  notBefore: Date;
  expiresAt: Date;
  /** Party authorized to request payouts under this grant (base64url ed25519).
   *  Defaults to self-delegation (the owner). */
  delegatePublicKey?: string;
  approvalThreshold?: number;
  maxIntents?: number;
  purpose?: string;
  /** Stamp for issued_at; defaults to notBefore (deterministic-friendly). */
  issuedAt?: Date;
}

const MAX_CAPABILITY_LIFETIME_MS = 86_400_000; // wallet spec LIMITS.max_capability_lifetime_ms (24h)

function keyRef(publicKey: string) {
  return { algorithm: "Ed25519", key_id: keyIdForPublicKey(publicKey), public_key: publicKey };
}

function sha256Id(value: unknown): `sha256:${string}` {
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))))}`;
}

/** Build + seal a multi-chain payout capability. Throws on an out-of-spec
 *  window or empty spec; the returned JSON is ready for policies.payout_capability. */
export async function mintPayoutCapability(input: MintPayoutCapabilityInput): Promise<unknown> {
  if (input.assets.length === 0) throw new Error("mintPayoutCapability: at least one asset grant is required");
  const lifetime = input.expiresAt.getTime() - input.notBefore.getTime();
  if (lifetime <= 0) throw new Error("mintPayoutCapability: expiresAt must be after notBefore");
  if (lifetime > MAX_CAPABILITY_LIFETIME_MS) {
    throw new Error(`mintPayoutCapability: lifetime ${lifetime}ms exceeds the 24h capability cap`);
  }

  const accountSet = new Set<string>();
  const seenAssets = new Set<string>();
  const seenTargets = new Set<string>();
  const spend_limits: Array<{ asset_id: string; max_per_intent: string; max_total: string }> = [];
  const fee_limits: Array<{ asset_id: string; max_per_intent: string }> = [];
  const call_rules: Array<{ target_account: string; actions: string[]; methods: string[]; requires_approval: boolean }> = [];

  for (const a of input.assets) {
    const source = input.sourceAddressByChain[a.chain];
    if (!source) throw new Error(`mintPayoutCapability: no source address for chain ${a.chain}`);
    if (a.destinations.length === 0) throw new Error(`mintPayoutCapability: chain ${a.chain} has no destinations`);
    const { assetId, account } = payoutCaip(a.chain, a.token, source);
    // The capability spec requires unique asset_ids and target_accounts. Reject
    // duplicates here with a clear mint-level error rather than letting the
    // wallet library throw an opaque "must be sorted and unique" downstream.
    if (seenAssets.has(assetId)) {
      throw new Error(`mintPayoutCapability: duplicate asset grant for ${a.chain}/${a.token} — merge them into one grant`);
    }
    seenAssets.add(assetId);
    accountSet.add(account); // one source account per chain the grant covers (CAIP-10)
    spend_limits.push({ asset_id: assetId, max_per_intent: a.maxPerIntentBase.toString(), max_total: a.maxTotalBase.toString() });
    fee_limits.push({ asset_id: assetId, max_per_intent: a.maxFeePerIntentBase.toString() });
    for (const dest of a.destinations) {
      const target = payoutCaip(a.chain, a.token, dest).account;
      if (seenTargets.has(target)) {
        throw new Error(`mintPayoutCapability: duplicate destination ${dest} on ${a.chain} — list each destination once`);
      }
      seenTargets.add(target);
      call_rules.push({ target_account: target, actions: ["transfer"], methods: [], requires_approval: (input.approvalThreshold ?? 0) > 0 });
    }
  }

  // The wallet spec requires canonically sorted, unique arrays.
  const byStr = <T>(pick: (row: T) => string) => (a: T, b: T) => {
    const x = pick(a);
    const y = pick(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  spend_limits.sort(byStr((r) => r.asset_id));
  fee_limits.sort(byStr((r) => r.asset_id));
  call_rules.sort(byStr((r) => r.target_account));
  const accounts = [...accountSet].sort();

  const spendPolicy = { spend_limits, fee_limits, call_rules };
  const issuedAt = (input.issuedAt ?? input.notBefore).toISOString();

  const core = {
    schema: "agent-wallet/capability/0.1",
    grant_id: input.grantId,
    wallet_id: input.walletId,
    descriptor_id: input.descriptorId,
    issuer: keyRef(input.ownerSigner.public_key),
    delegate: keyRef(input.delegatePublicKey ?? input.ownerSigner.public_key),
    accounts,
    call_rules,
    spend_limits,
    fee_limits,
    max_intents: input.maxIntents ?? 256,
    approval_threshold: input.approvalThreshold ?? 0,
    issued_at: issuedAt,
    not_before: input.notBefore.toISOString(),
    expires_at: input.expiresAt.toISOString(),
    revocation_nonce: 0,
    policy_hash: sha256Id(spendPolicy),
    purpose: input.purpose ?? "payout",
  };

  const sealed = await sealWalletCapability(core as never, input.ownerSigner);
  // Cross a process boundary the way the DB does — strip the in-process brand.
  return JSON.parse(JSON.stringify(sealed));
}
