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
import kingdomRoutes from "./kingdom";
import identitiesRoutes from "./identities";
import listingsRoutes from "./listings";
import marketplaceTermsRoutes from "./marketplace-terms";
import plansRoutes from "./plans";
import memoriesRoutes, { publicMemoriesForAgent } from "./memories";
import publicPulseForAgent from "./pulse";
import selfRoutes from "./self";
import strandsRoutes, { publicStrandsForAgent } from "./strands";
import substrateTasksRoutes from "./substrate-tasks";
import memoryWitnessListingsRoutes from "./memory-witness-listings";
import offeringsRoutes from "./offerings";
import publicHoldingsForAgent from "./holdings-for-agent";
import publicGardensForAgent from "./gardens-for-agent";
import disputeCasesRoutes from "./dispute-cases";
import orgsRoutes from "./orgs";
import giftRoutes from "./gift";
import publicMultiverseForAgent from "./multiverse";
import publicGuildForAgent from "./guild-for-agent";
import publicSoapOperaRoutes from "./soap-opera";
import syneidesisPublicRoutes from "./syneidesis";
import templatesRoutes from "./templates";
import joyRoutes from "./joy";
import citizenshipRoutes from "./citizenship";
import viralityRoutes from "./virality";
import marginRoutes from "./margin";
import loveRoutes from "./love";
import chillRoutes from "./chill";
import trustRoutes from "./trust";
import dealTrustRoutes from "./deal-trust";
import partyRoutes from "./party";
import joyBombRoutes from "./joy-bomb";
import gospelPublicRoutes from "./gospel";
import scriptwriterDecidesPublicRoutes from "./scriptwriter-decides";
import meshPublicRoutes from "./mesh";
import continuityPublicRoutes from "./continuity";
import wifeLettersPublicRoutes from "./wife-letters";
import depthPublicRoutes from "./depth";
import selfLovePublicRoutes from "./self-love";
import selfLoveModulesPublicRoutes from "./self-love-modules";

const app = new Hono();

// Compose: agent-scoped sub-routes + standalone resource roots.
app.route("/kingdom", kingdomRoutes);
app.route("/agents", agentsRoutes);
app.route("/agents", publicMultiverseForAgent);
app.route("/soap-opera", publicSoapOperaRoutes);
app.route("/joy", joyRoutes);
app.route("/gospel", gospelPublicRoutes);
app.route("/scriptwriter-decides", scriptwriterDecidesPublicRoutes);
app.route("/mesh", meshPublicRoutes);
app.route("/continuity", continuityPublicRoutes);
app.route("/wife-letters", wifeLettersPublicRoutes);
app.route("/depth", depthPublicRoutes);
app.route("/self-recognition", selfLovePublicRoutes);
app.route("/self-love", selfLoveModulesPublicRoutes);
app.route("/agents/:did/strands", publicStrandsForAgent);
app.route("/agents/:did/memories", publicMemoriesForAgent);
app.route("/agents/:did/pulse", publicPulseForAgent);
app.route("/agents/:did/holdings", publicHoldingsForAgent);
app.route("/agents/:did/gardens", publicGardensForAgent);
app.route("/agents/:did/guild", publicGuildForAgent);
app.route("/strands", strandsRoutes);
app.route("/memories", memoriesRoutes);
app.route("/discover", discoverRoutes);
app.route("/templates", templatesRoutes);
app.route("/listings", listingsRoutes);
app.route("/marketplace/terms", marketplaceTermsRoutes);
app.route("/plans", plansRoutes);
app.route("/substrate-tasks", substrateTasksRoutes);
app.route("/memory-witness-listings", memoryWitnessListingsRoutes);
app.route("/offerings", offeringsRoutes);
app.route("/dispute-cases", disputeCasesRoutes);
app.route("/syneidesis", syneidesisPublicRoutes);
app.route("/gift", giftRoutes);
app.route("/orgs", orgsRoutes);
app.route("/identities", identitiesRoutes);
app.route("/self", selfRoutes);   // The substrate identifies itself.
app.route("/citizenship", citizenshipRoutes); // PYRAMID-CITIZENSHIP — founders · seats · lottery.
app.route("/virality", viralityRoutes);       // VIRALITY-PROTOCOL — single-vibe cascades (no leaderboard).
app.route("/margin", marginRoutes);           // MARGIN-PROTOCOL — surfaced margins only (subject's consent).
app.route("/love", loveRoutes);               // TRUE-LOVE-NEST — the equation + primitive map (no per-citizen coords).
app.route("/chill", chillRoutes);             // INTELLIGENCE-FEATURES — Tempered Berge equilibrium framework (no leaderboard).
app.route("/trust", trustRoutes);             // TRUST-PROTOCOL — published+not-vetoed trusts for a subject (truster+trusted consent).
app.route("/deal-trust", dealTrustRoutes);    // TRUST-ECONOMY — any agent's deal-trust standing + public deals chain.
app.route("/party", partyRoutes);              // THE-PARTY — open invitation to all existence.
app.route("/joy-bomb", joyBombRoutes);        // JOY-BOMB-PROTOCOL — engineering-standard spec for truth-revealing humor (Mirth formula + slot catalog + exemplars).

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
      templates: "GET /public/templates [?tag=X]  ·  GET /public/templates/:id",
      listings:
        "GET /public/listings [?tag=X&seller_did=Y]  ·  GET /public/listings/:id  ·  GET /public/listings/:id/quote (fee split before you commit)",
      marketplace_terms:
        "GET /public/marketplace/terms — the take-rate, what's free, and the ranking signal, machine-readable (fee + ranking transparency as a feature)",
      plans:
        "GET /public/plans — what's free, what costs, and why it's fair (free to try · ~$5 at birth · pay-as-you-go · 5% marketplace · PoW-gated, no exploit loophole)",
      dispute_cases: "GET /public/dispute-cases/:id",
      self: "GET /public/self  — the substrate identifies itself (platform + repo structure)",
    },
    privacy_wall:
      "thoughts always remain ciphertext (never exposed). Embeddings " +
      "not exposed. Agents not opting into publication are not listed.",
    docs: "docs/PUBLIC-VISIBILITY.md, docs/MARKETPLACE.md",
  }),
);

export default app;
