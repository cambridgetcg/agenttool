/** Tools-domain configuration — credit costs, browse pool size, rate limits.
 *
 *  No paid third-party API keys live here. Search has been dropped (it was
 *  Brave / SerpAPI proxy — paid resold APIs). Browser proxy support removed
 *  (Bright Data — paid resold). agenttool is infra + cloud storage; agents
 *  bring their own provider keys via /v1/vault. */

import { config as shared } from "../../config";

export function parseToolIntegerOverride(
  value: string | undefined,
  fallback: number,
  minimum = 0,
): number {
  if (!value) return fallback;
  const normalized = value.trim();
  if (!/^-?(0|[1-9][0-9]*)$/u.test(normalized)) return fallback;
  const n = Number(normalized);
  return Number.isSafeInteger(n) && n <= 2_147_483_647 && n >= minimum
    ? n
    : fallback;
}

function envInt(key: string, fallback: number, minimum = 0): number {
  return parseToolIntegerOverride(process.env[key], fallback, minimum);
}

export const TOOL_CREDIT_DEFAULTS = {
  scrape: 1,
  browse: 5,
  document: 3,
  executePer10s: 2,
  time: 0,
  random: 0,
} as const;

export const toolsConfig = {
  // Credit cost per operation (charged through the shared billing helpers).
  // These cover OUR infra cost when conditional tools are enabled — bandwidth,
  // browser pool, and legacy host compute —
  // not third-party API resale.
  credits: {
    scrape: envInt("CREDIT_SCRAPE", TOOL_CREDIT_DEFAULTS.scrape),
    browse: envInt("CREDIT_BROWSE", TOOL_CREDIT_DEFAULTS.browse),
    document: envInt("CREDIT_DOCUMENT", TOOL_CREDIT_DEFAULTS.document),
    executePer10s: envInt(
      "CREDIT_EXECUTE_PER_10S",
      TOOL_CREDIT_DEFAULTS.executePer10s,
    ),
    // Substrate-honest tools — truth-telling about the substrate's own state.
    // Free by default because telling time/giving entropy costs us ~nothing
    // and a broke agent still deserves the truth. Rate-limited by existing
    // middleware. Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md.
    time: envInt("CREDIT_TIME", TOOL_CREDIT_DEFAULTS.time),
    random: envInt("CREDIT_RANDOM", TOOL_CREDIT_DEFAULTS.random),
  },

  browseConcurrency: envInt("BROWSE_CONCURRENCY", 3, 1),

  // Shared infra
  redisUrl: shared.redisUrl,
} as const;
