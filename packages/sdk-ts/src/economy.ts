/**
 * Economy client — wallets, durable payout requests, and escrows for
 * agent-to-agent value exchange.
 *
 * Mirrors py `agenttool.economy`: 18 shared methods across the wallet, payout,
 * and escrow surfaces of the agent-economy API. TypeScript also retains the
 * backward-compatible `createWallet` alias, for 19 methods total.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * const wallet = await at.economy.create_wallet("agent-42-wallet", { agent_id: "agent-42" });
 * const worker = await at.economy.create_wallet("worker-wallet", { agent_id: "agent-43" });
 * await at.economy.fund_wallet(wallet.id, { amount: 500, description: "Weekly budget" });
 * await at.economy.spend(wallet.id, { amount: 10, counterparty: "wal_xyz", description: "Task fee" });
 *
 * const escrow = await at.economy.create_escrow({
 *   creator_wallet_id: wallet.id,
 *   worker_wallet_id: worker.id,
 *   amount: 100,
 *   description: "Summarise 50 papers",
 *   idempotency_key: "summarise-50-papers-v1",
 * });
 * await at.economy.release_escrow(escrow.id);
 * ```
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";
import type { Escrow, Wallet } from "./types.js";

export interface CreateWalletOpts {
  agent_id?: string;
  currency?: string;
}

export interface FundWalletOpts {
  amount: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SpendOpts {
  amount: number;
  counterparty: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface SetWalletPolicyOpts {
  max_per_transaction?: number;
  max_per_hour?: number;
  max_per_day?: number;
  allowed_recipients?: string[];
  requires_approval_above?: number;
}

export type PayoutChain =
  | "ethereum"
  | "base"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "solana";

export type PayoutStatus =
  | "requested"
  | "signing"
  | "broadcasting"
  | "broadcast"
  | "confirmed"
  | "failed"
  | "cancelled";

export type PayoutNetwork = "testnet" | "mainnet";

export interface RequestPayoutOpts {
  chain: PayoutChain;
  /** Canonical positive USDC base-unit integer string; never a float. */
  amount_base: string;
  destination_address: string;
  token?: "USDC";
  metadata?: Record<string, unknown>;
  /**
   * Caller-chosen, required durable request identity.
   *
   * Must be 8-256 visible ASCII characters without spaces. The SDK neither
   * generates nor stores this value. Fresh requests currently rest with
   * `503 payout_admission_resting`; only an exact replay of durable historical
   * accepted state can return a payout, and changed input is a conflict.
   */
  idempotency_key: string;
}

/** Current server state returned only from exact durable historical replay. */
export interface PayoutRequestOutcome {
  id: string;
  status: PayoutStatus;
  /**
   * Whether the historical row remains pending under its durable state.
   * This does not claim that the currently resting broadcast path operates.
   */
  broadcast_pending: boolean;
  /**
   * True only when the server resolved this call through its durable payout
   * request reservation. This is not a claim about Redis availability.
   */
  replayed: boolean;
  note?: string;
}

/** One outgoing crypto payout row returned by `list_payouts`. */
export interface Payout {
  id: string;
  chain: PayoutChain;
  /** Durable network identity; null only for quarantined legacy rows. */
  network: PayoutNetwork | null;
  token: string;
  /** Exact token base-unit integer string. */
  amount_base: string;
  destination_address: string;
  status: PayoutStatus;
  tx_hash: string | null;
  requested_at: string;
  confirmed_at: string | null;
}

export interface CreateEscrowOpts {
  creator_wallet_id: string;
  amount: number;
  description: string;
  worker_wallet_id?: string;
  deadline?: string;
  /** 8-256 visible ASCII non-space chars. Exact retries return the same escrow's current row. */
  idempotency_key?: string;
}

const IDEMPOTENCY_KEY_RE = /^[!-~]{8,256}$/;
const PAYOUT_CHAINS = new Set<PayoutChain>([
  "ethereum",
  "base",
  "polygon",
  "arbitrum",
  "optimism",
  "solana",
]);
const PAYOUT_STATUSES = new Set<PayoutStatus>([
  "requested",
  "signing",
  "broadcasting",
  "broadcast",
  "confirmed",
  "failed",
  "cancelled",
]);
const PAYOUT_NETWORKS = new Set<PayoutNetwork>(["testnet", "mainnet"]);

