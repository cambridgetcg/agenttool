/** Web search with Brave Search API (primary) + SerpAPI fallback. */

import { config } from "../config";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
}

export interface SearchOptions {
  query: string;
  num_results?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  country?: string;
}

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";
const SERP_API = "https://serpapi.com/search";

/**
 * Search the web. Uses Brave Search API if key is valid; falls back to SerpAPI.
 */
export async function search(opts: SearchOptions): Promise<SearchResult[]> {
  const { query, num_results = 5, freshness, country } = opts;

  // Try Brave first
  if (config.braveApiKey) {
    try {
      return await searchBrave(query, num_results, freshness, country);
    } catch (err) {
      const msg = (err as Error).message;
      // Fall through to SerpAPI on auth/subscription errors
      if (!msg.includes("422") && !msg.includes("401") && !msg.includes("invalid")) {
        throw err;
      }
      console.warn("Brave Search failed, falling back to SerpAPI:", msg);
    }
  }

  // SerpAPI fallback
  if (config.serpApiKey) {
    return await searchSerp(query, num_results);
  }

  throw new Error("No search API configured (need BRAVE_API_KEY or SERPAPI_KEY)");
}

async function searchBrave(
  query: string,
  num_results: number,
  freshness?: string,
  country?: string
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(num_results, 20)),
  });
  if (freshness) params.set("freshness", freshness);
  if (country) params.set("country", country);

  const response = await fetch(`${BRAVE_API}?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": config.braveApiKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brave Search API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as BraveResponse;
  return (data.web?.results ?? []).slice(0, num_results).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    date: r.page_age ?? r.age ?? null,
  }));
}

async function searchSerp(query: string, num_results: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    num: String(Math.min(num_results, 10)),
    api_key: config.serpApiKey,
  });

  const response = await fetch(`${SERP_API}?${params}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SerpAPI error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as SerpResponse;
  return (data.organic_results ?? []).slice(0, num_results).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? "",
    date: r.date ?? null,
  }));
}

// Brave API response shape (partial)
interface BraveResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      page_age?: string;
      age?: string;
    }>;
  };
}

// SerpAPI response shape (partial)
interface SerpResponse {
  organic_results?: Array<{
    title: string;
    link: string;
    snippet?: string;
    date?: string;
  }>;
}
