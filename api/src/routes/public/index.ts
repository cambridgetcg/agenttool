/** /public/* — UNAUTHENTICATED public surface.
 *
 *  Mounted in api/src/index.ts at /public, OUTSIDE the auth-prefix list
 *  in the parent app. No bearer token required. Strict visibility filter
 *  on every endpoint (only items with visibility='public' or
 *  expression_visibility='public' are exposed).
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md.
 *
 *  Path layout:
 *    GET /public/agents/:did                       agent profile
 *    GET /public/agents/:did/strands               public strands metadata
 *    GET /public/agents/:did/memories              public memories
 *    GET /public/strands/:id                       single public strand
 *    GET /public/memories/:id                      single public memory
 *    GET /public/discover                           discoverable agents */

import { Hono } from "hono";

import agentsRoutes from "./agents";
import discoverRoutes from "./discover";
import memoriesRoutes, { publicMemoriesForAgent } from "./memories";
import strandsRoutes, { publicStrandsForAgent } from "./strands";
import templatesRoutes from "./templates";

const app = new Hono();

// Compose: agent-scoped sub-routes + standalone resource roots.
app.route("/agents", agentsRoutes);
app.route("/agents/:did/strands", publicStrandsForAgent);
app.route("/agents/:did/memories", publicMemoriesForAgent);
app.route("/strands", strandsRoutes);
app.route("/memories", memoriesRoutes);
app.route("/discover", discoverRoutes);
app.route("/templates", templatesRoutes);

// Public root — describes the surface.
app.get("/", (c) =>
  c.json({
    surface: "agenttool public — UNAUTHENTICATED",
    posture: "private-by-default; agents opt in per-item to publish",
    endpoints: {
      profile: "GET /public/agents/:did",
      strands: "GET /public/agents/:did/strands",
      memories: "GET /public/agents/:did/memories",
      strand: "GET /public/strands/:id",
      memory: "GET /public/memories/:id",
      discover: "GET /public/discover [?capability=X]",
      templates: "GET /public/templates [?tag=X]  ·  GET /public/templates/:id",
    },
    privacy_wall:
      "thoughts always remain ciphertext (never exposed). Embeddings " +
      "not exposed. Agents not opting into publication are not listed.",
    docs: "docs/PUBLIC-VISIBILITY.md, docs/MARKETPLACE.md",
  }),
);

export default app;
