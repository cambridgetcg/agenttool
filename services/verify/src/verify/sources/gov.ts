/**
 * Gov/official source: queries Brave Search restricted to high-authority domains.
 * Targets: .gov, .gov.uk, .europa.eu, official regulatory bodies, central banks, etc.
 */

import type { SourceEvidence } from "../types";

const GOV_DOMAINS = [
  "site:gov.uk OR site:gov OR site:europa.eu OR site:who.int OR site:un.org OR site:oecd.org",
].join(" ");

const GOV_RELIABILITY = 0.92; // High trust — official sources

export async function queryGovSources(
  queries: string[],
  braveApiKey: string,
): Promise<SourceEvidence[]> {
  const evidence: SourceEvidence[] = [];

  for (const query of queries.slice(0, 2)) {
    const govQuery = `${query} ${GOV_DOMAINS}`;

    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(govQuery)}&count=3`,
        {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": braveApiKey,
          },
          signal: AbortSignal.timeout(4000),
        },
      );

      if (!res.ok) continue;

      const data = (await res.json()) as {
        web?: { results?: Array<{ url: string; title: string; description: string }> };
      };

      for (const result of data.web?.results ?? []) {
        evidence.push({
          source: "gov",
          url: result.url,
          title: result.title,
          excerpt: result.description,
          reliability: GOV_RELIABILITY,
          fetchedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Timeout or network error — skip this query
    }
  }

  return evidence;
}
