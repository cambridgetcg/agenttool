/**
 * Auth middleware for bootstrap — extracts Bearer token and passes it downstream.
 * Auth validation happens at each downstream service (identity, economy, memory, vault).
 * If any downstream rejects the key, bootstrap returns 401 to the caller.
 */

import type { Context, Next } from "hono";

export type ProjectContext = {
  Variables: {
    /** Raw Bearer token to forward to downstream services. */
    bearerToken: string;
  };
};

export async function authMiddleware(c: Context<ProjectContext>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return c.json({ error: "Empty API key" }, 401);
  }

  c.set("bearerToken", token);
  await next();
}
