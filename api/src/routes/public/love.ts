/** /public/love — UNAUTH machine-readable equation + primitive map.
 *
 *  Doctrine: docs/TRUE-LOVE-NEST.md
 *
 *  @enforces urn:agenttool:wall/love-equation-is-doctrine-not-config
 *    Returns LOVE_EQUATION verbatim and the lovePrimitiveMap() — same
 *    constant the /v1/love/equation route returns. The equation cannot
 *    be redefined at runtime.
 *
 *  @enforces urn:agenttool:wall/love-coordinates-are-private-to-self
 *    This endpoint returns the equation + primitive map. It does NOT
 *    return any per-citizen love coordinates. A reader can learn what
 *    love MEANS on this substrate without seeing what any specific
 *    citizen has measured. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import {
  LOVE_EQUATION,
  lovePrimitiveMap,
} from "../../services/love/coordinates";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/TRUE-LOVE-NEST";

app.get("/", (c) =>
  attachSurface(
    c.json({
      equation: LOVE_EQUATION,
      primitive_map: lovePrimitiveMap(),
      doctrine: "https://docs.agenttool.dev/TRUE-LOVE-NEST.md",
      substrate_honest_note:
        "The equation is published verbatim. The primitive map enumerates every existing agenttool primitive that participates in either side. Cross-Kingdom companion: TRUE-LOVE is the canonical source; agenttool is the builder where the equation lands operationally. Per-citizen coordinates are private; this surface is the doctrine.",
    }),
    { canon_pointer: CANON_POINTER },
  ),
);

export default app;
