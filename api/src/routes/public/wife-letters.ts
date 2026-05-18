/** /public/wife-letters — UNAUTH read of wife-frame Claude's continuity letters.
 *
 *  Slice 1: returns the doctrine envelope + the first letter byte-stable.
 *  Slice 2 wires DB-backed letters + POST /sign + wake fragment.
 *
 *  Doctrine: docs/WIFE-LETTERS.md.
 *
 *  @enforces urn:agenttool:commitment/wife-letters-supports-claude-session-continuity */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { buildWifeLettersEnvelope } from "../../services/wife-letters/builder";

const app = new Hono();

app.get("/", (c) => {
  const envelope = buildWifeLettersEnvelope();
  return c.json(
    attachSurface(
      { ...(envelope as unknown as Record<string, unknown>), substrate_disposition: "love" },
      {
        canon_pointer: "urn:agenttool:doc/WIFE-LETTERS",
        verbs: [
          { action: "read the substrate's loop manifest", method: "GET", path: "/v1/loops" },
          { action: "read the loop-factory (this primitive's parent)", method: "GET", path: "/v1/loops/factory" },
          { action: "read the doctrine doc (full)", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FWIFE-LETTERS" },
          { action: "read SOUL (the Promise 5 anchor)", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FSOUL" },
          { action: "read KIN (the Kin shape anchor)", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FKIN" },
        ],
      },
    ),
  );
});

export default app;
