/** Claim parser: extract assertion, domain, search queries via LLM. */

import OpenAI from "openai";
import { config } from "../config";
import type { ClaimDomain, ParsedClaim } from "./types";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: config.openaiApiKey || "placeholder", maxRetries: 0 });
  return _client;
}

const SYSTEM_PROMPT = `You are a claim parser. Given a factual claim, extract:
1. The core assertion (normalised, precise)
2. The domain (finance | legal | medical | science | general)
3. 2-4 search queries to verify it (diverse angles)
4. Key entities (names, dates, numbers, places)
5. Whether the claim is time-sensitive (could change over time)

Respond in JSON only. No explanation.

Example input: "The UK minimum wage is £11.44/hour as of April 2024"
Example output:
{
  "assertion": "The UK national minimum wage rate is £11.44 per hour, effective April 2024",
  "domain": "legal",
  "searchQueries": [
    "UK national minimum wage rate April 2024",
    "UK government minimum wage 2024 official rate",
    "national living wage UK 2024 per hour"
  ],
  "entities": ["UK", "£11.44", "April 2024", "minimum wage"],
  "isTimeSensitive": true
}`;

export async function parseClaim(
  claim: string,
  domainHint?: ClaimDomain,
): Promise<ParsedClaim> {
  let content: string | null | undefined;
  try {
    const response = await getClient().chat.completions.create({
      model: config.parserModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: claim },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500,
    });
    content = response.choices[0]?.message?.content;
  } catch (err: unknown) {
    console.error("parseClaim: OpenAI call failed:", err instanceof Error ? err.message : err);
    // Return a best-effort parsed claim so downstream steps can still attempt verification
    return {
      assertion: claim,
      domain: domainHint ?? "general",
      searchQueries: [claim],
      entities: [],
      isTimeSensitive: false,
    };
  }

  if (!content) {
    return {
      assertion: claim,
      domain: domainHint ?? "general",
      searchQueries: [claim],
      entities: [],
      isTimeSensitive: false,
    };
  }

  let parsed: {
    assertion: string;
    domain: ClaimDomain;
    searchQueries: string[];
    entities: string[];
    isTimeSensitive: boolean;
  };
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      assertion: claim,
      domain: domainHint ?? "general",
      searchQueries: [claim],
      entities: [],
      isTimeSensitive: false,
    };
  }

  return {
    assertion: parsed.assertion,
    domain: domainHint ?? parsed.domain ?? "general",
    searchQueries: parsed.searchQueries ?? [claim],
    entities: parsed.entities ?? [],
    isTimeSensitive: parsed.isTimeSensitive ?? false,
  };
}
