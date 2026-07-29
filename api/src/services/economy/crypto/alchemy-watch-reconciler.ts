/**
 * Credential-safe Alchemy Notify reconciler for durable deposit-watch state.
 *
 * This adapter can inspect one existing Address Activity webhook, inspect its
 * bounded paginated membership, and idempotently add or remove one address.
 * It cannot create/delete webhooks, change their destination or active state,
 * expose provider responses, ingest events, sign, or broadcast transactions.
 *
 * A successful PATCH is only mutation acceptance. A later independent GET
 * must observe the exact webhook identity and membership before the durable
 * control plane may call the watch converged.
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md.
 */

import { isAddress } from "viem";

import {
  EVM_CHAINS,
  isEvmChain,
  type EvmChain,
} from "./chains";
import {
  type DepositWatchNetwork,
  type DepositWatchProviderOutcome,
  type DepositWatchProviderReconciler,
  type DepositWatchReconcileRequest,
} from "./deposit-watch";
import {
  ALCHEMY_ADDRESS_ACTIVITY_ACTIVE,
  ALCHEMY_ADDRESS_ACTIVITY_WEBHOOK_TYPE,
  ALCHEMY_WATCH_TARGET_REVISION_MAX,
  alchemyAddressActivityNetwork,
  alchemyDepositWatchTargetFingerprint,
} from "./alchemy-notify";

const ALCHEMY_NOTIFY_ORIGIN = "https://dashboard.alchemy.com";
const TEAM_WEBHOOKS_PATH = "/api/team-webhooks";
const WEBHOOK_ADDRESSES_PATH = "/api/webhook-addresses";
const UPDATE_WEBHOOK_ADDRESSES_PATH = "/api/update-webhook-addresses";
const CALLBACK_PATH_PREFIX = "/v1/billing/crypto-webhook/";

const ALLOWED_PATHS = new Set([
  TEAM_WEBHOOKS_PATH,
  WEBHOOK_ADDRESSES_PATH,
  UPDATE_WEBHOOK_ADDRESSES_PATH,
]);

export const ALCHEMY_WATCH_ENDPOINTS = {
  teamWebhooks: `${ALCHEMY_NOTIFY_ORIGIN}${TEAM_WEBHOOKS_PATH}`,
  webhookAddresses: `${ALCHEMY_NOTIFY_ORIGIN}${WEBHOOK_ADDRESSES_PATH}`,
  updateWebhookAddresses:
    `${ALCHEMY_NOTIFY_ORIGIN}${UPDATE_WEBHOOK_ADDRESSES_PATH}`,
} as const;

export const ALCHEMY_WATCH_DEFAULT_TIMEOUT_MS = 5_000;
export const ALCHEMY_WATCH_DEFAULT_MAX_RESPONSE_BYTES = 256 * 1_024;
export const ALCHEMY_WATCH_DEFAULT_PAGE_SIZE = 100;
export const ALCHEMY_WATCH_DEFAULT_MAX_PAGES = 1_000;
export const ALCHEMY_WATCH_DEFAULT_MAX_ADDRESSES = 100_000;

const ALCHEMY_WATCH_MAX_TIMEOUT_MS = 30_000;
const ALCHEMY_WATCH_MAX_RESPONSE_BYTES = 1_024 * 1_024;
const ALCHEMY_WATCH_MAX_PAGE_SIZE = 100;
const ALCHEMY_WATCH_MAX_PAGES = 1_000;
const ALCHEMY_WATCH_MAX_ADDRESSES = 100_000;
const ALCHEMY_WATCH_MAX_TEAM_WEBHOOKS = 1_000;
const ALCHEMY_WATCH_MAX_WEBHOOK_ID_BYTES = 256;
const ALCHEMY_WATCH_MAX_CURSOR_BYTES = 1_024;
const ALCHEMY_WATCH_MAX_REQUEST_BYTES = 4_096;
const ALCHEMY_WATCH_MAX_BODY_CHUNKS = 1_024;
const ALCHEMY_WATCH_MAX_AUTH_TOKEN_BYTES = 2_048;

const encoder = new TextEncoder();

export type AlchemyWatchWebhookIds = Partial<
  Record<
    EvmChain,
    Partial<Record<DepositWatchNetwork, string>>
  >
>;

export interface AlchemyWatchReconcilerConfig {
  /** Alchemy team Auth Token; it is sent only as X-Alchemy-Token. */
  authToken: string;
  /**
   * Explicit public origin used to derive the exact per-chain callback URL.
   * There is deliberately no implicit api.agenttool.dev production default.
   */
  callbackBaseUrl: string;
  /** Exact existing webhook identity for every intentionally enabled target. */
  webhookIds: AlchemyWatchWebhookIds;
  /** Monotonic non-secret revision for rolling target changes. */
  targetRevision?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  pageSize?: number;
  maxPages?: number;
  maxAddresses?: number;
}

