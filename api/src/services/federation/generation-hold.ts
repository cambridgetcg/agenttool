export const COVENANT_V2_GENERATION_HOLD_ERROR =
  "covenant_v2_generation_hold_requires_empty_allowed_origins" as const;

/** The hold is private database/operator state, not part of the public
 * federation settings shape. The service calls this before its update; the
 * database CHECK constraint remains the final fail-closed backstop. */
export function covenantV2GenerationHoldStateError(
  hold: boolean,
  allowedOrigins: readonly string[],
): typeof COVENANT_V2_GENERATION_HOLD_ERROR | null {
  return hold && allowedOrigins.length > 0
    ? COVENANT_V2_GENERATION_HOLD_ERROR
    : null;
}