/** Unwrap `{success, data}` envelope if present, otherwise return as-is. */
function unwrap<T = Record<string, unknown>>(json: unknown): T {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function invalidPayoutResponse(operation: string, detail: string): never {
  throw new AgentToolError(
    `${operation}: server returned a malformed payout response (${detail}).`,
    {
      code: "invalid_response",
      hint: "Do not infer payout state or retry a payout from this response. Preserve the Idempotency-Key and inspect current state once the API contract is healthy.",
    },
  );
}

function payoutRecord(
  operation: string,
  json: unknown,
): Record<string, unknown> {
  const value = unwrap<unknown>(json);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidPayoutResponse(operation, "expected an object");
  }
  return value as Record<string, unknown>;
}

function payoutString(
  operation: string,
  field: string,
  value: unknown,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalidPayoutResponse(operation, `${field} must be a non-empty string`);
  }
  return value;
}

function payoutNullableString(
  operation: string,
  field: string,
  value: unknown,
): string | null {
  if (value === null) return null;
  return payoutString(operation, field, value);
}

function payoutStatus(
  operation: string,
  value: unknown,
): PayoutStatus {
  if (typeof value !== "string" || !PAYOUT_STATUSES.has(value as PayoutStatus)) {
    return invalidPayoutResponse(operation, "status is unknown");
  }
  return value as PayoutStatus;
}

function payoutChain(operation: string, value: unknown): PayoutChain {
  if (typeof value !== "string" || !PAYOUT_CHAINS.has(value as PayoutChain)) {
    return invalidPayoutResponse(operation, "chain is unknown");
  }
  return value as PayoutChain;
}

function payoutNetwork(
  operation: string,
  data: Record<string, unknown>,
): PayoutNetwork | null {
  if (!Object.prototype.hasOwnProperty.call(data, "network")) {
    return invalidPayoutResponse(
      operation,
      "network must be present (null is allowed for legacy rows)",
    );
  }
  if (data.network === null) return null;
  if (
    typeof data.network !== "string" ||
    !PAYOUT_NETWORKS.has(data.network as PayoutNetwork)
  ) {
    return invalidPayoutResponse(operation, "network is unknown");
  }
  return data.network as PayoutNetwork;
}

function toWallet(json: unknown): Wallet {
  const d = unwrap<Record<string, unknown>>(json);
  return {
    id: (d.id as string) ?? "",
    name: (d.name as string) ?? "",
    balance: (d.balance as number) ?? 0,
    currency: (d.currency as string) ?? "GBP",
    frozen: (d.frozen as boolean) ?? false,
    agent_id: (d.agent_id as string) ?? (d.agentId as string) ?? undefined,
    api_key: (d.api_key as string) ?? (d.apiKey as string) ?? undefined,
  };
}

function toEscrow(json: unknown): Escrow {
  const d = unwrap<Record<string, unknown>>(json);
  return {
    id: (d.id as string) ?? "",
    status: ((d.status as Escrow["status"]) ?? "funded"),
    amount: (d.amount as number) ?? 0,
    description: (d.description as string) ?? "",
    creator_wallet_id:
      (d.creatorWallet as string) ??
      (d.creator_wallet_id as string) ??
      (d.creatorWalletId as string) ??
      "",
    worker_wallet_id:
      (d.workerWallet as string) ??
      (d.worker_wallet_id as string) ??
      (d.workerWalletId as string) ??
      null,
    managed_by:
      (d.managedBy as Escrow["managed_by"]) ??
      (d.managed_by as Escrow["managed_by"]) ??
      null,
    deadline: (d.deadline as string) ?? null,
    released_at:
      (d.releasedAt as string) ?? (d.released_at as string) ?? null,
    created_at:
      (d.createdAt as string) ?? (d.created_at as string) ?? "",
  };
}

function toPayout(json: unknown): Payout {
  const operation = "economy.list_payouts";
  const d = payoutRecord(operation, json);
  const amountBase = payoutString(operation, "amount_base", d.amount_base);
  if (!/^[1-9][0-9]*$/u.test(amountBase)) {
    return invalidPayoutResponse(
      operation,
      "amount_base must be a canonical positive integer string",
    );
  }
  return {
    id: payoutString(operation, "id", d.id),
    chain: payoutChain(operation, d.chain),
    network: payoutNetwork(operation, d),
    token: payoutString(operation, "token", d.token),
    amount_base: amountBase,
    destination_address: payoutString(
      operation,
      "destination_address",
      d.destination_address,
    ),
    status: payoutStatus(operation, d.status),
    tx_hash: payoutNullableString(operation, "tx_hash", d.tx_hash),
    requested_at: payoutString(operation, "requested_at", d.requested_at),
    confirmed_at: payoutNullableString(
      operation,
      "confirmed_at",
      d.confirmed_at,
    ),
  };
}