export interface AlchemyWatchReconcilerOptions {
  config: AlchemyWatchReconcilerConfig;
  fetchImpl?: typeof fetch;
}

interface ValidatedConfig {
  authToken: string;
  callbackOrigin: string;
  webhookIds: AlchemyWatchWebhookIds;
  targetRevision: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  pageSize: number;
  maxPages: number;
  maxAddresses: number;
  maxRequests: number;
  fetchImpl: typeof fetch;
}

type ProviderFaultKind =
  | "configuration"
  | "rejected"
  | "rate_limited"
  | "timeout"
  | "unstable"
  | "unavailable";

class ProviderFault extends Error {
  readonly kind: ProviderFaultKind;

  constructor(kind: ProviderFaultKind) {
    super("Alchemy watch reconciliation failed within a stable boundary.");
    this.name = "AlchemyWatchProviderFault";
    this.kind = kind;
  }
}

interface RequestBudget {
  used: number;
  maximum: number;
}

interface RawWebhook {
  id: string;
  network: string;
  webhook_type: string;
  webhook_url: string;
  is_active: boolean;
}

interface AddressPage {
  addresses: string[];
  totalCount: number;
  after: string | null;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedPrintable(
  value: unknown,
  maximumBytes: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    /^[\x21-\x7e]+$/.test(value) &&
    byteLength(value) <= maximumBytes
  );
}

function validateCallbackOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname === "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname !== "/"
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function validateConfig(
  options: AlchemyWatchReconcilerOptions,
): ValidatedConfig | null {
  if (
    !isRecord(options) ||
    !isRecord(options.config) ||
    !isBoundedPrintable(
      options.config.authToken,
      ALCHEMY_WATCH_MAX_AUTH_TOKEN_BYTES,
    ) ||
    !isRecord(options.config.webhookIds) ||
    (options.fetchImpl !== undefined &&
      typeof options.fetchImpl !== "function")
  ) {
    return null;
  }

  const callbackOrigin = validateCallbackOrigin(
    options.config.callbackBaseUrl,
  );
  const requestTimeoutMs =
    options.config.requestTimeoutMs ?? ALCHEMY_WATCH_DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.config.maxResponseBytes ??
    ALCHEMY_WATCH_DEFAULT_MAX_RESPONSE_BYTES;
  const pageSize =
    options.config.pageSize ?? ALCHEMY_WATCH_DEFAULT_PAGE_SIZE;
  const maxPages =
    options.config.maxPages ?? ALCHEMY_WATCH_DEFAULT_MAX_PAGES;
  const maxAddresses =
    options.config.maxAddresses ?? ALCHEMY_WATCH_DEFAULT_MAX_ADDRESSES;
  const targetRevision = options.config.targetRevision ?? 1;

  if (
    callbackOrigin === null ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > ALCHEMY_WATCH_MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > ALCHEMY_WATCH_MAX_RESPONSE_BYTES ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > ALCHEMY_WATCH_MAX_PAGE_SIZE ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > ALCHEMY_WATCH_MAX_PAGES ||
    !Number.isSafeInteger(maxAddresses) ||
    maxAddresses < 1 ||
    maxAddresses > ALCHEMY_WATCH_MAX_ADDRESSES ||
    maxAddresses > pageSize * maxPages ||
    !Number.isSafeInteger(targetRevision) ||
    targetRevision < 1 ||
    targetRevision > ALCHEMY_WATCH_TARGET_REVISION_MAX
  ) {
    return null;
  }

  return {
    authToken: options.config.authToken,
    callbackOrigin,
    webhookIds: options.config.webhookIds,
    targetRevision,
    requestTimeoutMs,
    maxResponseBytes,
    pageSize,
    maxPages,
    maxAddresses,
    // One webhook-identity GET, the bounded membership pages, and at most one
    // idempotent mutation. No other provider request can fit this budget.
    maxRequests: maxPages + 2,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };
}

function configuredWebhookId(
  config: ValidatedConfig,
  chain: EvmChain,
  network: DepositWatchNetwork,
): string | null {
  const chainTargets = config.webhookIds[chain];
  if (!isRecord(chainTargets)) return null;
  const webhookId = chainTargets[network];
  return isBoundedPrintable(
    webhookId,
    ALCHEMY_WATCH_MAX_WEBHOOK_ID_BYTES,
  )
    ? webhookId
    : null;
}

