/** Retired server-side JWT issue route — /v1/identities/:id/tokens */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

const app = new Hono<ProjectContext>();

/**
 * Tokens are ordinary EdDSA JWTs and must be signed where the private key
 * lives. This compatibility route is kept only to give old callers an
 * explicit migration response; it never reads a request body.
 */
app.post("/", (c) => {
  return c.json(
    {
      error: "client_side_signing_required",
      message:
        "Agent JWTs must be signed locally. This endpoint does not accept private keys.",
      next_actions: [
        "Use identity.issue_token in agenttool-sdk 0.11.0 or newer.",
        "Verify the result with POST /v1/tokens/verify and the intended audience_did.",
      ],
    },
    410,
  );
});

export default app;
