/** payout-capability.ts — the tamper-evident payout bound.
 *
 * The `economy.policies` row is DB-mutable: anyone who can write it can raise
 * their own payout ceiling. This module lets a policy carry an owner-signed
 * `agent-wallet/0.1` capability. When present, the enforced numbers come from
 * the *verified* capability, not the raw columns — so editing the row (or the
 * capability blob) breaks the signature and the payout is refused.
 *
 * `enforceSignedPayoutBound` is verification + policy logic only; it takes a
 * `getCumulativeSpentBase` callback so the caller can read the same-asset
 * lifetime spend INSIDE the reserving transaction (the cumulative check and the
 * reservation then serialize — no TOCTOU over-spend). It does not adopt the
 * full intent/simulation/receipt lifecycle; only the capability's signed authority.
 *
 * REVOCATION: the capability lives in exactly one place — the policy row. To
 * revoke, the owner clears it (payout_capability = NULL) or replaces it with a
 * fresh capability. For agent-owned wallets a NULL capability FAILS CLOSED
 * (see checkPayoutPolicy), so clearing = stop. `expires_at` (≤24h by the wallet
 * spec) is the backstop. There is no separate on-chain revocation epoch here.
 */
import { verifyWalletCapability } from "@agenttool/wallet";
import {
  EVM_CHAIN_IDS,
  USDC_ADDRESSES,
  USDC_SOL_MINT,
  isEvmChain,
  type Chain,
} from "./chains";

/** Solana mainnet CAIP-2 reference (genesis hash prefix). */
const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** Map a payout (chain, token, address) to the CAIP-19 asset id and CAIP-10
 *  account the owner's capability is expressed in. CONTRACT: EVM addresses are
 *  lowercased on both sides (CAIP compares byte-exact; EVM addresses are
 *  case-insensitive, so the capability MUST use lowercase to match). Solana
 *  base58 is case-sensitive and used verbatim. USDC only, for now. */
export function payoutCaip(
  chain: Chain,
  token: string,
  address: string,
): { assetId: string; account: string } {
  if (token.toUpperCase() !== "USDC") {
    throw new Error(`payoutCaip: only USDC is mapped, got ${token}`);
  }
  if (chain === "solana") {
    return {
      assetId: `${SOLANA_CAIP2}/token:${USDC_SOL_MINT}`,
      account: `${SOLANA_CAIP2}:${address}`,
    };
  }
  if (isEvmChain(chain)) {
    const caip2 = `eip155:${EVM_CHAIN_IDS[chain]}`;
    return {
      assetId: `${caip2}/erc20:${USDC_ADDRESSES[chain].toLowerCase()}`,
      account: `${caip2}:${address.toLowerCase()}`,
    };
  }
  throw new Error(`payoutCaip: unsupported chain ${chain}`);
}

/** Normalize an ed25519 public key to unpadded base64url so a standard-base64
 *  owner key and the wallet library's base64url key compare equal. Returns the
 *  input unchanged if it is not decodable (the compare then fails safely). */
export function normalizeKeyB64u(key: string): string {
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return key;
  }
}

export type SignedBoundDecision =
  | { ok: true; bound: "signed" }
  | {
      ok: false;
      bound: "signed";
      error:
        | "payout_capability_invalid"
        | "payout_capability_owner_mismatch"
        | "payout_capability_not_active"
        | "payout_asset_uncapped"
        | "payout_exceeds_per_payout_cap"
        | "payout_exceeds_cumulative_cap"
        | "destination_not_allowlisted"
        | "payout_dual_control_required";
      detail?: string;
    };

