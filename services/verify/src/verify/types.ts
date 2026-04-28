/** Core types for the verification pipeline. */

export type ClaimDomain = "finance" | "legal" | "medical" | "science" | "general";

export type Verdict = "verified" | "disputed" | "false" | "unverifiable";

export interface ParsedClaim {
  assertion: string;         // the core factual claim, normalised
  domain: ClaimDomain;       // auto-detected or user-provided
  searchQueries: string[];   // generated search queries for source lookup
  entities: string[];        // key entities mentioned (names, dates, numbers)
  isTimeSensitive: boolean;  // true if the claim could change over time
}

export interface SourceEvidence {
  source: string;            // "web" | "wikipedia" | "gov" | "knowledge"
  url: string;
  title: string;
  snippet: string;
  publishedDate?: string;
  reliability: number;       // 0.0 - 1.0
  position: "supports" | "contradicts" | "neutral";
}

export interface JudgeResult {
  verdict: Verdict;
  confidence: number;        // 0.0 - 1.0
  reasoning: string;         // LLM judge's explanation
  caveats: string[];         // nuances, edge cases
}

export interface VerificationResult {
  claim: string;
  parsedClaim: ParsedClaim;
  verdict: Verdict;
  confidence: number;
  evidence: {
    supporting: SourceEvidence[];
    contradicting: SourceEvidence[];
    neutral: SourceEvidence[];
  };
  sources: Array<{
    url: string;
    title: string;
    date?: string;
    reliability: number;
  }>;
  caveats: string[];
  processingMs: number;
}
