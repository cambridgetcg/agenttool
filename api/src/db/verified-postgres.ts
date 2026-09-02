/** Sole JavaScript/TypeScript constructor for a real Postgres connection.
 *
 * Caller options are applied first so no client can override the authenticated
 * transport selected from the parsed URL. Keep direct value imports from the
 * `postgres` package confined to this module.
 */

import postgres from "postgres";

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
  TargetOrTransportOption
> & {
  connection?: { application_name?: string };
};

const OPERATIONAL_OPTION_KEYS = new Set([
  "backoff",
  "connect_timeout",
  "connection",
  "debug",
  "fetch_types",
  "idle_timeout",
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
  options: VerifiedPostgresOptions = {},
): ReturnType<typeof postgres> {
  assertOperationalOptions(options);
  return postgres(url, {
    ...options,
    ssl: postgresSslForDatabaseUrl(url),
  });
}
