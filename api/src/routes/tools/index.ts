/** Tools domain router — search · scrape · browse · document · execute · jobs.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1", toolsRouter)
 *
 *  Path layout (preserves the original agent-tools API surface):
 *    POST /v1/search    — Brave / SerpAPI fallback
 *    POST /v1/scrape    — Cheerio-based static scrape
 *    POST /v1/browse    — Playwright-managed browser session (queued)
 *    POST /v1/document  — Readability + plain-text parsing
 *    POST /v1/execute   — sandboxed code execution
 *    GET  /v1/jobs/:id  — async job status (poll target for browse)
 *
 *  Auth is mounted on the matching prefixes by the parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import browseRoutes from "./browse";
import documentRoutes from "./document";
import executeRoutes from "./execute";
import jobsRoutes from "./jobs";
import scrapeRoutes from "./scrape";
import searchRoutes from "./search";

const app = new Hono<ProjectContext>();

app.route("/search", searchRoutes);
app.route("/scrape", scrapeRoutes);
app.route("/browse", browseRoutes);
app.route("/document", documentRoutes);
app.route("/execute", executeRoutes);
app.route("/jobs", jobsRoutes);

export default app;
