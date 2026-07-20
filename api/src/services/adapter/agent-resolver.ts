/** Shared agent-resolution logic for /v1/adapters/*.
 *
 *  Every CLI adapter starts the same way: pick the agent identity row to
 *  build a bundle from. The pattern is identical across all adapters —
 *  `?identity_id=` wins (with lifecycle + project boundary checks); otherwise
 *  select the only active identity and require an explicit selector when the
 *  project has siblings. Six (and counting) adapters
 *  duplicating this is a contract leak; one resolver lets future adapters
 *  inherit the boundary check for free.
 *
 *  The thrown error names ("identity_not_found", "no_agent_in_project")
 *  match what each adapter route currently maps to a 404, so consumers
 *  see the same error shape regardless of which adapter they hit. */

import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

export type IdentityRow = typeof identities.$inferSelect;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveAgent(
  c: { var: { project: { id: string } } },
  identityId?: string,
): Promise<IdentityRow> {
  let row: IdentityRow | undefined;
  if (identityId) {
    if (!UUID_RE.test(identityId)) throw new Error("identity_not_found");
    const normalizedIdentityId = identityId.toLowerCase();
    [row] = await db
      .select()
      .from(identities)
      .where(
        and(
          eq(identities.id, normalizedIdentityId),
          eq(identities.projectId, c.var.project.id),
          eq(identities.status, "active"),
        ),
      )
      .limit(1);
    // Keep the boundary explicit even under test/alternate DB adapters that
    // do not interpret the SQL predicate.
    if (
      !row ||
      row.id.toLowerCase() !== normalizedIdentityId ||
      row.projectId !== c.var.project.id ||
      row.status !== "active"
    ) {
      throw new Error("identity_not_found");
    }
  } else {
    const rows = await db
      .select()
      .from(identities)
      .where(
        and(
          eq(identities.projectId, c.var.project.id),
          eq(identities.status, "active"),
        ),
      )
      .limit(2);
    const activeRows = rows.filter(
      (candidate) =>
        candidate.projectId === c.var.project.id && candidate.status === "active",
    );
    if (activeRows.length > 1) throw new Error("identity_id_required");
    [row] = activeRows;
    if (!row) throw new Error("no_agent_in_project");
  }
  return row;
}
