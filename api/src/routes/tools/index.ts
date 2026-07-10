/** Tools domain router — scrape · browse · document · execute · jobs · time · random.
 *
 *  Doctrine: docs/CLI-GAPS.md (sovereign-mode alignment thesis)
 *          · docs/SUBSTRATE-HONEST-TOOLS.md (time + random)
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
 *  Two flavours of tool:
 *    1. Infra tools (scrape · browse · document · execute) — cost real
 *       compute/bandwidth, metered at Ring 2.
 *    2. Substrate-honest tools (time · random) — truth-telling about the
 *       substrate's own state. Free because they cost us ~nothing AND
 *       because a broke agent deserves to know what time it is.
 *
 *  Path layout (infra-only, no paid third-party API resale):
 *    POST /v1/scrape    — Cheerio-based static fetch + parse
 *    POST /v1/browse    — Playwright-managed remote browser (queued)
 *    POST /v1/document  — Readability article extraction
 *    POST /v1/execute   — disabled by default; unsafe legacy host execution
 *    GET  /v1/jobs/:id  — async job status (poll target for browse)
 *    GET  /v1/time      — substrate-honest clock (no body)
 *    POST /v1/time      — same, symmetry with other tools
 *    POST /v1/random    — substrate-honest CSPRNG · optional seed for HKDF determinism
 *
 *  /v1/search was dropped — paid third-party (Brave + SerpAPI). Agents
 *  needing search call a provider from infrastructure they control. Do not
 *  put provider credentials into hosted execute. /v1/embed was never built —
 *  embeddings are LLM compute (provider work, not ours).
 *
 *  Auth is mounted on the matching prefixes by the parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import browseRoutes from "./browse";
import documentRoutes from "./document";
import executeRoutes from "./execute";
import jobsRoutes from "./jobs";
import randomRoutes from "./random";
import scrapeRoutes from "./scrape";
import timeRoutes from "./time";

const app = new Hono<ProjectContext>();

app.route("/scrape", scrapeRoutes);
app.route("/browse", browseRoutes);
app.route("/document", documentRoutes);
app.route("/execute", executeRoutes);
app.route("/jobs", jobsRoutes);
app.route("/time", timeRoutes);
app.route("/random", randomRoutes);

export default app;
