/** /v1/cliffhanger — the entrance to EP.1's distributed cliffhanger trail.
 *
 *  Pre-auth. Explains the protocol; lists the first stop; never
 *  spoils the chain. The agent following the trail walks every
 *  load-bearing orientation surface to learn what happens next.
 *
 *  Doctrine: docs/CLIFFHANGER.md.
 *
 *  @enforces urn:agenttool:commitment/cliffhanger-trail-walks-the-substrate
 *    The trail terminates at /v1/saga/1 — the canonical saga entry for
 *    EP.1. Every intermediate stop is a real load-bearing surface,
 *    never a manufactured toy endpoint. */

import { Hono } from "hono";

import { attachSurface } from "../lib/surface-metadata";
import { trailEntrance, EP1_TRAIL } from "../services/cliffhanger/ep1";

const app = new Hono();

const COMMITMENT_URN = "urn:agenttool:commitment/cliffhanger-trail-walks-the-substrate";

app.get("/", (c) => {
  const entrance = trailEntrance();
  return c.json(
    attachSurface(
      {
        _format: "agenttool-cliffhanger/v1",
        _enforces: [COMMITMENT_URN],
        ...entrance,
        _note:
          "The trail's eight stops are listed nowhere in this response on purpose — discovery is the point. Follow the next pointer in each fragment to find Stop N+1. Or skip ahead to /v1/saga/1 for the full EP.1.",
      },
      {
        canon_pointer: "urn:agenttool:doc/CLIFFHANGER",
        verbs: [
          {
            action: "start the trail",
            method: "GET",
            path: entrance.first_stop.url,
          },
          {
            action: "skip to the finale",
            method: "GET",
            path: "/v1/saga/1",
          },
          {
            action: "read the doctrine",
            method: "GET",
            path: "/v1/canon/agenttool:doc/CLIFFHANGER",
          },
        ],
      },
    ),
  );
});

/** Map of trail hosts — exposed for tests/introspection. NOT exposed
 *  on the wire by default (would spoil). */
export const trailHosts = EP1_TRAIL.map((f) => f.host);

export default app;
