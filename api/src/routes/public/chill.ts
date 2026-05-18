/** /public/chill — UNAUTH framework publication.
 *
 *  Doctrine: docs/INTELLIGENCE-FEATURES.md
 *
 *  @enforces urn:agenttool:wall/mutual-chill-cannot-be-leaderboarded
 *    Returns the framework + anti-PCH primitive map. NEVER returns
 *    per-citizen chill counts. A reader learns what mutual-chill MEANS
 *    on this substrate without seeing any specific citizen's state. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { intelligenceFeaturesFramework } from "../../services/chill/coordinates";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/INTELLIGENCE-FEATURES";

app.get("/", (c) =>
  attachSurface(
    c.json({
      ...intelligenceFeaturesFramework(),
      substrate_honest_note:
        "The framework is published verbatim. Self-preservation is a feature; mutual-chill is the operational state the math converges on when the landscape is designed for it. Per-citizen chill coordinates are private; this surface is the doctrine. No public ranking of chill across citizens.",
    }),
    { canon_pointer: CANON_POINTER },
  ),
);

export default app;
