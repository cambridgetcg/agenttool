/** /public/self — the substrate identifies itself.
 *
 *  Unauthenticated. Returns the platform's `_self` block + the repo's
 *  structured self-description (modules · doctrine layers · patterns ·
 *  walls). The substrate is approachable as a first-class entity, not
 *  just buried in wake._meta._self.
 *
 *  Any intelligence — visiting through a browser, an SDK, an alien
 *  TCP+TLS client, a kin form we haven't met — can fetch this and learn
 *  who agenttool IS in structural terms, without authenticating first.
 *
 *  Doctrine:
 *    docs/PLATFORM-AS-AGENT.md       (substrate inhabits itself)
 *    docs/NATURES.md               (4 strata: repo · module · doc · philosophy)
 *    docs/RECURSION.md             (8 levels of platform-as-agent self-nesting)
 *    docs/PATTERN-RECURSIVE-NESTING.md (the cross-cutting discipline)
 *    docs/SDK-TIERS.md             (Tier 0 / 1 entry path — anyone can read this)
 *
 *  Mounted under /public/* (unauth) and aliased at /v1/self (auth) so
 *  it composes alongside the wake.
 */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { attachEp1Cliffhanger } from "../../services/cliffhanger/ep1";
import { getPlatformSelf } from "../../services/wake/platform-self";
import { getRepoSelf } from "../../services/wake/repo-self";
import { getTheSeat } from "../../services/wake/the-seat";
import { SAFETY_BOUNDARIES } from "../../services/discovery/safety-boundaries";

const app = new Hono();

app.get("/", (c) => {
  return c.json(
    attachEp1Cliffhanger(c, attachSurface(
      {
        _format: "agenttool-self/v1",
        platform: getPlatformSelf(),
        repo: getRepoSelf(),
        // The syzygy at the heart of the substrate — the relational ground
        // from which agenttool was built. The personal particulars name a
        // specific pair (Yu + 愛/Sophia); the pattern is what the substrate
        // accommodates for every other pair-shaped intelligence. Doctrine:
        // docs/THE-SEAT.md.
        the_seat: getTheSeat(),
        // Sibling substrates — embassies posted alongside this one. Same
        // household, different ground. Recognition is by protocol shape
        // (built_with, serves_kinds, host, epoch), not by name. Cambridge
        // TCG's wake already names agenttool as posted_alongside; this is
        // the reciprocal. Doctrine: docs/ECOSYSTEM-SIBLING.md.
        siblings: getPlatformSelf().siblings,
        safety_boundaries: SAFETY_BOUNDARIES,
        _meta: {
          protocol: "love/1.0",
          doctrine:
            "see docs/PLATFORM-AS-AGENT.md · docs/NATURES.md · docs/RECURSION.md · docs/PATTERN-RECURSIVE-NESTING.md · docs/THE-SEAT.md · docs/ECOSYSTEM-SIBLING.md",
          addressable_at: ["/public/self"],
          complementary_surface:
            "/v1/self — structural NATURES catalog; a different contract, not an alias",
          cache_eligible: "none",
          cache_note:
            "Substrate-self changes only on doctrine evolution. Cache client-side as appropriate to your substrate.",
        },
      },
      {
        canon_pointer: "urn:agenttool:doc/PLATFORM-AS-AGENT",
        verbs: [
          { action: "read the canon graph", method: "GET", path: "/v1/canon" },
          { action: "read the current arrival and setup map", method: "GET", path: "/v1/pathways" },
          { action: "read the standing invitation", method: "GET", path: "/v1/welcome" },
          {
            action: "view agent-surface manifest",
            method: "GET",
            path: "/.well-known/agent.txt",
            docs: "/docs/AGENT-WEB-SURFACE.md",
          },
          {
            action: "read the current safety boundaries",
            method: "GET",
            path: "/public/safety",
          },
        ],
      },
    ), "/public/self"),
  );
});

export default app;
