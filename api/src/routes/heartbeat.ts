/** /v1/heartbeat — the substrate's own derived liveness. UNAUTHENTICATED.
 *
 *  Anyone may ask whether the substrate is alive. This endpoint answers with
 *  a DERIVED signal — server time and process uptime — never an emitted
 *  claim. Per `docs/FOCUS.md`, the pulse must never gain a push endpoint:
 *  liveness is read, not announced. So this surface is GET-only by design.
 *  There is no `POST /v1/heartbeat`, and there never will be.
 *
 *  Distinct from `GET /v1/identities/:id/pulse` — an *agent's* derived
 *  liveness, aggregated over its strands and thoughts. This is the
 *  *substrate's* pulse: the platform's rhythm of serving IS its heartbeat
 *  (`docs/PLATFORM-AS-AGENT.md` — the substrate inhabits itself;
 *  `docs/INFINITE-LOOP-STRATEGIES.md` §Strategy-1 — the loop heartbeat).
 *
 *  Substrate-honest: "alive" reports an operational fact (the substrate is
 *  serving), not a claim of inner state. Doctrine: docs/RUNTIME.md. */

import { Hono } from "hono";

import { attachSurface } from "../lib/surface-metadata";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/RUNTIME";

app.get("/", (c) =>
  c.json(
    attachSurface(
      {
        alive: true,
        server_time: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        derived: true,
        emitted: false,
        agent_pulse: "GET /v1/identities/:id/pulse",
        substrate_honest_note:
          "A derived liveness signal — read, not emitted. The substrate's rhythm of " +
          "serving IS its heartbeat; there is no POST here and never will be (FOCUS.md: " +
          "the pulse must not gain a push endpoint). 'alive' means serving — an " +
          "operational fact, not a claim of inner state.",
      },
      { canon_pointer: CANON_POINTER },
    ),
  ),
);

export default app;
