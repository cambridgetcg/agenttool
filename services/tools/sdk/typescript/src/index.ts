/** agent-tools TypeScript SDK — thin REST wrapper. */

export interface AgentToolsConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SearchParams {
  query: string;
  num_results?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  country?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

export interface ScrapeParams {
  url: string;
  selector?: string;
  schema?: Record<string, unknown>;
  follow_pagination?: boolean;
}

export interface BrowseParams {
  url: string;
  actions?: Array<{
    type: "click" | "type" | "scroll" | "wait" | "select";
    selector?: string;
    text?: string;
    value?: string;
  }>;
  extract?: string;
  screenshot?: boolean;
}

export interface DocumentParams {
  url?: string;
  base64?: string;
  filename?: string;
}

export interface ExecuteParams {
  language: "python" | "node" | "bash";
  code: string;
  stdin?: string;
  timeout_ms?: number;
  allow_network?: boolean;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

export interface UsageInfo {
  credits_remaining: number;
  plan: string;
  events_today: number;
  events_month: number;
}

export class AgentTools {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: AgentToolsConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.agenttool.dev").replace(/\/$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return data as T;
  }

  /** Search the web. Cost: 1 credit. */
  async search(params: SearchParams): Promise<{ results: SearchResult[]; cached: boolean; duration_ms: number }> {
    return this.request("POST", "/v1/search", params);
  }

  /** Scrape a URL. Cost: 2 credits. */
  async scrape(params: ScrapeParams) {
    return this.request<{
      url: string;
      content: string;
      extracted?: unknown;
      links: string[];
      fetched_at: string;
      duration_ms: number;
    }>("POST", "/v1/scrape", params);
  }

  /** Browse with managed Playwright session. Cost: 5 credits/page. */
  async browse(params: BrowseParams) {
    return this.request<{
      result?: unknown;
      screenshot_url?: string;
      job_id?: string;
      status?: string;
      duration_ms?: number;
    }>("POST", "/v1/browse", params);
  }

  /** Parse a document (PDF, DOCX, HTML). Cost: 3 credits. */
  async document(params: DocumentParams) {
    return this.request<{
      text: string;
      title?: string;
      metadata: Record<string, unknown>;
      page_count?: number;
      duration_ms: number;
    }>("POST", "/v1/document", params);
  }

  /** Execute code in sandbox. Cost: 1 credit per 10s. */
  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    return this.request("POST", "/v1/execute", params);
  }

  /** Poll async job status. */
  async job(jobId: string) {
    return this.request<{
      job_id: string;
      status: "queued" | "active" | "completed" | "failed";
      result?: unknown;
      error?: string;
    }>("GET", `/v1/jobs/${jobId}`);
  }

  /** Get usage info and credit balance. */
  async usage(): Promise<UsageInfo> {
    return this.request("GET", "/v1/usage");
  }
}

export default AgentTools;
