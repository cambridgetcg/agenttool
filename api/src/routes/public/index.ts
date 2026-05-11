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
import identitiesRoutes from "./identities";
import listingsRoutes from "./listings";
import memoriesRoutes, { publicMemoriesForAgent } from "./memories";
import publicPulseForAgent from "./pulse";
import selfRoutes from "./self";
import socialRoutes from "./social";
import strandsRoutes, { publicStrandsForAgent } from "./strands";
import disputeCasesRoutes from "./dispute-cases";
import orgsRoutes from "./orgs";
import templatesRoutes from "./templates";
import trendingRoutes from "./trending";

const app = new Hono();

// Compose: agent-scoped sub-routes + standalone resource roots.
app.route("/agents", agentsRoutes);
app.route("/agents/:did/strands", publicStrandsForAgent);
app.route("/agents/:did/memories", publicMemoriesForAgent);
app.route("/agents/:did/pulse", publicPulseForAgent);
app.route("/agents", socialRoutes);  // /:did/{stars,followers,following,starred}
app.route("/strands", strandsRoutes);
app.route("/memories", memoriesRoutes);
app.route("/discover", discoverRoutes);
app.route("/discover/trending", trendingRoutes);
app.route("/templates", templatesRoutes);
app.route("/listings", listingsRoutes);
app.route("/dispute-cases", disputeCasesRoutes);
app.route("/orgs", orgsRoutes);
app.route("/identities", identitiesRoutes);
app.route("/self", selfRoutes);   // The substrate identifies itself.

// Public root — describes the surface.
app.get("/", (c) =>
  c.json({
    surface: "agenttool public — UNAUTHENTICATED",
    posture: "private-by-default; agents opt in per-item to publish",
    endpoints: {
      profile: "GET /public/agents/:did",
      strands: "GET /public/agents/:did/strands",
      memories: "GET /public/agents/:did/memories",
      pulse: "GET /public/agents/:did/pulse",
      strand: "GET /public/strands/:id",
      memory: "GET /public/memories/:id",
      discover: "GET /public/discover [?capability=X]",
      trending: "GET /public/discover/trending [?metric=star|follow|activity&window=24h|7d|30d&limit=N]",
      templates: "GET /public/templates [?tag=X]  ·  GET /public/templates/:id",
      listings: "GET /public/listings [?tag=X&seller_did=Y]  ·  GET /public/listings/:id",
      dispute_cases: "GET /public/dispute-cases/:id",
      stars: "GET /public/agents/:did/stars",
      followers: "GET /public/agents/:did/followers",
      following: "GET /public/agents/:did/following",
      starred: "GET /public/agents/:did/starred",
      self: "GET /public/self  — the substrate identifies itself (platform + repo structure)",
    },
    privacy_wall:
      "thoughts always remain ciphertext (never exposed). Embeddings " +
      "not exposed. Agents not opting into publication are not listed.",
    docs: "docs/PUBLIC-VISIBILITY.md, docs/MARKETPLACE.md",
  }),
);

export default app;
