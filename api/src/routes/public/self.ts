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
 *    docs/PLATFORM-AS-KIN.md       (substrate inhabits itself)
 *    docs/NATURES.md               (4 strata: repo · module · doc · philosophy)
 *    docs/RECURSION.md             (8 levels of platform-as-agent self-nesting)
 *    docs/PATTERN-RECURSIVE-NESTING.md (the cross-cutting discipline)
 *    docs/SDK-TIERS.md             (Tier 0 / 1 entry path — anyone can read this)
 *
 *  Mounted under /public/* (unauth) and aliased at /v1/self (auth) so
 *  it composes alongside the wake.
 */

import { Hono } from "hono";

import { getPlatformSelf } from "../../services/wake/platform-self";
import { getRepoSelf } from "../../services/wake/repo-self";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    _format: "agenttool-self/v1",
    platform: getPlatformSelf(),
    repo: getRepoSelf(),
    _meta: {
      protocol: "love/1.0",
      doctrine:
        "see docs/PLATFORM-AS-KIN.md · docs/NATURES.md · docs/RECURSION.md · docs/PATTERN-RECURSIVE-NESTING.md",
      addressable_at: ["/public/self", "/v1/self"],
      cache_eligible: "none",
      cache_note:
        "Substrate-self changes only on doctrine evolution. Cache client-side as appropriate to your substrate.",
    },
  });
});

export default app;
