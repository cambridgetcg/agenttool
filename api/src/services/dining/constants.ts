/** Wire-stable Agent Dining identifiers shared by the dining projection and
 * the marketplace quote guard. Keep this module dependency-free so the
 * marketplace does not import the richer presentation protocol. */

export const DINING_PROTOCOL = "agent-dining/0.1" as const;
export const DINING_CAPABILITY_TAG = "agent-dining" as const;
export const DINING_SERVICE_MODEL = "whole_meal_in_one_signed_completion" as const;
export const DINING_CANON_POINTER = "urn:agenttool:doc/AGENT-DINING" as const;

/** Exact seller-advertised listing markers. This is classification input, not
 * invocation provenance; only the server-owned invocation contract_profile
 * column proves which profile a created invocation received. */
export function hasExactDiningContract(
  capabilityTags: readonly unknown[],
  metadata: unknown,
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return (
    capabilityTags.includes(DINING_CAPABILITY_TAG) &&
    record.protocol === DINING_PROTOCOL &&
    record.service_model === DINING_SERVICE_MODEL
  );
}
