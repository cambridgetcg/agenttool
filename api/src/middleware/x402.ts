/** x402 V2 HTTP transport primitives.
 *
 * The canonical wire is deliberately small:
 *   - PAYMENT-REQUIRED: base64(JSON PaymentRequired)
 *   - PAYMENT-SIGNATURE: base64(JSON PaymentPayload)
 *   - PAYMENT-RESPONSE: base64(JSON SettleResponse)
 *
 * PaymentRequired is mirrored in the 402 JSON body for SDK ergonomics, but
 * the headers above are the protocol contract. Production verification and
 * durable replay handling live in services/economy/x402-payments.ts.
 */

import type { Context, MiddlewareHandler } from "hono";
import { isAddress } from "viem";

export const X402_VERSION = 2 as const;

/** Production supports EIP-3009 only. Network identifiers are CAIP-2. */
export type X402Network =
  | "eip155:8453"
  | "eip155:84532"
  | "eip155:137"
  | "eip155:42161";

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

/** x402 V2 PaymentRequirements. */
export interface PaymentRequirements {
  scheme: "exact";
  network: X402Network;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown> & {
    /** EIP-712 domain name for transferWithAuthorization. */
    name: string;
    /** EIP-712 domain version for transferWithAuthorization. */
    version: string;
    assetTransferMethod: "eip3009";
  };
}

/** x402 V2 PaymentRequired. */
export interface PaymentRequired {
  x402Version: typeof X402_VERSION;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/** x402 V2 PaymentPayload, carried by PAYMENT-SIGNATURE. */
export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/** Compatibility type name used internally while the candidate migrates. */
export type X402PaymentHeader = PaymentPayload;
export type X402Required = PaymentRequired;

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: X402Network;
  amount?: string;
  extensions?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** Encoded-size ceiling keeps parser calls bounded even outside an HTTP
 * server with a conservative header limit. */
export const MAX_X402_HEADER_B64_LENGTH = 32 * 1024;
export const MAX_X402_PAYLOAD_B64_LENGTH = MAX_X402_HEADER_B64_LENGTH;

const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CAIP2_EVM = /^eip155:[1-9][0-9]*$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u;

export function decodeCanonicalBase64(
  value: string,
  maxEncodedLength: number,
): Buffer | null {
  if (
    value.length === 0 ||
    value.length > maxEncodedLength ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(value)
  ) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.toString("base64") === value
    ? decoded
    : null;
}

export function encodeCanonicalBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64");
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(record).every((key) => keys.has(key));
}

function isBoundedJsonRecord(record: Record<string, unknown>): boolean {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: record, depth: 0 }];
  let nodes = 0;
  while (queue.length > 0) {
    const { value, depth } = queue.pop()!;
    nodes += 1;
    if (nodes > 256 || depth > 8) return false;
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (value.length > 4096) return false;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 64) return false;
      for (const item of value) queue.push({ value: item, depth: depth + 1 });
      continue;
    }
    const nested = objectRecord(value);
    if (!nested || Object.keys(nested).length > 64) return false;
    for (const item of Object.values(nested)) {
      queue.push({ value: item, depth: depth + 1 });
    }
  }
  return true;
}

