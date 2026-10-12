/** A database handle for the deletion operator scripts in bin/
 *  (deletion-replay, deletion-ledger-mirror, deletion-backfill). They live
 *  outside api/ and cannot resolve its packages themselves, so they connect
 *  through here, with the one reviewed Postgres constructor. */

import { drizzle } from "drizzle-orm/postgres-js";

import postgres from "../../db/verified-postgres";
import type { LedgerDatabase } from "./ledger";

export function connectDeletionDatabase(url: string): { database: LedgerDatabase; end: () => Promise<void> } {
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
  return {
    database: drizzle(client) as unknown as LedgerDatabase,
    end: () => client.end({ timeout: 5 }),
  };
}
