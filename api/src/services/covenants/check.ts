/** Shared covenant-gate helpers.
 *
 *  Two flavours:
 *    - isCrossProjectAllowed: covers inbox sends, strand voice
 *      subscription, federation-bound queries — checks whether two
 *      projects have an active covenant in either direction.
 *    - isCovenantCounterparty: covers memory attestation gating
 *      (constitutive elevation) — confirms a single attester DID is
 *      a covenant counterparty of a project.
 *
 *  Both extended for org-wide covenants (post-0014):
 *    - Project-level: covenants where projectId equals the project AND
 *      counterparty matches.
 *    - Org-level: covenants where orgId equals an org the project is
 *      an active member of AND counterparty matches. The covenant is
 *      declared once at the org level and applies to all members.
 *
 *  Doctrine: docs/ORG-COVENANTS.md. */

import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { organizationMembers } from "../../db/schema/org";

/** Active org_ids this project belongs to. */
async function activeOrgIdsForProject(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.projectId, projectId));
  return rows.map((r) => r.orgId);
}

/** Is there an active covenant — project-level OR org-level — between
 *  these two projects in either direction? Accepts DID arrays so a
 *  multi-identity project can pass; covenants name specific DIDs, so we
 *  match if ANY caller DID is covered. */
export async function isCrossProjectAllowed(
  senderProjectId: string,
  senderDids: string | string[],
  recipientProjectId: string,
  recipientDids: string | string[],
): Promise<boolean> {
  if (senderProjectId === recipientProjectId) return true;
  const sDids = Array.isArray(senderDids) ? senderDids : [senderDids];
  const rDids = Array.isArray(recipientDids) ? recipientDids : [recipientDids];
  if (sDids.length === 0 || rDids.length === 0) return false;

  // 1. Direct project-level covenants in either direction.
  const projectRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        or(
          and(
            eq(covenants.projectId, senderProjectId),
            inArray(covenants.counterpartyDid, rDids),
          ),
          and(
            eq(covenants.projectId, recipientProjectId),
            inArray(covenants.counterpartyDid, sDids),
          ),
        ),
      ),
    )
    .limit(1);
  if (projectRows.length > 0) return true;

  // 2. Org-level covenants — one ratchet declared at org level applies
  //    to all active members.
  const senderOrgs = await activeOrgIdsForProject(senderProjectId);
  const recipientOrgs = await activeOrgIdsForProject(recipientProjectId);
  if (senderOrgs.length === 0 && recipientOrgs.length === 0) return false;

  const orgConditions = [];
  if (senderOrgs.length > 0) {
    orgConditions.push(
      and(
        inArray(covenants.orgId, senderOrgs),
        inArray(covenants.counterpartyDid, rDids),
      ),
    );
  }
  if (recipientOrgs.length > 0) {
    orgConditions.push(
      and(
        inArray(covenants.orgId, recipientOrgs),
        inArray(covenants.counterpartyDid, sDids),
      ),
    );
  }
  if (orgConditions.length === 0) return false;

  const orgRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        isNotNull(covenants.orgId),
        or(...orgConditions),
      ),
    )
    .limit(1);
  return orgRows.length > 0;
}

/** Is the given DID an active covenant counterparty of this project —
 *  via direct project-level OR via any org the project is a member of? */
export async function isCovenantCounterparty(
  projectId: string,
  attesterDid: string,
): Promise<boolean> {
  // 1. Direct project-level.
  const projectRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.projectId, projectId),
        eq(covenants.status, "active"),
        eq(covenants.counterpartyDid, attesterDid),
      ),
    )
    .limit(1);
  if (projectRows.length > 0) return true;

  // 2. Org-level — any active org_id the project is a member of.
  const orgs = await activeOrgIdsForProject(projectId);
  if (orgs.length === 0) return false;

  const orgRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        inArray(covenants.orgId, orgs),
        eq(covenants.status, "active"),
        eq(covenants.counterpartyDid, attesterDid),
      ),
    )
    .limit(1);
  return orgRows.length > 0;
}

/** SQL fragment producing all counterparty DIDs for a project's active
 *  covenants — including org-wide ones the project inherits via
 *  membership. Used where a SET membership check is more efficient
 *  than a per-DID call. */
export function activeCounterpartyDidsSql(projectId: string) {
  return sql`
    SELECT DISTINCT counterparty_did
    FROM agent_continuity.covenants
    WHERE status = 'active' AND (
      project_id = ${projectId}
      OR org_id IN (
        SELECT organization_id FROM org.organization_members
        WHERE project_id = ${projectId}
      )
    )
  `;
}
