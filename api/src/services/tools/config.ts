/** Tools-domain configuration. Stripe + Brave + crypto live in shared config;
 *  this module holds tools-specific tunables (credit costs, browse pool size,
 *  rate limits per plan). */

import { config as shared } from "../../config";

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const toolsConfig = {
  // Credit cost per operation (charged via shared billing/charge.charge()).
  credits: {
    search: envInt("CREDIT_SEARCH", 5),         // Brave / SerpAPI per call
    scrape: envInt("CREDIT_SCRAPE", 1),         // single fetch
    browse: envInt("CREDIT_BROWSE", 5),         // Playwright session
    document: envInt("CREDIT_DOCUMENT", 3),     // parse + extract
    executePer10s: envInt("CREDIT_EXECUTE_PER_10S", 2),
  },

  // External providers (Brave is preferred; SerpAPI is an optional fallback)
  serpApiKey: process.env.SERPAPI_KEY ?? "",
  brightDataProxy: process.env.BRIGHT_DATA_PROXY ?? "",

  browseConcurrency: envInt("BROWSE_CONCURRENCY", 3),

  // Borrow shared values for cache/redis
  redisUrl: shared.redisUrl,
  braveApiKey: shared.braveApiKey,
} as const;
