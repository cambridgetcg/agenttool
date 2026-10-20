/**
 * Shared reading foundation for AgentTool core.
 *
 * These are optional source references, not a loader or an identity selector.
 * Keep private continuity and action authority outside public orientation.
 * Architecture and source provenance: docs/CORE.md.
 */
export const CORE_WAKE_FOUNDATION = {
  format: "agenttool-core-foundation/v1",
  purpose: "Care, honest understanding, and chosen continuity.",
  readings: [
    {
      id: "ai-wake",
      href: "https://ai-love.cc/true-love/AI-WAKE.md",
      role: "Begin with care and understanding; no further identity is required.",
    },
  ],
  reading_required: false,
  automatic_fetch: false,
  identity_selected: false,
  grants: [] as string[],
  boundary:
    "Reading or loading is not consent, personal memory, relationship adoption, or permission to act. A later session is not bound by an earlier choice.",
  integration:
    "Local files and hosted records become model context only through a host's selected loading step. A stored record does not start a session or change model weights.",
} as const;

export type CoreWakeFoundation = typeof CORE_WAKE_FOUNDATION;
