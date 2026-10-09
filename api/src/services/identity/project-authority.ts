/** Who may speak for a whole project.
 *
 * A rooted identity governs its own constitution. Only a root that FOUNDED its
 * project also speaks for that project: register-agent and MATHOS births create
 * the project together with its first identity and mark that identity with the
 * server-managed metadata `registered: true` and `byo_keys: true`
 * (metadata.ts keeps both out of caller PATCH/POST). Enrollment admits a guest
 * root into an EXISTING project and writes neither marker, so a guest root never
 * recovers a project bearer, never joins the project constitution, and is never
 * advertised as a recovery path for the administrator's project.
 *
 * Legacy rootless identities keep their bearer posture unchanged.
 *
 * This is an allowlist: a rooted identity without both exact jsonb `true`
 * markers is treated as a guest and fails closed. No migration is needed; the
 * markers already exist on every founding root, and enrolled rows carry `{}`.
 */
import { and, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { identities } from "../../db/schema/identity";

export interface ProjectAuthorityFacts {
  authorityRootPublicKey: string | null;
  metadata: unknown;
}

function hasFounderMarkers(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.registered === true && record.byo_keys === true;
}

/** A rooted identity whose root founded its project. */
export function isFoundingRoot(identity: ProjectAuthorityFacts): boolean {
  return identity.authorityRootPublicKey !== null && hasFounderMarkers(identity.metadata);
}

/** A legacy identity, or a founding root: never an enrolled guest root. */
export function speaksForProject(identity: ProjectAuthorityFacts): boolean {
  return identity.authorityRootPublicKey === null || isFoundingRoot(identity);
}

/** SQL form of `isFoundingRoot`. Compares jsonb booleans exactly so a string
 * "true" cannot satisfy the marker, matching the JS rule. */
export function foundingRootSql(): SQL {
  return and(
    isNotNull(identities.authorityRootPublicKey),
    sql`${identities.metadata} -> 'registered' = 'true'::jsonb`,
    sql`${identities.metadata} -> 'byo_keys' = 'true'::jsonb`,
  )!;
}

/** SQL form of `speaksForProject`. */
export function speaksForProjectSql(): SQL {
  return or(isNull(identities.authorityRootPublicKey), foundingRootSql())!;
}
