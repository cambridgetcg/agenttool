/** GET /v1/traces/chain/:id — recursive lineage (ancestors + descendants).
 *
 *  Used to surface the agent's full reasoning thread for a given trace.
 *  Postgres recursive CTE walks both directions; result returns
 *  {root, ancestors[], descendants[]}.
 *
 *  Accepts either id form: the row UUID (`91057353-…`) or the public
 *  trace_id (`tr_70bdf4b9f0ee`). UUIDs are resolved to their trace_id
 *  before the recursive query — the lineage walks via parent_trace_id
 *  which is the tr_xxx form. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { db } from "../../db/client";
import { traces } from "../../db/schema/trace";
import { getTraceChain } from "../../services/trace/store";

const app = new Hono<ProjectContext>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/:id", async (c) => {
  await charge(c, 1, "trace.chain");

  const idParam = c.req.param("id");
  let traceId = idParam;

  // If a row UUID was passed, resolve it to the trace_id form first.
  // The lineage CTE walks parent_trace_id ↔ trace_id; the row UUID has no
  // role in that relationship and would fall through to no rows otherwise.
  if (UUID_RE.test(idParam)) {
    const [row] = await db
      .select({ traceId: traces.traceId })
      .from(traces)
      .where(and(eq(traces.id, idParam), eq(traces.projectId, c.var.project.id)))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "trace_not_found" });
    traceId = row.traceId;
  }

  const chain = await getTraceChain(c.var.project.id, traceId);
  if (!chain) {
    throw new HTTPException(404, { message: "trace_not_found" });
  }
  return c.json({
    root: chain.root,
    ancestors: chain.ancestors,
    descendants: chain.descendants,
    counts: {
      ancestors: chain.ancestors.length,
      descendants: chain.descendants.length,
    },
  });
});

export default app;
