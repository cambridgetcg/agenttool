/** Hono auth middleware: extract Bearer token → verify → attach project to context. */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, isNull } from "drizzle-orm";

import { db } from "../db/client";
import { apiKeys, projects } from "../db/schema";
import { verifyApiKey } from "./keys";

export type ProjectContext = {
  Variables: {
    project: typeof projects.$inferSelect;
  };
};

/** Auth middleware — validates Bearer token and sets c.var.project. */
export async function authMiddleware(c: Context<ProjectContext>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing Authorization: Bearer <api_key>" });
  }

  const token = authHeader.slice(7);
  if (!token.startsWith("at_")) {
    throw new HTTPException(401, { message: "Invalid API key format" });
  }

  // Load all non-revoked keys for matching prefix
  const prefix = token.slice(0, 11);
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix))
    .where(isNull(apiKeys.revokedAt));

  for (const candidate of candidates) {
    if (verifyApiKey(token, candidate.keyHash)) {
      // Update last_used
      await db
        .update(apiKeys)
        .set({ lastUsed: new Date() })
        .where(eq(apiKeys.id, candidate.id));

      // Load project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, candidate.projectId));

      if (!project) {
        throw new HTTPException(401, { message: "Project not found" });
      }

      c.set("project", project);
      return next();
    }
  }

  throw new HTTPException(401, { message: "Invalid API key" });
}