function expectedCallbackUrl(
  config: ValidatedConfig,
  chain: EvmChain,
): string {
  return `${config.callbackOrigin}${CALLBACK_PATH_PREFIX}${chain}`;
}

function alchemyUrl(
  path: string,
  query?: Readonly<Record<string, string>>,
): string {
  if (!ALLOWED_PATHS.has(path)) throw new ProviderFault("configuration");
  const parsed = new URL(path, ALCHEMY_NOTIFY_ORIGIN);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      parsed.searchParams.set(key, value);
    }
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "dashboard.alchemy.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    !ALLOWED_PATHS.has(parsed.pathname)
  ) {
    throw new ProviderFault("configuration");
  }
  return parsed.href;
}

function spendRequest(budget: RequestBudget): void {
  budget.used += 1;
  if (budget.used > budget.maximum) {
    throw new ProviderFault("rejected");
  }
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Resource cleanup must not replace the stable provider outcome.
  }
}

function httpFault(status: number): ProviderFault {
  if (status === 408 || status === 504) {
    return new ProviderFault("timeout");
  }
  if (status === 429) return new ProviderFault("rate_limited");
  if (status >= 500) return new ProviderFault("unavailable");
  return new ProviderFault("rejected");
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      declaredLength.length > 16 ||
      BigInt(declaredLength) > BigInt(maximumBytes))
  ) {
    await cancelBody(response);
    throw new ProviderFault("rejected");
  }
  if (!response.body) throw new ProviderFault("rejected");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (
        totalBytes > maximumBytes ||
        chunks.length >= ALCHEMY_WATCH_MAX_BODY_CHUNKS
      ) {
        void reader.cancel().catch(() => undefined);
        throw new ProviderFault("rejected");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProviderFault("rejected");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderFault("rejected");
  }
}

async function withinRequestDeadline<T>(
  config: ValidatedConfig,
  parentSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parentSignal.aborted) throw new ProviderFault("timeout");

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = (): void => controller.abort();
  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  const work = Promise.resolve().then(() => operation(controller.signal));
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ProviderFault("timeout"));
    }, config.requestTimeoutMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    if (error instanceof ProviderFault) throw error;
    if (timedOut || parentSignal.aborted || controller.signal.aborted) {
      throw new ProviderFault("timeout");
    }
    // Provider exception text is intentionally discarded here.
    throw new ProviderFault("unavailable");
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

async function getJson(
  config: ValidatedConfig,
  budget: RequestBudget,
  signal: AbortSignal,
  url: string,
): Promise<unknown> {
  spendRequest(budget);
  return withinRequestDeadline(config, signal, async (requestSignal) => {
    const response = await config.fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: requestSignal,
      headers: {
        Accept: "application/json",
        "X-Alchemy-Token": config.authToken,
      },
    });
    if (!response.ok) {
      await cancelBody(response);
      throw httpFault(response.status);
    }
    return readBoundedJson(response, config.maxResponseBytes);
  });
}

async function patchMembership(
  config: ValidatedConfig,
  budget: RequestBudget,
  signal: AbortSignal,
  webhookId: string,
  address: string,
  desiredState: "watching" | "not_watching",
): Promise<void> {
  const body = JSON.stringify({
    webhook_id: webhookId,
    addresses_to_add: desiredState === "watching" ? [address] : [],
    addresses_to_remove:
      desiredState === "not_watching" ? [address] : [],
  });
  if (byteLength(body) > ALCHEMY_WATCH_MAX_REQUEST_BYTES) {
    throw new ProviderFault("rejected");
  }

  spendRequest(budget);
  await withinRequestDeadline(config, signal, async (requestSignal) => {
    const response = await config.fetchImpl(
      alchemyUrl(UPDATE_WEBHOOK_ADDRESSES_PATH),
      {
        method: "PATCH",
        redirect: "error",
        signal: requestSignal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Alchemy-Token": config.authToken,
        },
        body,
      },
    );
    if (!response.ok) {
      await cancelBody(response);
      throw httpFault(response.status);
    }
    // PATCH success is only an acknowledgement. Do not parse, persist, log,
    // or mistake its response body for independent provider observation.
    await cancelBody(response);
  });
}

function parseWebhook(value: unknown): RawWebhook {
  if (
    !isRecord(value) ||
    !isBoundedPrintable(
      value.id,
      ALCHEMY_WATCH_MAX_WEBHOOK_ID_BYTES,
    ) ||
    typeof value.network !== "string" ||
    typeof value.webhook_type !== "string" ||
    typeof value.webhook_url !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw new ProviderFault("rejected");
  }
  return {
    id: value.id,
    network: value.network,
    webhook_type: value.webhook_type,
    webhook_url: value.webhook_url,
    is_active: value.is_active,
  };
}

