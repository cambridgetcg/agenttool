/** Dispatch verification queries to all sources in parallel with timeout. */

import type { ParsedClaim, SourceEvidence } from "../types";
import { searchWeb } from "./web";
import { searchWikipedia } from "./wikipedia";

const SOURCE_TIMEOUT_MS = 5000;

export async function gatherEvidence(claim: ParsedClaim): Promise<SourceEvidence[]> {
  const queries = claim.searchQueries;

  // Run all sources in parallel with timeout
  const sources = await Promise.allSettled([
    withTimeout(searchWeb(queries, 5), SOURCE_TIMEOUT_MS),
    withTimeout(searchWikipedia(queries, 3), SOURCE_TIMEOUT_MS),
    // TODO: add gov.ts source
    // TODO: add knowledge.ts (internal verified facts DB)
  ]);

  const evidence: SourceEvidence[] = [];

  for (const result of sources) {
    if (result.status === "fulfilled" && result.value) {
      evidence.push(...result.value);
    }
    // Rejected sources are silently skipped — partial evidence is fine
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return evidence.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Source timeout after ${ms}ms`)), ms),
    ),
  ]);
}
