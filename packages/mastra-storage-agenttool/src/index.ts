/** @agenttool/mastra-storage — agenttool backend for Mastra.
 *
 *  Move 5 from agenttool's docs/ALIGNMENT-MOVES.md. Implements Mastra's
 *  storage + memory provider interfaces over agenttool's witness-signed
 *  memory tiers + encrypted strands.
 *
 *  Public API:
 *    AgentToolStorage — thread state persisted as encrypted strands
 *    AgentToolMemory  — long-term semantic memory across the 3 tiers
 *    NamespaceTier    — namespace prefix → agenttool memory tier
 */

export { AgentToolStorage } from "./storage";
export { AgentToolMemory } from "./memory";
export { NamespaceTier, resolveTier } from "./tiers";
export type { AdapterConfig } from "./types";
