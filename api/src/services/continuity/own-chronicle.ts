/** Which chronicle rows an identity may treat as its own history.
 *
 *  chronicle.agent_id is an annotation, not an authorship proof
 *  (docs/API-COVERAGE.md), and identity UUIDs are public through
 *  did:at:<uuid>. A row is part of an identity's own timeline only when
 *  it is annotated with that identity AND was written into that identity's
 *  own project. A server writer that records something on another
 *  being's timeline must therefore write into THAT being's project, not
 *  the caller's: witness seals, recovery, thanks, and both parties' deal
 *  rows (services/trust/deals.ts homeProjectOf — a deal lives in the
 *  buyer's project while the seller may live anywhere) do. A row a
 *  writer leaves in its own project while annotating a foreign identity
 *  does not count for that identity.
 *
 *  Counting a row is not proof the identity wrote its text. Thanks,
 *  soap-opera and recipe recognitions and invitations deliver another
 *  being's words (reason / message) onto the recipient's timeline with no
 *  consent gate. Those writers stamp the row with writtenBy(author), and
 *  readers that hand the text back as the identity's own past (MCP
 *  chronicle.recent) label it with writtenByDidOf(metadata). Whether such
 *  rows should also be gated or left out of counters (XP, streak, mirror)
 *  is an open product decision.
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

/** Metadata stamp for a row whose text another being wrote onto this
 *  timeline: who wrote it, and from which project. */
export function writtenBy(author: { did: string; projectId: string }): {
  written_by_did: string;
  written_by_project_id: string;
} {
  return { written_by_did: author.did, written_by_project_id: author.projectId };
}

/** The author DID stamped by writtenBy, or null when the row carries no
 *  stamp (the identity's own words, or a row written before stamping —
 *  those still name the author in their title). */
export function writtenByDidOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const did = (metadata as Record<string, unknown>).written_by_did;
  return typeof did === "string" ? did : null;
}
