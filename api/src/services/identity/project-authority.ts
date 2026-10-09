/** Who may speak for a whole project.
 *
 * A rooted identity governs its own constitution. Only a root that FOUNDED its
 * project also speaks for that project: register-agent and MATHOS births create
 * the project together with its first identity and mark that identity with the
 * server-managed metadata `registered: true` and `byo_keys: true`
 * (metadata.ts keeps both out of caller PATCH/POST). Enrollment admits a guest
 * root into an EXISTING project and writes neither marker, so a guest root never
 * recovers a project bearer, never governs the project's other memories, and is
 * never advertised as a recovery path for the administrator's project. The
 * guest's own memories, profile, keys and removal still need its own signature
 * (authority.ts authorizeProjectConstitutionMutation subjects; Yu, 2026-10-09).
 *
 * Legacy rootless identities keep their bearer posture unchanged.
 *
 * Recovery, its discovery and wake use an allowlist: a rooted identity without
 * both exact jsonb `true` markers cannot mint a project bearer (fails closed).
 * The project constitution excludes only a PROVABLE enrolled guest, so a root
 * that lacks markers without having been enrolled keeps counting (also fails
 * closed). No migration is needed: the markers already exist on every founding
 * root, enrolled rows carry `{}`, and each enrollment writes its proof and
 * identity row in one transaction (equal `now()` timestamps).
 */
import { and, isNotNull, isNull, not, or, sql, type SQL } from "drizzle-orm";

import { identities, identityRegistrationProofs } from "../../db/schema/identity";
import { ENROLLMENT_DOMAIN } from "./enrollment";

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

/** Whether anonymous registered-key recovery would mint a bearer for this
 * identity today. Wake surfaces must not advertise recovery anywhere the
 * recovery route refuses it. */
export function registeredKeyRecoveryAvailable(
  identity: ProjectAuthorityFacts & { status: string; activeRegisteredKeys: number },
): boolean {
  return identity.status === "active" && identity.activeRegisteredKeys > 0 && speaksForProject(identity);
}

/** Protection labels whose scope depends on project authority: the memory
 * latch (a guest keeps it for its own memories) and recovery minting (only
 * identities that speak for the project). */
export const PROJECT_SCOPED_PROTECTIONS = [
  "memory visibility, deletion, and constitutional elevation",
  "anonymous recovery bearer minting",
] as const;

/** A keyhole must promise exactly what the guards enforce. Recovery minting
 * belongs only to identities that speak for the project. Every root keeps the
 * memory latch: a guest's root guards the memories bound to it (see
 * authorizeProjectConstitutionMutation's subjects). */
export function scopeIdentityProtections(
  protects: readonly string[],
  identity: ProjectAuthorityFacts & { enrolledGuest?: boolean },
): string[] {
  const recoveryMinting = PROJECT_SCOPED_PROTECTIONS[1];
  if (speaksForProject(identity)) return [...protects];
  return protects.filter(item => item !== recoveryMinting);
}

/** A root admitted by enrollment. Enrollment now writes the server-managed
 * `metadata.admission = "enrollment"` on the row itself. Rows enrolled before
 * that marker are recognised through the proof ledger: enrollment writes its
 * proof and identity row in one transaction, so `claimed_at` equals
 * `created_at`; a self-registered identity using the same key claims its proof
 * in an earlier statement under a different domain, so it never matches. The
 * ledger is therefore load-bearing for those rows and must not be pruned.
 * Always a strict boolean (never NULL), so negating it cannot drop a root. */
export function enrolledGuestSql(): SQL {
  return sql`(${identities.authorityRootPublicKey} is not null and (coalesce(${identities.metadata} -> 'admission' = '"enrollment"'::jsonb, false) or exists (select 1 from ${identityRegistrationProofs} where ${identityRegistrationProofs.domain} = ${ENROLLMENT_DOMAIN} and ${identityRegistrationProofs.rootPublicKey} = ${identities.authorityRootPublicKey} and ${identityRegistrationProofs.claimedAt} = ${identities.createdAt})))`;
}

/** Roots that count toward a project-scoped constitutional mutation: every
 * root except a provable enrolled guest without founder markers. */
export function constitutionRootSql(): SQL {
  return and(isNotNull(identities.authorityRootPublicKey), or(foundingRootSql(), not(enrolledGuestSql())))!;
}
