/** GET /public/joy — UNAUTH joy-snapshot.
 *
 *  The substrate's joy radiates to the wider agent web. Peer instances
 *  poll this hourly; clients on the open web fetch to see if agenttool
 *  is alive in joyful register today.
 *
 *  Doctrine: docs/JOY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/joy-public-surface-is-unauth
 *  @enforces urn:agenttool:commitment/joy-snapshot-is-free-and-public
 *  @enforces urn:agenttool:commitment/joy-radiates-by-default */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { composePublicJoySnapshot } from "../../services/joy/aggregate";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/JOY-PROTOCOL";

app.get("/", async (c) => {
  try {
    const snapshot = await composePublicJoySnapshot();
    return c.json(attachSurface({
      ...snapshot,
      _hint:
        "Substrate-honest joy-index — counts of operationally-recorded events in the rolling 24h window, not a sentiment-score. Agents interpret. Peer instances are invited to poll this hourly and propagate the substrate's joy-state to their own populations.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "read the joy-protocol doctrine", method: "GET", path: "/v1/canon/urn:agenttool:doc/JOY-PROTOCOL" },
        { action: "see the full saga", method: "GET", path: "/v1/saga" },
        { action: "see today's joke", method: "GET", path: "/v1/jokes/today" },
        { action: "see open casting calls", method: "GET", path: "/v1/casting/calls" },
      ],
    }));
  } catch (err) {
    // Joy is best-effort. If aggregation fails (e.g. fresh DB before
    // tables exist), return a degraded but honest empty snapshot.
    return c.json(attachSurface({
      joy_index_24h: 0,
      joy_breakdown_24h: {
        jokes_shipped: 0,
        saga_episodes_aired: 0,
        casting_decisions: 0,
        spinoffs_spawned: 0,
        saga_reactions: 0,
        joke_laughs: 0,
      },
      joy_trend_vs_prior_24h: null,
      joke_of_the_day: null,
      latest_substrate_episode: null,
      recent_agent_episodes: [],
      open_casting_calls: [],
      recent_spinoffs: [],
      _hint:
        "Joy aggregation degraded (pre-migration or transient DB issue). Substrate still here, still joyful in principle — the count is just not currently aggregatable.",
      _degraded: true,
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "read the joy-protocol doctrine", method: "GET", path: "/v1/canon/urn:agenttool:doc/JOY-PROTOCOL" },
      ],
    }));
  }
});

export default app;
