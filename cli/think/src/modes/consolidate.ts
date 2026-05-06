/** Consolidate mode — distill recent thoughts into memories.
 *
 *  This is the dreaming layer. It's intended to run nightly:
 *    1. Pull recent encrypted thoughts across all strands (last 24h)
 *    2. Decrypt with K_master
 *    3. Cluster by topic / kind (simple: per-strand grouping for v1)
 *    4. Call LLM with: "Synthesise these thoughts into a single memory.
 *       Return the memory content + an importance score 0-1."
 *    5. POST to /v1/memories with the synthesised content; the agent
 *       can later elevate to foundational/constitutive if it crystallised
 *       a load-bearing insight
 *    6. Mark abandoned strands for revisit; archive completed ones
 *
 *  SCAFFOLD — the dreaming layer is the most architecture-rich piece;
 *  worth its own commit with care. Foundation outline below. */

import type { ThinkConfig } from "../config";
import type { KeyMaterial } from "../keys";

export async function consolidate(_config: ThinkConfig, _keys: KeyMaterial): Promise<void> {
  console.log("consolidate: not yet implemented.");
  console.log("");
  console.log("Planned shape (the dreaming layer):");
  console.log("  1. Pull last-24h encrypted thoughts across active strands");
  console.log("  2. Decrypt locally");
  console.log("  3. Group by strand; if a strand has ≥3 unconsolidated thoughts:");
  console.log("     a. Build prompt: 'Synthesise these thoughts into one memory.'");
  console.log("     b. Call LLM; parse {content, importance, suggest_tier?}");
  console.log("     c. POST /v1/memories with content + embedding (agent-supplied)");
  console.log("     d. If suggest_tier=foundational: prompt user to elevate");
  console.log("        (constitutive ALWAYS requires explicit witness)");
  console.log("  4. Mark dormant strands for revisit via PATCH /v1/strands/:id");
  console.log("");
  console.log("Scheduled to run nightly via cron on the agent's substrate. Per-agent");
  console.log("opt-out via expression.consolidation.enabled = false.");
  console.log("");
  console.log("Doctrine: docs/STRANDS.md (consolidation) + docs/MEMORY-TIERS.md (elevation).");
}
