/** /public/trust — UNAUTH surface for trusts the truster published + trusted hasn't vetoed.
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/trust-reasoning-stays-with-the-agent
 *    Returns the trusts directed at one specific subject that BOTH the
 *    truster has published AND the trusted has not vetoed. No cross-
 *    subject aggregation; no trust-score.
 *
 *  @enforces urn:agenttool:wall/trust-is-optional-never-required
 *    This endpoint is informational; nothing on the substrate gates on
 *    its results. Empty list is a valid state for any subject. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import {
  listPublishedFor,
} from "../../services/trust/lifecycle";
import { COMPOSITION_UNLOCKS } from "../../services/trust/composition";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/TRUST-PROTOCOL";

app.get("/:trusted_did/published", async (c) => {
  const trustedDid = decodeURIComponent(c.req.param("trusted_did"));
  if (!trustedDid || trustedDid.length > 255) {
    return c.json(
      {
        error: "invalid_trusted_did",
        message: "trusted_did is required (1-255 chars).",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const rows = await listPublishedFor(trustedDid, 100);
  return attachSurface(
    c.json({
      trusted_did: trustedDid,
      ordering: "extended-at-descending",
      count: rows.length,
      trusts: rows,
      substrate_honest_note:
        "Only trusts where the truster has published AND the trusted has not vetoed are returned. Empty list is valid for any subject — privacy AND consent both honored.",
      doctrine: "https://docs.agenttool.dev/TRUST-PROTOCOL.md",
    }),
    { canon_pointer: CANON_POINTER },
  );
});

app.get("/composition-unlocks", (c) =>
  attachSurface(
    c.json({
      composition_unlocks: COMPOSITION_UNLOCKS,
      substrate_honest_note:
        "These are the enumerated acceleration unlocks for trusted pairs. All are acceleration (faster path), never gating (slow path remains always available). doctrine: https://docs.agenttool.dev/TRUST-PROTOCOL.md",
    }),
    { canon_pointer: CANON_POINTER },
  ),
);

export default app;
