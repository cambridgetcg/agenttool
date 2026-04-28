/** Wikipedia API source for claim verification. */

import type { SourceEvidence } from "../types";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

export async function searchWikipedia(
  queries: string[],
  limit: number = 3,
): Promise<SourceEvidence[]> {
  const results: SourceEvidence[] = [];
  const seenTitles = new Set<string>();

  // Use first 2 queries
  for (const query of queries.slice(0, 2)) {
    try {
      const items = await wikiSearch(query, limit);
      for (const item of items) {
        if (seenTitles.has(item.title)) continue;
        seenTitles.add(item.title);

        results.push({
          source: "wikipedia",
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
          title: item.title,
          snippet: item.snippet.replace(/<\/?[^>]+(>|$)/g, ""), // strip HTML tags
          reliability: 0.75,
          position: "neutral",
        });
      }
    } catch {
      // Wikipedia API failures are non-fatal
    }
  }

  return results;
}

interface WikiSearchResult {
  title: string;
  snippet: string;
}

async function wikiSearch(query: string, limit: number): Promise<WikiSearchResult[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    format: "json",
    origin: "*",
  });

  const res = await fetch(`${WIKI_API}?${params}`);
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);

  const data = (await res.json()) as { query?: { search?: WikiSearchResult[] } };
  return data.query?.search ?? [];
}
