/** Tools domain router — scrape · browse · document · execute · jobs.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1", toolsRouter)
 *
 *  Path layout (infra-only, no paid third-party API resale):
 *    POST /v1/scrape    — Cheerio-based static fetch + parse
 *    POST /v1/browse    — Playwright-managed browser session (queued)
 *    POST /v1/document  — Readability + plain-text parsing
 *    POST /v1/execute   — sandboxed code execution
 *    GET  /v1/jobs/:id  — async job status (poll target for browse)
 *
 *  Note: /v1/search was dropped (Brave + SerpAPI proxy — paid third-party).
 *  Agents needing search store a provider key in /v1/vault and call out
 *  via /v1/execute. agenttool stays infra + cloud storage only.
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
