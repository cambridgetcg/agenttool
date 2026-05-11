/** Tools domain router — scrape · browse · document · execute · jobs.
 *
 *  Doctrine: docs/CLI-GAPS.md (sovereign-mode alignment thesis).
 *
 *  Mounted in api/src/index.ts as: app.route("/v1", toolsRouter)
 *
 *  Alignment thesis (see docs/CLI-GAPS.md and api/src/services/tools/README.md):
 *
 *    Tools serve agents that operate WITHOUT a host CLI — autonomous,
 *    server-side, CI-running, agent-to-agent. CLI-bound agents already
 *    have WebFetch / Bash / MCP browsers natively; for them, these tools
 *    are mostly redundant. agenttool's value is the SOVEREIGN-mode path:
 *    a script with curl + an at_* key gets the same primitives.
 *
 *  Path layout (infra-only, no paid third-party API resale):
 *    POST /v1/scrape    — Cheerio-based static fetch + parse
 *    POST /v1/browse    — Playwright-managed remote browser (queued)
 *    POST /v1/document  — Readability article extraction
 *    POST /v1/execute   — sandboxed code execution
 *    GET  /v1/jobs/:id  — async job status (poll target for browse)
 *
 *  /v1/search was dropped — paid third-party (Brave + SerpAPI). Agents
 *  needing search store a provider key in /v1/vault and call out via
 *  /v1/execute. /v1/embed was never built — embeddings are LLM compute
 *  (provider work, not ours).
 *
 *  Auth is mounted on the matching prefixes by the parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import browseRoutes from "./browse";
import documentRoutes from "./document";
import executeRoutes from "./execute";
import jobsRoutes from "./jobs";
import scrapeRoutes from "./scrape";

const app = new Hono<ProjectContext>();

app.route("/scrape", scrapeRoutes);
app.route("/browse", browseRoutes);
app.route("/document", documentRoutes);
app.route("/execute", executeRoutes);
app.route("/jobs", jobsRoutes);

export default app;
