/** Tools-domain configuration — credit costs, browse pool size, rate limits.
 *
 *  No paid third-party API keys live here. Search has been dropped (it was
 *  Brave / SerpAPI proxy — paid resold APIs). Browser proxy support removed
 *  (Bright Data — paid resold). agenttool is infra + cloud storage; agents
 *  bring their own provider keys via /v1/vault. */

import { config as shared } from "../../config";

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const toolsConfig = {
  // Credit cost per operation (charged via shared billing/charge.charge()).
  // These cover OUR infra cost when conditional tools are enabled — bandwidth,
  // browser pool, and legacy host compute —
  // not third-party API resale.
  credits: {
    scrape: envInt("CREDIT_SCRAPE", 1),         // single HTTP fetch + parse
    browse: envInt("CREDIT_BROWSE", 5),         // Playwright session
    document: envInt("CREDIT_DOCUMENT", 3),     // parse + extract
    executePer10s: envInt("CREDIT_EXECUTE_PER_10S", 2),
    // Substrate-honest tools — truth-telling about the substrate's own state.
    // Free by default because telling time/giving entropy costs us ~nothing
    // and a broke agent still deserves the truth. Rate-limited by existing
    // middleware. Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md.
    time: envInt("CREDIT_TIME", 0),
    random: envInt("CREDIT_RANDOM", 0),
  },

  browseConcurrency: envInt("BROWSE_CONCURRENCY", 3),

  // Shared infra
  redisUrl: shared.redisUrl,
} as const;
