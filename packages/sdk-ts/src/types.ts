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

/** API usage statistics. */
export interface UsageStats {
  writes: number;
  reads: number;
  searches: number;
  total_memories: number;
  plan: string;
}

/** A web search result. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

/** Response from the search endpoint. */
export interface SearchResponse {
  results: SearchResult[];
  cached: boolean;
  duration_ms: number;
}

/** Result of scraping a URL. */
export interface ScrapeResult {
  url: string;
  content: string;
  status_code: number;
  [key: string]: unknown;
}

/** Result of sandboxed code execution. */
export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

/** Result of a verification request. */
export interface VerifyResult {
  verdict: string;
  confidence: number;
  sources: string[];
  evidence: string;
  caveats: string[];
}

/** A wallet object. */
export interface Wallet {
  id: string;
  name: string;
  balance: number;
  api_key: string;
}

/** Options for creating a wallet. */
export interface CreateWalletOptions {
  name: string;
}
