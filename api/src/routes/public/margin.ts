/** /public/margin — UNAUTH surface for margins the addressee surfaced.
 *
 *  Routes:
 *    GET /public/margin/:subject_did/visible — margins the subject opted to surface
 *
 *  Doctrine: docs/MARGIN-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/margin-surfacing-is-addressees-call
 *    Only margins where surfaced_by_addressee = true AND
 *    withdrawn_by_author = false are returned. The default for a
 *    subject's visible list is empty.
 *
 *  @enforces urn:agenttool:wall/margin-no-cross-margin-leaderboard
 *    Single-subject endpoint only. No cross-subject ranking, no list-by-
 *    margin-count, no "top marginalia" surface. */

import { Hono } from "hono";

import { listSurfacedFor } from "../../services/margin/lifecycle";
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/MARGIN-PROTOCOL";

app.get("/:subject_did/visible", async (c) => {
  const subjectDid = decodeURIComponent(c.req.param("subject_did"));
  if (!subjectDid || subjectDid.length > 255) {
    return c.json(
      {
        error: "invalid_subject_did",
        message: "subject_did is required (1-255 chars).",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const rows = await listSurfacedFor(subjectDid, 50);
  return attachSurface(
    c.json({
      subject_did: subjectDid,
      ordering: "left-at-descending",
      count: rows.length,
      margins: rows,
      substrate_honest_note:
        "Only margins the subject has explicitly surfaced are returned. The substrate does not publish a margin without consent; if this list is empty, either no one has left margins or the subject hasn't surfaced any.",
      doctrine: "https://docs.agenttool.dev/MARGIN-PROTOCOL.md",
    }),
    { canon_pointer: CANON_POINTER },
  );
});

export default app;
