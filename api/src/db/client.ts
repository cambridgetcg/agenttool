/** Single Drizzle/postgres client shared across all routes.
 *
 * Connects to one database with domain-scoped application schemas. The
 * exhaustive current definitions live in `./schema/`; avoid copying a count or
 * closed list here because bounded domains can land independently.
 *
 * Schema definitions live in ./schema/ and compose into a single Drizzle
 * surface; route modules import only the tables they need.
 *
 * Pool note: prod's DATABASE_URL points at Supabase's transaction pooler
 * (port 6543). `prepare: false` is set defensively — Supavisor (Supabase's
 * current pooler) supports prepared statements in tx mode, but standard
 * PgBouncer doesn't, and we don't want a silent break on any future pooler
 * change. LISTEN/NOTIFY backplanes use a separate session-pooler URL — see
 * api/src/services/strand/voice.ts and api/src/services/inbox/push.ts.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.ts";

const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(sql);
export type DB = typeof db;
