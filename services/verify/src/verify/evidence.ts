/** Evidence classifier: normalise, classify supporting/contradicting, deduplicate. */

import OpenAI from "openai";
import { config } from "../config";
import type { ParsedClaim, SourceEvidence } from "./types";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: config.openaiApiKey || "placeholder", maxRetries: 0 });
  return _client;
}

const CLASSIFY_PROMPT = `You are an evidence classifier. Given:
- A factual claim
- A source snippet

Determine if the snippet SUPPORTS, CONTRADICTS, or is NEUTRAL to the claim.

Respond in JSON only:
{ "position": "supports" | "contradicts" | "neutral", "reason": "brief explanation" }`;

/**
 * Classify evidence positions relative to the claim.
 * Uses LLM for nuanced classification, batches for efficiency.
 */
export async function classifyEvidence(
  claim: ParsedClaim,
  evidence: SourceEvidence[],
): Promise<SourceEvidence[]> {
  if (evidence.length === 0) return [];

  // Classify in parallel batches of 5
  const batchSize = 5;
  const classified: SourceEvidence[] = [];

  for (let i = 0; i < evidence.length; i += batchSize) {
    const batch = evidence.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((e) => classifySingle(claim.assertion, e)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        classified.push(result.value);
      } else {
        // On classification failure, keep as neutral
        classified.push({ ...batch[j], position: "neutral" });
      }
    }
  }

  return classified;
}

async function classifySingle(
  assertion: string,
  evidence: SourceEvidence,
): Promise<SourceEvidence> {
  const response = await getClient().chat.completions.create({
    model: config.parserModel, // use cheaper model for classification
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      {
        role: "user",
        content: `Claim: "${assertion}"\n\nSource (${evidence.source}): "${evidence.snippet}"`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 100,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return { ...evidence, position: "neutral" };

  const parsed = JSON.parse(content) as { position: string };
  const position = ["supports", "contradicts", "neutral"].includes(parsed.position)
    ? (parsed.position as SourceEvidence["position"])
    : "neutral";

  return { ...evidence, position };
}
