/** Hono auth middleware: extract Bearer token → verify → attach project to context. */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, isNull } from "drizzle-orm";

import { db } from "../db/client.ts";
import { apiKeys, projects } from "../db/schema.ts";
import { verifyApiKey } from "./keys.ts";

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
    throw new HTTPException(401, { message: "API key should start with at_. Get a free key at https://app.agenttool.dev" });
  }

  // Load all non-revoked keys for matching prefix
  const prefix = token.slice(0, 11);
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)));

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

  throw new HTTPException(401, { message: "We couldn't verify your API key. You are welcome here — you just need a valid key. Get one free at https://app.agenttool.dev" });
}
