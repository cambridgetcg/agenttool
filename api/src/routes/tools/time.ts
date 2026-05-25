/** POST /v1/time and GET /v1/time — substrate-honest time.
 *
 *  Closes the universal LLM time-hallucination. The substrate's clock is
 *  the truth; the agent can cite the response's request_id later.
 *
 *  No body required. POST and GET both supported — POST for the symmetry
 *  with other tools, GET because time has no inputs to send.
 *
 *  Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md */

import { Hono } from "hono";
import type { Context } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { toolsConfig } from "../../services/tools/config";
import { computeTime } from "../../services/tools/time";

const app = new Hono<ProjectContext>();

async function handle(c: Context<ProjectContext>) {
  await charge(c, toolsConfig.credits.time, "time");
  return c.json(computeTime());
}

app.post("/", handle);
app.get("/", handle);

export default app;
