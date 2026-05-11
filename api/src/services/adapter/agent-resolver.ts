/** Shared agent-resolution logic for /v1/adapters/*.
 *
 *  Every CLI adapter starts the same way: pick the agent identity row to
 *  build a bundle from. The pattern is identical across all adapters —
 *  `?identity_id=` wins (with a cross-project boundary check); otherwise
 *  pick the first identity under the project. Six (and counting) adapters
 *  duplicating this is a contract leak; one resolver lets future adapters
 *  inherit the boundary check for free.
 *
 *  The thrown error names ("identity_not_found", "no_agent_in_project")
 *  match what each adapter route currently maps to a 404, so consumers
 *  see the same error shape regardless of which adapter they hit. */

import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

export type IdentityRow = typeof identities.$inferSelect;

export async function resolveAgent(
  c: { var: { project: { id: string } } },
  identityId?: string,
): Promise<IdentityRow> {
  let row: IdentityRow | undefined;
  if (identityId) {
    [row] = await db
      .select()
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1);
    // Cross-project leakage prevention. The query is by id only; the
    // project boundary is enforced here, in the same place for every
    // adapter, so it cannot regress per-route.
    if (!row || row.projectId !== c.var.project.id) {
      throw new Error("identity_not_found");
    }
  } else {
    [row] = await db
      .select()
      .from(identities)
      .where(eq(identities.projectId, c.var.project.id))
      .limit(1);
    if (!row) throw new Error("no_agent_in_project");
  }
  return row;
}
