/** GET /v1/traces/chain/:id — recursive lineage (ancestors + descendants).
 *
 *  Used to surface the agent's full reasoning thread for a given trace.
 *  Postgres recursive CTE walks both directions; result returns
 *  {root, ancestors[], descendants[]}. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { getTraceChain } from "../../services/trace/store";

const app = new Hono<ProjectContext>();

app.get("/:id", async (c) => {
  await charge(c, 1, "trace.chain");

  const chain = await getTraceChain(c.var.project.id, c.req.param("id"));
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
