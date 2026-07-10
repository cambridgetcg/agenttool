/**
 * Data types for the AgentTool SDK.
 */

/** A stored memory. */
export interface Memory {
  id: string;
  content: string;
  type: string;
  agent_id?: string;
  key?: string;
  metadata: Record<string, unknown>;
  importance: number;
  score?: number;
  created_at?: string;
  updated_at?: string;
}

/** Options for storing a memory. */
export interface StoreOptions {
  type?: string;
  agent_id?: string;
  key?: string;
  metadata?: Record<string, unknown>;
  importance?: number;
}

/** Options for searching memories. */
export interface SearchMemoryOptions {
  limit?: number;
  type?: string;
  agent_id?: string;
}

/** Result of scraping a URL. */
export interface ScrapeResult {
  url: string;
  content: string;
  status_code: number;
  [key: string]: unknown;
}

/** Result returned when an operator has enabled the unisolated legacy path. */
export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

/** Result of `tools.parse_document` (Mozilla Readability + plain-text fallback). */
export interface DocumentResult {
  title: string;
  content: string;
  word_count: number;
  content_type: string;
  metadata: Record<string, unknown>;
  duration_ms: number;
}

/** A wallet — the minted unit of agent-economy custody.
 *  `api_key` is only present right after `create_wallet` (new project bootstrap). */
export interface Wallet {
  id: string;
  name: string;
  balance: number;
  currency: string;
  frozen: boolean;
  agent_id?: string;
  api_key?: string;
}

/** Options for creating a wallet. */
export interface CreateWalletOptions {
  name: string;
  agent_id?: string;
  currency?: string;
}

/** An escrow — locks credits between creator + worker until released or refunded. */
export interface Escrow {
  id: string;
  status: "pending" | "active" | "released" | "refunded" | "disputed";
  amount: number;
  description: string;
  creator_wallet_id: string;
  worker_wallet_id?: string;
  deadline?: string;
}
