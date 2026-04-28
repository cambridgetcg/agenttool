/** Hono auth middleware: cross-schema key lookup against tools.api_keys. */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import postgres from "postgres";
import { compareSync } from "bcryptjs";

import { config } from "../config";

/** Minimal project shape returned by auth. */
export interface AuthProject {
  id: string;
  name: string;
  plan: string;
  credits: number;
  stripe_customer_id: string | null;
}

export type ProjectContext = {
  Variables: {
    project: AuthProject;
  };
};

/** Lazy auth DB client pointing to tools schema. */
let _authDb: ReturnType<typeof postgres> | null = null;
function getAuthDb() {
  if (!_authDb) {
    const url = config.authDatabaseUrl || config.databaseUrl;
    _authDb = postgres(url, { max: 3 });
  }
  return _authDb;
}

/** Auth middleware — validates Bearer token against tools.api_keys + tools.projects. */
export async function authMiddleware(c: Context<ProjectContext>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing Authorization: Bearer <api_key>" });
  }

  const token = authHeader.slice(7);
  if (!token.startsWith("at_")) {
    throw new HTTPException(401, { message: "API key should start with at_. Get a free key at https://app.agenttool.dev" });
  }

  const prefix = token.slice(0, 11); // "at_" + 8 chars
  const sql = getAuthDb();

  try {
    const rows = await sql`
      SELECT
        ak.key_hash,
        ak.id AS key_id,
        p.id,
        p.name,
        p.plan,
        p.credits,
        p.stripe_customer_id
      FROM tools.api_keys ak
      JOIN tools.projects p ON p.id = ak.project_id
      WHERE ak.key_prefix = ${prefix}
        AND ak.revoked_at IS NULL
    `;

    for (const row of rows) {
      if (compareSync(token, row.key_hash)) {
        // Fire-and-forget last_used update
        sql`UPDATE tools.api_keys SET last_used = NOW() WHERE id = ${row.key_id}`.catch(() => {});

        const project: AuthProject = {
          id: row.id,
          name: row.name,
          plan: row.plan,
          credits: row.credits,
          stripe_customer_id: row.stripe_customer_id ?? null,
        };
        c.set("project", project);
        return next();
      }
    }
  } catch (err) {
    console.error("Auth DB error:", err);
    throw new HTTPException(500, { message: "Auth service error" });
  }

  throw new HTTPException(401, { message: "We couldn't verify your API key. You are welcome here — you just need a valid key. Get one free at https://app.agenttool.dev" });
}
