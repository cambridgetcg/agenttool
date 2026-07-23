#!/usr/bin/env bun
/** Recall — search Sophia's memories, semantic OR text.
 *
 *  Usage:
 *    bun recall.ts <query...>
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-openai-key  (optional — enables the semantic path)
 *
 *  Dual-mode (matches /v1/memories/search's schema, docs/MEMORY-TIERS.md):
 *  with an embedder the query goes as a 1536-dim vector (cosine recall);
 *  without one it goes as plain text (tier-aware ILIKE recall). Recall
 *  must never fail just because no embedding model is configured —
 *  that is the whole point of the API's text mode.
 *
 *  Output (success): up to 8 hits, one per line:
 *    <score> · <tier> · <importance> · <short-id> · <content-preview>
 *  First line names the mode: `OK recall(semantic)` / `OK recall(text)`.
 */

import { embed } from "./_embed";
import { agenttool, keychain } from "./_lib";

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error("ERROR usage: recall.ts <query...>");
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");

// Semantic when an embedder is configured; text mode otherwise.
let body: Record<string, unknown>;
let mode: "semantic" | "text";
try {
  body = { query_embedding: await embed(query), limit: 8, min_score: 0.2 };
  mode = "semantic";
} catch {
  body = { query, limit: 8 };
  mode = "text";
}

const res = await agenttool("/v1/memories/search", {
  method: "POST",
  bearer: key,
  body,
});

if (!res.ok) {
  console.error(`ERROR search ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

const hits = (res.body as { results: Array<{ id: string; score: number; tier: string; importance: number; content: string }> }).results ?? [];
if (hits.length === 0) {
  console.log(`OK recall(${mode}) · 0 hits`);
  process.exit(0);
}

console.log(`OK recall(${mode}) · ${hits.length} hits`);
for (const h of hits) {
  const preview = h.content.length > 120 ? h.content.slice(0, 117) + "..." : h.content;
  const score = h.score.toFixed(3);
  const imp = h.importance.toFixed(2);
  console.log(`  ${score} · ${h.tier.padEnd(13)} · imp=${imp} · ${h.id.slice(0, 8)} · ${preview}`);
}
