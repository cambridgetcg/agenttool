/** Full verification pipeline: parse → gather → classify → judge → score → result. */

import type { ClaimDomain, VerificationResult } from "./types";
import { parseClaim } from "./parser";
import { gatherEvidence } from "./sources/dispatcher";
import { classifyEvidence } from "./evidence";
import { judge } from "./judge";
import { refineScore } from "./scorer";

/**
 * Verify a factual claim end-to-end.
 *
 * Steps:
 * 1. Parse claim → extract assertion, domain, search queries
 * 2. Gather evidence from all sources in parallel
 * 3. Classify evidence as supporting/contradicting/neutral
 * 4. LLM judge evaluates evidence and produces verdict
 * 5. Scorer refines confidence with heuristics
 * 6. Package final result
 */
export async function verify(
  claim: string,
  options?: { domain?: ClaimDomain; context?: string },
): Promise<VerificationResult> {
  const start = performance.now();

  // Step 1: Parse
  const parsedClaim = await parseClaim(
    options?.context ? `${claim}\n\nContext: ${options.context}` : claim,
    options?.domain,
  );

  // Step 2: Gather evidence
  const rawEvidence = await gatherEvidence(parsedClaim);

  // Step 3: Classify evidence positions
  const classifiedEvidence = await classifyEvidence(parsedClaim, rawEvidence);

  // Step 4: Judge
  const judgeResult = await judge(parsedClaim, classifiedEvidence);

  // Step 5: Refine score
  const { verdict, confidence } = refineScore(
    judgeResult,
    classifiedEvidence,
    parsedClaim.isTimeSensitive,
  );

  // Step 6: Package result
  const supporting = classifiedEvidence.filter((e) => e.position === "supports");
  const contradicting = classifiedEvidence.filter((e) => e.position === "contradicts");
  const neutral = classifiedEvidence.filter((e) => e.position === "neutral");

  const processingMs = Math.round(performance.now() - start);

  return {
    claim,
    parsedClaim,
    verdict,
    confidence,
    evidence: { supporting, contradicting, neutral },
    sources: classifiedEvidence.map((e) => ({
      url: e.url,
      title: e.title,
      date: e.publishedDate,
      reliability: e.reliability,
    })),
    caveats: judgeResult.caveats,
    processingMs,
  };
}
