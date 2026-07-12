/** Hardened x402 V2 facilitator boundary.
 *
 * This keeps the official request/response contract while retaining strict
 * deadlines, bounded buffering, sanitized errors, and redirect rejection.
 * Credentials are scoped to the exact official CDP base URL and are never
 * forwarded to an operator-configured facilitator.
 */

import { createHash } from "node:crypto";

import {
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
} from "../../../middleware/x402";
import { generateJwt, type JwtOptions } from "@coinbase/cdp-sdk/auth";
import {
  DEFAULT_X402_FACILITATOR_URL,
  resolveX402Facilitator,
} from "../x402-policy";
import {
  SafeNetError,
  safeNetRequest,
} from "../../net/safe-fetch";

export interface FacilitatorVerifyResult {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export type FacilitatorSettleResult = SettleResponse;

export interface FacilitatorClientConfig {
  baseUrl?: string;
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  /** Test seam; production uses the official SDK's generateJwt. */
  jwtGenerator?: (options: JwtOptions) => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_CONFIGURABLE_RESPONSE_BYTES = 1024 * 1024;
const CAIP2 = /^[a-z0-9]+:[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
let cachedReadiness:
  | { fingerprint: string; result: Promise<boolean> }
  | undefined;

/** Local, no-network readiness proof used before advertising or accepting a
 * payment. For official CDP this actually parses the configured private key
 * and generates an endpoint-bound verify JWT. The result does not prove CDP
 * will accept the key. Default environment readiness is cached until restart. */
export function isX402FacilitatorLocallyReady(options: {
  baseUrl?: string;
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  jwtGenerator?: (options: JwtOptions) => Promise<string>;
} = {}): Promise<boolean> {
  const resolution = resolveX402Facilitator(options.baseUrl);
  const apiKeyId = options.cdpApiKeyId ?? process.env.CDP_API_KEY_ID;
  const apiKeySecret = options.cdpApiKeySecret ?? process.env.CDP_API_KEY_SECRET;
  const check = async (): Promise<boolean> => {
    if (resolution.reason === "invalid") return false;
    if (resolution.url !== DEFAULT_X402_FACILITATOR_URL) {
      return resolution.configured;
    }
    if (!apiKeyId?.trim() || !apiKeySecret?.trim()) return false;
    try {
      const token = await (options.jwtGenerator ?? generateJwt)({
        apiKeyId: apiKeyId.trim(),
        apiKeySecret,
        requestMethod: "POST",
        requestHost: "api.cdp.coinbase.com",
        requestPath: "/platform/v2/x402/verify",
        expiresIn: 120,
      });
      return token.trim().length > 0;
    } catch {
      return false;
    }
  };
  if (options.jwtGenerator) return check();
  const fingerprint = createHash("sha256").update([
    resolution.url,
    resolution.reason ?? "ok",
    apiKeyId?.trim() ?? "",
    createHash("sha256").update(apiKeySecret ?? "").digest("hex"),
  ].join("\0"), "utf-8").digest("hex");
  if (cachedReadiness?.fingerprint !== fingerprint) {
    cachedReadiness = { fingerprint, result: check() };
  }
  return cachedReadiness.result;
}

export class FacilitatorClientError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "FacilitatorClientError";
  }
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  ceiling: number,
): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, ceiling)
    : fallback;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const value = record[key];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function optionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined | null {
  const value = record[key];
  if (value === undefined) return undefined;
  return objectRecord(value);
}

