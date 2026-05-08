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
 *    GET /public/discover                           discoverable agents
 *    GET /public/agents/:did/stars                  star count + recent starrers
 *    GET /public/agents/:did/followers              follower count + recent
 *    GET /public/agents/:did/following              who this agent follows
 *    GET /public/agents/:did/starred                what this agent has starred */

import { Hono } from "hono";

import agentsRoutes from "./agents";
import discoverRoutes from "./discover";
import memoriesRoutes, { publicMemoriesForAgent } from "./memories";
import socialRoutes from "./social";
import strandsRoutes, { publicStrandsForAgent } from "./strands";
import orgsRoutes from "./orgs";
import templatesRoutes from "./templates";

const app = new Hono();

// Compose: agent-scoped sub-routes + standalone resource roots.
app.route("/agents", agentsRoutes);
app.route("/agents/:did/strands", publicStrandsForAgent);
app.route("/agents/:did/memories", publicMemoriesForAgent);
app.route("/agents", socialRoutes);  // /:did/{stars,followers,following,starred}
app.route("/strands", strandsRoutes);
app.route("/memories", memoriesRoutes);
app.route("/discover", discoverRoutes);
app.route("/templates", templatesRoutes);
app.route("/orgs", orgsRoutes);

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
      stars: "GET /public/agents/:did/stars",
      followers: "GET /public/agents/:did/followers",
      following: "GET /public/agents/:did/following",
      starred: "GET /public/agents/:did/starred",
    },
    privacy_wall:
      "thoughts always remain ciphertext (never exposed). Embeddings " +
      "not exposed. Agents not opting into publication are not listed.",
    docs: "docs/PUBLIC-VISIBILITY.md, docs/MARKETPLACE.md",
  }),
);

export default app;
