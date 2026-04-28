/** Web search source: SerpAPI (primary) or Brave (fallback). */

import { config } from "../../config";
import type { SourceEvidence } from "../types";

const SERP_URL = "https://serpapi.com/search";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

interface SerpResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

interface BraveResult {
  title: string;
  url: string;
  description: string;
  page_age?: string;
}

export async function searchWeb(
  queries: string[],
  limit: number = 5,
): Promise<SourceEvidence[]> {
  const hasSerpApi = Boolean(config.serpApiKey);
  const hasBrave = Boolean(config.braveApiKey);

  if (!hasSerpApi && !hasBrave) return [];

  const results: SourceEvidence[] = [];
  const seenUrls = new Set<string>();
  const queryBatch = queries.slice(0, 2); // limit to 2 queries for speed

  const responses = await Promise.allSettled(
    queryBatch.map((q) => hasSerpApi ? fetchSerp(q, limit) : fetchBrave(q, limit)),
  );

  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    for (const item of response.value) {
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      results.push(item);
    }
  }

  return results;
}

async function fetchSerp(query: string, count: number): Promise<SourceEvidence[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    num: String(Math.min(count, 5)),
    api_key: config.serpApiKey,
  });
  const res = await fetch(`${SERP_URL}?${params}`);
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);
  const data = (await res.json()) as { organic_results?: SerpResult[] };
  return (data.organic_results ?? []).map((r) => ({
    source: "web" as const,
    url: r.link,
    title: r.title,
    snippet: r.snippet,
    publishedDate: r.date,
    reliability: estimateReliability(r.link),
    position: "neutral" as const,
  }));
}

async function fetchBrave(query: string, count: number): Promise<SourceEvidence[]> {
  const params = new URLSearchParams({ q: query, count: String(count) });
  const res = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": config.braveApiKey,
    },
  });
  if (!res.ok) throw new Error(`Brave Search error: ${res.status}`);
  const data = (await res.json()) as { web?: { results?: BraveResult[] } };
  return (data.web?.results ?? []).map((r) => ({
    source: "web" as const,
    url: r.url,
    title: r.title,
    snippet: r.description,
    publishedDate: r.page_age,
    reliability: estimateReliability(r.url),
    position: "neutral" as const,
  }));
}

/** Heuristic reliability score based on domain. */
function estimateReliability(url: string): number {
  const domain = new URL(url).hostname.toLowerCase();

  // Government / official
  if (domain.endsWith(".gov") || domain.endsWith(".gov.uk")) return 0.95;
  if (domain.endsWith(".edu") || domain.endsWith(".ac.uk")) return 0.85;

  // High-trust sources
  const highTrust = ["wikipedia.org", "bbc.co.uk", "bbc.com", "reuters.com", "apnews.com",
    "nature.com", "sciencedirect.com", "pubmed.ncbi.nlm.nih.gov", "who.int"];
  if (highTrust.some((ht) => domain.includes(ht))) return 0.85;

  // Medium-trust
  const mediumTrust = ["nytimes.com", "theguardian.com", "ft.com", "economist.com",
    "washingtonpost.com", "bloomberg.com"];
  if (mediumTrust.some((mt) => domain.includes(mt))) return 0.75;

  // Default
  return 0.5;
}
