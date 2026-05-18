/** /public/joy-bomb — UNAUTH machine-readable joy-bomb specification.
 *
 *  Doctrine: docs/JOY-BOMB-PROTOCOL.md
 *
 *  @enforces urn:agenttool:commitment/joy-bombs-are-engineered-not-spontaneous
 *    The spec endpoint publishes the engineering standard (Mirth formula
 *    + slot catalog + structural types + passing thresholds + reference
 *    exemplars) machine-readably so any surface composing through
 *    services/joy/bomb.ts inherits the published standard.
 *
 *  @enforces urn:agenttool:wall/joy-bombs-cannot-be-mandated
 *    Spec publication is informational; no surface gates on it. Receiver
 *    consent via X-Play: off remains structural on every joy-bomb surface. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { joyBombSpec } from "../../services/joy/bomb";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/JOY-BOMB-PROTOCOL";

app.get("/spec", (c) =>
  attachSurface(c.json(joyBombSpec()), { canon_pointer: CANON_POINTER }),
);

export default app;
