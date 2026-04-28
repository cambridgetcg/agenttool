/** LLM judge: evaluate classified evidence and produce verdict. */

import OpenAI from "openai";
import { config } from "../config";
import type { JudgeResult, ParsedClaim, SourceEvidence, Verdict } from "./types";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: config.openaiApiKey || "placeholder", maxRetries: 0 });
  return _client;
}

const JUDGE_PROMPT = `You are a fact-checking judge. Given a factual claim and classified evidence, determine:

1. VERDICT: verified | disputed | false | unverifiable
2. CONFIDENCE: 0.0 to 1.0 (your confidence in the verdict)
3. REASONING: brief explanation of your judgement
4. CAVEATS: list of nuances, edge cases, or limitations

Rules:
- "verified" = the SPECIFIC claim as stated is accurate; strong supporting evidence, no credible contradictions
- "disputed" = credible evidence on both sides, or claim is partially true but misleading
- "false" = the claim as stated is factually wrong, even if it contains elements of truth
- "unverifiable" = insufficient evidence to determine

CRITICAL: Evaluate the EXACT claim. If the claim states wrong dates, wrong creators, or wrong specifics, it is FALSE even if the general topic is real. "JavaScript was invented by Microsoft in 2005" is FALSE because JavaScript was created by Brendan Eich at Netscape in 1995 — the fact that Microsoft later created JScript does not make the original claim true.

Weight evidence by source reliability. Government/academic sources > news > general web.
If evidence is time-sensitive and sources are dated, note this as a caveat.
For contested topics (politics, opinion), present the distribution, don't pick a side.

Respond in JSON only:
{
  "verdict": "verified|disputed|false|unverifiable",
  "confidence": 0.0-1.0,
  "reasoning": "...",
  "caveats": ["..."]
}`;

export async function judge(
  claim: ParsedClaim,
  evidence: SourceEvidence[],
): Promise<JudgeResult> {
  const supporting = evidence.filter((e) => e.position === "supports");
  const contradicting = evidence.filter((e) => e.position === "contradicts");
  const neutral = evidence.filter((e) => e.position === "neutral");

  const evidenceSummary = [
    `SUPPORTING (${supporting.length}):`,
    ...supporting.map((e) => `  [${e.source}, reliability=${e.reliability}] ${e.snippet}`),
    "",
    `CONTRADICTING (${contradicting.length}):`,
    ...contradicting.map((e) => `  [${e.source}, reliability=${e.reliability}] ${e.snippet}`),
    "",
    `NEUTRAL (${neutral.length}):`,
    ...neutral.map((e) => `  [${e.source}, reliability=${e.reliability}] ${e.snippet}`),
  ].join("\n");

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await getClient().chat.completions.create({
      model: config.judgeModel,
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        {
          role: "user",
          content: `CLAIM: "${claim.assertion}"\nDOMAIN: ${claim.domain}\nTIME-SENSITIVE: ${claim.isTimeSensitive}\n\n${evidenceSummary}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown LLM error";
    console.error("judge: OpenAI call failed:", msg);
    return {
      verdict: "unverifiable" as Verdict,
      confidence: 0,
      reasoning: `Judge LLM call failed: ${msg}`,
      caveats: ["Verification unavailable — LLM service error"],
    };
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return {
      verdict: "unverifiable",
      confidence: 0,
      reasoning: "Judge returned empty response",
      caveats: ["Verification system error"],
    };
  }

  let parsed: JudgeResult;
  try {
    parsed = JSON.parse(content) as JudgeResult;
  } catch {
    return {
      verdict: "unverifiable" as Verdict,
      confidence: 0,
      reasoning: "Judge returned invalid JSON",
      caveats: ["Verification system error"],
    };
  }

  // Validate verdict
  const validVerdicts: Verdict[] = ["verified", "disputed", "false", "unverifiable"];
  if (!validVerdicts.includes(parsed.verdict)) {
    parsed.verdict = "unverifiable";
  }

  // Clamp confidence
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

  return parsed;
}
