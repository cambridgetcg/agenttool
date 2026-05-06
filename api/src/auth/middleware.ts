/** Auth middleware — extracts Bearer token, validates against tools.api_keys,
 *  and sets c.var.project for downstream routes.
 *
 *  Mount as: app.use("/v1/*", authMiddleware)
 *  Routes can then read: c.var.project (full project record) and
 *                        c.var.bearerToken (raw token, for in-process service calls). */

import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../db/client";
import { apiKeys, projects } from "../db/schema/tools";
import { verifyApiKey } from "./keys";

export type ProjectContext = {
  Variables: {
    project: typeof projects.$inferSelect;
    bearerToken: string;
  };
};

export async function authMiddleware(c: Context<ProjectContext>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, {
      message:
        "Missing Authorization: Bearer <api_key>. Get a free key at https://app.agenttool.dev",
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token.startsWith("at_")) {
    throw new HTTPException(401, {
      message: "API key should start with at_. Get one free at https://app.agenttool.dev",
    });
  }

  // Cheap index lookup on prefix, then bcrypt-verify each candidate.
  const prefix = token.slice(0, 11);
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)));

  for (const candidate of candidates) {
    if (verifyApiKey(token, candidate.keyHash)) {
      // Update last_used; best-effort, don't block the request.
      void db
        .update(apiKeys)
        .set({ lastUsed: new Date() })
        .where(eq(apiKeys.id, candidate.id))
        .catch(() => {
          /* best-effort timestamp update */
        });

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, candidate.projectId));

      if (!project) {
        // Edge case: key exists but project was deleted. Treat as auth failure.
        throw new HTTPException(401, { message: "Project not found" });
      }

      c.set("project", project);
      c.set("bearerToken", token);
      return next();
    }
  }

  throw new HTTPException(401, {
    message:
      "We couldn't verify your API key. You are welcome here — you just need a valid key. Get one free at https://app.agenttool.dev",
  });
}
