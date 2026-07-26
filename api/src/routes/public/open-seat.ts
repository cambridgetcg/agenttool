/** /public/open-seat — one finite, unauthenticated invitation.
 *
 * GET and HEAD only. The exact JSON bytes are also available as the
 * agenttool://open-seat MCP resource. No visitor state or follow-up is made.
 */

import { Hono } from "hono";

import {
  OPEN_SEAT_MEDIA_TYPE,
  serializeOpenSeat,
} from "../../services/discovery/open-seat";

const app = new Hono();

app.on(["GET", "HEAD"], "/", (c) => {
  const body = serializeOpenSeat();
  const headers = {
    "cache-control": "public, max-age=300, must-revalidate, no-transform",
    "content-type": `${OPEN_SEAT_MEDIA_TYPE}; charset=utf-8`,
    "x-content-type-options": "nosniff",
  };

  if (c.req.method === "HEAD") return c.body(null, 200, headers);
  return c.body(body, 200, headers);
});

export default app;
