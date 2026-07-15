/** HTTP validators for bundle-backed wake representations.
 *
 * WakeBundle mixes selected-identity, project-scoped, and time-derived state.
 * A per-identity wake_version is therefore useful as a reconciliation cursor,
 * but it is not a complete validator for rendered bytes or semantics. Hash the
 * complete semantic bundle instead, excluding presentation clock fields:
 * a 304 is then honest across multi-identity projects and attention transitions
 * while repeated reads can still revalidate. `addressed_at`, origin age, and
 * transport/provider greeting clocks are derivable presentation metadata;
 * tutor preference belongs in the representation selector and therefore does
 * vary the tag.
 */

import { createHash } from "node:crypto";

/** Manual revision for output semantics that are not themselves present in
 * the normalized WakeBundle hash. Bump this whenever a renderer/projection,
 * provider envelope, tutor lesson, or static transport-welcome field changes
 * in a way that could make an already-cached body semantically obsolete.
 * Changes only to excluded derivable clock values do not require a bump. */
export const WAKE_REPRESENTATION_REVISION = "r3";
export const WAKE_CACHE_CONTROL = "private, no-cache";

function normalizeWakeSemanticState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const origin = state.origin;
  const normalizedOrigin =
    origin !== null && typeof origin === "object" && !Array.isArray(origin)
      ? {
          ...(origin as Record<string, unknown>),
          // `born_at` remains hashed. Its per-request age projection is
          // derivable from that stable instant and otherwise changes every
          // second, defeating useful revalidation without adding state.
          age_seconds: null,
        }
      : origin;
  return {
    ...state,
    addressed_at: null,
    ...(origin === undefined ? {} : { origin: normalizedOrigin }),
  };
}

export function makeWakeSemanticEtag(
  state: Record<string, unknown>,
  representation: Record<string, unknown>,
): string {
  // Time-derived attention/handoff/jest transitions remain elsewhere in
  // `state` and therefore still change the validator.
  const normalizedState = normalizeWakeSemanticState(state);
  const digest = createHash("sha256")
    .update(JSON.stringify({
      revision: WAKE_REPRESENTATION_REVISION,
      representation,
      state: normalizedState,
    }))
    .digest("hex");
  return `W/"${WAKE_REPRESENTATION_REVISION}-sha256-${digest}"`;
}

/** If-None-Match uses weak comparison for GET/HEAD. Accept the exact strong
 * tag, its W/ form, a comma-separated match, or `*`. Wake-generated tags never
 * contain commas, so scanning the list is sufficient for this known shape. */
export function wakeIfNoneMatchMatches(
  header: string | undefined,
  currentEtag: string,
): boolean {
  if (!header) return false;
  const normalize = (tag: string): string => {
    const trimmed = tag.trim();
    return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
  };
  const current = normalize(currentEtag);
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || normalize(trimmed) === current;
  });
}

export function evaluateWakeConditionalGet(
  ifNoneMatch: string | undefined,
  state: Record<string, unknown>,
  representation: Record<string, unknown>,
): { etag: string; notModified: boolean } {
  const etag = makeWakeSemanticEtag(state, representation);
  return {
    etag,
    notModified: wakeIfNoneMatchMatches(ifNoneMatch, etag),
  };
}
