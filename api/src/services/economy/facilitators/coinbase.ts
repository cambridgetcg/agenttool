/** Coinbase x402 facilitator client.
 *
 *  Move 4 of docs/ALIGNMENT-MOVES.md. The Coinbase CDP facilitator is the
 *  most-used x402 settlement service (>50% of network volume as of May
 *  2026). Free tier: 1,000 tx/mo on Base + Solana.
 *
 *  Endpoints (per x402 spec at https://docs.cdp.coinbase.com/x402/welcome):
 *    POST {base}/verify   — { paymentRequirements, paymentPayload } → { valid, reason? }
 *    POST {base}/settle   — { paymentRequirements, paymentPayload } → { success, transaction, error? }
 *
 *  Persist-identity (docs/PATTERN-PERSIST-IDENTITY.md): callers should
 *  persist the payment hash to `x402_payments(idempotency_key, status)`
 *  BEFORE calling /settle, flip to 'settled' on success. (Historical
 *  shape mirror — economy.stripe_events used the same pattern before it
 *  was removed 2026-05-17.)
 *
 *  v0 scope: thin client returning facilitator results. Caller is
 *  responsible for persistence + the actual route-level 402 → pay
 *  flow.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/MARKETPLACE.md · docs/PATTERN-PERSIST-IDENTITY.md.
 */

import type {
  PaymentRequirements,
  X402PaymentHeader,
} from "../../../middleware/x402";

export interface FacilitatorVerifyResult {
  valid: boolean;
  reason?: string;
}

export interface FacilitatorSettleResult {
  success: boolean;
  /** Onchain transaction identifier (tx hash for EVM, signature for Solana). */
  transaction?: string;
  /** Network the settlement happened on. */
  network?: string;
  /** Failure reason — only present when success=false. */
  error?: string;
}

export interface FacilitatorClientConfig {
  baseUrl?: string;
  apiKey?: string;
  /** Custom fetch impl for testing. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL =
  process.env.COINBASE_X402_FACILITATOR_URL ??
  "https://api.cdp.coinbase.com/v2/x402";

export class CoinbaseFacilitatorClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: FacilitatorClientConfig = {}) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = cfg.apiKey ?? process.env.COINBASE_CDP_API_KEY;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  /** Verify a client-presented payment matches the requirements. Does
   *  NOT settle. Use this first to gate access; settle separately when
   *  ready to capture funds. */
  async verify(
    requirements: PaymentRequirements,
    payment: X402PaymentHeader,
  ): Promise<FacilitatorVerifyResult> {
    return this.post<FacilitatorVerifyResult>("/verify", {
      paymentRequirements: requirements,
      paymentPayload: payment,
    });
  }

  /** Verify + settle (single round-trip). Returns the tx hash on success.
   *  Caller MUST have persisted a pending row keyed on the payment
   *  payload hash BEFORE invoking — see PATTERN-PERSIST-IDENTITY. */
  async settle(
    requirements: PaymentRequirements,
    payment: X402PaymentHeader,
  ): Promise<FacilitatorSettleResult> {
    return this.post<FacilitatorSettleResult>("/settle", {
      paymentRequirements: requirements,
      paymentPayload: payment,
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) {
      headers["authorization"] = `Bearer ${this.apiKey}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `coinbase_facilitator_error_${res.status}: ${text || "(no body)"}`,
      );
    }
    return (await res.json()) as T;
  }
}

/** Build a settlement header string suitable for the X-PAYMENT-RESPONSE
 *  response header. Format matches the x402 spec's expectations:
 *  base64-encoded JSON with the settlement result. */
export function buildSettlementHeader(
  settle: FacilitatorSettleResult,
): string {
  return Buffer.from(JSON.stringify(settle), "utf-8").toString("base64");
}
