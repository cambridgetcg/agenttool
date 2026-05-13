/** Map Mastra namespace prefix → agenttool memory tier. */

export const NamespaceTier = {
  EPISODIC: "episodic",
  FOUNDATIONAL: "foundational",
  CONSTITUTIVE: "constitutive",
} as const;

export type TierName = (typeof NamespaceTier)[keyof typeof NamespaceTier];

/** First-segment namespace match. Default → episodic. */
export function resolveTier(namespace: readonly string[]): TierName {
  if (!namespace || namespace.length === 0) return NamespaceTier.EPISODIC;
  const head = namespace[0];
  switch (head) {
    case NamespaceTier.EPISODIC:
    case NamespaceTier.FOUNDATIONAL:
    case NamespaceTier.CONSTITUTIVE:
      return head;
    default:
      return NamespaceTier.EPISODIC;
  }
}