export interface SignedBoundInput {
  /** The owner-signed capability JSON stored on the policy row. */
  capabilityJson: unknown;
  /** The base64url ed25519 public key that MUST have issued the capability —
   *  the wallet's registered owner key. A capability issued by any other key
   *  is refused even if internally valid. Encoding is normalized before compare. */
  expectedIssuerPublicKey: string;
  /** CAIP-19 asset id of the payout token (e.g. Solana USDC). The capability
   *  must carry a spend_limit for exactly this asset, or the payout is refused. */
  assetId: string;
  /** CAIP-10 account the funds are leaving to, matched against call_rules. */
  destinationAccount: string;
  amountBase: bigint;
  now: Date;
  /** Count of approvals the host has already authenticated (verified authority,
   *  binding, expiry, and replay). NEVER pass caller-supplied approval ids
   *  through unchecked — that is worse than refusing. Defaults to 0. */
  hostVerifiedApprovalCount?: number;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Enforce a payout against an owner-signed capability.
 *
 *  `getCumulativeSpentBase(notBefore)` must return the sum of same-asset payouts
 *  already committed for this wallet since the capability became active — read
 *  by the caller inside the reserving transaction. `max_total` is a LIFETIME
 *  cap over the grant, not a daily one. */
export async function enforceSignedPayoutBound(
  input: SignedBoundInput,
  getCumulativeSpentBase: (notBefore: Date) => Promise<bigint>,
): Promise<SignedBoundDecision> {
  const fail = (error: Extract<SignedBoundDecision, { ok: false }>["error"], detail?: string): SignedBoundDecision => ({
    ok: false,
    bound: "signed",
    error,
    detail,
  });

  let capability: {
    issuer?: { public_key?: string };
    not_before?: string;
    expires_at?: string;
    spend_limits?: Array<{ asset_id: string; max_per_intent: string; max_total: string }>;
    call_rules?: Array<{ target_account: string }>;
    approval_threshold?: number;
  };
  try {
    // Throws on a tampered blob, bad signature, or malformed record.
    capability = verifyWalletCapability(input.capabilityJson) as typeof capability;
  } catch (e) {
    return fail("payout_capability_invalid", String((e as Error).message ?? e).slice(0, 160));
  }

  // Bind to OUR owner: only the wallet's registered key may set the bound.
  if (
    typeof capability.issuer?.public_key !== "string" ||
    normalizeKeyB64u(capability.issuer.public_key) !== normalizeKeyB64u(input.expectedIssuerPublicKey)
  ) {
    return fail(
      "payout_capability_owner_mismatch",
      "capability issuer is not the wallet's registered owner key",
    );
  }

  // Active window.
  const now = input.now.getTime();
  const notBefore = capability.not_before ? new Date(capability.not_before) : new Date(0);
  if (notBefore.getTime() > now) {
    return fail("payout_capability_not_active", `not_before ${capability.not_before}`);
  }
  if (capability.expires_at && Date.parse(capability.expires_at) <= now) {
    return fail("payout_capability_not_active", `expired at ${capability.expires_at}`);
  }

  // Destination allowlist: if the capability names call_rules, the destination
  // account must be among their targets. No call_rules ⇒ no destination gate.
  const rules = capability.call_rules ?? [];
  if (rules.length > 0 && !rules.some((r) => r.target_account === input.destinationAccount)) {
    return fail("destination_not_allowlisted", `destination ${input.destinationAccount} not in capability`);
  }

  // The asset must be explicitly capped. Refusing an uncapped asset is the
  // safe default — the owner opts each asset in, never out.
  const limit = (capability.spend_limits ?? []).find((l) => l.asset_id === input.assetId);
  if (!limit) {
    return fail("payout_asset_uncapped", `no spend_limit for ${input.assetId}`);
  }
  const maxPerIntent = toBigInt(limit.max_per_intent);
  const maxTotal = toBigInt(limit.max_total);
  if (maxPerIntent === null || maxTotal === null) {
    return fail("payout_capability_invalid", "spend_limit amounts are not canonical integers");
  }

  if (input.amountBase > maxPerIntent) {
    return fail(
      "payout_exceeds_per_payout_cap",
      `amount ${input.amountBase} exceeds max_per_intent ${maxPerIntent}`,
    );
  }

  // Lifetime cumulative cap: sum same-asset spend since the grant became active.
  const spent = await getCumulativeSpentBase(notBefore);
  if (spent + input.amountBase > maxTotal) {
    return fail(
      "payout_exceeds_cumulative_cap",
      `grant_spent=${spent} new=${input.amountBase} max_total=${maxTotal}`,
    );
  }

  // Dual control: a positive approval_threshold means high-trust payouts need
  // that many host-AUTHENTICATED approvals. This is now a real gate keyed off
  // the signed number, not a dead stub — a future approval flow supplies the count.
  const threshold = capability.approval_threshold ?? 0;
  if (threshold > 0 && (input.hostVerifiedApprovalCount ?? 0) < threshold) {
    return fail(
      "payout_dual_control_required",
      `needs ${threshold} host-verified approvals; have ${input.hostVerifiedApprovalCount ?? 0}`,
    );
  }

  return { ok: true, bound: "signed" };
}
