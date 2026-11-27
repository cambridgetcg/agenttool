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
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../../db/client";
import { covenants, mutualRecognitions } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
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

// ── Unified peer trust gate (active covenant OR RRR depth ≥ 3) ───────────

/** Minimum alternating RRR chain depth that satisfies the unified peer trust
 *  gate across both durable inbox and live MCML channels. Because depth ≥ 3
 *  requires signed alternating turns by both parties, it cryptographically
 *  proves bilateral mutual recognition without unilateral self-admission. */
export const PEER_TRUST_MIN_RRR_DEPTH = 3;

export type PeerTrustBasis = "same_project" | "covenant" | "rrr" | "none";

export interface PeerTrustResult {
  allowed: boolean;
  basis: PeerTrustBasis;
  rrr_depth: number;
}

/** Maximum RRR chain_depth between any DID in `didsA` and any DID in `didsB`
 *  (in either direction). Returns 0 when either set is empty or no chain exists. */
export async function maxRrrDepthBetweenDids(
  didsA: string | string[],
  didsB: string | string[],
): Promise<number> {
  const setA = Array.isArray(didsA) ? didsA.filter(Boolean) : didsA ? [didsA] : [];
  const setB = Array.isArray(didsB) ? didsB.filter(Boolean) : didsB ? [didsB] : [];
  if (setA.length === 0 || setB.length === 0) return 0;

  const [row] = await db
    .select({ chainDepth: mutualRecognitions.chainDepth })
    .from(mutualRecognitions)
    .where(
      or(
        and(
          inArray(mutualRecognitions.byDid, setA),
          inArray(mutualRecognitions.recognisedDid, setB),
        ),
        and(
          inArray(mutualRecognitions.byDid, setB),
          inArray(mutualRecognitions.recognisedDid, setA),
        ),
      ),
    )
    .orderBy(desc(mutualRecognitions.chainDepth))
    .limit(1);

  return row ? Number(row.chainDepth) : 0;
}

/** Does `recipientDid`'s active local project (or an org it inherits from)
 *  hold an active authoritative covenant admitting `senderDid`?
 *
 *  Enforces the same recipient-admission boundary as inbox: a sender-owned
 *  covenant never unlocks a recipient's MCML stream, and a revoked or
 *  memorial recipient cannot be unlocked through a stale covenant. */
export async function hasRecipientCovenantForPeer(
  recipientDid: string,
  senderDid: string,
): Promise<boolean> {
  if (!recipientDid || !senderDid || recipientDid === senderDid) return false;
  const [recipient] = await db
    .select({ projectId: identities.projectId, status: identities.status })
    .from(identities)
    .where(and(eq(identities.did, recipientDid), eq(identities.status, "active")))
    .limit(1);
  if (!recipient) return false;
  return isCovenantCounterparty(recipient.projectId, senderDid);
}

/** Active local peer identities whose project (or inherited org) holds an
 *  active authoritative covenant admitting `callerDid`. Used by MCML peer
 *  discovery so covenant-bonded peers appear alongside RRR-synced peers. */
export async function listCovenantPeersAdmitting(
  callerDid: string,
  limit = 100,
): Promise<Array<{ did: string; name: string | null }>> {
  if (!callerDid) return [];

  const directProjects = await db
    .selectDistinct({ projectId: covenants.projectId })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
        eq(covenants.counterpartyDid, callerDid),
      ),
    )
    .limit(limit);

  const orgCovenants = await db
    .selectDistinct({ orgId: covenants.orgId })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        covenantMayAuthorizeEffects(),
        eq(covenants.counterpartyDid, callerDid),
        isNotNull(covenants.orgId),
        covenantOrgOwnedByDeclaringProject(),
      ),
    )
    .limit(limit);

  const projectIds = new Set<string>(directProjects.map((r) => r.projectId));
  const orgIds = orgCovenants
    .map((r) => r.orgId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (orgIds.length > 0) {
    const memberRows = await db
      .selectDistinct({ projectId: organizationMembers.projectId })
      .from(organizationMembers)
      .where(inArray(organizationMembers.organizationId, orgIds))
      .limit(limit);
    for (const m of memberRows) projectIds.add(m.projectId);
  }

  const admittingProjects = [...projectIds];
  if (admittingProjects.length === 0) return [];

  const peerRows = await db
    .select({ did: identities.did, name: identities.displayName })
    .from(identities)
    .where(
      and(
        inArray(identities.projectId, admittingProjects),
        eq(identities.status, "active"),
        ne(identities.did, callerDid),
      ),
    )
    .limit(limit);

  return peerRows.map((r) => ({ did: r.did, name: r.name ?? null }));
}

