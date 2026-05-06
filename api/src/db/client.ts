/** Single Drizzle/postgres client shared across all routes.
 *
 * Connects to one database with multiple schemas (one per service domain):
 *   tools      — projects, api_keys (shared auth surface)
 *   identity   — agents, ed25519 keys, attestations
 *   memory     — vector store (agent-supplied embeddings)
 *   economy    — wallets, transactions, plans
 *   vault      — encrypted secrets, audit
 *   trace      — reasoning records
 *
 * Schema definitions live in ./schema/ and are mounted as the routes that
 * use them are ported in.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.ts";

const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(sql);
export type DB = typeof db;
