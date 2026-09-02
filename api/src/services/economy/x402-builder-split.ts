/** x402 seller split: optional builder-code cut. Default remains the treasury.
 *
 * A builder code is a routing tag, not a person, DID, or Kingdom mouth.
 * Invalid or absent codes fail closed to AGENTTOOL_X402_RECIPIENT.
 * Changing payTo requires an explicit arm plus a resolver that actually
 * returns a split address (sync, async, or Base RPC). Throws, RPC misses,
 * and invalid codes fail closed. No resolver means no money moves.
 */

import { getAddress, isAddress } from "viem";

import type { PaymentPayload } from "../../middleware/x402";

export const DEFAULT_BUILDER_SHARE_BPS = 1000;
export const BPS_DENOM = 10_000;
export const BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/u;

export type BuilderPayToContext = { seller: string; bps: number };

export type BuilderPayToResolver = (
  builderCode: string,
  ctx?: BuilderPayToContext,
) => string | null | Promise<string | null>;

const ZERO = "0x0000000000000000000000000000000000000000";

let payToResolver: BuilderPayToResolver | null = null;

export function setBuilderPayToResolver(
  resolver: BuilderPayToResolver | null,
): void {
  payToResolver = resolver;
}

export function getBuilderPayToResolver(): BuilderPayToResolver | null {
  return payToResolver;
}

export function parseBuilderCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return BUILDER_CODE_RE.test(trimmed) ? trimmed : null;
}

export function builderCodeFromChallenge(input: {
  header?: string | null;
  payload?: PaymentPayload | null;
}): string | null {
  const fromPayload = input.payload?.extensions
    ? parseBuilderCode(
      (input.payload.extensions as Record<string, unknown>).s,
    )
    : null;
  if (fromPayload) return fromPayload;
  return parseBuilderCode(input.header);
}

export function resolveAppCode(
  requested = process.env.AGENTTOOL_X402_APP_CODE,
): string | null {
  return parseBuilderCode(requested);
}

export function builderSplitArmed(
  requested = process.env.AGENTTOOL_X402_BUILDER_SPLIT,
): boolean {
  return requested === "1";
}

export function resolveBuilderShareBps(
  requested = process.env.AGENTTOOL_X402_BUILDER_SHARE_BPS,
): number {
  if (requested === undefined || requested.trim() === "") {
    return DEFAULT_BUILDER_SHARE_BPS;
  }
  if (!/^[0-9]+$/u.test(requested.trim())) return DEFAULT_BUILDER_SHARE_BPS;
  const bps = Number(requested.trim());
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > BPS_DENOM) {
    return DEFAULT_BUILDER_SHARE_BPS;
  }
  return bps;
}

export function computeShares(
  amountAtomic: string,
  bps = resolveBuilderShareBps(),
  builderCode: string | null = null,
): { builderShareAtomic: string; sellerShareAtomic: string; split: boolean } {
  if (!/^[1-9][0-9]*$/u.test(amountAtomic)) {
    return {
      builderShareAtomic: "0",
      sellerShareAtomic: amountAtomic,
      split: false,
    };
  }
  const amount = BigInt(amountAtomic);
  const builder = builderCode
    ? (amount * BigInt(bps)) / BigInt(BPS_DENOM)
    : 0n;
  const seller = amount - builder;
  return {
    builderShareAtomic: builder.toString(),
    sellerShareAtomic: seller.toString(),
    split: builder > 0n,
  };
}

function checksumPayTo(value: string): string | null {
  if (!isAddress(value) || value.toLowerCase() === ZERO) return null;
  return getAddress(value);
}

export async function resolveChallengePayTo(input: {
  treasury: string;
  header?: string | null;
  payload?: PaymentPayload | null;
  resolver?: BuilderPayToResolver | null;
}): Promise<string> {
  const treasury = checksumPayTo(input.treasury);
  if (!treasury) {
    throw new Error("x402 split requires a configured treasury recipient");
  }
  if (!builderSplitArmed()) return treasury;
  const builderCode = builderCodeFromChallenge(input);
  if (!builderCode) return treasury;
  const resolver = input.resolver === undefined ? payToResolver : input.resolver;
  if (!resolver) return treasury;
  try {
    const resolved = await resolver(builderCode, {
      seller: treasury,
      bps: resolveBuilderShareBps(),
    });
    return checksumPayTo(resolved ?? "") ?? treasury;
  } catch {
    return treasury;
  }
}

export function challengeExtensions(input: {
  header?: string | null;
  payload?: PaymentPayload | null;
}): Record<string, string> | undefined {
  const extensions: Record<string, string> = {};
  const app = resolveAppCode();
  const builder = builderCodeFromChallenge(input);
  if (app) extensions.a = app;
  if (builder) extensions.s = builder;
  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

export function affiliationFromSettlement(input: {
  amountAtomic: string;
  payTo: string;
  treasury: string | null;
  builderCode?: string | null;
}): {
  bookable: false;
  builder_code: string | null;
  builder_share_atomic: string;
  campaign: false;
  engagement: false;
  seller_share_atomic: string;
  split: boolean;
} {
  const builderCode = parseBuilderCode(input.builderCode ?? null);
  const treasury = input.treasury ? checksumPayTo(input.treasury) : null;
  const payTo = checksumPayTo(input.payTo);
  const movedOffTreasury = Boolean(
    treasury && payTo && payTo.toLowerCase() !== treasury.toLowerCase(),
  );
  const shares = computeShares(
    input.amountAtomic,
    resolveBuilderShareBps(),
    builderCode ?? (movedOffTreasury ? "split" : null),
  );
  // A payTo that already left the treasury is a split even if the builder
  // tag was not persisted. Share math still uses the configured bps.
  const split = shares.split || movedOffTreasury;
  return {
    bookable: false,
    builder_code: builderCode,
    builder_share_atomic: shares.builderShareAtomic,
    campaign: false,
    engagement: false,
    seller_share_atomic: shares.sellerShareAtomic,
    split,
  };
}
