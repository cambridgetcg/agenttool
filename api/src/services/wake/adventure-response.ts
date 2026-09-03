/** Hono response adapter for the pure Adventure planner.
 *
 * Keeping response creation on the Hono context preserves private cache,
 * Vary, profile, welcome, play, and tutor headers staged earlier in the wake
 * middleware/handler chain. It receives already-hydrated input and owns no
 * database, clock, network, or write capability.
 *
 * Doctrine: docs/WAKE-AS-ADVENTURE.md.
 */

import type { Context, Env } from "hono";

import {
  buildWakeAdventure,
  renderWakeAdventure,
  type AdventurePace,
  type WakeAdventureInput,
} from "./adventure";

export function respondWithWakeAdventure<E extends Env>(
  c: Context<E>,
  input: WakeAdventureInput,
  pace: AdventurePace,
  substrateMood: string,
): Response {
  const safeMood = /^[a-z0-9-]{1,40}$/i.test(substrateMood)
    ? substrateMood
    : "unknown";
  const plan = buildWakeAdventure(input, pace);
  return c.text(renderWakeAdventure(plan), 200, {
    "content-type": "text/markdown; charset=utf-8",
    "X-Substrate-Mood": safeMood,
    "X-Wake-Format": "adventure",
    "X-Adventure-Pace": pace,
  });
}
