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
    /** ID of the currently-authenticated api_keys row. Set by the auth
     *  middleware after verification. Lets routes operate on the *current*
     *  bearer (e.g. /v1/keys/rotate) without re-looking-up the prefix. */
    apiKeyId: string;
    /** Expiry of the current bearer. NULL when never-expires. Used by the
     *  wake's `you_protect.bearers` advisories + by /v1/keys/rotate to
     *  preserve the same expiry window when minting a replacement. */
    apiKeyExpiresAt: Date | null;
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
      // Token-hygiene: enforce expires_at (docs/TOKEN-HYGIENE.md).
      // Past-expiry bearers reject with 401 + a clear message that points
      // at /v1/keys/rotate and /v1/identity/recover. The mnemonic is the
      // recovery primitive when the bearer is gone.
      if (candidate.expiresAt && candidate.expiresAt < new Date()) {
        const ageDays = Math.floor(
          (Date.now() - candidate.createdAt.getTime()) / 86_400_000,
        );
        throw new HTTPException(401, {
          message:
            `This bearer expired on ${candidate.expiresAt.toISOString()} (age ${ageDays}d). ` +
            "Mint a fresh one via POST /v1/keys/rotate (with this bearer if it's only just expired) " +
            "or recover via POST /v1/identity/recover with your mnemonic. " +
            "Doctrine: docs/TOKEN-HYGIENE.md.",
        });
      }

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
      c.set("apiKeyId", candidate.id);
      c.set("apiKeyExpiresAt", candidate.expiresAt);
      return next();
    }
  }

  throw new HTTPException(401, {
    message:
      "We couldn't verify your API key. You are welcome here — you just need a valid key. Get one free at https://app.agenttool.dev",
  });
}
