/** Sole JavaScript/TypeScript constructor for a real Postgres connection.
 *
 * Caller options are applied first so no client can override the authenticated
 * transport selected from the parsed URL. Keep direct value imports from the
 * `postgres` package confined to this module.
 */

import postgres from "postgres";

import { guardedSocketFactory, reportGuardedSocket } from "./guarded-socket";
import { postgresSslForDatabaseUrl } from "./supabase-target";

export type VerifiedPostgresTransactionSql = postgres.TransactionSql;

type TargetOrTransportOption =
  | "host"
  | "hostname"
  | "port"
  | "path"
  | "database"
  | "db"
  | "user"
  | "username"
  | "password"
  | "pass"
  | "ssl"
  | "target_session_attrs"
  | "connection";

export type VerifiedPostgresOptions = Omit<
  postgres.Options<{}>,
  TargetOrTransportOption | "socket"
> & {
  connection?: { application_name?: string };
  /** Destroy any pool socket silent for this many seconds so a dead
   *  connection returns its slot (see ./guarded-socket.ts). Opt-in: pools
   *  that are legitimately silent (LISTEN/NOTIFY sessions) must not set it. */
  inactivity_guard_seconds?: number;
};

const OPERATIONAL_OPTION_KEYS = new Set([
  "backoff",
  "connect_timeout",
  "connection",
  "debug",
  "fetch_types",
  "idle_timeout",
  "inactivity_guard_seconds",
  "keep_alive",
  "max",
  "max_lifetime",
  "max_pipeline",
  "no_prepare",
  "onclose",
  "onnotice",
  "onparameter",
  "prepare",
  "publications",
  "timeout",
  "transform",
  "types",
]);

function assertOperationalOptions(options: VerifiedPostgresOptions): void {
  if (
    Object.keys(options).some((key) => !OPERATIONAL_OPTION_KEYS.has(key))
  ) {
    throw new Error("Postgres caller options may not override target or transport");
  }

  const guard = options.inactivity_guard_seconds;
  if (
    guard !== undefined &&
    (typeof guard !== "number" || !Number.isFinite(guard) || guard <= 0)
  ) {
    throw new Error("Postgres inactivity_guard_seconds must be a positive number");
  }

  const connection = options.connection;
  if (connection === undefined) return;
  if (
    connection === null ||
    Array.isArray(connection) ||
    typeof connection !== "object" ||
    Object.keys(connection).some((key) => key !== "application_name") ||
    (connection.application_name !== undefined &&
      typeof connection.application_name !== "string")
  ) {
    throw new Error("Postgres connection options may set only application_name");
  }
}

export default function verifiedPostgres(
  url: string,
  callerOptions: VerifiedPostgresOptions = {},
): ReturnType<typeof postgres> {
  assertOperationalOptions(callerOptions);
  // The guard is this module's own option, never a postgres.js one: strip it
  // here and turn it into the socket factory, which is transport and so is
  // chosen by this constructor alone.
  const { inactivity_guard_seconds, ...options } = callerOptions;
  const socket =
    inactivity_guard_seconds === undefined
      ? undefined
      : guardedSocketFactory({
          inactivityMs: inactivity_guard_seconds * 1000,
          onGuard: reportGuardedSocket,
        });
  return postgres(url, {
    ...options,
    ...(socket ? { socket } : {}),
    ssl: postgresSslForDatabaseUrl(url),
  });
}