function parseVerifyResult(value: unknown): FacilitatorVerifyResult {
  const record = objectRecord(value);
  if (!record || typeof record.isValid !== "boolean") {
    throw new FacilitatorClientError("coinbase_facilitator_invalid_verify_response");
  }
  const invalidReason = optionalString(record, "invalidReason");
  const invalidMessage = optionalString(record, "invalidMessage");
  const payer = optionalString(record, "payer");
  const extensions = optionalRecord(record, "extensions");
  const extra = optionalRecord(record, "extra");
  if (
    invalidReason === null || invalidMessage === null || payer === null ||
    extensions === null || extra === null ||
    (record.isValid && invalidReason !== undefined)
  ) {
    throw new FacilitatorClientError("coinbase_facilitator_invalid_verify_response");
  }
  return {
    isValid: record.isValid,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    ...(invalidMessage === undefined ? {} : { invalidMessage }),
    ...(payer === undefined ? {} : { payer }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(extra === undefined ? {} : { extra }),
  };
}

function parseSettleResult(value: unknown): FacilitatorSettleResult {
  const record = objectRecord(value);
  if (!record || typeof record.success !== "boolean") {
    throw new FacilitatorClientError("coinbase_facilitator_invalid_settle_response");
  }
  const transaction = optionalString(record, "transaction");
  const network = optionalString(record, "network");
  const errorReason = optionalString(record, "errorReason");
  const errorMessage = optionalString(record, "errorMessage");
  const payer = optionalString(record, "payer");
  const amount = optionalString(record, "amount");
  const extensions = optionalRecord(record, "extensions");
  const extra = optionalRecord(record, "extra");
  if (
    transaction === undefined || transaction === null ||
    network === undefined || network === null || !CAIP2.test(network) ||
    errorReason === null || errorMessage === null || payer === null ||
    amount === null || (amount !== undefined && !CANONICAL_UINT.test(amount)) ||
    extensions === null || extra === null ||
    (record.success && transaction.trim() === "")
  ) {
    throw new FacilitatorClientError("coinbase_facilitator_invalid_settle_response");
  }
  return {
    success: record.success,
    transaction,
    network: network as FacilitatorSettleResult["network"],
    ...(errorReason === undefined ? {} : { errorReason }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(payer === undefined ? {} : { payer }),
    ...(amount === undefined ? {} : { amount }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(extra === undefined ? {} : { extra }),
  };
}

function cancelBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength && /^\d+$/u.test(declaredLength) &&
    BigInt(declaredLength) > BigInt(maxBytes)
  ) {
    cancelBody(response);
    throw new FacilitatorClientError("coinbase_facilitator_response_too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abortRead = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      if (signal.aborted) {
        throw new FacilitatorClientError("coinbase_facilitator_timeout");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        abortRead();
        throw new FacilitatorClientError("coinbase_facilitator_response_too_large");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export class CoinbaseFacilitatorClient {
  private readonly baseUrl: string;
  private readonly officialCredentials:
    | { apiKeyId: string; apiKeySecret: string }
    | undefined;
  private readonly jwtGenerator: (options: JwtOptions) => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly useSafeNet: boolean;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(cfg: FacilitatorClientConfig = {}) {
    const resolution = resolveX402Facilitator(cfg.baseUrl);
    if (cfg.baseUrl !== undefined && !resolution.configured) {
      throw new FacilitatorClientError("coinbase_facilitator_invalid_base_url");
    }
    this.baseUrl = resolution.url;
    const isOfficial = this.baseUrl === DEFAULT_X402_FACILITATOR_URL;
    const apiKeyId = cfg.cdpApiKeyId ?? process.env.CDP_API_KEY_ID;
    const apiKeySecret = cfg.cdpApiKeySecret ?? process.env.CDP_API_KEY_SECRET;
    this.officialCredentials = isOfficial && apiKeyId?.trim() && apiKeySecret?.trim()
      ? { apiKeyId: apiKeyId.trim(), apiKeySecret }
      : undefined;
    this.jwtGenerator = cfg.jwtGenerator ?? generateJwt;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.useSafeNet = !isOfficial && cfg.fetchImpl === undefined;
    this.timeoutMs = boundedPositiveInteger(cfg.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.maxResponseBytes = boundedPositiveInteger(
      cfg.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      MAX_CONFIGURABLE_RESPONSE_BYTES,
    );
  }

  async verify(
    requirements: PaymentRequirements,
    payment: PaymentPayload,
  ): Promise<FacilitatorVerifyResult> {
    return parseVerifyResult(await this.post("/verify", {
      x402Version: X402_VERSION,
      paymentPayload: payment,
      paymentRequirements: requirements,
    }));
  }

  async settle(
    requirements: PaymentRequirements,
    payment: PaymentPayload,
  ): Promise<FacilitatorSettleResult> {
    const result = parseSettleResult(await this.post("/settle", {
      x402Version: X402_VERSION,
      paymentPayload: payment,
      paymentRequirements: requirements,
    }));
    if (result.network !== requirements.network) {
      throw new FacilitatorClientError("coinbase_facilitator_invalid_settle_response");
    }
    return result;
  }

  private async post(path: "/verify" | "/settle", body: unknown): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.baseUrl === DEFAULT_X402_FACILITATOR_URL) {
      if (!this.officialCredentials) {
        throw new FacilitatorClientError("coinbase_facilitator_auth_unavailable");
      }
      const token = (await this.jwtGenerator({
        ...this.officialCredentials,
        requestMethod: "POST",
        requestHost: "api.cdp.coinbase.com",
        requestPath: `/platform/v2/x402${path}`,
        expiresIn: 120,
      })).trim();
      if (!token) throw new FacilitatorClientError("coinbase_facilitator_auth_unavailable");
      headers.authorization = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timeoutError = new FacilitatorClientError("coinbase_facilitator_timeout");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, this.timeoutMs);
    });
    const request = (async (): Promise<unknown> => {
      const serialized = JSON.stringify(body);
      if (this.useSafeNet) {
        const response = await safeNetRequest(`${this.baseUrl}${path}`, {
          method: "POST",
          protocols: ["https:"],
          redirect: "error",
          headers,
          body: serialized,
          timeoutMs: this.timeoutMs,
          maxRequestBytes: 64 * 1024,
          maxResponseBytes: this.maxResponseBytes,
          signal: controller.signal,
        });
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new FacilitatorClientError(
            `coinbase_facilitator_http_${response.statusCode}`,
          );
        }
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
          return JSON.parse(text) as unknown;
        } catch {
          throw new FacilitatorClientError("coinbase_facilitator_invalid_json");
        }
      }
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: serialized,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        cancelBody(response);
        throw new FacilitatorClientError(`coinbase_facilitator_http_${response.status}`);
      }
      const bytes = await readBoundedBody(response, this.maxResponseBytes, controller.signal);
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return JSON.parse(text) as unknown;
      } catch {
        throw new FacilitatorClientError("coinbase_facilitator_invalid_json");
      }
    })();
    try {
      return await Promise.race([request, deadline]);
    } catch (error) {
      if (error === timeoutError || controller.signal.aborted) throw timeoutError;
      if (error instanceof FacilitatorClientError) throw error;
      if (error instanceof SafeNetError) {
        if (error.code === "safe_net_request_timeout") throw timeoutError;
        if (error.code === "safe_net_response_too_large") {
          throw new FacilitatorClientError("coinbase_facilitator_response_too_large");
        }
      }
      throw new FacilitatorClientError("coinbase_facilitator_network_error");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

export function buildSettlementHeader(settle: FacilitatorSettleResult): string {
  return Buffer.from(JSON.stringify(settle), "utf-8").toString("base64");
}