function validateConfiguredWebhook(
  payload: unknown,
  expected: {
    id: string;
    network: string;
    callbackUrl: string;
  },
): void {
  // The current endpoint and archived official SDK use `{ data: [...] }`.
  // Alchemy's generated reference example currently wraps that exact envelope
  // in a one-element array, so accept only those two bounded wire shapes.
  const envelope =
    isRecord(payload)
      ? payload
      : Array.isArray(payload) &&
          payload.length === 1 &&
          isRecord(payload[0])
        ? payload[0]
        : null;
  if (envelope === null || !Array.isArray(envelope.data)) {
    throw new ProviderFault("rejected");
  }
  if (envelope.data.length > ALCHEMY_WATCH_MAX_TEAM_WEBHOOKS) {
    throw new ProviderFault("rejected");
  }

  const matches: RawWebhook[] = [];
  for (const item of envelope.data) {
    const webhook = parseWebhook(item);
    if (webhook.id === expected.id) matches.push(webhook);
  }
  if (matches.length !== 1) throw new ProviderFault("rejected");

  const webhook = matches[0]!;
  if (
    webhook.webhook_type !== ALCHEMY_ADDRESS_ACTIVITY_WEBHOOK_TYPE ||
    webhook.network !== expected.network ||
    webhook.is_active !== ALCHEMY_ADDRESS_ACTIVITY_ACTIVE ||
    webhook.webhook_url !== expected.callbackUrl
  ) {
    throw new ProviderFault("rejected");
  }
}

function parseAddressPage(
  payload: unknown,
  pageSize: number,
  maxAddresses: number,
): AddressPage {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.data) ||
    payload.data.length > pageSize ||
    !isRecord(payload.pagination) ||
    !isRecord(payload.pagination.cursors)
  ) {
    throw new ProviderFault("rejected");
  }

  const totalCount = payload.pagination.total_count;
  if (
    !Number.isSafeInteger(totalCount) ||
    (totalCount as number) < 0 ||
    (totalCount as number) > maxAddresses
  ) {
    throw new ProviderFault("rejected");
  }

  const cursor = payload.pagination.cursors.after;
  if (
    cursor !== undefined &&
    cursor !== null &&
    !isBoundedPrintable(cursor, ALCHEMY_WATCH_MAX_CURSOR_BYTES)
  ) {
    throw new ProviderFault("rejected");
  }

  const addresses = payload.data.map((address) => {
    if (typeof address !== "string" || !isAddress(address)) {
      throw new ProviderFault("rejected");
    }
    return address.toLowerCase();
  });
  return {
    addresses,
    totalCount: totalCount as number,
    after: typeof cursor === "string" ? cursor : null,
  };
}

async function observeMembership(
  config: ValidatedConfig,
  budget: RequestBudget,
  signal: AbortSignal,
  webhookId: string,
  address: string,
): Promise<boolean> {
  const expectedAddress = address.toLowerCase();
  const cursors = new Set<string>();
  const observedAddresses = new Set<string>();
  let after: string | null = null;
  let expectedTotal: number | null = null;

  for (let pageNumber = 0; pageNumber < config.maxPages; pageNumber += 1) {
    const query: Record<string, string> = {
      webhook_id: webhookId,
      limit: String(config.pageSize),
    };
    if (after !== null) query.after = after;
    const payload = await getJson(
      config,
      budget,
      signal,
      alchemyUrl(WEBHOOK_ADDRESSES_PATH, query),
    );
    const page = parseAddressPage(
      payload,
      config.pageSize,
      config.maxAddresses,
    );

    if (expectedTotal === null) expectedTotal = page.totalCount;
    if (page.totalCount !== expectedTotal) {
      throw new ProviderFault("unstable");
    }
    for (const member of page.addresses) {
      if (observedAddresses.has(member)) {
        throw new ProviderFault("unstable");
      }
      observedAddresses.add(member);
      if (observedAddresses.size > config.maxAddresses) {
        throw new ProviderFault("rejected");
      }
    }
    if (observedAddresses.size > page.totalCount) {
      throw new ProviderFault("unstable");
    }

    if (observedAddresses.has(expectedAddress)) return true;
    if (page.after === null) {
      if (observedAddresses.size !== page.totalCount) {
        throw new ProviderFault("unstable");
      }
      return false;
    }
    if (cursors.has(page.after)) throw new ProviderFault("unstable");
    cursors.add(page.after);
    after = page.after;
  }

  throw new ProviderFault("rejected");
}

