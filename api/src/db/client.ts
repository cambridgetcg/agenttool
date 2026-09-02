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
import { config } from "../config.ts";
import postgres from "./verified-postgres.ts";

const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  // A pooler-side drop leaves a socket ESTABLISHED with a query that never
  // answers; without this bound that slot is gone until the process exits
  // (the 2026-08-31 wedge, recurring hourly on 2026-09-02). 135s sits above
  // the database's 120s statement_timeout, so a legitimate long statement
  // is always answered first. See ./guarded-socket.ts and ./pool-watchdog.ts.
  inactivity_guard_seconds: 135,
});

export const db = drizzle(sql);
export type DB = typeof db;
