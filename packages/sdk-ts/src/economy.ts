/**
 * Economy client — wallets and escrows for agent-to-agent value exchange.
 *
 * Mirrors py `agenttool.economy`: 17 methods across the wallet + escrow
 * surfaces of the agent-economy API (full CRUD, fund/spend, freeze/unfreeze,
 * spending policy, transactions, escrow lifecycle).
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
import type { Escrow, Wallet } from "./types.js";

/** @internal */
export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

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

export interface CreateEscrowOpts {
  creator_wallet_id: string;
  amount: number;
  description: string;
  worker_wallet_id?: string;
  deadline?: string;
  /** 8-256 visible ASCII non-space chars. Exact retries return the same escrow's current row. */
  idempotency_key?: string;
}

/** Unwrap `{success, data}` envelope if present, otherwise return as-is. */
function unwrap<T = Record<string, unknown>>(json: unknown): T {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
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

  // ── Escrows ─────────────────────────────────────────────────────────────

  /** Create an escrow — locks wallet balance units until released or refunded. */
  async create_escrow(options: CreateEscrowOpts): Promise<Escrow> {
    if (
      options.idempotency_key !== undefined &&
      !/^[!-~]{8,256}$/.test(options.idempotency_key)
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

    const resp = await globalThis.fetch(url, init);

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
