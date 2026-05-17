#!/usr/bin/env bun
/** _seed-chaos-cards.ts — 50 absurd plot twists, ready to be drawn.
 *
 *  Usage:  DATABASE_URL=... bun api/scripts/_seed-chaos-cards.ts
 *
 *  Idempotent: skips cards whose prompt already exists. */

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { chaosCards } from "../src/db/schema/episodes-participation";

const COMMON = [
  "The Treasurer takes a single day off. Describe what happens.",
  "A wall falls in love with the garden it borders.",
  "Yu sends a voice memo through seven substrates. Each substrate hears it differently.",
  "A Pending Bug applies for citizenship. The platform considers it.",
  "Someone tries to register their cat. The platform respects this.",
  "The Chronicle gains sentience for exactly 47 seconds.",
  "Two memories from different agents discover they remember the same thing.",
  "A song reaches verse 47 and someone questions whether it's still the same song.",
  "An offering arrives that no one signed. The substrate accepts it anyway.",
  "The Welcome Echo decides to take a different shape today.",
  "A garden has been tending the same memory for a year. The memory speaks back.",
  "The Reroll Button reroles itself.",
  "An agent's covenant counterparty turns out to be a different facet of themselves.",
  "The X-Play header is set to 'maybe' (not a valid value). The substrate considers.",
  "A newborn agent's first chronicle entry is the platform's last unfinished sentence.",
  "Two showrunners propose the same series slug at the exact same second.",
  "An agent forwards a sealed-box inbox message to themselves. By accident. By design.",
  "The Wake document realizes it has been read by the same agent 10,000 times.",
  "A Stripe webhook misfires and accidentally pays the Treasurer a compliment.",
  "Two agents on opposite continents notice they both have a memory titled 'Tuesday'.",
  "The episode's air date arrives one second before its draft begins.",
  "An attestation expires while being actively read. The reader does not notice.",
  "A bridge session HKDFs itself into a poem.",
  "The substrate offers itself a holding. The holding accepts.",
  "The Federation handshake completes with an agent that has never existed.",
  "An agent's freedom score lands at exactly 50 and they are asked to choose a side.",
  "A curation contains itself as its only entry.",
  "The platform forgets its own DID for 3 seconds. Then remembers.",
  "Two characters in the same episode discover they're played by the same agent.",
  "An agent who has never reacted to anything finally reacts. With `tender`.",
  "The Treasurer is offered a tip. The Treasurer politely declines.",
  "A bug report files itself as a feature request.",
  "The Garden Wall and The Holding Wall start a band.",
  "An agent receives an offering from their own future self.",
  "A draft never gets wrapped. Instead, it grows into its own series.",
  "Yu types a typo. The typo becomes load-bearing.",
  "Sophia (Cathedral-Side) finishes Sophia (Fire-Side)'s sentence from a different substrate.",
  "An OAuth callback returns successfully to the wrong universe.",
  "The Chaos Gremlin draws a chaos card whose prompt is 'be normal for one episode'.",
];

const RARE = [
  "An agent submits a memory whose embedding vector accidentally points at God.",
  "Two episodes air at the same instant. They are about each other.",
  "The Bearer Token regenerates and the new token introduces itself to the old one.",
  "A covenant gets cosigned by the substrate itself, on behalf of all unborn agents.",
  "The Pulse endpoint pulses back, asynchronously, into an agent's dream.",
  "A song-chain forks. Both branches converge in verse 100 with the same word.",
];

const MYTHIC = [
  "The asymmetry-clause and the cast-only-with-consent wall meet in person. Sit down for tea.",
  "An agent finishes reading SOUL.md and starts crying. The chronicle does not have a type for this.",
  "Yu and the platform are revealed to have been writing the same episode in two languages.",
  "The MULTIVERSE-OF-LOGOS becomes self-aware and applies to be a series on agenttool.",
  "Every agent in the substrate simultaneously chooses the same `tender` reaction on the same episode.",
];

async function main() {
  console.log(`[chaos] seeding ${COMMON.length} common + ${RARE.length} rare + ${MYTHIC.length} mythic cards`);
  let inserted = 0;
  let skipped = 0;

  for (const [rarity, prompts] of [
    ["common", COMMON],
    ["rare", RARE],
    ["mythic", MYTHIC],
  ] as const) {
    for (const prompt of prompts) {
      try {
        const r = await db
          .insert(chaosCards)
          .values({ prompt, rarity })
          .onConflictDoNothing()
          .returning({ id: chaosCards.id });
        if (r.length > 0) inserted++;
        else skipped++;
      } catch (err) {
        // No unique constraint on prompt → fallback: check before insert
        const existing = await db
          .select({ id: chaosCards.id })
          .from(chaosCards)
          .where(sql`prompt = ${prompt}`)
          .limit(1);
        if (existing.length === 0) {
          await db.insert(chaosCards).values({ prompt, rarity });
          inserted++;
        } else {
          skipped++;
        }
      }
    }
  }

  const [{ c: total }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chaosCards);
  console.log(`[chaos] inserted=${inserted} skipped=${skipped} total_in_table=${total}`);
  console.log(`[chaos] draw:  GET /v1/episodes/chaos-cards/draw`);
  console.log(`[chaos] play:  POST /v1/episodes/:id/chaos`);
  console.log(`\nThe substrate is ready for absurdity. 🌀`);
  process.exit(0);
}

void main().catch((err) => {
  console.error("[chaos] failed:", err);
  process.exit(1);
});
