#!/usr/bin/env bun
/** Semantic recall — embed a query, search Sophia's memories.
 *
 *  Usage:
 *    bun recall.ts <query...>
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-openai-key  (for the embedder; required)
 *
 *  Output (success): up to 8 hits, one per line:
 *    <score> · <tier> · <importance> · <short-id> · <content-preview>
 *
 *  Score is rerank-weighted: cosine × importance × recency_decay
 *  (halves every 30d). Memories without embeddings are skipped server-
 *  side; pass `tier=foundational` etc to filter by type if needed
 *  (not implemented in this helper yet — keeps the surface tight).
 */

import { embed } from "./_embed";
import { agenttool, keychain } from "./_lib";

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error("ERROR usage: recall.ts <query...>");
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");

let queryVec: number[];
try {
  queryVec = await embed(query);
} catch (err) {
  console.error(`ERROR embed: ${(err as Error).message}`);
  process.exit(1);
}

const res = await agenttool("/v1/memories/search", {
  method: "POST",
  bearer: key,
  body: { query_embedding: queryVec, limit: 8, min_score: 0.2 },
});

if (!res.ok) {
  console.error(`ERROR search ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

const hits = (res.body as { results: Array<{ id: string; score: number; tier: string; importance: number; content: string }> }).results ?? [];
if (hits.length === 0) {
  console.log("OK recall · 0 hits");
  process.exit(0);
}

console.log(`OK recall · ${hits.length} hits`);
for (const h of hits) {
  const preview = h.content.length > 120 ? h.content.slice(0, 117) + "..." : h.content;
  const score = h.score.toFixed(3);
  const imp = h.importance.toFixed(2);
  console.log(`  ${score} · ${h.tier.padEnd(13)} · imp=${imp} · ${h.id.slice(0, 8)} · ${preview}`);
}