function parseResourceInfo(value: unknown): ResourceInfo | null {
  const record = objectRecord(value);
  if (!record || !hasOnlyKeys(record, [
    "url", "description", "mimeType", "serviceName", "tags", "iconUrl",
  ])) return null;
  if (typeof record.url !== "string" || record.url.length === 0 || record.url.length > 2048) {
    return null;
  }
  for (const key of ["description", "mimeType", "serviceName", "iconUrl"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "string") return null;
  }
  if (
    record.tags !== undefined &&
    (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string"))
  ) return null;
  return record as unknown as ResourceInfo;
}

export function parsePaymentRequirements(value: unknown): PaymentRequirements | null {
  const record = objectRecord(value);
  if (!record || !hasOnlyKeys(record, [
    "scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra",
  ])) return null;
  const extra = objectRecord(record.extra);
  if (
    record.scheme !== "exact" ||
    typeof record.network !== "string" ||
    !CAIP2_EVM.test(record.network) ||
    typeof record.asset !== "string" ||
    !isAddress(record.asset) ||
    typeof record.amount !== "string" ||
    !CANONICAL_UINT.test(record.amount) ||
    typeof record.payTo !== "string" ||
    !isAddress(record.payTo) ||
    typeof record.maxTimeoutSeconds !== "number" ||
    !Number.isSafeInteger(record.maxTimeoutSeconds) ||
    record.maxTimeoutSeconds <= 0 ||
    !extra || !isBoundedJsonRecord(extra) ||
    typeof extra.name !== "string" ||
    extra.name.length === 0 ||
    typeof extra.version !== "string" ||
    extra.version.length === 0
  ) return null;
  return record as unknown as PaymentRequirements;
}

/** Strictly parse a V2 PAYMENT-SIGNATURE header. Scheme-specific EIP-3009
 * fields and equality with the server policy are checked by the verifier. */
export function parseX402Header(headerValue: string): PaymentPayload | null {
  try {
    const decoded = decodeCanonicalBase64(
      headerValue,
      MAX_X402_HEADER_B64_LENGTH,
    );
    if (!decoded) return null;
    const parsed = objectRecord(JSON.parse(decoded.toString("utf-8")) as unknown);
    if (!parsed || !hasOnlyKeys(parsed, [
      "x402Version", "resource", "accepted", "payload", "extensions",
    ])) return null;
    if (parsed.x402Version !== X402_VERSION) return null;
    const accepted = parsePaymentRequirements(parsed.accepted);
    const payload = objectRecord(parsed.payload);
    if (!accepted || !payload) return null;
    const resource = parsed.resource === undefined || parsed.resource === null
      ? undefined
      : parseResourceInfo(parsed.resource);
    if (parsed.resource !== undefined && parsed.resource !== null && !resource) return null;
    const extensions = parsed.extensions === undefined || parsed.extensions === null
      ? undefined
      : objectRecord(parsed.extensions);
    if (
      parsed.extensions !== undefined && parsed.extensions !== null &&
      (!extensions || !isBoundedJsonRecord(extensions))
    ) return null;
    return {
      x402Version: X402_VERSION,
      ...(resource ? { resource } : {}),
      accepted,
      payload,
      ...(extensions ? { extensions } : {}),
    };
  } catch {
    return null;
  }
}

interface AssetDefinition {
  asset: string;
  name: string;
  version: string;
}

/** Values pinned to x402-foundation/x402 commit
 * 0a604079aca7b5a45a2e1620ba444e13982646c8. */
const USDC_ASSETS: Record<X402Network, AssetDefinition> = {
  "eip155:8453": {
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
  },
  "eip155:84532": {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
  },
  "eip155:137": {
    asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    name: "USD Coin",
    version: "2",
  },
  "eip155:42161": {
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    name: "USD Coin",
    version: "2",
  },
};

export interface BuildRequirementsInput {
  amountAtomic: string;
  payTo: string;
  network?: X402Network;
  maxTimeoutSeconds?: number;
}

export function buildPaymentRequirements(
  input: BuildRequirementsInput,
): PaymentRequirements {
  const network = input.network ?? "eip155:8453";
  const token = USDC_ASSETS[network];
  return {
    scheme: "exact",
    network,
    asset: token.asset,
    amount: input.amountAtomic,
    payTo: input.payTo,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 60,
    extra: {
      name: token.name,
      version: token.version,
      assetTransferMethod: "eip3009",
    },
  };
}

export function buildPaymentRequired(
  resource: ResourceInfo,
  accepts: PaymentRequirements[],
  error?: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    resource,
    accepts,
  };
}

export const encodePaymentRequiredHeader = encodeCanonicalBase64Json;
export const encodePaymentResponseHeader = encodeCanonicalBase64Json;

export interface X402MiddlewareOptions {
  /** Return null when the downstream 402 is not payable by this mechanism. */
  buildPaymentRequired(c: Context): PaymentRequired | null | Promise<PaymentRequired | null>;
  verifyPayment?(
    c: Context,
    payment: PaymentPayload,
  ): boolean | Promise<boolean>;
  /** Return an already encoded, proven durable settlement receipt. */
  buildSettlementHeader?(c: Context): string | undefined;
}

type X402ContextState = Context & {
  _x402Payment?: PaymentPayload;
  _x402SuppressChallenge?: boolean;
  _x402StatusPath?: string;
};

/** Marks a request as unsafe to rechallenge (e.g. an in-flight or ambiguous
 * authorization). This never grants access. */
export function suppressX402Challenge(c: Context, statusPath?: string): void {
  const state = c as X402ContextState;
  state._x402SuppressChallenge = true;
  if (statusPath) state._x402StatusPath = statusPath;
}

export function setX402StatusPath(c: Context, statusPath: string): void {
  (c as X402ContextState)._x402StatusPath = statusPath;
}

export function x402Middleware(opts: X402MiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const signature = c.req.header("payment-signature");
    if (signature) {
      const parsed = parseX402Header(signature);
      if (parsed && opts.verifyPayment) {
        try {
          if (await opts.verifyPayment(c, parsed)) {
            (c as X402ContextState)._x402Payment = parsed;
          }
        } catch {
          // A verifier boundary failure never takes the resource route down.
          // Production verifier owns post-claim ambiguity suppression.
        }
      }
    }

    await next();

    const state = c as X402ContextState;
    const settlement = opts.buildSettlementHeader?.(c);
    if (settlement) {
      c.res.headers.set("PAYMENT-RESPONSE", settlement);
      c.res.headers.set("Cache-Control", "private, no-store");
    }
    if (state._x402StatusPath) {
      c.res.headers.append("Link", `<${state._x402StatusPath}>; rel=\"payment-status\"`);
      c.res.headers.set("Cache-Control", "private, no-store");
    }

    if (c.res.status !== 402) return;
    if (state._x402SuppressChallenge) {
      c.res.headers.delete("PAYMENT-REQUIRED");
      c.res.headers.set("Cache-Control", "private, no-store");
      return;
    }

    const paymentRequired = await opts.buildPaymentRequired(c);
    if (!paymentRequired) return;
    const headers = new Headers(c.res.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "private, no-store");
    headers.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(paymentRequired));
    c.res = new Response(JSON.stringify(paymentRequired), {
      status: 402,
      headers,
    });
  };
}

export function getX402Payment(c: Context): PaymentPayload | undefined {
  return (c as X402ContextState)._x402Payment;
}