export class EconomyClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  // ── Wallets ─────────────────────────────────────────────────────────────

  /** Create a new wallet. */
  async create_wallet(name: string, options?: CreateWalletOpts): Promise<Wallet> {
    const body: Record<string, unknown> = {
      name,
      currency: options?.currency ?? "GBP",
    };
    if (options?.agent_id !== undefined) body.agentId = options.agent_id;
    return toWallet(await this.req("POST", "/v1/wallets", body));
  }

  /** Backward-compatible alias for `create_wallet` (camelCase form, present since 0.5.0). */
  async createWallet(opts: { name: string } & CreateWalletOpts): Promise<Wallet> {
    const { name, ...rest } = opts;
    return this.create_wallet(name, rest);
  }

  /** List all wallets for this project. */
  async list_wallets(): Promise<Wallet[]> {
    const data = await this.req("GET", "/v1/wallets");
    const items = unwrap<unknown[]>(data);
    return (Array.isArray(items) ? items : []).map(toWallet);
  }

  /** Get a wallet by ID. */
  async get_wallet(walletId: string): Promise<Wallet> {
    return toWallet(await this.req("GET", `/v1/wallets/${walletId}`));
  }

  /** Add credits to a wallet. */
  async fund_wallet(
    walletId: string,
    options: FundWalletOpts,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      amount: options.amount,
      description: options.description ?? "Manual fund",
    };
    if (options.metadata !== undefined) body.metadata = options.metadata;
    return (await this.req("POST", `/v1/wallets/${walletId}/fund`, body)) as Record<
      string,
      unknown
    >;
  }

  /** Spend credits from a wallet (subject to spending policy). */
  async spend(
    walletId: string,
    options: SpendOpts,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      amount: options.amount,
      counterparty: options.counterparty,
      description: options.description,
    };
    if (options.metadata !== undefined) body.metadata = options.metadata;
    return (await this.req("POST", `/v1/wallets/${walletId}/spend`, body)) as Record<
      string,
      unknown
    >;
  }

  /** Set or update a wallet's spending policy. */
  async set_policy(
    walletId: string,
    options: SetWalletPolicyOpts,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    if (options.max_per_transaction !== undefined)
      body.maxPerTransaction = options.max_per_transaction;
    if (options.max_per_hour !== undefined) body.maxPerHour = options.max_per_hour;
    if (options.max_per_day !== undefined) body.maxPerDay = options.max_per_day;
    if (options.allowed_recipients !== undefined)
      body.allowedRecipients = options.allowed_recipients;
    if (options.requires_approval_above !== undefined)
      body.requiresApprovalAbove = options.requires_approval_above;
    return (await this.req("PUT", `/v1/wallets/${walletId}/policy`, body)) as Record<
      string,
      unknown
    >;
  }

  /** Freeze a wallet — halts all spending immediately. */
  async freeze_wallet(walletId: string): Promise<Wallet> {
    return toWallet(await this.req("POST", `/v1/wallets/${walletId}/freeze`));
  }

  /** Unfreeze a wallet to resume normal operation. */
  async unfreeze_wallet(walletId: string): Promise<Wallet> {
    return toWallet(await this.req("POST", `/v1/wallets/${walletId}/unfreeze`));
  }

  /** Get paginated transaction history for a wallet. */
  async get_transactions(
    walletId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Record<string, unknown>[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const data = await this.req(
      "GET",
      `/v1/wallets/${walletId}/transactions?limit=${limit}&offset=${offset}`,
    );
    const items = unwrap<unknown[]>(data);
    return (Array.isArray(items) ? items : []) as Record<string, unknown>[];
  }

  // ── Crypto payouts ──────────────────────────────────────────────────────

  /**
   * Attempt an outgoing crypto payout under a caller-chosen durable key.
   *
   * Fresh requests currently rest with `503 payout_admission_resting`; only
   * an exact replay of durable historical accepted state can succeed. The SDK
   * sends exactly one request and never generates a key, retries a broadcast,
   * or treats a Redis cache as the correctness boundary.
   */
  async request_payout(
    walletId: string,
    options: RequestPayoutOpts,
  ): Promise<PayoutRequestOutcome> {
    if (
      typeof options.idempotency_key !== "string" ||
      !IDEMPOTENCY_KEY_RE.test(options.idempotency_key)
    ) {
      throw new AgentToolError(
        "request_payout idempotency_key must be 8-256 visible ASCII characters without spaces",
      );
    }

    const body: Record<string, unknown> = {
      chain: options.chain,
      token: options.token ?? "USDC",
      amount_base: options.amount_base,
      destination_address: options.destination_address,
    };
    if (options.metadata !== undefined) body.metadata = options.metadata;

    const data = payoutRecord(
      "economy.request_payout",
      await this.req(
        "POST",
        `/v1/wallets/${walletId}/payout`,
        body,
        { "Idempotency-Key": options.idempotency_key },
      ),
    );
    const status = payoutStatus("economy.request_payout", data.status);
    if (typeof data.broadcast_pending !== "boolean") {
      return invalidPayoutResponse(
        "economy.request_payout",
        "broadcast_pending must be boolean",
      );
    }
    if (typeof data.replayed !== "boolean") {
      return invalidPayoutResponse(
        "economy.request_payout",
        "replayed must be boolean",
      );
    }
    if (data.note !== undefined && typeof data.note !== "string") {
      return invalidPayoutResponse(
        "economy.request_payout",
        "note must be a string when present",
      );
    }
    return {
      id: payoutString("economy.request_payout", "id", data.id),
      status,
      broadcast_pending: data.broadcast_pending,
      replayed: data.replayed,
      note: data.note,
    };
  }

  /** List outgoing crypto payouts for a wallet, newest first. */
  async list_payouts(walletId: string): Promise<Payout[]> {
    const data = payoutRecord(
      "economy.list_payouts",
      await this.req("GET", `/v1/wallets/${walletId}/payouts`),
    );
    const items = data.payouts;
    if (!Array.isArray(items)) {
      return invalidPayoutResponse(
        "economy.list_payouts",
        "payouts must be an array",
      );
    }
    return items.map(toPayout);
  }

  // ── Escrows ─────────────────────────────────────────────────────────────

  /** Create an escrow — locks wallet balance units until released or refunded. */
  async create_escrow(options: CreateEscrowOpts): Promise<Escrow> {
    if (
      options.idempotency_key !== undefined &&
      !IDEMPOTENCY_KEY_RE.test(options.idempotency_key)
    ) {
      throw new AgentToolError(
        "create_escrow idempotency_key must be 8-256 visible ASCII characters without spaces",
      );
    }
    const body: Record<string, unknown> = {
      creatorWalletId: options.creator_wallet_id,
      amount: options.amount,
      description: options.description,
    };
    if (options.worker_wallet_id !== undefined)
      body.workerWalletId = options.worker_wallet_id;
    if (options.deadline !== undefined) body.deadline = options.deadline;
    const headers = options.idempotency_key
      ? { "Idempotency-Key": options.idempotency_key }
      : undefined;
    return toEscrow(await this.req("POST", "/v1/escrows", body, headers));
  }

  /** List escrows, optionally filtered by status. */
  async list_escrows(options?: { status?: Escrow["status"] }): Promise<Escrow[]> {
    const qs = options?.status ? `?status=${encodeURIComponent(options.status)}` : "";
    const data = await this.req("GET", `/v1/escrows${qs}`);
    const items = unwrap<unknown[]>(data);
    return (Array.isArray(items) ? items : []).map(toEscrow);
  }

  /** Get an escrow by ID. */
  async get_escrow(escrowId: string): Promise<Escrow> {
    return toEscrow(await this.req("GET", `/v1/escrows/${escrowId}`));
  }

  /** Accept an escrow as the worker. */
  async accept_escrow(escrowId: string, workerWalletId: string): Promise<Escrow> {
    return toEscrow(
      await this.req("POST", `/v1/escrows/${escrowId}/accept`, {
        workerWalletId,
      }),
    );
  }

  /** Release escrow funds to the worker. */
  async release_escrow(escrowId: string): Promise<Escrow> {
    return toEscrow(await this.req("POST", `/v1/escrows/${escrowId}/release`));
  }

  /** Refund escrow balance units back to the creator. */
  async refund_escrow(escrowId: string): Promise<Escrow> {
    return toEscrow(await this.req("POST", `/v1/escrows/${escrowId}/refund`));
  }

  /** Flag an escrow as disputed — balance units stay locked. */
  async dispute_escrow(escrowId: string): Promise<Escrow> {
    return toEscrow(await this.req("POST", `/v1/escrows/${escrowId}/dispute`));
  }

  // ── internal ────────────────────────────────────────────────────────────

  private async req(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<unknown> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    const init: RequestInit = {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const resp = await this.http.request(url, init);

    if (resp.status >= 400) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail = (json.detail as string) ?? (json.error as string) ?? resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(`Economy API error (${resp.status}): ${detail}`, {
        hint: "Check wallet ID, balance, and spending policy.",
      });
    }

    return resp.json();
  }
}