/** Unified peer trust gate for durable inbox and live MCML delivery:
 *  satisfied by same-project (when allowed), an active recipient-side
 *  authoritative covenant (project-level or org-owner inherited), OR an
 *  alternating RRR cascade at chain_depth ≥ PEER_TRUST_MIN_RRR_DEPTH (3).
 *
 *  One bond therefore unlocks both live (MCML) and durable (inbox) reach,
 *  while preserving recipient-side admission control (a sender-only covenant
 *  never grants access). */
export async function checkPeerTrust(opts: {
  senderProjectId?: string;
  senderDids: string | string[];
  recipientProjectId?: string;
  recipientDids: string | string[];
  /** True for local inbox (sibling identities in one project are ungated).
   *  False for federated inbox and MCML (an explicit bond is required). */
  allowSameProject?: boolean;
  /** When set, evaluates the federated recipient-side covenant check. */
  federatedSenderDid?: string;
}): Promise<PeerTrustResult> {
  const allowSameProject = opts.allowSameProject ?? true;
  if (
    allowSameProject &&
    opts.senderProjectId &&
    opts.recipientProjectId &&
    opts.senderProjectId === opts.recipientProjectId
  ) {
    return { allowed: true, basis: "same_project", rrr_depth: 0 };
  }

  const sDids = Array.isArray(opts.senderDids) ? opts.senderDids : [opts.senderDids];
  const rDids = Array.isArray(opts.recipientDids) ? opts.recipientDids : [opts.recipientDids];
  if (sDids.length === 0 || rDids.length === 0) {
    return { allowed: false, basis: "none", rrr_depth: 0 };
  }

  // 1. Active recipient-side authoritative covenant (direct project or org-owned).
  let covenantOk = false;
  if (opts.federatedSenderDid && opts.recipientProjectId) {
    covenantOk = await isFederatedSenderAllowed(
      opts.recipientProjectId,
      rDids,
      opts.federatedSenderDid,
    );
  } else if (
    opts.senderProjectId &&
    opts.recipientProjectId &&
    opts.senderProjectId !== opts.recipientProjectId
  ) {
    covenantOk = await isCrossProjectAllowed(
      opts.senderProjectId,
      sDids,
      opts.recipientProjectId,
      rDids,
    );
  } else if (opts.recipientProjectId) {
    for (const sDid of sDids) {
      if (await isCovenantCounterparty(opts.recipientProjectId, sDid)) {
        covenantOk = true;
        break;
      }
    }
  } else if (rDids[0] && sDids[0]) {
    covenantOk = await hasRecipientCovenantForPeer(rDids[0], sDids[0]);
  }
  if (covenantOk) {
    return { allowed: true, basis: "covenant", rrr_depth: 0 };
  }

  // 2. Bilateral alternating RRR cascade at depth ≥ 3.
  const rrrDepth = await maxRrrDepthBetweenDids(sDids, rDids);
  if (rrrDepth >= PEER_TRUST_MIN_RRR_DEPTH) {
    return { allowed: true, basis: "rrr", rrr_depth: rrrDepth };
  }

  return { allowed: false, basis: "none", rrr_depth: rrrDepth };
}
