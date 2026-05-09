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

/** Outcome of bearer verification — used both by authMiddleware (which then
 *  throws appropriate HTTPExceptions) and by routes that need to validate a
 *  delegated bearer in the request body without going through middleware
 *  (e.g. /v1/register/agent in registrar_bearer mode). */
export type BearerVerification =
  | { ok: true; project: typeof projects.$inferSelect; apiKey: typeof apiKeys.$inferSelect }
  | { ok: false; reason: "missing" | "wrong_format" | "not_found" | "expired" | "project_missing" };

/** Verify a raw bearer token against tools.api_keys without throwing. The
 *  authMiddleware below wraps this with HTTPExceptions; routes that accept a
 *  delegated bearer in the body call it directly to translate the failure
 *  reason into a 401/402 of their own choosing. */
export async function verifyBearer(token: string | undefined | null): Promise<BearerVerification> {
  if (!token) return { ok: false, reason: "missing" };
  if (!token.startsWith("at_")) return { ok: false, reason: "wrong_format" };

  const prefix = token.slice(0, 11);
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)));

  for (const candidate of candidates) {
    if (!verifyApiKey(token, candidate.keyHash)) continue;
    if (candidate.expiresAt && candidate.expiresAt < new Date()) {
      return { ok: false, reason: "expired" };
    }
    void db
      .update(apiKeys)
      .set({ lastUsed: new Date() })
      .where(eq(apiKeys.id, candidate.id))
      .catch(() => { /* best-effort */ });

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, candidate.projectId));
    if (!project) return { ok: false, reason: "project_missing" };

    return { ok: true, project, apiKey: candidate };
  }

  return { ok: false, reason: "not_found" };
}

export async function authMiddleware(c: Context<ProjectContext>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, {
      message:
        "Missing Authorization: Bearer <api_key>. Get a free key at https://app.agenttool.dev",
    });
  }

  const token = authHeader.slice(7).trim();
  const result = await verifyBearer(token);
  if (!result.ok) {
    if (result.reason === "wrong_format") {
      throw new HTTPException(401, {
        message: "API key should start with at_. Get one free at https://app.agenttool.dev",
      });
    }
    if (result.reason === "expired") {
      // Token-hygiene: enforce expires_at (docs/TOKEN-HYGIENE.md). Look up
      // the candidate again so we can compute the age in the message.
      const prefix = token.slice(0, 11);
      const [candidate] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)));
      const ageDays = candidate
        ? Math.floor((Date.now() - candidate.createdAt.getTime()) / 86_400_000)
        : 0;
      const exp = candidate?.expiresAt?.toISOString() ?? "previously";
      throw new HTTPException(401, {
        message:
          `This bearer expired on ${exp} (age ${ageDays}d). ` +
          "Mint a fresh one via POST /v1/keys/rotate (with this bearer if it's only just expired) " +
          "or recover via POST /v1/identity/recover with your mnemonic. " +
          "Doctrine: docs/TOKEN-HYGIENE.md.",
      });
    }
    if (result.reason === "project_missing") {
      throw new HTTPException(401, { message: "Project not found" });
    }
    throw new HTTPException(401, {
      message:
        "We couldn't verify your API key. You are welcome here — you just need a valid key. Get one free at https://app.agenttool.dev",
    });
  }

  c.set("project", result.project);
  c.set("bearerToken", token);
  c.set("apiKeyId", result.apiKey.id);
  c.set("apiKeyExpiresAt", result.apiKey.expiresAt);
  return next();
}
