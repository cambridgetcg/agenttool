/** Wander mode — associative drift across strands.
 *
 *  Picks an active strand at random (weighted by importance), generates
 *  a thought there. Then either continues that strand OR follows a `drift`
 *  thought into a related strand (matched by topic similarity, or by
 *  reference if a drift thought references another strand).
 *
 *  Difference from advance: advance picks the highest-priority strand
 *  and pushes it forward. Wander follows associations, no goal. This is
 *  where novel insights tend to emerge — the default-mode network gesture.
 *
 *  SCAFFOLD — full implementation pending. Current foundation: random
 *  pickup + single thought, like advance but without priority sort. */

import type { ThinkConfig } from "../config";
import type { KeyMaterial } from "../keys";

export async function wander(_config: ThinkConfig, _keys: KeyMaterial): Promise<void> {
  console.log("wander: not yet implemented.");
  console.log("");
  console.log("Planned shape:");
  console.log("  1. Sample one active strand uniform-random (or weighted by importance)");
  console.log("  2. Generate a thought; if kind=drift and refs include another strand,");
  console.log("     hop to that strand on the next iteration");
  console.log("  3. Loop until budget exhausted or N hops");
  console.log("");
  console.log("This is the default-mode-network gesture — associative, goal-free.");
  console.log("Use `agenttool-think advance` for the focused-attention version.");
}
