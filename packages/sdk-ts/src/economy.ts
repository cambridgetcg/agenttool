/**
 * Economy client for the wallet/economy API.
 */

import { AgentToolError } from "./errors.js";
import type { CreateWalletOptions, Wallet } from "./types.js";
import type { HttpConfig } from "./memory.js";

/**
 * Client for the economy/wallet API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * const wallet = await at.economy.createWallet({ name: "my-wallet" });
 * console.log(wallet.id, wallet.balance);
 * ```
 */
export class EconomyClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Create a new wallet.
   *
   * @param options - Wallet creation options (name required).
   * @returns The created Wallet object.
   */
  async createWallet(options: CreateWalletOptions): Promise<Wallet> {
    const body: Record<string, unknown> = { name: options.name };

    const url = `${this.http.baseUrl}/v1/wallets`;
    const resp = await globalThis.fetch(url, {
      method: "POST",
      headers: this.http.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail = (json.detail as string) ?? resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(`Economy API error (${resp.status}): ${detail}`, {
        hint: "Check your API key and request parameters.",
      });
    }

    return (await resp.json()) as Wallet;
  }
}
