/** Confidence scoring and final verdict assignment. */

import type { JudgeResult, SourceEvidence, Verdict } from "./types";

/**
 * Refine the judge's confidence score with heuristic adjustments:
 * - Boost confidence if many high-reliability sources agree
 * - Penalise if evidence is sparse or low-reliability
 * - Penalise if time-sensitive with stale sources
 */
export function refineScore(
  judgeResult: JudgeResult,
  evidence: SourceEvidence[],
  isTimeSensitive: boolean,
): { verdict: Verdict; confidence: number } {
  let confidence = judgeResult.confidence;

  const supporting = evidence.filter((e) => e.position === "supports");
  const contradicting = evidence.filter((e) => e.position === "contradicts");

  // Source count adjustment
  const totalRelevant = supporting.length + contradicting.length;
  if (totalRelevant === 0) {
    return { verdict: "unverifiable", confidence: 0.1 };
  }
  if (totalRelevant === 1) {
    confidence *= 0.7; // single source penalty
  }

  // Reliability-weighted agreement
  const avgSupportReliability =
    supporting.length > 0
      ? supporting.reduce((sum, e) => sum + e.reliability, 0) / supporting.length
      : 0;

  const avgContradictReliability =
    contradicting.length > 0
      ? contradicting.reduce((sum, e) => sum + e.reliability, 0) / contradicting.length
      : 0;

  // High-reliability consensus boost
  if (avgSupportReliability > 0.8 && supporting.length >= 3 && contradicting.length === 0) {
    confidence = Math.min(1.0, confidence * 1.15);
  }

  // High-reliability contradiction: force "disputed" if judge said "verified"
  if (
    avgContradictReliability > 0.7 &&
    contradicting.length >= 2 &&
    judgeResult.verdict === "verified"
  ) {
    return { verdict: "disputed", confidence: Math.min(confidence, 0.5) };
  }

  // Time-sensitivity penalty (stale data for a time-sensitive claim)
  if (isTimeSensitive) {
    confidence *= 0.9; // universal 10% penalty for time-sensitive claims
  }

  // Clamp
  confidence = Math.max(0, Math.min(1, confidence));

  return { verdict: judgeResult.verdict, confidence };
}

/**
 * Simplified scorer for testing and direct use:
 * Takes a base confidence, evidence array, and verdict string.
 */
export function refineConfidence(
  baseConfidence: number,
  evidence: SourceEvidence[],
  verdict: Verdict,
): number {
  const fakeJudge: JudgeResult = {
    verdict,
    confidence: baseConfidence,
    reasoning: "",
    supportingPoints: [],
    contradictions: [],
  };
  const { confidence } = refineScore(fakeJudge, evidence, false);
  return Math.max(0.01, Math.min(0.99, confidence));
}