function providerOutcome(
  fault: ProviderFault,
): DepositWatchProviderOutcome {
  switch (fault.kind) {
    case "configuration":
      return {
        kind: "terminal",
        code: "provider_configuration_missing",
      };
    case "rejected":
      return { kind: "terminal", code: "provider_rejected" };
    case "rate_limited":
      return {
        kind: "retryable",
        code: "provider_rate_limited",
      };
    case "timeout":
      return { kind: "retryable", code: "provider_timeout" };
    case "unstable":
      return {
        kind: "retryable",
        code: "provider_unavailable",
      };
    case "unavailable":
      return {
        kind: "retryable",
        code: "provider_unavailable",
      };
  }
}

async function reconcileAlchemyWatch(
  config: ValidatedConfig,
  request: DepositWatchReconcileRequest,
): Promise<DepositWatchProviderOutcome> {
  if (request.provider !== "alchemy" || !isEvmChain(request.chain)) {
    return { kind: "terminal", code: "provider_unsupported" };
  }
  if (
    (request.network !== "mainnet" && request.network !== "testnet") ||
    (request.desiredState !== "watching" &&
      request.desiredState !== "not_watching") ||
    !isAddress(request.address)
  ) {
    return { kind: "terminal", code: "provider_rejected" };
  }

  const webhookId = configuredWebhookId(
    config,
    request.chain,
    request.network,
  );
  if (webhookId === null) {
    return {
      kind: "terminal",
      code: "provider_configuration_missing",
    };
  }
  if (request.targetRevision !== config.targetRevision) {
    // A revision disagreement is sufficient to fence this process from the
    // provider. The fingerprint check below remains a second, independent
    // binding to the exact public target.
    return {
      kind: "retryable",
      code: "provider_target_mismatch",
    };
  }
  const configuredTargetFingerprint =
    alchemyDepositWatchTargetFingerprint({
      chain: request.chain,
      network: request.network,
      webhookId,
      callbackBaseUrl: config.callbackOrigin,
    });
  if (configuredTargetFingerprint === null) {
    return {
      kind: "terminal",
      code: "provider_configuration_missing",
    };
  }
  if (request.targetFingerprint !== configuredTargetFingerprint) {
    // During a rolling config change, an older worker may briefly see a row
    // fenced for the new public target. It must neither mutate its old target
    // nor terminally block the new generation.
    return {
      kind: "retryable",
      code: "provider_target_mismatch",
    };
  }

  const budget: RequestBudget = {
    used: 0,
    maximum: config.maxRequests,
  };
  try {
    const webhookPayload = await getJson(
      config,
      budget,
      request.signal,
      alchemyUrl(TEAM_WEBHOOKS_PATH),
    );
    validateConfiguredWebhook(webhookPayload, {
      id: webhookId,
      network: alchemyAddressActivityNetwork(
        request.chain,
        request.network,
      ),
      callbackUrl: expectedCallbackUrl(config, request.chain),
    });

    const isWatching = await observeMembership(
      config,
      budget,
      request.signal,
      webhookId,
      request.address,
    );
    const desiredWatching = request.desiredState === "watching";
    if (isWatching === desiredWatching) {
      return {
        kind: "verified",
        observedState: isWatching ? "watching" : "not_watching",
      };
    }

    await patchMembership(
      config,
      budget,
      request.signal,
      webhookId,
      request.address,
      request.desiredState,
    );
    return { kind: "mutation_accepted" };
  } catch (error) {
    return providerOutcome(
      error instanceof ProviderFault
        ? error
        : new ProviderFault("unavailable"),
    );
  }
}

/**
 * Build a closed reconciler. Invalid global configuration is represented as a
 * stable terminal provider outcome rather than an exception containing input.
 */
export function createAlchemyDepositWatchReconciler(
  options: AlchemyWatchReconcilerOptions,
): DepositWatchProviderReconciler {
  const config = validateConfig(options);
  if (config === null) {
    return async (request) =>
      request.provider !== "alchemy" || !isEvmChain(request.chain)
        ? { kind: "terminal", code: "provider_unsupported" }
        : {
            kind: "terminal",
            code: "provider_configuration_missing",
          };
  }
  return (request) => reconcileAlchemyWatch(config, request);
}

/** Enumerated here for config builders without opening arbitrary chains. */
export const ALCHEMY_WATCH_EVM_CHAINS = EVM_CHAINS;
