/** Which chronicle rows an identity may treat as its own history.
 *
 *  chronicle.agent_id is an annotation, not an authorship proof
 *  (docs/API-COVERAGE.md), and identity UUIDs are public through
 *  did:at:<uuid>. A row is part of an identity's own timeline only when
 *  it is annotated with that identity AND was written into that identity's
 *  own project. Server writers that record something on another being's
 *  timeline (thanks, witness seals, recovery) already write into the
 *  recipient's project, so they still count.
 *
 *  The project is read from the identity row inside the predicate, so a
 *  caller never has to (and cannot) supply it.
 *
 *  Doctrine: docs/WAKE.md · docs/WAKE-WARMING.md.
 *  Tested: api/tests/chronicle-project-trust.test.ts */

import { and, eq, sql, type SQL } from "drizzle-orm";

import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";

export function ownChronicle(identityId: string): SQL {
  return and(
    eq(chronicle.agentId, identityId),
    eq(
      chronicle.projectId,
      sql`(select ${identities.projectId} from ${identities} where ${identities.id} = ${identityId})`,
    ),
  )!;
}

/** Row-level form for multi-identity reads (e.g. "which of these peers
 *  were active"): the row was written in the project of the identity it
 *  is annotated with. */
export function chronicleInAnnotatedProject(): SQL {
  return sql`${chronicle.projectId} = (select ${identities.projectId} from ${identities} where ${identities.id} = ${chronicle.agentId})`;
}
