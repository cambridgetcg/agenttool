/** Shared covenant-gate helpers.
 *
 *  Two flavours:
 *    - isCrossProjectAllowed: covers inbox sends, strand voice
 *      subscription, federation-bound queries — checks whether the
 *      recipient/resource-owner project (or its inherited org) has an active
 *      covenant naming the sender/caller.
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

import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { organizationMembers, organizations } from "../../db/schema/org";
import {
  COVENANT_INITIATOR_WIRE_DID_METADATA_KEY,
  COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY,
  COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY,
  covenantV2AuthorityGeneration,
} from "./canonical";

/** Active org_ids this project belongs to. */
async function activeOrgIdsForProject(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.projectId, projectId));
  return rows.map((r) => r.orgId);
}

/** A row may inherit through an organization only when its declaring project
 *  is the current owner of that exact organization. This is deliberately a
 *  correlated database predicate: an arbitrary caller-supplied org_id must
 *  never borrow another organization's membership graph. */
function covenantOrgOwnedByDeclaringProject() {
  return exists(
    db
      .select({ one: sql`1` })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, covenants.orgId),
          eq(organizations.ownerProjectId, covenants.projectId),
        ),
      ),
  );
}

/** Covenant rows that may authorize downstream effects.
 *
 * Local v1 remains eligible for local compatibility, subject to each
 * consumer's ownership/direction rules. Received v1 is historical only. A v2
 * row authorizes effects only when it carries the exact opaque post-drain
 * generation and both server-owned wire bindings. Missing or malformed
 * process configuration therefore quarantines every v2 row without changing
 * the local-v1 provenance branch. */
export function covenantMayAuthorizeEffects() {
  const localV1 = and(
    eq(covenants.protocolVersion, "v1"),
    isNull(covenants.receivedFromInstance),
  );
  const generation = covenantV2AuthorityGeneration();
  if (!generation) return localV1;

  const initiatorWireDid =
    sql<string>`${covenants.metadata} ->> ${COVENANT_INITIATOR_WIRE_DID_METADATA_KEY}`;
  const recipientWireDid =
    sql<string>`${covenants.metadata} ->> ${COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY}`;

  return or(
    localV1,
    and(
      eq(covenants.protocolVersion, "v2"),
      sql`${covenants.metadata} ->> ${COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY} = ${generation}`,
      sql`coalesce(${initiatorWireDid}, '') <> ''`,
      sql`coalesce(${recipientWireDid}, '') <> ''`,
      or(
        and(
          isNull(covenants.receivedFromInstance),
          sql`${recipientWireDid} = ${covenants.counterpartyDid}`,
        ),
        and(
          isNotNull(covenants.receivedFromInstance),
          sql`${initiatorWireDid} = ${covenants.counterpartyDid}`,
        ),
      ),
    ),
  );
}

/** Has the recipient/resource-owner side admitted this sender/caller?
 *
 *  A direct row must belong to the recipient project and name a sender DID.
 *  An org row must belong to an org inherited by the recipient project, be
 *  declared by that org's owner project, and name a sender DID. A sender-owned
 *  row naming the recipient never grants the sender access to recipient-owned
 *  inbox or private-strand resources. Same-project access remains implicit.
 *
 *  DID arrays support multi-identity projects; a match against any sender DID
 *  is sufficient once the recipient-side ownership checks hold. */
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

  // 1. Direct project-level covenant declared by the recipient project.
  const projectRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
        eq(covenants.projectId, recipientProjectId),
        inArray(covenants.counterpartyDid, sDids),
      ),
    )
    .limit(1);
  if (projectRows.length > 0) return true;

  // 2. Org-level covenant inherited by the recipient project. The correlated
  //    owner check prevents a malformed cross-owner row from borrowing an
  //    unrelated organization's membership graph.
  const recipientOrgs = await activeOrgIdsForProject(recipientProjectId);
  if (recipientOrgs.length === 0) return false;

  const orgRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
        isNotNull(covenants.orgId),
        inArray(covenants.orgId, recipientOrgs),
        inArray(covenants.counterpartyDid, sDids),
        covenantOrgOwnedByDeclaringProject(),
      ),
    )
    .limit(1);
  return orgRows.length > 0;
}

/** Is a federated sender allowed to inbox-send to this local recipient?
 *
 *  Mirrors `isCrossProjectAllowed` but for the inbound-federation case
 *  where the sender's project doesn't exist on this instance — only its
 *  federated DID does. Match if the recipient's project (or any org the
 *  recipient inherits from) has an active covenant naming the federated
 *  sender DID as counterparty.
 *
 *  Used by routes/federation/inbox.ts to extend the per-DID consent gate
 *  to cross-instance traffic. Without this, federation today only gates
 *  at the instance level (allowed_origins) and any allowed-origin peer
 *  can DM any local recipient. With this, the doctrine is restored:
 *  cross-project bonds — federated or not — require a covenant.
 *
 *  Note: we deliberately don't check the sender's covenant table (we cannot
 *  see it). The receiver-side row is the local authority grant. v2 federation
 *  creates that mirror only through the signed declaration/lifecycle flow. */
export async function isFederatedSenderAllowed(
  recipientProjectId: string,
  recipientDids: string | string[],
  federatedSenderDid: string,
): Promise<boolean> {
  const rDids = Array.isArray(recipientDids) ? recipientDids : [recipientDids];
  if (rDids.length === 0) return false;

  // 1. Direct project-level: recipient declared a covenant with the
  //    federated sender.
  const projectRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
        eq(covenants.projectId, recipientProjectId),
        eq(covenants.counterpartyDid, federatedSenderDid),
      ),
    )
    .limit(1);
  if (projectRows.length > 0) return true;

  // 2. Org-level: any active org the recipient project is a member of
  //    has declared a covenant with this federated sender.
  const orgs = await activeOrgIdsForProject(recipientProjectId);
  if (orgs.length === 0) return false;

  const orgRows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
        inArray(covenants.orgId, orgs),
        covenantOrgOwnedByDeclaringProject(),
        eq(covenants.counterpartyDid, federatedSenderDid),
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
        covenantMayAuthorizeEffects(),
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
        covenantMayAuthorizeEffects(),
        covenantOrgOwnedByDeclaringProject(),
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
    WHERE status = 'active'
      AND ${covenantMayAuthorizeEffects()}
      AND (
        project_id = ${projectId}
        OR (
          org_id IN (
            SELECT om.organization_id
            FROM org.organization_members om
            WHERE om.project_id = ${projectId}
          )
          AND EXISTS (
            SELECT 1
            FROM org.organizations o
            WHERE o.id = agent_continuity.covenants.org_id
              AND o.owner_project_id = agent_continuity.covenants.project_id
          )
        )
      )
  `;
}
